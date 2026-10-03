/**
 * 白方（对手）策略：三档难度只改这一处，规则层与呈现层都不感知强度差异。
 *
 * - starter：在合法动作里等概率随机；
 * - skilled：贪心 + 1 层 —— 成三 > 挡对方成三 > 占中点，并扣掉「我走完之后对手立刻能成三」的分数；
 * - challenging：同一套评估 + **α-β 剪枝深度 4**（每节点固定分支上限、固定节点预算）。
 *
 * 确定性：随机只来自调用方传入的 `createRng(seed + 白方回合数)`；
 * 候选动作先按启发式稳定排序再截断，只有同分候选才用随机流，因此同 seed + 同局面必然同一手。
 */
import { type Rng } from '@eink/core'
import {
  BLACK,
  MILL_LINES,
  POINT_COUNT,
  WHITE,
  applyAction,
  degreeOf,
  otherPlayer,
  phaseOf,
  pointsOf,
  rawActions,
  stonesLeft,
  type DifficultyId,
  type LoggedAction,
  type NinemensState,
  type Player,
} from './board.js'

/** 搜索深度与分支上限：固定值，保证代价与结果都可复现 */
export const SEARCH_DEPTH = 4
export const BRANCH_LIMIT = 8
export const NODE_BUDGET = 20_000
const WIN_SCORE = 1_000_000

/** 度数 4 的点位就是「中间方框四条边的中点」（经典盘面的枢纽点） */
export const KEY_POINTS: readonly number[] = (() => {
  const out: number[] = []
  for (let point = 0; point < POINT_COUNT; point++) if (degreeOf(point) === 4) out.push(point)
  return out
})()

/** 已完成的成三线条数 */
export function completeMills(state: NinemensState, player: Player): number {
  return MILL_LINES.filter((line) => line.every((point) => state.points[point] === player)).length
}

/**
 * 「两子一线」威胁数：一条成三线上正好有 2 个自己的子、第 3 点为空。
 * 这是直棋里最直接的进攻指标，也是「挡对方成三」要盯的东西。
 */
export function lineThreats(state: NinemensState, player: Player): number {
  let count = 0
  for (const line of MILL_LINES) {
    const mine = line.filter((point) => state.points[point] === player).length
    const empty = line.filter((point) => state.points[point] === null).length
    if (mine === 2 && empty === 1) count += 1
  }
  return count
}

function keyCount(state: NinemensState, player: Player): number {
  return pointsOf(state, player).filter((point) => KEY_POINTS.includes(point)).length
}

/** 局面评估（`player` 视角） */
export function evaluate(state: NinemensState, player: Player): number {
  const other = otherPlayer(player)
  const material = stonesLeft(state, player) - stonesLeft(state, other)
  const mills = completeMills(state, player) - completeMills(state, other)
  const threats = lineThreats(state, player) - lineThreats(state, other)
  const key = keyCount(state, player) - keyCount(state, other)
  return material * 12 + mills * 25 + threats * 10 + key * 4
}

/**
 * 该方一步之内最多能成几条线（用于「挡对方成三」与 1 层前瞻）。
 * 做法：把局面虚拟成「该方行棋、没有待吃子」，按阶段重新生成合法动作（放/移），取最大成三数。
 */
export function bestImmediateMills(state: NinemensState, player: Player): number {
  const base: NinemensState = { ...state, turn: player, pendingRemove: 0 }
  const probe: NinemensState = { ...base, phase: phaseOf(base) }
  let best = 0
  for (const action of rawActions(probe)) {
    if (action.type === 'remove') continue
    const formed = formedMills(probe, action)
    if (formed > best) best = formed
  }
  return best
}

/** 这个动作能形成几条成三线（不改原状态） */
function formedMills(state: NinemensState, action: LoggedAction): number {
  if (action.type === 'remove') return 0
  const points = [...state.points]
  if (action.type === 'place') points[action.index] = state.turn
  else {
    points[action.from] = null
    points[action.to] = state.turn
  }
  const target = action.type === 'place' ? action.index : action.to
  return MILL_LINES.filter(
    (line) => line.includes(target) && line.every((point) => points[point] === state.turn),
  ).length
}

/** 吃子打分：优先吃掉对方「两子一线」里的子（拆掉对方的成三威胁） */
function removeScore(state: NinemensState, index: number): number {
  const victim = otherPlayer(state.turn)
  let score = 100
  for (const line of MILL_LINES) {
    if (!line.includes(index)) continue
    const theirs = line.filter((point) => state.points[point] === victim).length
    const empty = line.filter((point) => state.points[point] === null).length
    if (theirs === 2 && empty === 1) score += 40
    else if (theirs === 3) score += 20
  }
  return score
}

