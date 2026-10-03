/**
 * 消消乐规则层：状态、动作与存档编解码（纯函数、无副作用、无平台依赖）。
 *
 * 核心设计（墨水屏 1-bit + 无动画，这一条决定了整个状态机）：
 * 1. **一次交换 = 一次完整结算**。玩家点第一格选中、再点相邻格交换；
 *    若交换后横竖都凑不出三连，规则层**抛错并保持原状态**（棋子不动、步数不扣），
 *    壳层据此给出明确文字提示。
 * 2. **离散步进**：消除 → 下落 → 补充 → 再看有没有新的三连（连锁）全在一次 reduce 里算完，
 *    中间状态不外露，也没有任何动画/计时器。
 * 3. **补充的棋子不会当场成三连**（见 board.ts 的 forbiddenKinds），
 *    所以连锁只可能来自落下来的旧棋子，结算必然收敛；另有一道连锁轮数上限做防御。
 * 4. **撤销 = 紧凑快照**：一次交换可能牵动很多格，history 里只存「本次操作真正改动过的格子」
 *    的旧种类 + 改动前的分数/随机游标；撤销时按索引写回即可精确回到交换前的完整局面。
 *    history 进存档；decode 遇到缺字段按空栈处理。
 *
 * 确定性：随机只来自 create(seed, difficulty)；补充棋子用 `createRng(seed + 游标)`，
 * 游标每次落子 +1，因此同 seed + 同动作序列双端必然同局面，撤销也能精确回退游标。
 */
import { IllegalActionError, type GameStatus } from '@eink/core'
import {
  EMPTY,
  applyGravity,
  areAdjacent,
  buildBoard,
  cellCount,
  configFor,
  createStableBoard,
  fillEmpties,
  findGroups,
  findLegalSwaps,
  groupScore,
  hasLegalSwap,
  isIndex,
  normalizeSeed,
  swapCells,
  type BoardConfig,
} from './board.js'
import { MATCH3_ID, difficultyOrThrow, type DifficultyId } from './meta.js'

/** 连锁轮数上限：正常局面 3~4 轮就结束，超出说明出现异常盘面，直接重排并终止结算 */
export const MAX_CASCADE_ROUNDS = 32

export interface MoveRecord {
  /** 本次交换真正改动过的格子索引（升序去重） */
  readonly at: readonly number[]
  /** 与 at 一一对应的旧种类 */
  readonly old: readonly number[]
  /** 交换前的分数 */
  readonly score: number
  /** 交换前的随机游标 */
  readonly cursor: number
  /** 交换前的「最近一次重排发生在第几步」 */
  readonly lastShuffle: number
}

export interface Match3State {
  readonly difficulty: DifficultyId
  /** 开局种子：同 seed + 同难度必然得到同一盘初始棋盘 */
  readonly seed: number
  /** 行优先的棋子种类；稳定局面里没有 EMPTY */
  readonly board: readonly number[]
  readonly score: number
  /** 已用步数（成功的交换次数）；`history.length` 恒等于它 */
  readonly moves: number
  /** 已消耗的随机抽取次数（补充棋子与重排都要记账） */
  readonly cursor: number
  /** 当前选中的格子（墨水屏靠整格反白表示）；没有选中时为 null */
  readonly selected: number | null
  /** 最近一次自动重排发生在第几步（1 起算；从未重排为 -1） */
  readonly lastShuffle: number
  /** 撤销栈：每次成功交换压一条，`history.length === moves` */
  readonly history: readonly MoveRecord[]
}

export type Match3Action =
  /** 点第 index 格：没选中就选中它；点同一格取消选中 */
  | { type: 'select'; index: number }
  /** 交换相邻两格 a、b；换不出三连时抛 IllegalActionError（状态不变） */
  | { type: 'swap'; a: number; b: number }
  /** 撤销最近一次交换（含随后的消除 / 下落 / 补充），回到交换前的完整局面 */
  | { type: 'undo' }
  /** 重开：回到同难度同种子的同一盘初始棋盘 */
  | { type: 'restart' }

function illegal(reason: string): IllegalActionError {
  return new IllegalActionError(MATCH3_ID, reason)
}

