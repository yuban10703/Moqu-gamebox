/**
 * 华容道规则层：状态、选中/滑动、撤销与存档编解码（纯函数，无副作用）。
 *
 * 核心设计与 pegsolitaire / checkers 同一套「动作日志即存档」：
 * - 位置表可以由 `(levelId, log)` 从关卡初始摆法重放出来；
 * - `undo` 把日志截断一次再重放（**不撤回选中**：选中是界面状态，不进日志）；
 * - `decode` 重放日志并逐字段比对位置表/步数 —— 块重叠、块越界、块数量不对、选中不存在的块
 *   都会在这里被拒绝，不会出现「decode 拒绝自己状态」。
 *
 * 关卡布局固定、没有随机性：`create` 忽略 seed。
 */
import { IllegalActionError, type GameStatus, type MoveDir } from '@eink/core'
import {
  CELLS,
  COLS,
  GAME_ID,
  ROWS,
  cellsOf,
  firstLevelId,
  initialPositions,
  isMoveDir,
  isSolved,
  levelOrThrow,
  occupancy,
  pieceById,
  replaySlides,
  slidePositions,
  targetStart,
  type DifficultyId,
  type LevelDef,
  type Positions,
} from './board.js'

export type KlotskiAction =
  /** 选中/取消选中一块（选中不计步、不进日志） */
  | { type: 'select'; id: string }
  /** 把 id 块沿 dir 滑一格；目标格有块或越界时抛 IllegalActionError */
  | { type: 'slide'; id: string; dir: MoveDir }
  /** 撤回一次滑动（不撤回选中）。没有历史时抛错 */
  | { type: 'undo' }
  /** 重开：回到本关初始摆法。壳层会无条件派发，必须接受 */
  | { type: 'restart' }

export interface Slide {
  readonly id: string
  readonly dir: MoveDir
}

export interface KlotskiState {
  readonly levelId: string
  /** 块 id → 左上角索引 */
  readonly positions: Positions
  /** 当前选中的块 id；null = 没有选中 */
  readonly selected: string | null
  /** 滑动次数（撤销会回退） */
  readonly moves: number
  /** 每次滑动的记录；`log.length` 恒等于 `moves` */
  readonly log: readonly Slide[]
}

function illegal(reason: string): IllegalActionError {
  return new IllegalActionError(GAME_ID, reason)
}

export function createState(levelId: string): KlotskiState {
  const level = levelOrThrow(levelId)
  return {
    levelId,
    positions: initialPositions(level.def),
    selected: null,
    moves: 0,
    log: [],
  }
}

export function createStateForDifficulty(difficulty: DifficultyId): KlotskiState {
  return createState(firstLevelId(difficulty))
}

/** 曹操左上角到达出口位置即胜；本玩法没有失败态 */
export function gameStatus(state: KlotskiState): GameStatus {
  return isSolved(state.positions) ? 'won' : 'playing'
}

function assertPlaying(state: KlotskiState): void {
  if (gameStatus(state) !== 'playing') throw illegal('game already finished')
}

function levelOf(state: KlotskiState): LevelDef {
  return levelOrThrow(state.levelId).def
}

function assertPiece(level: LevelDef, id: unknown): asserts id is string {
  if (typeof id !== 'string' || pieceById(level, id) === undefined) {
    throw illegal(`klotski.illegal.piece:${String(id)}`)
  }
}

export function reduceKlotski(state: KlotskiState, action: KlotskiAction): KlotskiState {
  const level = levelOf(state)
  switch (action.type) {
    case 'select': {
      assertPlaying(state)
      assertPiece(level, action.id)
      // 点同一块 = 取消选中
      return { ...state, selected: state.selected === action.id ? null : action.id }
    }

    case 'slide': {
      assertPlaying(state)
      assertPiece(level, action.id)
      if (!isMoveDir(action.dir)) throw illegal(`klotski.illegal.dir:${String(action.dir)}`)
      const next = slidePositions(level, state.positions, action.id, action.dir)
      // 目标格有块或越界：明确拒绝，壳层按 illegalNoticeKey 提示
      if (next === null) throw illegal(`klotski.illegal.slide:${action.id}:${action.dir}`)
      return {
        ...state,
        positions: next,
        // 选中保持不变：玩家可以继续点旁边的空格把同一块接着挪
        moves: state.moves + 1,
        log: [...state.log, { id: action.id, dir: action.dir }],
      }
    }

    case 'undo': {
      const last = state.log[state.log.length - 1]
      if (last === undefined) throw illegal('klotski.illegal.nothing-to-undo')
      const log = state.log.slice(0, -1)
      // 重放剩余日志得到上一步的位置表；selected 保持原样（撤回滑动不撤回选中）
      return {
        ...state,
        positions: replaySlides(level, log),
        moves: state.moves - 1,
        log,
      }
    }

    case 'restart':
      // 回到本关初始摆法（过关后也必须可用）
      return createState(state.levelId)

    default: {
      // 未知动作（方向键、旧存档、壳层误派）明确报错，避免静默无响应
      const unknown = action as { type?: unknown }
      throw illegal(`klotski.illegal.action:${String(unknown.type)}`)
    }
  }
}

