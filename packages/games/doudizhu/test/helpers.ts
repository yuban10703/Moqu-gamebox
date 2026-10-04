/**
 * 测试辅助：用「点数 + 花色」写牌，避免在测试里手算 id。
 *   card('3', 0)：黑桃 3；card('2', 1)：红桃 2；card('SJ') / card('BJ')：小王 / 大王
 *   hand('3 3 4 4 5 5')：按出现顺序给同点数轮换花色
 */
import { BIG_JOKER, SMALL_JOKER, type CardId } from '../src/cards.js'

const RANKS: Record<string, number> = {
  '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
  J: 11, Q: 12, K: 13, A: 14, '2': 15,
}

export function card(rank: string, suit = 0): CardId {
  if (rank === 'SJ') return SMALL_JOKER
  if (rank === 'BJ') return BIG_JOKER
  const r = RANKS[rank]
  if (r === undefined) throw new Error(`bad rank ${rank}`)
  return (r - 3) * 4 + suit
}

export function hand(text: string): CardId[] {
  const used = new Map<string, number>()
  return text
    .trim()
    .split(/\s+/)
    .map((rank) => {
      const suit = used.get(rank) ?? 0
      used.set(rank, suit + 1)
      return card(rank, suit)
    })
}
