/**
 * 白方（对手）策略：三档难度只改这一处，规则层与呈现层都不感知强度差异。
 *
 * - starter：在全部未画的边里等概率随机；
 * - skilled：先把能**立刻占格**的边吃掉（占得越多越好）；否则只走**安全边**（不给对手留下三边格）；
 *   实在没有安全边时，挑留下三边格最少的边（弃子最少）；
 * - challenging：同上，再对排好序的前 8 个候选做 **1 层前瞻** —— 模拟自己这一手之后
 *   对手最贪心的一手能吃几格，挑净亏最少的边。
 *
 * 确定性：随机只来自调用方传入的 `createRng(seed + 游标)`；候选排序带索引兜底、
 * 分支上限是常量，因此同 seed + 同局面必然选出同一条边。
 */
import { type Rng } from '@eink/core'
import {
  BLACK,
  applyClaim,
  boxesCompletedBy,
  openEdges,
  threesAfterClaim,
  type DifficultyId,
  type DotsBoxesState,
} from './board.js'

/** 前瞻候选上限：固定值，保证搜索代价与结果都可复现 */
export const AI_BRANCH_LIMIT = 8

/** 该方一条边最多能立刻占几个格（对手威胁评估用） */
export function immediateGain(state: DotsBoxesState, edge: number): number {
  return boxesCompletedBy(state, edge).length
}

/** 当前局面里「一手最多能立刻吃几格」（不区分轮到谁，纯看边） */
export function bestImmediateGain(state: DotsBoxesState): number {
  let best = 0
  for (const edge of openEdges(state)) {
    const gain = immediateGain(state, edge)
    if (gain > best) best = gain
  }
  return best
}

/** 一个候选边的确定性排序分：先看三边格数量，再看索引 */
function dangerScore(state: DotsBoxesState, edge: number): number {
  return threesAfterClaim(state, edge).length
}

/**
 * 为一个回合选一条边。`state.turn` 必须是传进来的一方（白方应手时恒为白方）。
 * 返回的边一定未画。
 */
export function chooseEdge(
  state: DotsBoxesState,
  difficulty: DifficultyId,
  rng: Rng,
): number {
  const legal = openEdges(state)
  if (legal.length === 0) throw new Error('dotsboxes: no legal edge')
  if (difficulty === 'starter') return rng.pick(legal)

  // 1) 能立刻占格就吃掉（占得越多越好）
  const capturing = legal.filter((edge) => immediateGain(state, edge) > 0)
  if (capturing.length > 0) {
    const bestGain = Math.max(...capturing.map((edge) => immediateGain(state, edge)))
    return rng.pick(capturing.filter((edge) => immediateGain(state, edge) === bestGain))
  }

  // 2) 安全边：画完之后不给对手留下三边格
  let pool = legal.filter((edge) => dangerScore(state, edge) === 0)
  if (pool.length === 0) {
    // 所有边都会送出三边格：挑送出最少的（弃子最少）
    const minDanger = Math.min(...legal.map((edge) => dangerScore(state, edge)))
    pool = legal.filter((edge) => dangerScore(state, edge) === minDanger)
  }
  if (difficulty === 'skilled') return rng.pick(pool)

  // 3) challenging：排序后取前 N 个候选，做 1 层前瞻（模拟对手最贪心的一手）
  const ordered = [...pool].sort((a, b) => dangerScore(state, a) - dangerScore(state, b) || a - b)
  const candidates = ordered.slice(0, AI_BRANCH_LIMIT)
  let bestScore = Number.NEGATIVE_INFINITY
  let bestEdges: number[] = []
  for (const edge of candidates) {
    const after = applyClaim(state, edge)
    // 这一手不会占格（能占格的边上面已经处理过），因此轮到对手：
    // 对手下一手最多能吃几格 + 留下的三边格数量，越小越好
    const threat = bestImmediateGain(after)
    const danger = threesAfterClaim(state, edge).length
    const score = -(threat * 10 + danger)
    if (score > bestScore) {
      bestScore = score
      bestEdges = [edge]
    } else if (score === bestScore) {
      bestEdges.push(edge)
    }
  }
  return rng.pick(bestEdges.length > 0 ? bestEdges : candidates)
}

/** 局面评估（黑方视角的子力差），供测试与调试用 */
export function evaluatePosition(state: DotsBoxesState): number {
  let score = 0
  for (const owner of state.owners) {
    if (owner === BLACK) score += 1
    else if (owner) score -= 1
  }
  return score
}
