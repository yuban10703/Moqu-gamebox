/**
 * 牌与牌堆：52 张牌用 0..51 的整数 id 表示（存档、日志、点击编号里都只传 id）。
 *
 *   id 0..51：普通牌，suit = id % 4（黑桃 / 红桃 / 梅花 / 方块），rank = 1 + floor(id / 4)（1 = A … 13 = K）
 *
 * 这套编号与斗地主的 0..51 完全一致（那里也是花色取模、点数取商），换包时不必重新理解
 * 「花色点数怎么从 id 推出来」；空当接龙只用 52 张、没有王，于是 A 就是 1、K 就是 13。
 *
 * 红黑不另存字段，由花色推得（红桃 / 方块红，黑桃 / 梅花黑）—— 墨水屏上没有颜色，
 * 壳层画的是实心（♠♣）与空心（♡♢）两套字形，红黑在**形状**上就能分辨，
 * 规则层因此只需要「同色 / 异色」这一个判断，不必关心壳层怎么画。
 *
 * 每个牌堆用数组表示，**数组末尾 = 堆顶**（摸牌从末尾取、叠放往末尾推）。
 * 这样「取顶部 count 张」就是 slice(-count)，「整段序列」天然就是一段连续切片，
 * 序列移动不必做任何索引换算。
 */
import { createRng } from '@eink/core'

export type CardId = number
export type Suit = 'spade' | 'heart' | 'club' | 'diamond'
/** 红黑（花色推断，不落字段） */
export type CardColor = 'black' | 'red'

export const CARD_COUNT = 52
/** 一副牌里每个花色的张数（收满 13 张 = 这个花色收完） */
export const RANKS_PER_SUIT = 13
export const RANK_A = 1
export const RANK_K = 13

export const SUITS: readonly Suit[] = ['spade', 'heart', 'club', 'diamond']

export function isCardId(value: unknown): value is CardId {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < CARD_COUNT
}

export function suitOf(card: CardId): Suit {
  return SUITS[card % 4]!
}

/** 点数：1 = A … 11 = J、12 = Q、13 = K */
export function rankOf(card: CardId): number {
  return 1 + Math.floor(card / 4)
}

export function colorOf(card: CardId): CardColor {
  const suit = suitOf(card)
  return suit === 'heart' || suit === 'diamond' ? 'red' : 'black'
}

/** 两张牌颜色相反（牌列降序叠放要求红黑交替） */
export function isOppositeColor(a: CardId, b: CardId): boolean {
  return colorOf(a) !== colorOf(b)
}

/** 牌面文字（不走 i18n：A / J / Q / K 与数字在各语言里都一样） */
export function rankLabel(rank: number): string {
  switch (rank) {
    case RANK_A:
      return 'A'
    case 11:
      return 'J'
    case 12:
      return 'Q'
    case RANK_K:
      return 'K'
    default:
      return String(rank)
  }
}

/* ------------------------------------------------------------------ 牌堆 */

export type Zone = 'stock' | 'waste' | 'foundation' | 'tableau'

export const FOUNDATION_COUNT = 4
export const TABLEAU_COUNT = 7

/**
 * 一个牌堆的编号。四种区各有一套语义：
 *   stock 抽牌堆、waste 弃牌堆（各只有一个，index 恒为 0）；
 *   foundation 基础堆 0..3；tableau 牌列 0..6（0 是最左一列）。
 */
export interface PileRef {
  readonly zone: Zone
  readonly index: number
}

export const STOCK: PileRef = { zone: 'stock', index: 0 }
export const WASTE: PileRef = { zone: 'waste', index: 0 }

export function foundation(index: number): PileRef {
  return { zone: 'foundation', index }
}

export function tableau(index: number): PileRef {
  return { zone: 'tableau', index }
}

export function samePile(a: PileRef, b: PileRef): boolean {
  return a.zone === b.zone && a.index === b.index
}

export function isPileRef(value: unknown): value is PileRef {
  if (!value || typeof value !== 'object') return false
  const pile = value as { zone?: unknown; index?: unknown }
  if (typeof pile.index !== 'number' || !Number.isInteger(pile.index)) return false
  if (pile.zone === 'stock' || pile.zone === 'waste') return pile.index === 0
  if (pile.zone === 'foundation') return pile.index >= 0 && pile.index < FOUNDATION_COUNT
  if (pile.zone === 'tableau') return pile.index >= 0 && pile.index < TABLEAU_COUNT
  return false
}

