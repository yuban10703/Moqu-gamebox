/**
 * 牌：54 张，用 0..53 的整数 id 表示（存档与联机消息里都只传 id）。
 *
 *   id 0..51：普通牌，rank = 3 + floor(id / 4)（3..15，其中 14 = A、15 = 2），suit = id % 4
 *   id 52：小王（rank 16）；id 53：大王（rank 17）
 *
 * 点数（rank）就是比较大小用的数值：3 < 4 < … < K(13) < A(14) < 2(15) < 小王(16) < 大王(17)。
 * 顺子 / 连对 / 飞机只能用到 A（不含 2 与王）。
 */
import { createRng } from '@eink/core'

export type CardId = number
export type Suit = 'spade' | 'heart' | 'club' | 'diamond'

export const CARD_COUNT = 54
export const SMALL_JOKER: CardId = 52
export const BIG_JOKER: CardId = 53

export const RANK_A = 14
export const RANK_2 = 15
export const RANK_SMALL_JOKER = 16
export const RANK_BIG_JOKER = 17
/** 顺子 / 连对 / 飞机能用到的最大点数（A） */
export const MAX_CHAIN_RANK = RANK_A

const SUITS: readonly Suit[] = ['spade', 'heart', 'club', 'diamond']

export function isCardId(value: unknown): value is CardId {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < CARD_COUNT
}

export function rankOf(card: CardId): number {
  if (card === SMALL_JOKER) return RANK_SMALL_JOKER
  if (card === BIG_JOKER) return RANK_BIG_JOKER
  return 3 + Math.floor(card / 4)
}

export function suitOf(card: CardId): Suit | null {
  return card >= 52 ? null : SUITS[card % 4]!
}

/** 点数的显示文字（不走 i18n：牌面字符在各语言里都一样） */
export function rankLabel(rank: number): string {
  switch (rank) {
    case 11:
      return 'J'
    case 12:
      return 'Q'
    case 13:
      return 'K'
    case RANK_A:
      return 'A'
    case RANK_2:
      return '2'
    default:
      return String(rank)
  }
}

/**
 * 理牌顺序：点数大的在前，同点数按花色固定排（黑桃 → 红桃 → 梅花 → 方块）。
 * 手牌、出过的牌都按这个顺序展示，与截图里「王 2 2 2 2 K J J …」一致。
 */
export function compareForDisplay(a: CardId, b: CardId): number {
  const diff = rankOf(b) - rankOf(a)
  return diff !== 0 ? diff : a - b
}

export function sortForDisplay(cards: readonly CardId[]): CardId[] {
  return [...cards].sort(compareForDisplay)
}

/** 按点数计数：counts[rank] = 张数 */
export function rankCounts(cards: readonly CardId[]): number[] {
  const counts = new Array<number>(RANK_BIG_JOKER + 1).fill(0)
  for (const card of cards) counts[rankOf(card)]!++
  return counts
}

/** 发牌结果：三家各 17 张 + 3 张底牌，以及先叫分的座位 */
export interface Deal {
  hands: [CardId[], CardId[], CardId[]]
  bottom: CardId[]
  firstBidder: number
}

/**
 * 确定性发牌：同一个 (seed, dealNo) 必然发出同一副牌。
 * dealNo 是「这副存档里第几次发牌」（重新发牌、下一局都会 +1），因此不必存牌面，只存计数即可复算。
 */
export function dealCards(seed: number, dealNo: number): Deal {
  const rng = createRng((seed + Math.imul(dealNo + 1, 0x9e3779b1)) >>> 0)
  const deck = rng.shuffle(Array.from({ length: CARD_COUNT }, (_, id) => id))
  const hands: [CardId[], CardId[], CardId[]] = [
    sortForDisplay(deck.slice(0, 17)),
    sortForDisplay(deck.slice(17, 34)),
    sortForDisplay(deck.slice(34, 51)),
  ]
  return { hands, bottom: sortForDisplay(deck.slice(51)), firstBidder: rng.int(3) }
}
