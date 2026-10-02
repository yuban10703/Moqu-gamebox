/**
 * 游戏注册表：游戏盒子只需要认识这一个结构。
 * 新增一款游戏 = 补规则/内容/呈现 + 在这里登记一条，壳层代码不用改（对应 C 阶段完成条件）。
 */
import type { CellKind, DictSet, GameDef } from '@eink/core'

export interface GameRegistryEntry<S = unknown, A = unknown> {
  game: GameDef<S, A>
  /** 详情页「玩法说明」的文案 key 列表（按顺序展示） */
  rulesKeys: string[]
  defaultDifficulty: string
  /** 详情页展示的内容列表（关卡等） */
  levels?: readonly { id: string }[]
  /** 用已完成内容 id 计算进度 */
  progressFor(completed: readonly string[]): { done: number; total: number }
  /** 该存档处于内容的第几项（用于「继续」定位） */
  indexOfLevel?(levelId: string, state: unknown): number
  /**
   * 格子无障碍标签的 i18n key。由**游戏包提供** ——
   * 壳层不应硬编码任何具体玩法的文案 key（原先写死了 sokoban.cell.*）。
   */
  cellLabelKey?(kind: CellKind): string | undefined
  /**
   * 从存档状态里取出「内容 id」，用于「继续」定位与通关进度。
   * 关卡制游戏（推箱子）就是关卡 id；无关卡制的游戏（2048）可用难度 id 等。
   * 缺省时壳层回退到读取 state.levelId。
   */
  contentIdOf?(state: unknown): string
}

export type AnyRegistryEntry = GameRegistryEntry<never, never> | GameRegistryEntry<unknown, unknown>

export interface GameLibrary {
  entries: ReadonlyArray<GameRegistryEntry<unknown, unknown>>
  dicts: DictSet
}

export function defineGame<S, A>(entry: GameRegistryEntry<S, A>): GameRegistryEntry<unknown, unknown> {
  return entry as unknown as GameRegistryEntry<unknown, unknown>
}