/** 确定性初始状态：初始棋盘由 seed + 难度决定，分数与撤销栈都是空的 */
export function createState(seed: number, difficulty: DifficultyId): Match3State {
  const normalized = normalizeSeed(seed)
  const start = buildBoard(normalized, difficulty)
  return {
    difficulty,
    seed: normalized,
    board: start.board,
    score: 0,
    moves: 0,
    cursor: start.cursor,
    selected: null,
    lastShuffle: -1,
    history: [],
  }
}

/** 达到目标分即胜；步数用尽仍未达标即负。先判胜：最后一步既达标又用尽步数时算赢 */
export function gameStatus(state: Match3State): GameStatus {
  const config = configFor(state.difficulty)
  if (state.score >= config.targetScore) return 'won'
  if (state.moves >= config.moveLimit) return 'lost'
  return 'playing'
}

/** 剩余步数（统计栏展示） */
export function remainingMoves(state: Match3State): number {
  return Math.max(0, configFor(state.difficulty).moveLimit - state.moves)
}

export function targetScoreOf(state: Match3State): number {
  return configFor(state.difficulty).targetScore
}

/** 棋盘上还剩多少枚棋子（用于测试断言，EMPTY 只应出现在结算中间态） */
export function pieceCount(state: Match3State): number {
  let count = 0
  for (const kind of state.board) if (kind !== EMPTY) count += 1
  return count
}

interface Resolution {
  readonly board: number[]
  /** 本次结算新得的分数（不含交换前的分数） */
  readonly score: number
  readonly cursor: number
  /** 本次结算里发生自动重排时记下的步号；没重排则为 -1 */
  readonly lastShuffle: number
  /** 共消掉多少枚棋子（测试与统计用） */
  readonly cleared: number
  /** 连锁轮数（第一轮消除算 1） */
  readonly rounds: number
}

/**
 * 把「交换后的盘面」一路结算到稳定局面：消除 → 下落 → 补充 → 再看新三连。
 *
 * 分数 = 每轮各组得分之和 × 轮次系数（第 1 轮 ×1、第 2 轮 ×2…），
 * 连锁越长收益越高，但没有任何动画 —— 全部在一次调用里算完。
 *
 * 终止性：补充的棋子当场不会成三连（board.ts 的 forbiddenKinds），
 * 因此连锁只可能由落下的旧棋子触发；再加一道 MAX_CASCADE_ROUNDS 防御，
 * 超限时直接换一盘稳定新棋盘并结束结算（确定性、必然终止）。
 */
function resolveBoard(
  settled: readonly number[],
  config: BoardConfig,
  seed: number,
  cursor: number,
  moveNumber: number,
): Resolution {
  let board = settled.slice()
  let score = 0
  let at = cursor
  let lastShuffle = -1
  let cleared = 0
  let rounds = 0
  for (;;) {
    const groups = findGroups(board, config)
    if (groups.length === 0) break
    if (rounds >= MAX_CASCADE_ROUNDS) {
      const fresh = createStableBoard(config, seed, at)
      board = fresh.board
      at = fresh.cursor
      lastShuffle = moveNumber
      break
    }
    const clearedCells = new Set<number>()
    let gained = 0
    for (const group of groups) {
      gained += groupScore(group.length)
      for (const index of group) clearedCells.add(index)
    }
    score += gained * (rounds + 1)
    cleared += clearedCells.size
    for (const index of clearedCells) board[index] = EMPTY
    board = applyGravity(board, config)
    const refilled = fillEmpties(board, config, seed, at)
    board = refilled.board
    at = refilled.cursor
    rounds += 1
  }
  // 死局保护：没有任何可交换的组合时重排棋盘（玩家不至于卡死），并留下可见提示
  if (!hasLegalSwap(board, config)) {
    const fresh = createStableBoard(config, seed, at)
    board = fresh.board
    at = fresh.cursor
    lastShuffle = moveNumber
  }
  return { board, score, cursor: at, lastShuffle, cleared, rounds }
}

function assertPlaying(state: Match3State): void {
  if (gameStatus(state) !== 'playing') throw illegal('match3.illegal.finished')
}

