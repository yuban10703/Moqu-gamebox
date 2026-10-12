/**
 * 屏幕契约：每个屏幕就是一个 `render(root, ctx) => cleanup` 的纯函数。
 *
 * 为什么不用框架：Kindle 浏览器解析与执行预算都很紧，这一层只需要
 * 「清空 → 重建 → 返回解绑函数」三件事，框架带来的抽象在这里没有收益。
 */
import type { GameLibrary, GameRegistryEntry } from '@eink/ui'
import type { KindleSettings } from './store.js'

export type ScreenName = 'library' | 'detail' | 'game' | 'settings' | 'about' | 'diagnostics'

export interface ScreenParams {
  gameId?: string
  difficulty?: string
  contentId?: string
  /** 从详情页进入对局时是否强制开新局（忽略已有存档） */
  fresh?: boolean
  /**
   * 屏幕内部的分页页号（游戏库、诊断页）。
   *
   * 为什么要放进 params：页号原先只是屏幕函数里的一个局部变量，
   * 于是"翻到第 2 页 → 进详情/对局 → 返回"总是回到第 1 页（用户报的）。
   * 放进 params 之后它随返回栈一起保存，返回时能回到原处。
   */
  page?: number
}

export interface ScreenCtx {
  /** 翻译 */
  t(key: string, params?: Record<string, string | number>): string
  /**
   * 复数翻译（`key__one` / `key__other`）。
   *
   * **凡是有「数量」的文案都必须走它**：字典里大量键只存在复数形式
   * （例如 `tictactoe.result.moves__other`、`<ns>.result.best__other`），
   * 用普通 `t()` 取会直接落到缺键分支，屏幕上出现 ⟦tictactoe.result.moves⟧。
   * 中文没有 `__one`，core 的 plural 会自动落到本语言的 `__other`。
   */
  plural(key: string, count: number, params?: Record<string, string | number>): string
  /**
   * 字典里有没有这个键。
   *
   * 用途：**玩法自定义文案不是每款都有**（例如 `<ns>.solved.best` 只有 14/20 款定义），
   * 无条件取会在另外 6 款上显示 ⟦key⟧。渲染前先问一句，缺了就退回壳层通用文案。
   */
  has(key: string): boolean
  /** 本次渲染的语言（用于诊断页展示） */
  locale: string
  library: GameLibrary
  settings: KindleSettings
  updateSettings(patch: Partial<KindleSettings>): void
  navigate(screen: ScreenName, params?: ScreenParams): void
  /** 返回上一屏（历史栈由 app 维护） */
  back(): void
  params: ScreenParams
  /**
   * 就地更新当前屏幕的 params（**不重新渲染**）。
   *
   * 用途：翻页这类"屏幕内部状态"要能被返回栈记住 —— 翻页时调用它写回页号，
   * 等玩家从这里离开时，压栈的就是最新的 params；返回时页号还在。
   * 不重新渲染是因为翻页本来就会自己重画，再来一次会闪。
   */
  setParams(patch: Partial<ScreenParams>): void
  /** 当前屏幕可用宽度（像素） */
  width: number
  /** 当前屏幕可用高度（像素） */
  height: number
  /** 顶部提示条文本；null 表示清掉 */
  setStatus(text: string | null): void
}

export type Screen = (root: HTMLElement, ctx: ScreenCtx) => () => void

/** 按 id 找登记项（找不到返回 null，不抛） */
export function findEntry(library: GameLibrary, gameId: string | undefined): GameRegistryEntry<unknown, unknown> | null {
  if (!gameId) return null
  for (let i = 0; i < library.entries.length; i++) {
    if (library.entries[i].game.id === gameId) return library.entries[i]
  }
  return null
}
