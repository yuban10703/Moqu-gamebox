/**
 * 规则层：状态、动作执行与存档编解码（纯函数，无副作用）。
 *
 * 约定：
 * 1. `toggle` 翻转该格及其十字邻域的灯；越界索引抛 IllegalActionError（壳层给明确提示）；
 * 2. 全部熄灭即 `won`。到达全灭后**不再接受新的翻转**（避免误触把刚解开的谜题又点亮），
 *    但撤销/重开无条件可用 —— 想继续玩可以撤销一步；
 * 3. 撤销用「对合」实现：十字翻转翻两次等于没翻，所以历史里只存每次翻转的格子索引，
 *    撤销时对同一个格子再翻一次就精确回到上一个状态（比快照更省，也不会漏字段）。
 *
 * 谜题本身只由 seed + 难度决定，玩家操作绝不会触发重新生成。
 */
import { IllegalActionError, type GameStatus } from '@eink/core'
import {
  GAME_ID,
  cellCount,
  configFor,
  difficultyOrThrow,
  isAllOff,
  litCount,
  normalizeSeed,
  replay,
  scramblePlan,
  toggleCross,
  type DifficultyId,
} from './board.js'

export type LightsOutAction =
  /** 翻转第 index 格及其十字邻域（含自身） */
  | { type: 'toggle'; index: number }
  /** 撤回上一次翻转。没有历史时抛错 */
  | { type: 'undo' }
  /** 重开：回到同难度同种子的同一道谜题。壳层会无条件派发，必须接受 */
  | { type: 'restart' }

export interface LightsOutState {
  readonly difficulty: DifficultyId
  /** 打乱种子：同 seed + 同难度必然得到同一道谜题 */
  readonly seed: number
  /** 打乱消耗的随机数个数（载入时据此复核初始谜题） */
  readonly rngCursor: number
  /** 行优先的亮灯图案：true = 亮 */
  readonly lights: readonly boolean[]
  /** 有效翻转次数（撤销会回退） */
  readonly moves: number
  /** 每次翻转的格子索引（按时间顺序）；`history.length` 恒等于 `moves` */
  readonly history: readonly number[]
}

function illegal(reason: string): IllegalActionError {
  return new IllegalActionError(GAME_ID, reason)
}

/** 确定性初始状态：从全灭局面随机翻转打乱（构造性保证可解，且不等于已解局面） */
export function createState(seed: number, difficulty: DifficultyId): LightsOutState {
  const config = configFor(difficulty)
  const normalized = normalizeSeed(seed)
  const puzzle = scramblePlan(config, normalized)
  return {
    difficulty,
    seed: normalized,
    rngCursor: puzzle.cursor,
    lights: puzzle.lights,
    moves: 0,
    history: [],
  }
}

/** 全部熄灭即胜；本玩法没有失败态 */
export function gameStatus(state: LightsOutState): GameStatus {
  return isAllOff(state.lights) ? 'won' : 'playing'
}

/** 还剩几盏亮着（视图统计与提示用） */
export function remainingLights(state: LightsOutState): number {
  return litCount(state.lights)
}

function assertPlaying(state: LightsOutState): void {
  if (gameStatus(state) !== 'playing') throw illegal('game already finished')
}

function applyToggle(state: LightsOutState, index: number): LightsOutState {
  assertPlaying(state)
  if (!Number.isInteger(index) || index < 0 || index >= state.lights.length) {
    throw illegal(`lightsout.illegal.index:${String(index)}`)
  }
  return {
    ...state,
    lights: toggleCross(state.lights, configFor(state.difficulty).size, index),
    moves: state.moves + 1,
    history: [...state.history, index],
  }
}

export function reduceLightsOut(
  state: LightsOutState,
  action: LightsOutAction,
): LightsOutState {
  switch (action.type) {
    case 'toggle':
      return applyToggle(state, action.index)

    case 'undo': {
      const last = state.history[state.history.length - 1]
      if (last === undefined) throw illegal('lightsout.illegal.nothing-to-undo')
      // 对合：再翻同一格就精确回到上一个状态，因此 encode 与翻转前逐字段相同
      return {
        ...state,
        lights: toggleCross(state.lights, configFor(state.difficulty).size, last),
        moves: state.moves - 1,
        history: state.history.slice(0, -1),
      }
    }

    case 'restart':
      // 同难度同种子重开：回到同一道谜题，历史清空（解开之后也必须可用）
      return createState(state.seed, state.difficulty)

    default: {
      // 未知动作（方向键、旧存档、壳层误派）明确报错，避免静默无响应
      const unknown = action as { type?: unknown }
      throw illegal(`lightsout.illegal.action:${String(unknown.type)}`)
    }
  }
}

