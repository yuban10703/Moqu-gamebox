/**
 * 白方（对手）策略：三档难度只改这一处，规则层与呈现层都不感知强度差异。
 *
 * - starter：在合法坑里等概率随机；
 * - skilled：贪心 —— ① 能「最后一颗落自己仓」连走的优先；② 其次「能吃就吃」；
 *   两者都没有时在其余合法坑里随机（避免每局都走同一步）；
 * - challenging：同一套启发式 + **2~3 层前瞻**（固定深度与分支上限，保证确定性）：
 *   对每个合法坑做 minimax，评估值为「自家仓 − 对手仓」加上坑内石子的潜在价值；
 *   连走只延长同一层（不额外扣深度），靠节点预算兜底避免指数爆炸。
 *
 * 确定性：随机只来自调用方传入的 `createRng(seed + 白方回合数)`；
 * 候选坑一律升序、只对同分候选随机，因此同 seed + 同局面必然同一手。
 */
import { type Rng } from '@eink/core'
import {
  BLACK,
  isFinished,
  legalPits,
  otherSide,
  pitStones,
  sowOnce,
  storeCount,
  type DifficultyId,
  type MancalaState,
  type Side,
} from './board.js'

/** 前瞻深度（challenging 用） */
export const SEARCH_DEPTH = 3
/** 每个节点的分支上限：固定值，保证搜索代价与结果都可复现 */
export const BRANCH_LIMIT = 6
/** 节点预算：连走不扣深度，靠它兜底 */
export const NODE_BUDGET = 20_000

/** 局面评估（`side` 视角）：仓差为主，坑内石子为辅（未结算的石子还有价值） */
export function evaluate(state: MancalaState, side: Side): number {
  const other = otherSide(side)
  return (
    (storeCount(state.cells, side) - storeCount(state.cells, other)) * 100 +
    (pitStones(state.cells, side) - pitStones(state.cells, other))
  )
}

interface Counter {
  nodes: number
}

function search(state: MancalaState, side: Side, depth: number, counter: Counter): number {
  if (isFinished(state.cells) || depth <= 0 || counter.nodes++ > NODE_BUDGET) {
    return evaluate(state, side)
  }
  const moves = legalPits(state, side).slice(0, BRANCH_LIMIT)
  if (moves.length === 0) return evaluate(state, side)
  let best = Number.NEGATIVE_INFINITY
  for (const pit of moves) {
    const { state: next } = sowOnce({ ...state, turn: side }, pit)
    // 连走：同一方继续（深度不扣，节点预算兜底）；否则换到对手视角取相反数
    const value =
      next.turn === side
        ? search(next, side, depth, counter)
        : -search(next, otherSide(side), depth - 1, counter)
    if (value > best) best = value
  }
  return best
}

/** 贪心分：连走 2 分、吃子 1 分（skilled / challenging 的叶子启发式） */
export function greedyScore(state: MancalaState, pit: number): number {
  const { extraTurn, captured } = sowOnce(state, pit)
  return (extraTurn ? 2 : 0) + (captured > 0 ? 1 : 0)
}

/** 该方全部合法坑的贪心分（测试与调试用） */
export function greedyScores(state: MancalaState, side: Side = state.turn): Array<{ pit: number; score: number }> {
  return legalPits(state, side).map((pit) => ({ pit, score: greedyScore({ ...state, turn: side }, pit) }))
}

/**
 * 为白方选一个坑。返回的坑一定是当前这一方（`state.turn`）合法且非空的坑。
 */
export function choosePit(
  state: MancalaState,
  difficulty: DifficultyId,
  rng: Rng,
): number {
  const legal = legalPits(state)
  if (legal.length === 0) throw new Error('mancala: no legal pit')
  if (difficulty === 'starter') return rng.pick(legal)

  if (difficulty === 'skilled') {
    const scored = legal.map((pit) => ({ pit, score: greedyScore(state, pit) }))
    const best = Math.max(...scored.map((item) => item.score))
    return rng.pick(scored.filter((item) => item.score === best).map((item) => item.pit))
  }

  // challenging：逐坑做前瞻，取最大评估值；同分交给随机流
  let bestValue = Number.NEGATIVE_INFINITY
  let bestPits: number[] = []
  for (const pit of legal.slice(0, BRANCH_LIMIT)) {
    const { state: next } = sowOnce(state, pit)
    const counter: Counter = { nodes: 0 }
    const value =
      next.turn === state.turn
        ? search(next, state.turn, SEARCH_DEPTH, counter)
        : -search(next, otherSide(state.turn), SEARCH_DEPTH - 1, counter)
    if (value > bestValue) {
      bestValue = value
      bestPits = [pit]
    } else if (value === bestValue) {
      bestPits.push(pit)
    }
  }
  return rng.pick(bestPits.length > 0 ? bestPits : legal)
}

/** 局面评估（黑方视角），供测试与调试用 */
export function evaluatePosition(state: MancalaState): number {
  return evaluate(state, BLACK)
}
