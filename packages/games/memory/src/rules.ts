/**
 * 记忆配对规则层：纯函数、无副作用、无平台依赖。
 *
 * 核心设计（墨水屏上没有动画/计时器，这一条决定了整个状态机）：
 * - 一次「尝试」= 连续翻两张牌。
 *   · 两张符号相同 → 立即锁定为已配对；
 *   · 两张不同 → 两张**保持可见**并标记为「待盖回」（pending），
 *     **不会**靠延时自动翻回；玩家**下一次点击**时才先把它们盖回，
 *     并且这次点击同时算作新一次翻牌的第一张。
 * - 因此状态里只保存「翻牌点击日志」`flips`，正面朝上/已配对/待盖回/尝试次数
 *   全部由 `replayFlips(deck, flips)` 推导。这带来三个好处：
 *   1. `undo` 只是截断日志（一次撤销退回一次尝试），无需保存历史快照；
 *   2. `decode` 可以逐条重放日志，把「翻同一张两次」「翻已配对的牌」这类坏数据拒之门外；
 *   3. 日志天然是「动作日志即存档」，与 core 的可重放约定一致。
 *
 * 确定性：洗牌只用 `createRng(seed + 游标)`（见 board.ts），reduce 内不产生任何随机性。
 */
import { IllegalActionError, type GameStatus } from '@eink/core'
import {
  MEMORY_ID,
  cellCount,
  configFor,
  deal,
  difficultyOrThrow,
  normalizeSeed,
  pairCount,
  type DifficultyId,
} from './board.js'

export type MemoryAction =
  /** 翻开第 index 张牌。越界、已翻开（含待盖回）、已配对都抛 IllegalActionError */
  | { type: 'flip'; index: number }
  /** 撤销一次翻牌尝试：撤回最近一次完整尝试（两张）；若当前尝试只翻了第一张，则退回这一张 */
  | { type: 'undo' }
  /** 重开。壳层的结果面板/暂停菜单会无条件派发它，因此必须接受，并且要重新洗牌 */
  | { type: 'restart' }

export interface MemoryState {
  difficulty: DifficultyId
  /** 洗牌种子：同 seed + 同游标 + 同动作序列必然得到同一局面 */
  seed: number
  /** 洗牌游标：`restart` 每次 +1，用 `createRng(seed + rngCursor)` 重洗 */
  rngCursor: number
  /** 牌面：`deck[index]` 是第 index 格的 pairId（每个 pairId 恰好出现两次） */
  deck: readonly number[]
  /** 翻牌点击日志：每两次点击构成一次尝试；正面朝上/配对/待盖回都由它推导 */
  flips: readonly number[]
}

/** 由牌面与点击日志推导出来的局面事实（不单独存，避免状态与日志不一致） */
export interface MemorySnapshot {
  /** 当前正面朝上的未配对牌（1 张 = 本尝试刚翻第一张；2 张 = 待盖回） */
  readonly faceUp: readonly number[]
  /** 待盖回的两张（= 长度 2 的 faceUp）；没有待盖回时为空数组 */
  readonly pending: readonly number[]
  /** 已锁定的配对牌（升序索引） */
  readonly matched: readonly number[]
  /** 尝试次数：翻两张算一次（只翻了第一张时不计） */
  readonly attempts: number
  /** 已配成的对数 */
  readonly matchedPairs: number
}

function illegal(reason: string): IllegalActionError {
  return new IllegalActionError(MEMORY_ID, reason)
}

function isIndex(value: number, cells: number): boolean {
  return Number.isInteger(value) && value >= 0 && value < cells
}

export function createState(seed: number, difficulty: DifficultyId): MemoryState {
  const normalized = normalizeSeed(seed)
  return {
    difficulty,
    seed: normalized,
    rngCursor: 0,
    deck: deal(normalized, 0, difficulty),
    flips: [],
  }
}

/**
 * 重放点击日志，得到当前局面；同时用规则不变量严格校验日志本身（reduce 与 decode 共用）。
 *
 * 校验顺序很关键：**先判断合法性，再执行盖回**。
 * 待盖回的两张仍处于「已翻开」状态，点它们是非法的；
 * 只有点到一张扣着的牌时，才先把 pending 盖回，再翻开新的一张（这次点击同时算作新翻牌）。
 */
