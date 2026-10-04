/**
 * 贪吃蛇的元信息与难度档。
 *
 * 单独成文件的原因与五子棋一致：难度 id 同时被 rules（步进语义）与 view（格子形状）使用，
 * 放在这里可以避免两者互相依赖（也避免 index 变成所有模块的枢纽）。
 */
import { IllegalActionError } from '@eink/core'
/**
 * 自动前进间隔（**三档统一**，用户要求"不同难度的延迟应该统一"）。
 *
 * 500ms 的依据：本项目实测 BOOX 面板整屏刷新约 2 次/秒（≈500ms），正好卡在
 * "不产生残影"的边界上；而难度差异由**规则**承担（穿墙 / 障碍 / 每食长两节），
 * 不该由"手速"承担。玩家想快就自己点方向（点一下立即走一格，见 rules.ts 的 turn）。
 * 硬下限是 core 的 MIN_TICK_MS = 400，500 在其之上 —— 壳层的钳位对本作不会生效。
 *
 * 三档难度引用的是**同一个常量**：改这里就是同时改三档。"统一"是需求而不是巧合，
 * rules.test.ts 有一条用例同时从取值与源码两个层面钉住它。
 */
const SNAKE_TICK_MS = 500

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
   * **不操作时**自动前进的间隔（毫秒/格）。**三档完全相同**（用户要求统一延迟）。
   *
   * 取值口径（理由必须写清楚）：
   *
   * - **它不是"玩家能多快"**：玩家点方向键是**立即**走一格（见 rules.ts 的 turn），
   *   想快就连点，节奏完全由玩家掌握。tickMs 只决定「手不碰屏幕时蛇自己爬多快」，
   *   也就是"你还有多少时间想下一步"。
   * - **统一 500ms**：BOOX 面板整屏刷新实测约 2 次/秒（≈500ms，
   *   docs/refresh-adaptation.md），500ms 正好是"不产生残影"的边界。
   *   难度差异一律由**规则**承担（穿墙 / 障碍 / 每食长两节），不由手速承担 ——
   *   否则"选简单档"会变成"节奏更慢"，同一套操作在三档之间要重新适应手感。
   * - **400ms 是硬下限，不是参考值**：core/types.ts 的 MIN_TICK_MS
   *   （以及 docs/eink-guidelines.md 的「慢速自动步进」规范）要求自动步进 ≥400ms，
   *   低于它的重绘在墨水屏上表现为跳变与残影而不是运动。500ms 在它之上，
   *   所以壳层的钳位永远不会生效（声明多少就走多少）。
   * - 与旧值的关系：最早的 850/680/520 把"刷新 500ms + 反应 350ms"当成必需，
   *   是"转向要等一个 tick 才生效"的年代为不吞输入而留的余量；后来压到
   *   600/480/400 的梯度；现在按用户要求**三档统一为 500ms**。
   *   转向已经立即生效、每次输入都会重置计时（壳层 session.ts），
   *   玩家永远拿得到完整的一个间隔，那段余量可以还给节奏；
   *   而档位之间的差异只保留在规则上，不再让"难度 = 手速"。
   */
  readonly tickMs: number
}

/**
 * 三档难度**只改规则**（速度三档统一，见 `SNAKE_TICK_MS` 与 SnakeDifficulty.tickMs），规则差异是：
 * - starter：可以穿墙，最宽容，只有撞到自己才会结束；
 * - skilled：实心墙的经典规则，撞墙或撞自己都会结束；
 * - challenging：实心墙 + 8 块场内障碍，而且吃一个食物长两节（更快把场地堵死）。
 */
export const DIFFICULTIES: readonly SnakeDifficulty[] = [
  { id: 'starter', size: 12, obstacles: 0, growth: 1, wrap: true, tickMs: SNAKE_TICK_MS },
  { id: 'skilled', size: 12, obstacles: 0, growth: 1, wrap: false, tickMs: SNAKE_TICK_MS },
  { id: 'challenging', size: 12, obstacles: 8, growth: 2, wrap: false, tickMs: SNAKE_TICK_MS },
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
