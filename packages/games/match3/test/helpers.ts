/**
 * 消消乐测试公用小工具。
 *
 * 测试里也不许出现 Math.random：需要“随机”时一律用 core 的 createRng。
 */
import { createRng } from '@eink/core'
import {
  DIFFICULTIES,
  configFor,
  findGroups,
  findLegalSwaps,
  groupScore,
  match3Game,
  swapCells,
  type DifficultyId,
  type Match3Action,
  type Match3State,
} from '../src/index.js'

export function fresh(seed = 1, difficulty: DifficultyId = 'starter'): Match3State {
  return match3Game.create(seed, difficulty)
}

export function act(state: Match3State, action: Match3Action): Match3State {
  return match3Game.reduce(state, action)
}

/** selectAction 在契约里是可选的；消消乐必须实现它，这里断言存在后再调用 */
export function selectAt(state: Match3State, index: number): Match3Action | null {
  const select = match3Game.selectAction
  if (!select) throw new Error('match3 must implement selectAction')
  return select(state, index)
}

export function controlById(state: Match3State, id: string) {
  return match3Game.controls(state).find((control) => control.id === id)
}

export function statValue(state: Match3State, labelKey: string): string | undefined {
  return match3Game.view(state).stats.find((stat) => stat.labelKey === labelKey)?.value
}

/** 交换 a、b 之后第一轮能拿到的分数（不含连锁），用于「贪心」策略与断言 */
export function immediateScore(state: Match3State, a: number, b: number): number {
  const config = configFor(state.difficulty)
  let total = 0
  for (const group of findGroups(swapCells(state.board, a, b), config)) total += groupScore(group.length)
  return total
}

/**
 * 贪心选出「第一轮得分最高」的合法交换（同分取最靠前的），
 * 模拟一个水平普通、只看一步的玩家 —— 平衡校准用它当基线。
 */
export function greedyAction(state: Match3State): Match3Action | null {
  const swaps = findLegalSwaps(state.board, configFor(state.difficulty))
  let best: { a: number; b: number; gain: number } | null = null
  for (const [a, b] of swaps) {
    const gain = immediateScore(state, a, b)
    if (!best || gain > best.gain) best = { a, b, gain }
  }
  return best ? { type: 'swap', a: best.a, b: best.b } : null
}

/** 用贪心策略一直打到终局（或没有合法交换为止） */
export function playGreedy(state: Match3State): Match3State {
  let current = state
  for (let step = 0; step < 500; step++) {
    if (match3Game.status(current) !== 'playing') break
    const action = greedyAction(current)
    if (!action) break
    current = act(current, action)
  }
  return current
}

/** 用 core 的确定性随机源挑合法动作，做「随机合法动作」回放 */
export function randomPlayer(seed: number) {
  const rng = createRng(seed)
  return {
    rng,
    pick<T>(items: readonly T[]): T {
      return items[rng.int(items.length)]!
    },
  }
}

/** 交换两个格子后，只保留「能消」的那些相邻对（供测试挑选素材） */
export function swapPairs(state: Match3State): Array<readonly [number, number]> {
  return findLegalSwaps(state.board, configFor(state.difficulty))
}

export { DIFFICULTIES, configFor, findLegalSwaps, match3Game }