export function replayFlips(deck: readonly number[], flips: readonly number[]): MemorySnapshot {
  const cells = deck.length
  const matched = new Set<number>()
  let faceUp: number[] = []
  let attempts = 0
  for (const index of flips) {
    if (!isIndex(index, cells)) throw illegal(`memory.illegal.state:flip:${String(index)}`)
    // 已锁定的配对牌不能再翻
    if (matched.has(index)) throw illegal(`memory.illegal.state:flip-matched:${index}`)
    // 正面朝上的牌（含待盖回的两张）不能再翻：否则同一张牌会被算成一对
    if (faceUp.includes(index)) throw illegal(`memory.illegal.state:flip-face-up:${index}`)
    // 到这里才算一次合法的新翻牌：若上一轮不匹配，先把那两张盖回去
    if (faceUp.length === 2) faceUp = []
    faceUp.push(index)
    if (faceUp.length === 2) {
      attempts++
      const [first, second] = faceUp
      if (deck[first] === deck[second]) {
        matched.add(first)
        matched.add(second)
        faceUp = []
      }
    }
  }
  return {
    faceUp,
    pending: faceUp.length === 2 ? [...faceUp] : [],
    matched: [...matched].sort((a, b) => a - b),
    attempts,
    matchedPairs: matched.size / 2,
  }
}

/** 推导当前局面（所有状态都由 create/reduce/decode 产出，日志必然自洽） */
export function snapshotOf(state: MemoryState): MemorySnapshot {
  return replayFlips(state.deck, state.flips)
}

export function gameStatus(state: MemoryState): GameStatus {
  // 没有失败态：全部配对完成即获胜
  return snapshotOf(state).matchedPairs === pairCount(configFor(state.difficulty))
    ? 'won'
    : 'playing'
}

export function reduceMemory(state: MemoryState, action: MemoryAction): MemoryState {
  switch (action.type) {
    case 'flip': {
      const cells = cellCount(configFor(state.difficulty))
      const index = action.index
      if (!isIndex(index, cells)) throw illegal(`memory.illegal.index:${String(index)}`)
      const snapshot = snapshotOf(state)
      // 翻已配对的牌：明确报错，而不是悄悄忽略（对应「非法输入」验收点）
      if (snapshot.matched.includes(index)) throw illegal(`memory.illegal.matched:${index}`)
      // 翻正面朝上的牌（含待盖回）：同样报错。待盖回时必须点一张扣着的牌，
      // 那次点击会先盖回这两张，再翻开新牌 —— 这就是「不匹配后需要再点一次才盖回」。
      if (snapshot.faceUp.includes(index)) throw illegal(`memory.illegal.face-up:${index}`)
      return { ...state, flips: [...state.flips, index] }
    }

    case 'undo': {
      if (state.flips.length === 0) throw illegal('memory.illegal.nothing-to-undo')
      // 一次尝试 = 两张。日志奇数长度说明当前尝试只翻了第一张，只退回这一张；
      // 偶数长度说明最近一次尝试已翻满两张，整次退回。
      const drop = state.flips.length % 2 === 1 ? 1 : 2
      return { ...state, flips: state.flips.slice(0, state.flips.length - drop) }
    }

    case 'restart':
      // 同难度、同种子、游标 +1：重新洗牌，但同种子序列依然完全可复现。
      // 游标参与 `createRng(seed + 游标)`，因此重开不会又发到同一副牌面。
      return {
        ...state,
        rngCursor: state.rngCursor + 1,
        deck: deal(state.seed, state.rngCursor + 1, state.difficulty),
        flips: [],
      }

    default: {
      // 未知动作（旧存档/壳层误派）明确报错，避免静默无响应
      const unknown = action as { type?: unknown }
      throw illegal(`memory.illegal.action:${String(unknown.type)}`)
    }
  }
}

/** 当前局面下被规则允许的动作（供禁用按钮与回放校验） */
export function legalActions(state: MemoryState): MemoryAction[] {
  const out: MemoryAction[] = [{ type: 'restart' }]
  if (state.flips.length > 0) out.push({ type: 'undo' })
  if (gameStatus(state) !== 'playing') return out
  const snapshot = snapshotOf(state)
  const blocked = new Set<number>([...snapshot.matched, ...snapshot.faceUp])
  for (let index = 0; index < cellCount(configFor(state.difficulty)); index++) {
    if (!blocked.has(index)) out.push({ type: 'flip', index })
  }
  return out
}