/** 执行一次交换：换不出三连就抛错（调用方的状态原封不动），否则完整结算并记录撤销快照 */
function applySwap(state: Match3State, a: number, b: number): Match3State {
  assertPlaying(state)
  const config = configFor(state.difficulty)
  if (!isIndex(a, config) || !isIndex(b, config)) {
    throw illegal(`match3.illegal.index:${String(a)},${String(b)}`)
  }
  if (!areAdjacent(a, b, config)) throw illegal(`match3.illegal.not-adjacent:${String(a)},${String(b)}`)
  const swapped = swapCells(state.board, a, b)
  // 「被拒绝的输入要有明确反馈」：换不出三连时抛错，绝不悄悄扣步数
  if (findGroups(swapped, config).length === 0) throw illegal('match3.illegal.no-match')

  const resolution = resolveBoard(swapped, config, state.seed, state.cursor, state.moves + 1)

  // 紧凑快照：只记真正改动过的格子的旧值（升序），撤销时按索引写回
  const at: number[] = []
  const old: number[] = []
  for (let index = 0; index < state.board.length; index++) {
    const before = state.board[index]!
    if (before !== resolution.board[index]) {
      at.push(index)
      old.push(before)
    }
  }
  const record: MoveRecord = {
    at,
    old,
    score: state.score,
    cursor: state.cursor,
    lastShuffle: state.lastShuffle,
  }
  return {
    difficulty: state.difficulty,
    seed: state.seed,
    board: resolution.board,
    score: state.score + resolution.score,
    moves: state.moves + 1,
    cursor: resolution.cursor,
    selected: null,
    // 本次没重排就沿用之前的值：它是「最近一次重排」而不只是「这一步有没有重排」
    lastShuffle: resolution.lastShuffle === -1 ? state.lastShuffle : resolution.lastShuffle,
    history: [...state.history, record],
  }
}

export function reduceMatch3(state: Match3State, action: Match3Action): Match3State {
  switch (action.type) {
    case 'select': {
      assertPlaying(state)
      const config = configFor(state.difficulty)
      if (!isIndex(action.index, config)) throw illegal(`match3.illegal.index:${String(action.index)}`)
      // 再点同一格 = 取消选中（墨水屏上误触很常见，必须能退回来）
      return { ...state, selected: state.selected === action.index ? null : action.index }
    }

    case 'swap':
      return applySwap(state, action.a, action.b)

    case 'undo': {
      const record = state.history[state.history.length - 1]
      if (!record) throw illegal('match3.illegal.nothing-to-undo')
      const board = state.board.slice()
      record.at.forEach((index, slot) => {
        board[index] = record.old[slot]!
      })
      return {
        ...state,
        board,
        score: record.score,
        moves: state.moves - 1,
        cursor: record.cursor,
        selected: null,
        lastShuffle: record.lastShuffle,
        history: state.history.slice(0, -1),
      }
    }

    case 'restart':
      // 同难度同种子重开：回到同一盘初始棋盘，分数与撤销栈清空（终局后也允许）
      return createState(state.seed, state.difficulty)

    default: {
      // 未知动作（旧存档、壳层误派）明确报错，避免静默无响应
      const unknown = action as { type?: unknown }
      throw illegal(`match3.illegal.action:${String(unknown.type)}`)
    }
  }
}

/** 当前局面下被规则允许的动作（供禁用按钮、回放校验与契约测试使用） */
export function legalActions(state: Match3State): Match3Action[] {
  const config = configFor(state.difficulty)
  const out: Match3Action[] = []
  if (gameStatus(state) === 'playing') {
    // 能消除的交换排在前面：随机回放时会更多地真正推进局面
    for (const [a, b] of findLegalSwaps(state.board, config)) out.push({ type: 'swap', a, b })
    for (let index = 0; index < cellCount(config); index++) out.push({ type: 'select', index })
  }
  if (state.history.length > 0) out.push({ type: 'undo' })
  out.push({ type: 'restart' })
  return out
}

