/**
 * 贪吃蛇的元信息与难度档。
 *
 * 单独成文件的原因与五子棋一致：难度 id 同时被 rules（步进语义）与 view（格子形状）使用，
 * 放在这里可以避免两者互相依赖（也避免 index 变成所有模块的枢纽）。
 */
import { IllegalActionError } from '@eink/core'

export const SNAKE_ID = 'snake'
/** 规则版本：规则语义变化时 +1，旧存档据此判定兼容性 */
export const SNAKE_RULES_VERSION = 1
/** 内容版本：本作没有题库/关卡包，随规则一起走 */
export const SNAKE_CONTENT_VERSION = 1

export const DIFFICULTY_IDS = ['starter', 'skilled', 'challenging'] as const
export type DifficultyId = (typeof DIFFICULTY_IDS)[number]

export interface SnakeDifficulty {
  readonly id: DifficultyId
  /**
   * 棋盘边长（正方形，格数 = size × size）。
   * 12×12 在 439×847 竖屏下每格仍有 ~32px：既是可读的触摸目标，也不会让一局拖太久。
   * 约定 size ≥ 3：蛇身初始长度是 3，且 rules 用「差 1 / 差 size−1」判定相邻方向。
   */
  readonly size: number
  /** 场内障碍块数量（障碍不可穿过，撞上即结束） */
  readonly obstacles: number
  /** 每吃到一个食物，蛇身要长出的节数 */
  readonly growth: number
  /** 是否穿墙：为真时从一边出去、从对边进来（该档不会撞墙） */
  readonly wrap: boolean
}

/**
 * 三档难度都**不是**靠「速度」区分 —— 本作是离散步进（一按一步），根本没有速度这个概念。
 * 差异全部落在规则上：
 * - starter：可以穿墙，最宽容，只有撞到自己才会结束；
 * - skilled：实心墙的经典规则，撞墙或撞自己都会结束；
 * - challenging：实心墙 + 8 块场内障碍，而且吃一个食物长两节（更快把场地堵死）。
 */
export const DIFFICULTIES: readonly SnakeDifficulty[] = [
  { id: 'starter', size: 12, obstacles: 0, growth: 1, wrap: true },
  { id: 'skilled', size: 12, obstacles: 0, growth: 1, wrap: false },
  { id: 'challenging', size: 12, obstacles: 8, growth: 2, wrap: false },
]

export function isDifficultyId(value: string): value is DifficultyId {
  return (DIFFICULTY_IDS as readonly string[]).includes(value)
}

/** 未知难度一律拒绝（存档损坏 / 版本不兼容都要有明确反馈） */
export function difficultyOrThrow(value: string): DifficultyId {
  if (!isDifficultyId(value)) throw new IllegalActionError(SNAKE_ID, `bad difficulty: ${value}`)
  return value
}

export function difficultySpec(id: DifficultyId): SnakeDifficulty {
  const spec = DIFFICULTIES.find((entry) => entry.id === id)
  if (!spec) throw new IllegalActionError(SNAKE_ID, `bad difficulty: ${id}`)
  return spec
}

export function difficultyLabelKey(id: DifficultyId): string {
  return `${SNAKE_ID}.difficulty.${id}`
}