/* ------------------------------------------------------------------ 点击编号 */

/**
 * 可点牌的编号。壳层点一下会把 `CardFace.id` 原样交回 `selectAction`，
 * 点击编号因此必须**只由「哪个牌堆的第几张」决定**，与局面无关 ——
 * 同一张牌在各状态之间编号稳定，壳层重绘时按钮不会换身份，日志里也能直接读懂。
 *
 *   0                     抽牌堆（点它 = 翻牌 / 回收）
 *   1                     弃牌堆（只有堆顶那一张可点）
 *   2 .. 5                基础堆 0..3（只有堆顶可点）
 *   6 + 列号 * 32 + 序号   牌列（序号 0 = 该列最底下那张，最后一张 = 列顶）
 *
 * 牌列每列预留 32 个编号：一列最多 6 张牌背 + 13 张明牌 = 19 张，32 足够，
 * 而且解码只用除法取模、不必查表（编号越界即视为不可点）。
 */
export const STOCK_CLICK_ID = 0
export const WASTE_CLICK_ID = 1
const FOUNDATION_CLICK_BASE = 2
const TABLEAU_CLICK_BASE = 6
/** 牌列每列预留的编号数（一列最多 19 张，留 32 是取整后的余量） */
export const TABLEAU_CLICK_STRIDE = 32

export function clickIdOf(pile: PileRef, cardIndex = 0): number {
  switch (pile.zone) {
    case 'stock':
      return STOCK_CLICK_ID
    case 'waste':
      return WASTE_CLICK_ID
    case 'foundation':
      return FOUNDATION_CLICK_BASE + pile.index
    case 'tableau':
      if (cardIndex < 0 || cardIndex >= TABLEAU_CLICK_STRIDE) {
        throw new Error(`klondike: tableau card index out of range: ${cardIndex}`)
      }
      return TABLEAU_CLICK_BASE + pile.index * TABLEAU_CLICK_STRIDE + cardIndex
  }
}

export function decodeClickId(id: number): { pile: PileRef; cardIndex: number } | null {
  if (!Number.isInteger(id) || id < 0) return null
  if (id === STOCK_CLICK_ID) return { pile: STOCK, cardIndex: 0 }
  if (id === WASTE_CLICK_ID) return { pile: WASTE, cardIndex: 0 }
  if (id >= FOUNDATION_CLICK_BASE && id < FOUNDATION_CLICK_BASE + FOUNDATION_COUNT) {
    return { pile: foundation(id - FOUNDATION_CLICK_BASE), cardIndex: 0 }
  }
  const offset = id - TABLEAU_CLICK_BASE
  if (offset < 0) return null
  const column = Math.floor(offset / TABLEAU_CLICK_STRIDE)
  if (column >= TABLEAU_COUNT) return null
  return { pile: tableau(column), cardIndex: offset % TABLEAU_CLICK_STRIDE }
}

/* ------------------------------------------------------------------ 发牌 */

export interface Deal {
  /** 7 列，第 i 列 i+1 张（只有最后一张是明牌） */
  tableau: CardId[][]
  /** 剩下的 24 张，末尾 = 堆顶（下一张就抽它） */
  stock: CardId[]
}

/**
 * 确定性发牌：同一个 (seed, dealNo) 必然发出同一副牌，因此存档里只存计数、不存牌面。
 *
 * 发牌顺序照着实体牌桌来：第 1 轮给第 1 列 1 张，第 2 轮给第 2、3 列各 1 张 ……
 * 第 7 轮给第 7 列 1 张，余下 24 张整叠进抽牌堆。行式与逐列式在规则上等价
 * （都是「洗好的牌切成 7 段」），但行式是玩家看得懂的「一次发一圈」，复盘时能对上。
 */
export function dealCards(seed: number, dealNo: number): Deal {
  // 局号参与混合：换一局只改计数，不必改种子，同一份存档因此仍然只由 (seed, dealNo) 决定
  const rng = createRng((seed + Math.imul(dealNo + 1, 0x9e3779b1)) >>> 0)
  const deck = rng.shuffle(Array.from({ length: CARD_COUNT }, (_, id) => id))
  const columns: CardId[][] = Array.from({ length: TABLEAU_COUNT }, () => [])
  let index = 0
  for (let row = 0; row < TABLEAU_COUNT; row++) {
    for (let column = row; column < TABLEAU_COUNT; column++) {
      columns[column]!.push(deck[index]!)
      index++
    }
  }
  return { tableau: columns, stock: deck.slice(index) }
}