/**
 * 「点了第 index 格」→ 动作。选中态语义：
 * - 没选中 → 选中它；
 * - 点同一格 → 取消选中（select 动作在 reduce 里翻成 null）；
 * - 点相邻格 → 交换（换不出三连时 reduce 抛错，由壳层给出文字提示，棋子不动）；
 * - 点不相邻的格 → 选中态移到这一格（墨水屏上比「没反应」更符合预期）。
 * 越界、终局后返回 null：点了没反应比弹错误自然。
 */
export function selectAction(state: Match3State, index: number): Match3Action | null {
  const config = configFor(state.difficulty)
  if (gameStatus(state) !== 'playing') return null
  if (!isIndex(index, config)) return null
  const selected = state.selected
  if (selected === null || selected === index) return { type: 'select', index }
  if (areAdjacent(selected, index, config)) return { type: 'swap', a: selected, b: index }
  return { type: 'select', index }
}

export function encodeState(state: Match3State): unknown {
  return {
    difficulty: state.difficulty,
    seed: state.seed,
    board: [...state.board],
    score: state.score,
    moves: state.moves,
    cursor: state.cursor,
    selected: state.selected,
    lastShuffle: state.lastShuffle,
    history: state.history.map((record) => ({
      at: [...record.at],
      old: [...record.old],
      score: record.score,
      cursor: record.cursor,
      lastShuffle: record.lastShuffle,
    })),
  }
}

function readCount(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw illegal(`match3.illegal.state:${field}`)
  }
  return value
}

function readBoard(value: unknown, config: BoardConfig): number[] {
  if (!Array.isArray(value) || value.length !== cellCount(config)) {
    throw illegal('match3.illegal.state:board')
  }
  const board: number[] = []
  for (const kind of value) {
    if (typeof kind !== 'number' || !Number.isInteger(kind) || kind < 0 || kind >= config.kinds) {
      throw illegal('match3.illegal.state:board-kind')
    }
    board.push(kind)
  }
  return board
}

/** 索引表：升序、去重、落在棋盘内（紧凑快照的规范形式，往返编码因此稳定） */
function readIndices(value: unknown, config: BoardConfig): number[] {
  if (!Array.isArray(value)) throw illegal('match3.illegal.state:history-at')
  const cells = cellCount(config)
  const out: number[] = []
  let previous = -1
  for (const index of value) {
    if (typeof index !== 'number' || !Number.isInteger(index) || index <= previous || index >= cells) {
      throw illegal('match3.illegal.state:history-at')
    }
    previous = index
    out.push(index)
  }
  return out
}

function readKinds(value: unknown, expected: number, config: BoardConfig, field: string): number[] {
  if (!Array.isArray(value) || value.length !== expected) throw illegal(`match3.illegal.state:${field}`)
  const out: number[] = []
  for (const kind of value) {
    if (typeof kind !== 'number' || !Number.isInteger(kind) || kind < 0 || kind >= config.kinds) {
      throw illegal(`match3.illegal.state:${field}`)
    }
    out.push(kind)
  }
  return out
}

interface EncodedState {
  difficulty?: unknown
  seed?: unknown
  board?: unknown
  score?: unknown
  moves?: unknown
  cursor?: unknown
  selected?: unknown
  lastShuffle?: unknown
  history?: unknown
}

/**
 * 严格校验存档（对应「拒绝损坏或非法存档」）。除字段类型与取值范围外，还复核四条不变量：
 * 1. 盘面必须**稳定**（结算后不该残留三连）；
 * 2. 盘面必须**有解**（规则层在死局时会自动重排，因此死局不是本作能产出的局面）；
 * 3. `history.length === moves`，且步数不超过难度上限；
 * 4. **撤销栈可回放**：从当前盘面按 history 逐条回退，每一步都必须落在稳定盘面上，
 *    最终必须精确回到 `(seed, 难度)` 的初始棋盘、分数 0、游标为初始游标。
 *    任何被改过的棋子、被截断或被塞私货的撤销栈都会在这里被拒绝。
 *
 * 容忍度：`history` 缺字段按空栈处理（撤销栈是可选的附加信息）；
 * `selected` / `lastShuffle` 缺字段按「未选中 / 从未重排」处理。
 * 但 `moves > 0` 却没有撤销栈时，局面与撤销栈自相矛盾 —— 仍然按存档损坏拒绝。
 */
