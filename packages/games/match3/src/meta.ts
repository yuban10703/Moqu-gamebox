/**
 * 消消乐的元信息与难度档：身份、版本号、难度 id 与难度文案 key。
 *
 * 单独成文件（与 gomoku / snake 等一致）：这些常量同时被 board.ts（棋盘与难度配置）、
 * rules.ts（状态机）、view.ts（展示）与壳层注册使用，放在最底层就不会出现依赖环。
 */
import { IllegalActionError } from '@eink/core'

export const MATCH3_ID = 'match3'
/** 规则版本：规则语义变化时 +1，旧存档据此判定兼容性 */
export const MATCH3_RULES_VERSION = 1
/** 内容版本：本作没有题库/关卡包，随规则一起走 */
export const MATCH3_CONTENT_VERSION = 1

/** 三档难度：棋盘尺寸 / 棋子种类 / 目标分 / 步数上限各不相同（数值见 board.ts 的 DIFFICULTIES） */
export const DIFFICULTY_IDS = ['starter', 'skilled', 'challenging'] as const
export type DifficultyId = (typeof DIFFICULTY_IDS)[number]

export function isDifficultyId(value: string): value is DifficultyId {
  return (DIFFICULTY_IDS as readonly string[]).includes(value)
}

export function difficultyOrThrow(value: string): DifficultyId {
  if (!isDifficultyId(value)) {
    throw new IllegalActionError(MATCH3_ID, `unknown difficulty ${value}`)
  }
  return value
}

export function difficultyLabelKey(id: DifficultyId): string {
  return `${MATCH3_ID}.difficulty.${id}`
}
