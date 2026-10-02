/**
 * 记忆配对测试公用小工具。
 *
 * 测试里也不许出现 Math.random：需要随机时一律用 core 的 createRng。
 */
import {
  DIFFICULTIES,
  cellCount,
  configFor,
  memoryGame,
  snapshotOf,
  type DifficultyId,
  type MemoryAction,
  type MemoryState,
} from '../src/index.js'

export function fresh(seed = 1, difficulty: DifficultyId = 'starter'): MemoryState {
  return memoryGame.create(seed, difficulty)
}

export function act(state: MemoryState, action: MemoryAction): MemoryState {
  return memoryGame.reduce(state, action)
}

/** pairId → 该对子在牌面上的两个索引 */
export function pairIndices(deck: readonly number[]): Map<number, number[]> {
  const groups = new Map<number, number[]>()
  deck.forEach((pairId, index) => {
    const list = groups.get(pairId) ?? []
    list.push(index)
    groups.set(pairId, list)
  })
  return groups
}

/** 第 pairId 对子的两个索引（升序） */
export function pairOf(deck: readonly number[], pairId: number): [number, number] {
  const indices = pairIndices(deck).get(pairId)
  if (!indices || indices.length !== 2) throw new Error(`pair ${pairId} is not a pair`)
  return [indices[0]!, indices[1]!]
}

/** 按 pairId 升序把每一对连续翻开（完美记忆），一直打到终局 */
export function playToWin(state: MemoryState): MemoryState {
  let current = state
  const pairs = cellCount(configFor(state.difficulty)) / 2
  for (let pair = 0; pair < pairs; pair++) {
    const [first, second] = pairOf(state.deck, pair)
    current = act(current, { type: 'flip', index: first })
    current = act(current, { type: 'flip', index: second })
  }
  return current
}

export function statValue(state: MemoryState, labelKey: string): string | undefined {
  return memoryGame.view(state).stats.find((stat) => stat.labelKey === labelKey)?.value
}

export function controlById(state: MemoryState, id: string) {
  return memoryGame.controls(state).find((control) => control.id === id)
}

/** selectAction 在契约里是可选的；记忆配对必须实现它，这里断言存在后再调用 */
export function selectAt(state: MemoryState, index: number): MemoryAction | null {
  const select = memoryGame.selectAction
  if (!select) throw new Error('memory must implement selectAction')
  return select(state, index)
}

export { DIFFICULTIES, memoryGame, snapshotOf }