export function decodeState(raw: unknown): Match3State {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw illegal('match3.illegal.state:root')
  const value = raw as EncodedState
  const difficulty = difficultyOrThrow(String(value.difficulty ?? ''))
  const config = configFor(difficulty)

  const seed = readCount(value.seed, 'seed')
  if (seed > 0xffffffff) throw illegal('match3.illegal.state:seed')
  const board = readBoard(value.board, config)
  const score = readCount(value.score, 'score')
  const moves = readCount(value.moves, 'moves')
  if (moves > config.moveLimit) throw illegal('match3.illegal.state:moves')
  const cursor = readCount(value.cursor, 'cursor')
  if (cursor > 0xffffffff) throw illegal('match3.illegal.state:cursor')

  let selected: number | null = null
  if (value.selected !== undefined && value.selected !== null) {
    if (!isIndex(value.selected as number, config)) throw illegal('match3.illegal.state:selected')
    selected = value.selected as number
  }
  let lastShuffle = -1
  if (value.lastShuffle !== undefined) {
    if (
      typeof value.lastShuffle !== 'number' ||
      !Number.isInteger(value.lastShuffle) ||
      (value.lastShuffle !== -1 && (value.lastShuffle < 1 || value.lastShuffle > moves))
    ) {
      throw illegal('match3.illegal.state:last-shuffle')
    }
    lastShuffle = value.lastShuffle
  }

  const rawHistory = value.history === undefined ? [] : value.history
  if (!Array.isArray(rawHistory)) throw illegal('match3.illegal.state:history')
  const history: MoveRecord[] = rawHistory.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw illegal('match3.illegal.state:history-entry')
    }
    const record = entry as Partial<MoveRecord>
    const at = readIndices(record.at, config)
    const old = readKinds(record.old, at.length, config, 'history-old')
    const recordScore = readCount(record.score, 'history-score')
    const recordCursor = readCount(record.cursor, 'history-cursor')
    const recordShuffle = record.lastShuffle
    if (
      recordShuffle !== undefined &&
      (typeof recordShuffle !== 'number' || !Number.isInteger(recordShuffle) || recordShuffle < -1)
    ) {
      throw illegal('match3.illegal.state:history-shuffle')
    }
    return { at, old, score: recordScore, cursor: recordCursor, lastShuffle: recordShuffle ?? -1 }
  })
  if (history.length !== moves) throw illegal('match3.illegal.state:history-length')

  // 不变量 1：稳定盘面
  if (findGroups(board, config).length > 0) throw illegal('match3.illegal.state:unstable')
  // 不变量 2：有解盘面
  if (!hasLegalSwap(board, config)) throw illegal('match3.illegal.state:dead')

  // 不变量 4：撤销栈逐条回退，必须回到初始棋盘
  const replayed = board.slice()
  let replayScore = score
  let replayCursor = cursor
  let replayShuffle = lastShuffle
  for (let position = history.length - 1; position >= 0; position--) {
    const record = history[position]!
    // 每次成功交换至少消掉 3 枚棋子 → 至少 3 次抽取，游标必然严格递减
    if (record.cursor >= replayCursor) throw illegal('match3.illegal.state:cursor-order')
    // 分数只增不减
    if (record.score > replayScore) throw illegal('match3.illegal.state:score-order')
    if (record.lastShuffle > replayShuffle) throw illegal('match3.illegal.state:shuffle-order')
    record.at.forEach((index, slot) => {
      replayed[index] = record.old[slot]!
    })
    if (findGroups(replayed, config).length > 0) throw illegal('match3.illegal.state:unstable-history')
    replayScore = record.score
    replayCursor = record.cursor
    replayShuffle = record.lastShuffle
  }
  const start = buildBoard(seed, difficulty)
  if (replayCursor !== start.cursor) throw illegal('match3.illegal.state:cursor')
  if (replayScore !== 0) throw illegal('match3.illegal.state:score')
  if (replayShuffle !== -1) throw illegal('match3.illegal.state:shuffle')
  if (replayed.some((kind, index) => kind !== start.board[index])) {
    throw illegal('match3.illegal.state:unreachable')
  }

  return { difficulty, seed, board, score, moves, cursor, selected, lastShuffle, history }
}
