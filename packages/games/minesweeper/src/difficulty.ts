/**
 * 扫雷的难度与棋盘尺寸。
 *
 * 尺寸/雷数只在这里定义一处：规则层、视图层、测试都从这里取，
 * 避免出现「视图按 9×9 画、规则按 16×16 算」这类分叉。
 */
import { IllegalActionError } from '@eink/core'

export const GAME_ID = 'minesweeper'

export const DIFFICULTY_IDS = ['starter', 'skilled', 'challenging'] as const

export type DifficultyId = (typeof DIFFICULTY_IDS)[number]

export interface BoardConfig {
  readonly cols: number
  readonly rows: number
  readonly mineCount: number
}

export const DIFFICULTIES: Record<DifficultyId, BoardConfig> = {
  starter: { cols: 9, rows: 9, mineCount: 10 },
  skilled: { cols: 12, rows: 12, mineCount: 25 },
  challenging: { cols: 16, rows: 16, mineCount: 50 },
}

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

export function cellCount(config: BoardConfig): number {
  return config.cols * config.rows
}
