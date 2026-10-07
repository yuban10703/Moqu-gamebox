/**
 * 游戏元信息与难度档。
 */
import { IllegalActionError } from '@eink/core'

export const REVERSI_ID = 'reversi'
/** 规则版本：两拍式应手（先亮目标格、再落子）使规则语义变化 → +1 */
export const REVERSI_RULES_VERSION = 2
/** 内容版本：本作没有题库/关卡包，随规则一起走 */
export const REVERSI_CONTENT_VERSION = 1

/** 三档难度只影响白方（对手）强度，棋盘尺寸与规则完全相同 */
export const DIFFICULTY_IDS = ['starter', 'skilled', 'challenging'] as const
export type DifficultyId = (typeof DIFFICULTY_IDS)[number]

export function isDifficultyId(value: string): value is DifficultyId {
  return (DIFFICULTY_IDS as readonly string[]).includes(value)
}

export function difficultyOrThrow(value: string): DifficultyId {
  if (!isDifficultyId(value)) throw new IllegalActionError(REVERSI_ID, `bad difficulty: ${value}`)
  return value
}

export function difficultyLabelKey(id: DifficultyId): string {
  return `${REVERSI_ID}.difficulty.${id}`
}