/** 当前局面下被规则允许的动作（供禁用按钮与回放校验） */
export function legalActions(state: LightsOutState): LightsOutAction[] {
  const out: LightsOutAction[] = []
  if (gameStatus(state) === 'playing') {
    for (let index = 0; index < state.lights.length; index++) out.push({ type: 'toggle', index })
  }
  if (state.history.length > 0) out.push({ type: 'undo' })
  out.push({ type: 'restart' })
  return out
}

/**
 * 「点了第 index 个格子」→ 动作。
 * 棋盘上每一格都可以点，因此只要索引合法就是 toggle；越界或已解开时返回 null（点了没反应）。
 */
export function selectAction(state: LightsOutState, index: number): LightsOutAction | null {
  if (gameStatus(state) !== 'playing') return null
  if (!Number.isInteger(index) || index < 0 || index >= state.lights.length) return null
  return { type: 'toggle', index }
}

export function encodeState(state: LightsOutState): unknown {
  return {
    difficulty: state.difficulty,
    seed: state.seed,
    rngCursor: state.rngCursor,
    lights: [...state.lights],
    moves: state.moves,
    history: [...state.history],
  }
}

function readCount(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw illegal(`lightsout.illegal.state:${field}`)
  }
  return value
}

function readLights(value: unknown, total: number, field: string): boolean[] {
  if (!Array.isArray(value) || value.length !== total) throw illegal(`lightsout.illegal.state:${field}`)
  const lights: boolean[] = []
  for (const cell of value) {
    if (typeof cell !== 'boolean') throw illegal(`lightsout.illegal.state:${field}`)
    lights.push(cell)
  }
  return lights
}

function readToggles(value: unknown, total: number, field: string): number[] {
  if (!Array.isArray(value)) throw illegal(`lightsout.illegal.state:${field}`)
  const toggles: number[] = []
  for (const item of value) {
    if (typeof item !== 'number' || !Number.isInteger(item) || item < 0 || item >= total) {
      throw illegal(`lightsout.illegal.state:${field}`)
    }
    toggles.push(item)
  }
  return toggles
}

/**
 * 严格校验存档（对应「拒绝损坏或非法存档」）。
 *
 * 除了字段类型与取值范围，还复核三条不变量：
 * 1. 初始谜题可复算：`rngCursor` 必须等于同 seed/难度打乱的随机数消耗量，
 *    且初始谜题本身不能是全灭（保证「同 seed 同谜题」且开局就有事可做）；
 * 2. **可重放**：把 history 里的翻转依次作用到初始谜题上，必须逐格等于存档里的 lights ——
 *    也就是说存档里的局面必须真的能由这道谜题走出，任何被改过的灯或凭空多出的局面都会在这里被拒绝；
 * 3. `history.length === moves`，且每个索引都在棋盘范围内。
 * decode 只按 seed 复算初始谜题，不会重算解法。
 */
export function decodeState(raw: unknown): LightsOutState {
  if (!raw || typeof raw !== 'object') throw illegal('lightsout.illegal.state:root')
  const value = raw as Partial<{
    difficulty: unknown
    seed: unknown
    rngCursor: unknown
    lights: unknown
    moves: unknown
    history: unknown
  }>
  const difficulty = difficultyOrThrow(String(value.difficulty ?? ''))
  const config = configFor(difficulty)
  const total = cellCount(config)

  const seed = readCount(value.seed, 'seed')
  if (seed > 0xffffffff) throw illegal('lightsout.illegal.state:seed')
  const rngCursor = readCount(value.rngCursor, 'rngCursor')
  const lights = readLights(value.lights, total, 'lights')
  const moves = readCount(value.moves, 'moves')
  const history = readToggles(value.history, total, 'history')
  if (history.length !== moves) throw illegal('lightsout.illegal.state:history-length')

  // 不变量 1：初始谜题可复算，且开局不是已解局面
  const puzzle = scramblePlan(config, seed)
  if (rngCursor !== puzzle.cursor) throw illegal('lightsout.illegal.state:rng-cursor')
  if (isAllOff(puzzle.lights)) throw illegal('lightsout.illegal.state:solved-puzzle')

  // 不变量 2：存档里的局面必须能由初始谜题按 history 走出
  const replayed = replay(puzzle.lights, config.size, history)
  if (!replayed.every((lit, index) => lit === lights[index])) {
    throw illegal('lightsout.illegal.state:unreachable')
  }

  return { difficulty, seed, rngCursor, lights, moves, history }
}
