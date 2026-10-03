/**
 * 游戏注册表：游戏盒子只需要认识这一个结构。
 * 新增一款游戏 = 补规则/内容/呈现 + 在这里登记一条，壳层代码不用改（对应 C 阶段完成条件）。
 */
import type { CellKind, DictSet, GameDef } from '@eink/core'

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
