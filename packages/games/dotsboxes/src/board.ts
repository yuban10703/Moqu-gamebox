/**
 * 点格棋棋盘模型：把 R×C 个方格编码成 (2R+1)×(2C+1) 的格子网格，用「线的格子」表达画线。
 *
 * 网格里每一格的类型由行列奇偶决定（棋盘是正方形，gridSize = 2R+1）：
 * - **偶行偶列 = 点**（lattice 交叉点，kind:'wall'，不可点）——共 (R+1)² 个；
 * - **奇行奇列 = 方格**（方块中心，被占领后属于某一方）——共 R² 个；
 * - 其余（偶行奇列 / 奇行偶列）= **边**：偶行奇列是横边，奇行偶列是竖边 —— 共 2R(R+1) 条。
 *
 * 注意：任务书里把「奇数行列 = 点、偶数行列 = 方格」写反了 —— 在 (2R+1) 网格上
 * 照那个奇偶走，奇数行列恰好是**方块中心**、而 (R+1)² 个真正的交叉点落在偶数行列上，
 * 画出来点会出现在方格中间。这里按几何正确的方式映射（点=偶偶、方格=奇奇），
 * 三类格子的数量、边的数量与「画第四条边占格」的判定都与经典点格棋一致。
 *
 * 一条边最多属于两个方格（棋盘边界上的边只属于一个），
 * 因此「画一条边后四边齐了的方格归当前玩家」这件事可以纯粹靠几何算出来。
 *
 * 本文件同时定义状态类型与**纯局面转移** `applyClaim`：
 * 规则层（动作/日志/撤销/存档）与 AI（模拟试算）都用同一个转移，保证两条路径语义一致。
 */
import { IllegalActionError } from '@eink/core'

export const GAME_ID = 'dotsboxes'

export const DIFFICULTY_IDS = ['starter', 'skilled', 'challenging'] as const

export type DifficultyId = (typeof DIFFICULTY_IDS)[number]

/** 对局方：黑方是玩家（先手），白方由规则层自动应手 */
export type Side = 'black' | 'white'

export const BLACK: Side = 'black'
export const WHITE: Side = 'white'

export function otherSide(side: Side): Side {
  return side === BLACK ? WHITE : BLACK
}

export interface BoardConfig {
  /** 方格数 R（也是 C，棋盘是正方形） */
  readonly boxes: number
  /** 网格边长 2R+1 */
  readonly gridSize: number
  /** 网格格数 */
  readonly cells: number
  /** 边的条数：横边 (R+1)*R + 竖边 R*(R+1) = 2R(R+1) */
  readonly edgeCount: number
  /** 方格数 R*R */
  readonly boxCount: number
}

export const DIFFICULTIES: Record<DifficultyId, BoardConfig> = (() => {
  const build = (boxes: number): BoardConfig => {
    const gridSize = boxes * 2 + 1
    return {
      boxes,
      gridSize,
      cells: gridSize * gridSize,
      edgeCount: 2 * boxes * (boxes + 1),
      boxCount: boxes * boxes,
    }
  }
  return { starter: build(3), skilled: build(4), challenging: build(5) }
})()

export function isDifficultyId(value: string): value is DifficultyId {
  return (DIFFICULTY_IDS as readonly string[]).includes(value)
}

export function difficultyOrThrow(value: string): DifficultyId {
  if (!isDifficultyId(value)) throw new IllegalActionError(GAME_ID, `unknown difficulty ${value}`)
  return value
}

export function configFor(difficulty: DifficultyId): BoardConfig {
  return DIFFICULTIES[difficulty]
}

/** 种子归一化成 uint32：负数/小数/NaN 都不会破坏「同 seed 同结果」 */
export function normalizeSeed(seed: number): number {
  return Number.isFinite(seed) ? Math.trunc(seed) >>> 0 : 0
}

export function rowOf(index: number, config: BoardConfig): number {
  return Math.floor(index / config.gridSize)
}

export function colOf(index: number, config: BoardConfig): number {
  return index % config.gridSize
}

export function indexOf(row: number, col: number, config: BoardConfig): number {
  return row * config.gridSize + col
}

export function inRange(index: number, config: BoardConfig): boolean {
  return Number.isInteger(index) && index >= 0 && index < config.cells
}

