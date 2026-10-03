/**
 * 测试夹具：真实局面（create + reduce）与用于 AI 测试的**手工局面**。
 *
 * AI 只读 `edges` / `owners`（谁画的边不影响它的判断），因此手工局面可以直接摆线，
 * 不需要凑出一条真实可达的日志。规则层测试则一律用真实对局（undo/decode 依赖日志）。
 */
import { createRng } from '@eink/core'
import {
  BLACK,
  WHITE,
  configFor,
  edgesOfBox,
  emptyState,
  indexOf,
  isBox,
  isEdge,
  openEdges,
  type DifficultyId,
  type DotsBoxesState,
  type Side,
} from '../src/index.js'

export function fresh(seed = 20240607, difficulty: DifficultyId = 'starter'): DotsBoxesState {
  return emptyState(seed, difficulty)
}

/** 某条边/某个方格的索引（便于测试里按行列写位置） */
export function cellAt(row: number, col: number, difficulty: DifficultyId): number {
  return indexOf(row, col, configFor(difficulty))
}

export interface CustomBoard {
  /** 已经画过的边（谁画的无所谓，AI 只看「画没画」） */
  readonly claimed?: readonly number[]
  /** 已经占领的方格 */
  readonly owners?: ReadonlyArray<readonly [number, Side]>
  readonly turn?: Side
}

/** 手工摆一个局面（只填 edges/owners/turn，log 为空） */
export function customState(difficulty: DifficultyId, board: CustomBoard = {}): DotsBoxesState {
  const state = emptyState(1, difficulty)
  const config = configFor(difficulty)
  const edges = state.edges.slice()
  const owners = state.owners.slice()
  for (const edge of board.claimed ?? []) {
    if (!isEdge(edge, config)) throw new Error(`claim target ${edge} is not an edge`)
    edges[edge] = BLACK
  }
  for (const [box, side] of board.owners ?? []) {
    if (!isBox(box, config)) throw new Error(`owner target ${box} is not a box`)
    owners[box] = side
  }
  return { ...state, edges, owners, turn: board.turn ?? WHITE }
}

/** 画满某个方格的四条边里的前 n 条（用于构造「三边格」） */
export function claimedEdgesOfBox(
  box: number,
  count: number,
  difficulty: DifficultyId,
): number[] {
  return edgesOfBox(box, configFor(difficulty)).slice(0, count)
}

/**
 * 用「随机黑方 + 指定难度的白方」把一局打完（黑方只走合法边）。
 * 返回终局状态；用于验证「画满后判胜/判和」与统计口径。
 */
export function playFullGame(
  seed: number,
  difficulty: DifficultyId,
  claim: (state: DotsBoxesState, index: number) => DotsBoxesState,
): DotsBoxesState {
  const rng = createRng(seed)
  let state = fresh(seed, difficulty)
  let guard = 0
  for (;;) {
    const edges = openEdges(state)
    if (edges.length === 0) break
    if (guard++ > 5000) throw new Error('game did not finish')
    state = claim(state, edges[rng.int(edges.length)]!)
  }
  return state
}
