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
}

export interface ScreenCtx {
  /** 翻译 */
  t(key: string, params?: Record<string, string | number>): string
  /** 本次渲染的语言（用于诊断页展示） */
  locale: string
  library: GameLibrary
  settings: KindleSettings
  updateSettings(patch: Partial<KindleSettings>): void
  navigate(screen: ScreenName, params?: ScreenParams): void
  /** 返回上一屏（历史栈由 app 维护） */
  back(): void
  params: ScreenParams
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