/** 偶行偶列 = 点（交叉点，不可点） */
export function isDot(index: number, config: BoardConfig): boolean {
  return inRange(index, config) && rowOf(index, config) % 2 === 0 && colOf(index, config) % 2 === 0
}

/** 奇行奇列 = 方格（方块中心） */
export function isBox(index: number, config: BoardConfig): boolean {
  return inRange(index, config) && rowOf(index, config) % 2 === 1 && colOf(index, config) % 2 === 1
}

/** 其余 = 边（偶行奇列是横边，奇行偶列是竖边） */
export function isEdge(index: number, config: BoardConfig): boolean {
  return inRange(index, config) && !isDot(index, config) && !isBox(index, config)
}

/** 横边：偶行奇列 */
export function isHorizontalEdge(index: number, config: BoardConfig): boolean {
  return isEdge(index, config) && rowOf(index, config) % 2 === 0
}

/** 全部边的索引（升序） */
export function edgeIndexes(config: BoardConfig): number[] {
  const out: number[] = []
  for (let index = 0; index < config.cells; index++) if (isEdge(index, config)) out.push(index)
  return out
}

/** 第 (row, col) 个方格在网格里的索引（方格中心在奇行奇列） */
export function boxIndexAt(row: number, col: number, config: BoardConfig): number {
  return indexOf(row * 2 + 1, col * 2 + 1, config)
}

/** 一个方格的四条边：[上, 下, 左, 右] */
export function edgesOfBox(boxIndex: number, config: BoardConfig): number[] {
  const row = (rowOf(boxIndex, config) - 1) / 2
  const col = (colOf(boxIndex, config) - 1) / 2
  return [
    indexOf(row * 2, col * 2 + 1, config),
    indexOf(row * 2 + 2, col * 2 + 1, config),
    indexOf(row * 2 + 1, col * 2, config),
    indexOf(row * 2 + 1, col * 2 + 2, config),
  ]
}

/** 一条边相邻的方格（棋盘边界上的边只有一个） */
export function boxesOfEdge(edgeIndex: number, config: BoardConfig): number[] {
  const row = rowOf(edgeIndex, config)
  const col = colOf(edgeIndex, config)
  const out: number[] = []
  if (row % 2 === 0) {
    // 横边（偶行奇列）：上方与下方的方格（紧邻的奇行）
    if (row > 0) out.push(indexOf(row - 1, col, config))
    if (row < config.gridSize - 1) out.push(indexOf(row + 1, col, config))
  } else {
    // 竖边（奇行偶列）：左侧与右侧的方格（紧邻的奇列）
    if (col > 0) out.push(indexOf(row, col - 1, config))
    if (col < config.gridSize - 1) out.push(indexOf(row, col + 1, config))
  }
  return out
}

/** 全部方格索引（升序） */
export function boxIndexes(config: BoardConfig): number[] {
  const out: number[] = []
  for (let row = 0; row < config.boxes; row++) {
    for (let col = 0; col < config.boxes; col++) out.push(boxIndexAt(row, col, config))
  }
  return out
}

/**
 * 点格棋状态。
 * `edges` 与 `owners` 都是「和网格同样长」的数组：
 * - `edges[格]` 只在边格上有意义（null = 没画，'black'/'white' = 谁画的）；
 * - `owners[格]` 只在方格格上有意义（null = 没被占领）。
 * 这样视图可以逐个格子直接查，不需要额外映射。
 */
export interface DotsBoxesState {
  readonly difficulty: DifficultyId
  readonly seed: number
  readonly edges: readonly (Side | null)[]
  readonly owners: readonly (Side | null)[]
  /** 现在轮到谁。可对局时恒为黑方（白方应手在同一次 reduce 内算完） */
  readonly turn: Side
  /** 玩家画线数（白方应手不计；撤销会回退） */
  readonly moves: number
  /** 已应手过的白方回合数：白方每回合用 createRng(seed + 该值) 取一次随机流 */
  readonly rngCursor: number
  /** 最近被画的边（视图/复盘用） */
  readonly lastEdge: number | null
  /** 双方全部画线的日志（动作日志即存档） */
  readonly log: readonly number[]
}

export interface Scores {
  readonly black: number
  readonly white: number
}

