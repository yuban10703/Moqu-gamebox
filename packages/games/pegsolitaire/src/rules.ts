/**
 * 孔明棋规则层：状态、跳吃、撤销与存档编解码（纯函数，无副作用）。
 *
 * 核心设计：
 * 1. 选中态存在 state 里（`selected`），点棋子/点空孔都是 `select` 动作 —— 它是**界面状态**，
 *    不计步、不进历史，因此「选中不算一步」；
 * 2. 历史只记跳吃（`{from,to,jumped}`）。跳吃不是对合运算（要还原被跳过的棋子），
 *    但记录足够还原：撤销 = 把落点的子拿回起点、把被跳过的子放回去，
 *    并把选中态恢复成这次跳吃的起点（跳吃的前提就是它被选中）。撤销后的 encode 与跳吃前逐字段相同；
 * 3. 存档校验用「重放」：初始布局是固定的，decode 从初始布局出发按 history 逐条重放，
 *    每条都必须是合法跳吃，重放结果必须逐格等于存档里的 pegs ——
 *    「棋子数凭空变化」「选中不存在的棋子」「斜跳」这类坏数据都进不来；
 * 4. 只剩 1 枚棋子即 `won`，没有失败态；解开后不再接受选中/跳吃（撤销/重开仍可用）。
 */
import { IllegalActionError, type GameStatus } from '@eink/core'
import {
  BOARD_SIZE,
  GAME_ID,
  HOLE_INDEXES,
  applyJump,
  countPegs,
  difficultyOrThrow,
  initialPegs,
  isHole,
  isLegalJump,
  jumpedIndex,
  legalJumps,
  type DifficultyId,
  type Jump,
} from './board.js'

export type PegAction =
  /** 选中/取消选中一枚棋子；点到空孔表示清除选中。选中不算一步 */
  | { type: 'select'; index: number }
  /** 跳过 from 与 to 之间的一枚棋子落到 to（要求 from 正是当前选中的棋子） */
  | { type: 'jump'; from: number; to: number }
  /** 撤回上一次跳吃（选中态一并回到跳吃前的样子）。没有历史时抛错 */
  | { type: 'undo' }
  /** 重开：回到同一难度的起始布局。壳层会无条件派发，必须接受 */
  | { type: 'restart' }

export interface PegState {
  readonly difficulty: DifficultyId
  /** 行优先棋子表：true = 该孔位有棋子；非孔位恒为 false */
  readonly pegs: readonly boolean[]
  /** 当前选中的棋子孔位；null = 没有选中。选中态不算一步，也不进历史 */
  readonly selected: number | null
  /** 跳吃次数（撤销会回退） */
  readonly moves: number
  /** 每次跳吃的记录；`history.length` 恒等于 `moves` */
  readonly history: readonly Jump[]
}

function illegal(reason: string): IllegalActionError {
  return new IllegalActionError(GAME_ID, reason)
}

/** 起始布局是固定的（与 seed 无关），因此本玩法不需要随机种子 */
export function createState(difficulty: DifficultyId): PegState {
  return {
    difficulty,
    pegs: initialPegs(difficulty),
    selected: null,
    moves: 0,
    history: [],
  }
}

/** 只剩一枚棋子即胜；本玩法没有失败态（走不通就撤销/重开） */
export function gameStatus(state: PegState): GameStatus {
  return countPegs(state.pegs) === 1 ? 'won' : 'playing'
}

export function remainingPegs(state: PegState): number {
  return countPegs(state.pegs)
}

function assertPlaying(state: PegState): void {
  if (gameStatus(state) !== 'playing') throw illegal('game already finished')
}

/**
 * 选中语义：
 * - 点有棋子的孔：已选中它 → 取消；否则改选它；
 * - 点空孔：清除选中（点空处相当于放弃当前选择）。
 */
function applySelect(state: PegState, index: number): PegState {
  assertPlaying(state)
  if (!isHole(index)) throw illegal(`pegsolitaire.illegal.select:${String(index)}`)
  if (!state.pegs[index]) return { ...state, selected: null }
  return { ...state, selected: state.selected === index ? null : index }
}