/**
 * 「点了第 index 个格子」→ 动作。
 * 越界/已配对/已翻开（含待盖回）返回 null：点了没反应比弹错误自然（手机端误触很常见）。
 * 注意待盖回的两张返回 null —— 玩家必须点一张扣着的牌，那次点击会先把它们盖回。
 */
export function selectAction(state: MemoryState, index: number): MemoryAction | null {
  if (gameStatus(state) !== 'playing') return null
  if (!isIndex(index, cellCount(configFor(state.difficulty)))) return null
  const snapshot = snapshotOf(state)
  if (snapshot.matched.includes(index)) return null
  if (snapshot.faceUp.includes(index)) return null
  return { type: 'flip', index }
}

export function encodeState(state: MemoryState): unknown {
  return {
    difficulty: state.difficulty,
    seed: state.seed,
    rngCursor: state.rngCursor,
    deck: [...state.deck],
    flips: [...state.flips],
  }
}

function readCount(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw illegal(`memory.illegal.state:${field}`)
  }
  return value
}

/**
 * 严格校验存档（对应「拒绝损坏或非法存档」）。
 * 除了字段类型与取值范围，还做三件事：
 * 1. 牌面必须是 `deal(seed, 游标, 难度)` 的洗牌结果 —— 手改牌面（把对子摆到一起）会被拒绝；
 * 2. 牌面必须恰好是「每个 pairId 出现两次」，且 pairId 落在 [0, 对数) 内；
 * 3. 点击日志逐条重放，翻越界/同一张翻两次/翻已配对的牌都会被拒绝。
 * 由于牌面与日志互不依赖随机数，decode 不会「重新洗牌」，同一存档双端必得同一局面。
 */
export function decodeState(raw: unknown): MemoryState {
  if (!raw || typeof raw !== 'object') throw illegal('memory.illegal.state:root')
  const value = raw as Partial<{
    difficulty: unknown
    seed: unknown
    rngCursor: unknown
    deck: unknown
    flips: unknown
  }>
  const difficulty = difficultyOrThrow(String(value.difficulty ?? ''))
  const config = configFor(difficulty)
  const cells = cellCount(config)
  const pairs = pairCount(config)

  const seed = readCount(value.seed, 'seed')
  if (seed > 0xffffffff) throw illegal('memory.illegal.state:seed')
  const rngCursor = readCount(value.rngCursor, 'rngCursor')
  // 游标只由 restart +1，合法存档不可能超过 uint32
  if (rngCursor > 0xffffffff) throw illegal('memory.illegal.state:rngCursor')

  if (!Array.isArray(value.deck) || value.deck.length !== cells) {
    throw illegal('memory.illegal.state:deck')
  }
  const deck: number[] = []
  const seen = new Array<number>(pairs).fill(0)
  for (const pairId of value.deck) {
    if (typeof pairId !== 'number' || !Number.isInteger(pairId) || pairId < 0 || pairId >= pairs) {
      throw illegal('memory.illegal.state:deck-value')
    }
    seen[pairId]++
    deck.push(pairId)
  }
  for (let pair = 0; pair < pairs; pair++) {
    if (seen[pair] !== 2) throw illegal(`memory.illegal.state:deck-multiplicity:${pair}`)
  }
  // 与 (seed, 游标) 推出的洗牌结果逐格比对：篡改牌面在这里被拒绝
  const expected = deal(seed, rngCursor, difficulty)
  for (let index = 0; index < cells; index++) {
    if (deck[index] !== expected[index]) throw illegal('memory.illegal.state:deck-deal')
  }

  if (!Array.isArray(value.flips)) throw illegal('memory.illegal.state:flips')
  const flips: number[] = []
  for (const entry of value.flips) {
    if (typeof entry !== 'number' || !Number.isInteger(entry)) {
      throw illegal('memory.illegal.state:flip-value')
    }
    flips.push(entry)
  }
  // 重放即校验：非法日志在这里抛错
  replayFlips(deck, flips)

  return { difficulty, seed, rngCursor, deck, flips }
}
