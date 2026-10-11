/**
 * 渲染层契约：三个渲染器（棋盘 / 牌桌 / 对决面板）共用。
 *
 * 设计：渲染器**只画**，不判断规则、不认识具体玩法 —— 点击一律回调给壳层，
 * 由壳层转成动作交给游戏（与 packages/core 的 GameDef 契约同一条分工）。
 */
export interface RenderCtx {
  /** 翻译（缺 key 时返回 ⟦key⟧，便于在设备上直接看出漏词） */
  t(key: string, params?: Record<string, string | number>): string
  /** 点了棋盘第 index 格 */
  onCell(index: number): void
  /** 点了某张牌 / 某个牌堆入口（编号就是 CardFace.id / CardPileView.id） */
  onCard(id: number): void
  /** 点了对决面板里自己的某件道具（编号是 DuelItem.id） */
  onItem(id: number): void
  /** 点了对决面板里「抢对手道具」的槽位（编号是槽位下标） */
  onSteal(slot: number): void
  /** 棋盘可用宽度（像素）；渲染器据此算格子边长 */
  width: number
  /** 棋盘可用高度（像素）；与 width 一起决定格子边长，缺省按 0 = 只看宽度 */
  height: number
  /** 方向键是否可用（决定是否给棋盘加滑动提示） */
  dpad: boolean
}
