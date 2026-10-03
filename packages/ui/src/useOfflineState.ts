/**
 * 订阅离线状态（现代写法：`useSyncExternalStore`）。
 *
 * 修的是一个**真 bug**，不是风格问题：原先首页与帮助页是在渲染时直接调用
 * `platform.offline.state()` —— 那只是"读一次快照"，**没有订阅**。
 * 于是 Service Worker 从「准备中」变成「就绪」时界面不会重渲染，
 * 首页那个「离线准备中」徽标会一直卡在旧状态，直到别的原因触发一次重渲染。
 *
 * store 本来就有 `subscribe`（见 `packages/platform/src/offline.ts`），
 * 用 `useSyncExternalStore` 接上即可。这里能安全使用它有一个前提：
 * `state()` 返回的是**字符串字面量**（'unavailable' | 'preparing' | 'ready'），
 * 引用天然稳定 —— 如果它每次返回新对象，`useSyncExternalStore` 会因 Object.is 不等而无限重渲染。
 */
import { useSyncExternalStore } from 'react'
import type { OfflineController, OfflineState } from '@eink/platform'

export function useOfflineState(offline: OfflineController): OfflineState {
  return useSyncExternalStore(offline.subscribe, offline.state)
}
