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
  /**
   * 自动前进的间隔（毫秒/格）。**速度也参与难度**，但取值有硬下限（见下）。
   *
   * 依据（真机实测数据，不是拍的）：
   * - BOOX 面板能完成的整屏刷新约 **2 次/秒**（≈500ms/次，docs/refresh-adaptation.md）；
   * - 本项目的刷新实测同样表明：低于 ~400ms 的重绘在墨水屏上表现为跳变与残影，
   *   而不是运动（docs/eink-guidelines.md 的「慢速自动步进」规范把 400ms 定为硬下限）；
   * - 人眼在墨水屏上要「看清一步 → 决定下一步」，还需要在刷新时间之外留出反应时间。
   *   因此入门档取 850ms（≈500ms 刷新 + 350ms 决策），熟练 680ms，挑战 520ms
   *   —— 最快一档仍高于 500ms 的整屏刷新耗时，玩家每次操作后都能拿到完整的一格间隔。
   */
  readonly tickMs: number
}

/**
 * 三档难度**同时**改规则与速度：速度只落在 ≥500ms/格这一段（见 SnakeDifficulty.tickMs 的依据），
 * 规则差异是：
 * - starter：可以穿墙，最宽容，只有撞到自己才会结束；
 * - skilled：实心墙的经典规则，撞墙或撞自己都会结束；
 * - challenging：实心墙 + 8 块场内障碍，而且吃一个食物长两节（更快把场地堵死）。
 */
export const DIFFICULTIES: readonly SnakeDifficulty[] = [
  { id: 'starter', size: 12, obstacles: 0, growth: 1, wrap: true, tickMs: 850 },
  { id: 'skilled', size: 12, obstacles: 0, growth: 1, wrap: false, tickMs: 680 },
  { id: 'challenging', size: 12, obstacles: 8, growth: 2, wrap: false, tickMs: 520 },
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