/** 非吃子动作的启发式分（skilled 用；challenging 只借它排序） */
export function heuristicScore(state: NinemensState, action: LoggedAction): number {
  if (action.type === 'remove') return removeScore(state, action.index)
  const side = state.turn
  const formed = formedMills(state, action)
  let score = formed * 100
  const target = action.type === 'place' ? action.index : action.to
  if (KEY_POINTS.includes(target)) score += 6
  // 挡对方成三：走完之后对手立刻能成的线越少越好（用对手视角的 1 层前瞻）
  const after = applyAction(state, action).state
  score -= bestImmediateMills(after, otherPlayer(side)) * 30
  return score
}

interface Counter {
  nodes: number
}

function terminalValue(state: NinemensState, side: Player, depth: number): number | null {
  if (stonesLeft(state, BLACK) <= 2) return side === BLACK ? -WIN_SCORE - depth : WIN_SCORE + depth
  if (stonesLeft(state, WHITE) <= 2) return side === WHITE ? -WIN_SCORE - depth : WIN_SCORE + depth
  if (state.pendingRemove === 0 && rawActions(state).length === 0) {
    return state.turn === side ? -WIN_SCORE - depth : WIN_SCORE + depth
  }
  return null
}

/** α-β 搜索：返回 `side` 视角的分值 */
export function search(
  state: NinemensState,
  side: Player,
  depth: number,
  alpha: number,
  beta: number,
  counter: Counter,
): number {
  const terminal = terminalValue(state, side, depth)
  if (terminal !== null) return terminal
  if (depth <= 0 || counter.nodes++ > NODE_BUDGET) return evaluate(state, side)
  // 只有浅层（搜索的前两层）才值得按启发式排序：深层每个节点都算一遍 O(动作数²)
  // 的启发式会让整棵搜索树变慢好几倍，而剪枝收益很小
  const all = rawActions(state)
  const actions =
    depth >= SEARCH_DEPTH - 1
      ? [...all]
          .map((action, order) => ({ action, order, score: heuristicScore(state, action) }))
          .sort((a, b) => b.score - a.score || a.order - b.order)
          .slice(0, BRANCH_LIMIT)
          .map((item) => item.action)
      : all.slice(0, BRANCH_LIMIT)
  if (actions.length === 0) return evaluate(state, side)

  let best = Number.NEGATIVE_INFINITY
  let localAlpha = alpha
  for (const action of actions) {
    const after = applyAction(state, action).state
    // 成三后同一方继续吃子 ⇒ 深度不扣，交给节点预算兜底
    const value =
      after.turn === side
        ? search(after, side, depth, localAlpha, beta, counter)
        : -search(after, otherPlayer(side), depth - 1, -beta, -localAlpha, counter)
    if (value > best) best = value
    if (best > localAlpha) localAlpha = best
    if (localAlpha >= beta) break
  }
  return best
}

/** 按启发式稳定排序（同分保持原始顺序），便于截断分支 */
function orderedActions(state: NinemensState): LoggedAction[] {
  return rawActions(state)
    .map((action, order) => ({ action, order, score: heuristicScore(state, action) }))
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map((item) => item.action)
}

/**
 * 为白方选一个动作。返回的动作一定是当前局面合法的 place/move/remove。
 */
export function chooseAction(
  state: NinemensState,
  difficulty: DifficultyId,
  rng: Rng,
): LoggedAction {
  const actions = rawActions(state)
  if (actions.length === 0) throw new Error('ninemens: no legal action')
  if (difficulty === 'starter') return rng.pick(actions)

  if (difficulty === 'skilled') {
    const scored = actions.map((action) => ({ action, score: heuristicScore(state, action) }))
    const best = Math.max(...scored.map((item) => item.score))
    return rng.pick(scored.filter((item) => item.score === best).map((item) => item.action))
  }

  // challenging：α-β，根节点逐动作求值；同分交给随机流
  const candidates = orderedActions(state).slice(0, BRANCH_LIMIT)
  let bestValue = Number.NEGATIVE_INFINITY
  let bestActions: LoggedAction[] = []
  for (const action of candidates) {
    const after = applyAction(state, action).state
    const counter: Counter = { nodes: 0 }
    const value =
      after.turn === state.turn
        ? search(after, state.turn, SEARCH_DEPTH, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY, counter)
        : -search(
            after,
            otherPlayer(state.turn),
            SEARCH_DEPTH - 1,
            Number.NEGATIVE_INFINITY,
            Number.POSITIVE_INFINITY,
            counter,
          )
    if (value > bestValue) {
      bestValue = value
      bestActions = [action]
    } else if (value === bestValue) {
      bestActions.push(action)
    }
  }
  return rng.pick(bestActions.length > 0 ? bestActions : candidates)
}

/** 局面评估（黑方视角），供测试与调试用 */
export function evaluatePosition(state: NinemensState): number {
  return evaluate(state, BLACK)
}

/** 供测试与调试：黑方「两子一线」威胁数 */
export function blackThreats(state: NinemensState): number {
  return lineThreats(state, BLACK)
}