export function countScores(owners: readonly (Side | null)[]): Scores {
  let black = 0
  let white = 0
  for (const owner of owners) {
    if (owner === BLACK) black += 1
    else if (owner === WHITE) white += 1
  }
  return { black, white }
}

/** 未画的边（升序）；只有边格会被算进来 */
export function openEdges(state: DotsBoxesState): number[] {
  const config = configFor(state.difficulty)
  const out: number[] = []
  for (let index = 0; index < config.cells; index++) {
    if (isEdge(index, config) && state.edges[index] === null) out.push(index)
  }
  return out
}

/** 还剩几条边没画（只统计边格，点与方格不算） */
export function remainingEdges(state: DotsBoxesState): number {
  return openEdges(state).length
}

/** 棋盘是否已经画满（= 全部分格被占领） */
export function isBoardFull(state: DotsBoxesState): boolean {
  return openEdges(state).length === 0
}

export function emptyState(seed: number, difficulty: DifficultyId): DotsBoxesState {
  const config = configFor(difficulty)
  return {
    difficulty,
    seed: normalizeSeed(seed),
    edges: new Array<Side | null>(config.cells).fill(null),
    owners: new Array<Side | null>(config.cells).fill(null),
    turn: BLACK,
    moves: 0,
    rngCursor: 0,
    lastEdge: null,
    log: [],
  }
}

/**
 * 画这条边会立刻占掉的方格：这些方格现在只差这一条边。
 * 注意要把「正在画的这条边」也算成已画，否则永远算不出任何可占的方格
 * （AI 的「优先吃格」判断就完全失效了）。
 */
export function boxesCompletedBy(
  state: DotsBoxesState,
  edge: number,
): number[] {
  const config = configFor(state.difficulty)
  const out: number[] = []
  for (const box of boxesOfEdge(edge, config)) {
    if (state.owners[box] !== null) continue
    const edges = edgesOfBox(box, config)
    if (
      edges.every((candidate) => candidate === edge || state.edges[candidate] !== null)
    ) {
      out.push(box)
    }
  }
  return out
}

/** 画这条边之后，会剩下「三边齐、只差一条」的方格（对手下一手就能吃掉它们） */
export function threesAfterClaim(state: DotsBoxesState, edge: number): number[] {
  const config = configFor(state.difficulty)
  const claimed = new Set<number>([edge])
  const out: number[] = []
  for (const box of boxesOfEdge(edge, config)) {
    if (state.owners[box] !== null) continue
    const edges = edgesOfBox(box, config)
    const filled = edges.filter(
      (candidate) => state.edges[candidate] !== null || claimed.has(candidate),
    ).length
    if (filled === 3) out.push(box)
  }
  return out
}

/**
 * 纯局面转移：把 edge 画给当前这一方。
 *
 * - 非法（越界 / 不是边 / 已经画过）直接抛 IllegalActionError；
 * - 若这一笔让**至少一个**方格四边齐了，方格归当前玩家，并且**当前玩家继续走**（连走）；
 * - 否则换手；换到白方时随机游标 +1（白方每回合正好消耗一条随机流）。
 */
export function applyClaim(state: DotsBoxesState, edge: number): DotsBoxesState {
  const config = configFor(state.difficulty)
  if (!inRange(edge, config) || !isEdge(edge, config)) {
    throw new IllegalActionError(GAME_ID, `dotsboxes.illegal.not-an-edge:${String(edge)}`)
  }
  if (state.edges[edge] !== null) {
    throw new IllegalActionError(GAME_ID, `dotsboxes.illegal.claimed:${edge}`)
  }
  const edges = state.edges.slice()
  edges[edge] = state.turn
  const owners = state.owners.slice()
  let captured = 0
  for (const box of boxesOfEdge(edge, config)) {
    if (owners[box] !== null) continue
    if (edgesOfBox(box, config).every((candidate) => edges[candidate] !== null)) {
      owners[box] = state.turn
      captured += 1
    }
  }
  const moves = state.turn === BLACK ? state.moves + 1 : state.moves
  let turn = state.turn
  let rngCursor = state.rngCursor
  if (captured === 0) {
    turn = otherSide(state.turn)
    if (turn === WHITE) rngCursor += 1
  }
  return {
    ...state,
    edges,
    owners,
    turn,
    moves,
    rngCursor,
    lastEdge: edge,
    log: [...state.log, edge],
  }
}
