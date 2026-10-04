/**
 * 游戏注册表：游戏盒子只需要认识这一个结构。
 * 新增一款游戏 = 补规则/内容/呈现 + 在这里登记一条，壳层代码不用改（对应 C 阶段完成条件）。
 */
import type { CellKind, DictSet, DpadLayout, GameDef } from '@eink/core'

export interface GameRegistryEntry<S = unknown, A = unknown> {
  game: GameDef<S, A>
  /** 详情页「玩法说明」的文案 key 列表（按顺序展示） */
  rulesKeys: string[]
  /**
   * 隐藏详情页的「难度」区。
   * 用于**同时有难度和关卡**的玩法（推箱子 / 华容道）—— 那里的"难度"其实只是
   * "从第几关开始"的快捷方式，有关卡列表就够了（用户要求："把难度选项删了，只保留关卡"）。
   * 只有难度、没有关卡的玩法**不要**设它，那七款的难度是真难度。
   */
  hideDifficulty?: boolean
  /**
   * 不渲染这些**壳层按钮**（id 与壳层保持一致，例如 'undo'）。
   * 用于"这个玩法没有这个能力、按钮永远点不动"的情况 —— 与其显示一个假按钮，不如不显示。
   * 目前：数独不提供撤销，因此隐藏 'undo'（用户要求"数独的撤销直接隐藏"）。
   */
  hideShellControls?: readonly string[]
  /**
   * 方向键的摆法（见 core 的 DpadLayout）：缺省 `tee` = 倒 T，撤销 / 重开收在上排两侧，共两行；
   * `row` = 四键平铺一行，用于「上/下」不是空间方向的玩法 ——
   * 俄罗斯方块的上是旋转、下是下落一格（用户要求：方向键平铺、画面最大化）。
   */
  dpadLayout?: DpadLayout
  /**
   * 方向键**默认**是否显示（玩家在暂停菜单里按游戏改过之后以玩家的为准）。缺省跟随全局设置。
   * 设成 false 的场景：方向键只是重复入口、点格子本来就能玩 —— 数字华容道点方块即可滑动，
   * 默认收起方向键让棋盘直接长到宽度上限。
   */
  dpadDefault?: boolean
  defaultDifficulty: string
  /** 详情页展示的内容列表（关卡等） */
  levels?: readonly { id: string }[]
  /**
   * 用已完成内容 id 计算进度。关卡制游戏给出「已过关/总数」；
   * 不提供时界面不显示进度行（例如 2048 这类没有关卡进度的玩法）。
   */
  progressFor?(completed: readonly string[]): { done: number; total: number }
  /** 该存档处于内容的第几项（用于「继续」定位） */
  indexOfLevel?(levelId: string, state: unknown): number
  /**
   * 格子无障碍标签的 i18n key。由**游戏包提供** ——
   * 壳层不应硬编码任何具体玩法的文案 key（原先写死了 sokoban.cell.*）。
   */
  cellLabelKey?(kind: CellKind): string | undefined

}

/**
 * 这个玩法是否支持「在棋盘上滑动 = 按方向」：有方向键、且不靠点格子操作。
 *
 * 点格子的玩法（数字华容道、华容道、数独…）必须禁用滑动：墨水屏触摸有抖动，
 * 轻点很容易被判成滑动（真机反馈过"点到的不是我想点的那块"）。
 * 对局页（是否接管滑动）与详情页（是否提示可以滑动）共用这一个判定。
 */
export function supportsSwipe(entry: GameRegistryEntry<unknown, unknown>): boolean {
  if (entry.game.selectAction !== undefined) return false
  const first = entry.game.difficulties[0]?.id ?? entry.defaultDifficulty
  return entry.game.controls(entry.game.create(0, first)).some((control) => control.role === 'dpad')
}

export type AnyRegistryEntry = GameRegistryEntry<never, never> | GameRegistryEntry<unknown, unknown>

export interface GameLibrary {
  entries: ReadonlyArray<GameRegistryEntry<unknown, unknown>>
  dicts: DictSet
}

/**
 * 把某个具体玩法登记进库。
 *
 * 这里的类型断言**删不掉**，原因在类型系统本身：`GameDef<S, A>` 对 `S`/`A` 是**不变**的
 * （类型参数既出现在入参也出现在返回值），所以 `GameDef<具体状态, 具体动作>` 无法赋给
 * `GameDef<unknown, unknown>` —— 这不是写法问题，TS 也没有存在类型（existential types）可用。
 *
 * 因此做法是：把抹除集中在这**唯一的登记入口**，并保证抹除之后库只按 `unknown` 使用
 * （见 `GameLibrary.entries`），需要具体类型时由各玩法的测试直接对着 `GameDef` 断言。
 */
export function defineGame<S, A>(entry: GameRegistryEntry<S, A>): GameRegistryEntry<unknown, unknown> {
  return entry as unknown as GameRegistryEntry<unknown, unknown>
}