function applyJumpAction(state: PegState, from: number, to: number): PegState {
  assertPlaying(state)
  if (!isHole(from) || !isHole(to)) {
    throw illegal(`pegsolitaire.illegal.jump:${String(from)}->${String(to)}`)
  }
  if (state.selected === null) throw illegal('pegsolitaire.illegal.no-selection')
  // 跳吃的起点必须正是当前选中的那枚棋子，避免「点 A 却在 B 跳」这种不透明操作
  if (from !== state.selected) throw illegal(`pegsolitaire.illegal.from:${String(from)}`)
  if (!isLegalJump(state.pegs, from, to)) throw illegal(`pegsolitaire.illegal.jump:${from}->${to}`)
  const jumped = jumpedIndex(from, to)!
  return {
    ...state,
    pegs: applyJump(state.pegs, from, to),
    // 落点上的棋子不自动选中：连续跳吃时再点一次更明确
    selected: null,
    moves: state.moves + 1,
    history: [...state.history, { from, to, jumped }],
  }
}

export function reducePegSolitaire(state: PegState, action: PegAction): PegState {
  switch (action.type) {
    case 'select':
      return applySelect(state, action.index)

    case 'jump':
      return applyJumpAction(state, action.from, action.to)

    case 'undo': {
      const last = state.history[state.history.length - 1]
      if (last === undefined) throw illegal('pegsolitaire.illegal.nothing-to-undo')
      // 反向还原这一步：落点拿走、起点与被跳过的棋子放回
      const pegs = state.pegs.slice()
      pegs[last.from] = true
      pegs[last.jumped] = true
      pegs[last.to] = false
      return {
        ...state,
        pegs,
        // 跳吃前这枚棋子必然处于选中态（applyJumpAction 强校验），因此撤销即恢复选中。
        // 若跳吃之后又点选了别的棋子，撤销会连同那次点选一起丢弃 —— 选中不算一步，不进历史。
        selected: last.from,
        moves: state.moves - 1,
        history: state.history.slice(0, -1),
      }
    }

    case 'restart':
      // 同难度重开：回到同一套起始布局，选中与历史都清空
      return createState(state.difficulty)

    default: {
      // 未知动作（方向键、旧存档、壳层误派）明确报错，避免静默无响应
      const unknown = action as { type?: unknown }
      throw illegal(`pegsolitaire.illegal.action:${String(unknown.type)}`)
    }
  }
}

/** 当前局面下被规则允许的动作（供禁用按钮与回放校验） */
export function legalActions(state: PegState): PegAction[] {
  const out: PegAction[] = []
  if (gameStatus(state) === 'playing') {
    // 每个孔位都可以点：有子 = 选中/取消，空孔 = 清除选中
    for (const index of HOLE_INDEXES) out.push({ type: 'select', index })
    for (const jump of legalJumps(state.pegs)) {
      out.push({ type: 'jump', from: jump.from, to: jump.to })
    }
  }
  if (state.history.length > 0) out.push({ type: 'undo' })
  out.push({ type: 'restart' })
  return out
}

/**
 * 「点了第 index 个格子」→ 动作（契约要求的四分支语义）：
 * 1. 有棋子的孔 → select（选中/取消）；
 * 2. 已有选中且 index 是合法落点 → jump（从选中处跳过去）；
 * 3. 已有选中但 index 不合法 → select（改选/清除）；
 * 4. 空孔且没有选中 → null（点了没反应）。
 * 非孔位（棋盘缺角）与越界一律 null。
 */
export function selectAction(state: PegState, index: number): PegAction | null {
  if (gameStatus(state) !== 'playing') return null
  if (!isHole(index)) return null
  if (state.pegs[index] === true) return { type: 'select', index }
  if (state.selected !== null && isLegalJump(state.pegs, state.selected, index)) {
    return { type: 'jump', from: state.selected, to: index }
  }
  if (state.selected !== null) return { type: 'select', index }
  return null
}

export function encodeState(state: PegState): unknown {
  return {
    difficulty: state.difficulty,
    pegs: [...state.pegs],
    selected: state.selected,
    moves: state.moves,
    history: state.history.map((jump) => ({
      from: jump.from,
      to: jump.to,
      jumped: jump.jumped,
    })),
  }
}

