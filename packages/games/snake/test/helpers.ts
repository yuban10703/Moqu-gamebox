/**
 * 测试共用的小工具：手工构造局面 + 一条 12×12 的哈密顿回路。
 *
 * 为什么需要手工构造：撞墙 / 撞障碍 / 撞自己 / 填满棋盘这些边界局面
 * 靠随机种子碰运气既慢又不稳，直接摆出来测才是确定性的。
 */
import { createState, type SnakeState } from '../src/rules.js'
import type { DifficultyId } from '../src/meta.js'

export const SEED = 20261004

/** 以某个难度的初始局面为底，覆盖若干字段（只用于 reduce / view 层测试） */
export function stateWith(difficulty: DifficultyId, overrides: Partial<SnakeState>): SnakeState {
  return { ...createState(SEED, difficulty), ...overrides }
}

/**
 * size × size 棋盘上的一条哈密顿回路（首尾相邻），蛇身顺序即数组顺序。
 *
 * 走法：顶行从左到右 → 中间各行在 1..size−1 列之间来回蛇行 → 最左列从下往上回到起点。
 * 只有 size ≥ 2 且为偶数时才闭合；本测试只用 size = 12。
 */
export function hamiltonianCycle(size: number): number[] {
  const cycle: number[] = []
  const at = (x: number, y: number): number => y * size + x
  for (let x = 0; x < size; x++) cycle.push(at(x, 0))
  for (let y = 1; y < size; y++) {
    if (y % 2 === 1) {
      for (let x = size - 1; x >= 1; x--) cycle.push(at(x, y))
    } else {
      for (let x = 1; x < size; x++) cycle.push(at(x, y))
    }
  }
  for (let y = size - 1; y >= 1; y--) cycle.push(at(0, y))
  return cycle
}

/**
 * 把回路旋转成「缺一格」的合法蛇身：缺口 cell 是食物，蛇头是它在回路里的后继，
 * 因此从蛇头朝缺口走一步就是「吃掉最后一个空格 → 填满棋盘 → 胜利」。
 */
export function cycleWithGap(size: number, gap: number): { body: number[]; head: number } {
  const cycle = hamiltonianCycle(size)
  const gapIndex = cycle.indexOf(gap)
  if (gapIndex < 0) throw new Error('gap must be on the cycle')
  const body: number[] = []
  for (let step = 1; step < cycle.length; step++) {
    body.push(cycle[(gapIndex + step) % cycle.length]!)
  }
  return { body, head: body[0]! }
}