/** 当前局面下被规则允许的动作（供禁用按钮与回放校验） */
export function legalActions(state: KlotskiState): KlotskiAction[] {
  const level = levelOf(state)
  const out: KlotskiAction[] = []
  if (gameStatus(state) === 'playing') {
    for (const piece of level.pieces) {
      out.push({ type: 'select', id: piece.id })
      for (const dir of ['up', 'down', 'left', 'right'] as const) {
        if (slidePositions(level, state.positions, piece.id, dir) !== null) {
          out.push({ type: 'slide', id: piece.id, dir })
        }
      }
    }
  }
  if (state.log.length > 0) out.push({ type: 'undo' })
  out.push({ type: 'restart' })
  return out
}

/**
 * 「点了第 index 个格子」→ 动作。
 *
 * - 点到某块占用的格 → `select`（点同一块即取消，由 reduce 处理）；
 * - 已选中时点到**该块旁边的空格**，且这一步滑动合法 → `slide`；
 * - 已选中时点到别的块 → `select`（改选）；
 * - 点空格但没有选中 / 方向不合法 → null（点了没反应）。
 *
 * 关键：只给出**当前合法**的那一步 —— 玩家不可能点到会抛错的位置。
 */
export function selectAction(state: KlotskiState, index: number): KlotskiAction | null {
  if (gameStatus(state) !== 'playing') return null
  if (!Number.isInteger(index) || index < 0 || index >= CELLS) return null
  const level = levelOf(state)
  const grid = occupancy(level, state.positions)
  const owner = grid[index] ?? null
  if (owner !== null) return { type: 'select', id: owner }
  if (state.selected === null) return null

  const piece = pieceById(level, state.selected)
  if (!piece) return null
  const start = state.positions[state.selected]
  if (start === undefined) return null
  const ownCells = new Set(cellsOf(start, piece.width, piece.height))
  for (const dir of ['up', 'down', 'left', 'right'] as const) {
    const next = slidePositions(level, state.positions, state.selected, dir)
    if (next === null) continue
    const nextStart = targetStart(start, piece.width, piece.height, dir)
    if (nextStart === null) continue
    // 这一步「新占」的格子（也就是滑过去时贴着的那些空格）
    const entering = cellsOf(nextStart, piece.width, piece.height).filter(
      (cell) => !ownCells.has(cell),
    )
    if (entering.includes(index)) return { type: 'slide', id: state.selected, dir }
  }
  return null
}

export function encodeState(state: KlotskiState): unknown {
  return {
    levelId: state.levelId,
    positions: { ...state.positions },
    selected: state.selected,
    moves: state.moves,
    log: state.log.map((slide) => ({ id: slide.id, dir: slide.dir })),
  }
}

function readCount(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw illegal(`klotski.illegal.state:${field}`)
  }
  return value
}

/** 读位置表：必须恰好覆盖本关所有块，且每个值都是盘内合法左上角 */
function readPositions(value: unknown, level: LevelDef): Positions {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw illegal('klotski.illegal.state:positions')
  }
  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
  if (keys.length !== level.pieces.length) throw illegal('klotski.illegal.state:positions')
  const positions: Record<string, number> = {}
  for (const piece of level.pieces) {
    const raw = record[piece.id]
    if (raw === undefined) throw illegal('klotski.illegal.state:positions')
    const start = readCount(raw, 'positions')
    if (start >= CELLS) throw illegal('klotski.illegal.state:positions')
    const row = Math.floor(start / COLS)
    const col = start % COLS
    if (row + piece.height > ROWS || col + piece.width > COLS) {
      throw illegal('klotski.illegal.state:positions')
    }
    positions[piece.id] = start
  }
  return positions
}

function readLog(value: unknown, level: LevelDef): Slide[] {
  if (!Array.isArray(value)) throw illegal('klotski.illegal.state:log')
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object') throw illegal('klotski.illegal.state:log-entry')
    const slide = entry as { id?: unknown; dir?: unknown }
    if (typeof slide.id !== 'string' || pieceById(level, slide.id) === undefined) {
      throw illegal('klotski.illegal.state:log-id')
    }
    if (!isMoveDir(slide.dir)) throw illegal('klotski.illegal.state:log-dir')
    return { id: slide.id, dir: slide.dir }
  })
}

/**
 * 严格校验存档：从关卡初始摆法重放日志，并逐字段比对位置表。
 * 重放会拒绝一切非法滑动（越界、撞块），因此重叠/越界/块数量不对的存档都进不来。
 */
export function decodeState(raw: unknown): KlotskiState {
  if (!raw || typeof raw !== 'object') throw illegal('klotski.illegal.state:root')
  const value = raw as Partial<{
    levelId: unknown
    positions: unknown
    selected: unknown
    moves: unknown
    log: unknown
  }>
  if (typeof value.levelId !== 'string') throw illegal('klotski.illegal.state:level')
  const level = levelOrThrow(value.levelId).def

  const log = readLog(value.log, level)
  const moves = readCount(value.moves, 'moves')
  if (moves !== log.length) throw illegal('klotski.illegal.state:log-length')

  const replayed = replaySlides(level, log)
  const positions = readPositions(value.positions, level)
  if (!level.pieces.every((piece) => positions[piece.id] === replayed[piece.id])) {
    throw illegal('klotski.illegal.state:positions-mismatch')
  }
  // 顺带校验「同一格不会被两块占用」（readPositions 不可能发现，重放结果本来就是合法的）
  occupancy(level, replayed)

  let selected: string | null = null
  if (value.selected !== null && value.selected !== undefined) {
    if (typeof value.selected !== 'string' || pieceById(level, value.selected) === undefined) {
      throw illegal('klotski.illegal.state:selected')
    }
    selected = value.selected
  }

  return { levelId: level.id, positions: replayed, selected, moves, log }
}