function readCount(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw illegal(`pegsolitaire.illegal.state:${field}`)
  }
  return value
}

function readPegs(value: unknown, field: string): boolean[] {
  const total = BOARD_SIZE * BOARD_SIZE
  if (!Array.isArray(value) || value.length !== total) {
    throw illegal(`pegsolitaire.illegal.state:${field}`)
  }
  const pegs: boolean[] = []
  for (let index = 0; index < total; index++) {
    const cell = value[index]
    if (typeof cell !== 'boolean') throw illegal(`pegsolitaire.illegal.state:${field}`)
    // 非孔位（四个缺角）永远不能有棋子
    if (cell && !isHole(index)) throw illegal(`pegsolitaire.illegal.state:${field}`)
    pegs.push(cell)
  }
  return pegs
}

function readSelected(value: unknown, pegs: readonly boolean[]): number | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'number' || !Number.isInteger(value) || !isHole(value)) {
    throw illegal('pegsolitaire.illegal.state:selected')
  }
  // 选中的必须是真实存在的棋子
  if (!pegs[value]) throw illegal('pegsolitaire.illegal.state:selected-not-a-peg')
  return value
}

function readHistory(value: unknown): Jump[] {
  if (!Array.isArray(value)) throw illegal('pegsolitaire.illegal.state:history')
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object') throw illegal('pegsolitaire.illegal.state:history-entry')
    const record = entry as { from?: unknown; to?: unknown; jumped?: unknown }
    const from = record.from
    const to = record.to
    if (typeof from !== 'number' || !isHole(from)) {
      throw illegal('pegsolitaire.illegal.state:history-from')
    }
    if (typeof to !== 'number' || !isHole(to)) {
      throw illegal('pegsolitaire.illegal.state:history-to')
    }
    const jumped = jumpedIndex(from, to)
    if (jumped === null) throw illegal('pegsolitaire.illegal.state:history-line')
    // 记录里的 jumped 必须与 from/to 推算的一致（自解释字段也要经得起核对）
    if (record.jumped !== jumped) throw illegal('pegsolitaire.illegal.state:history-jumped')
    return { from, to, jumped }
  })
}

/**
 * 严格校验存档（对应「拒绝损坏或非法存档」）。
 *
 * 除了字段类型与取值范围，还复核四条不变量：
 * 1. 棋子只出现在 33 个孔位上；
 * 2. `history.length === moves`，选中态要么为空、要么指向一枚真实棋子；
 * 3. **可重放**：从固定起始布局出发按 history 逐条执行，每条都必须是合法跳吃
 *    （起点有子、被跳过的格子有子、落点是空孔、三点正交共线）；
 * 4. 重放结果必须逐格等于存档里的 pegs —— 棋子数凭空变化、斜跳、落点有子等都会被拒绝。
 * decode 不重算解法，只做重放校验。
 */
export function decodeState(raw: unknown): PegState {
  if (!raw || typeof raw !== 'object') throw illegal('pegsolitaire.illegal.state:root')
  const value = raw as Partial<{
    difficulty: unknown
    pegs: unknown
    selected: unknown
    moves: unknown
    history: unknown
  }>
  const difficulty = difficultyOrThrow(String(value.difficulty ?? ''))
  const pegs = readPegs(value.pegs, 'pegs')
  const selected = readSelected(value.selected, pegs)
  const moves = readCount(value.moves, 'moves')
  const history = readHistory(value.history)
  if (history.length !== moves) throw illegal('pegsolitaire.illegal.state:history-length')

  // 不变量 3/4：从固定起始布局重放，逐条校验合法性，结果必须与存档一致
  let replayed = initialPegs(difficulty)
  for (const jump of history) {
    if (!isLegalJump(replayed, jump.from, jump.to)) {
      throw illegal('pegsolitaire.illegal.state:unreachable')
    }
    replayed = applyJump(replayed, jump.from, jump.to)
  }
  if (!replayed.every((peg, index) => peg === pegs[index])) {
    throw illegal('pegsolitaire.illegal.state:unreachable')
  }

  return { difficulty, pegs, selected, moves, history }
}
