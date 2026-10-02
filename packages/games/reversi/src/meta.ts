/**
 * 游戏元信息与难度档。
 *
 * 单独成文件是为了打断依赖环：`board.ts`（纯棋盘规则）与 `ai.ts`（对手强度）
 * 都需要难度 id，而 `rules.ts`（状态机）同时依赖前两者。
 */
import { IllegalActionError } from '@eink/core'

export const REVERSI_ID = 'reversi'
/** 规则版本：规则语义变化时 +1，旧存档据此判定兼容性 */
export const REVERSI_RULES_VERSION = 1
/** 内容版本：本作没有题库/关卡包，随规则一起走 */
export const REVERSI_CONTENT_VERSION = 1

/** 三档难度只影响对手（白方）强度，不影响棋盘与规则 */
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
