/**
 * 电脑对手：只看自己的座位视角（SeatView），按难度决定叫分与出牌。
 *
 * 纯函数 + 确定性：随机性只来自调用方传入的 Rng（由 seed + 发牌序号 + 动作数算出），
 * 同一局面永远做出同一个决定 —— 存档重放、联机主机复算都能得到一致结果。
 *
 * 三档：
 *   入门 starter      ：叫分随缘；能压就压的概率 3/4，偶尔放过；几乎不用炸弹；领出总是从最小的单张 / 组出。
 *   熟练 skilled      ：按拆牌结果出牌（先出小组合、不拆顺子三张）；队友领先不压；对手快出完时盯人、用炸弹。
 *                      对手剩 1 张时不领单张。
 *   挑战 challenging  ：在熟练基础上：记牌（剩下的组里至多一组能被压时，先出压不住的保住出牌权）；
 *                      对手剩 2 张不领对子；坐在地主上家的农民在队友出小牌时顶大牌；
 *                      队友剩 1 张时送小单张；炸弹留到能决定胜负时再用。
 */
import type { Rng } from '@eink/core'
import { RANK_2, RANK_A, RANK_BIG_JOKER, RANK_SMALL_JOKER, rankCounts, type CardId } from './cards.js'
import { beatingPlays, classify, decompose, type Pattern } from './patterns.js'
import type { SeatView } from './observe.js'
import type { Move, Seat } from './table.js'

export type DifficultyId = 'starter' | 'skilled' | 'challenging'

/** 手牌强度（叫分用）：大小王、2、A、炸弹各记分 */
export function handStrength(hand: readonly CardId[]): number {
  const counts = rankCounts(hand)
  let score = 0
  score += counts[RANK_BIG_JOKER]! * 4 + counts[RANK_SMALL_JOKER]! * 3
  score += counts[RANK_2]! * 2 + counts[RANK_A]! * 1
  for (let r = 3; r <= RANK_A; r++) if (counts[r] === 4) score += 4
  if (counts[RANK_SMALL_JOKER] === 1 && counts[RANK_BIG_JOKER] === 1) score += 2
  return score
}

export function decideBid(view: SeatView, difficulty: DifficultyId, rng: Rng): Move {
  const noise = difficulty === 'starter' ? rng.int(5) - 2 : difficulty === 'skilled' ? rng.int(3) - 1 : 0
  const strength = handStrength(view.hand) + noise
  // 门槛偏高：地主多拿 3 张还先出，弱牌当地主反而送分（实测门槛 6/8/10 时地主胜率高达 65%）
  const want = strength >= 11 ? 3 : strength >= 9 ? 2 : strength >= 7 ? 1 : 0
  return { kind: 'bid', value: (want > view.highestBid ? want : 0) as 0 | 1 | 2 | 3 }
}

function topPattern(view: SeatView): Pattern | null {
  if (!view.top) return null
  return { type: view.top.type, main: view.top.main, chain: view.top.chain, cards: view.top.cards }
}

function isBombLike(pattern: Pattern): boolean {
  return pattern.type === 'bomb' || pattern.type === 'rocket'
}

function sameSide(view: SeatView, a: Seat, b: Seat): boolean {
  if (a === b) return true
  return view.landlord !== null && a !== view.landlord && b !== view.landlord
}

/** 对手里剩牌最少的那家的张数 */
function enemyMin(view: SeatView): number {
  let min = Infinity
  for (const seat of [0, 1, 2] as Seat[]) {
    if (!sameSide(view, view.seat, seat)) min = Math.min(min, view.counts[seat])
  }
  return min
}

function partnerOf(view: SeatView): Seat | null {
  if (view.landlord === null || view.landlord === view.seat) return null
  return ([0, 1, 2] as Seat[]).find((seat) => seat !== view.seat && seat !== view.landlord) ?? null
}

const play = (pattern: Pattern): Move => ({ kind: 'play', cards: [...pattern.cards] })

/** 还没出现过的牌（不在自己手里、也没被出过）：两家对手的手牌都在里面（底牌若已公开也算可见） */
function unseenCards(view: SeatView): CardId[] {
  const seen = new Set<CardId>([...view.hand, ...view.played])
  const out: CardId[] = []
  for (let card = 0; card < 54; card++) if (!seen.has(card)) out.push(card)
  return out
}

/** 领出：拆牌后挑一组出 */
function decideLead(view: SeatView, difficulty: DifficultyId): Move {
  const hand = view.hand
  const whole = classify(hand)
  if (whole) return { kind: 'play', cards: [...hand] }

  const groups = decompose(hand)
  const plain = groups.filter((g) => !isBombLike(g))
  if (plain.length === 0) {
    // 只剩炸弹：先出小的
    const bombs = [...groups].sort((a, b) => a.main - b.main)
    return play(bombs[0]!)
  }
  const byLow = [...plain].sort((a, b) => a.main - b.main || b.cards.length - a.cards.length)
  if (difficulty === 'starter') return play(byLow[0]!)

  // 熟练 / 挑战：同样小的情况下优先出能一次走掉多张的组合
  const score = (g: Pattern): number => g.main - (g.cards.length >= 5 ? 2.5 : g.cards.length >= 3 ? 1 : 0)
  let ordered = [...plain].sort((a, b) => score(a) - score(b) || a.main - b.main)

  const partner = partnerOf(view)
  if (difficulty === 'challenging' && partner !== null && view.counts[partner] === 1) {
    // 队友只剩一张：送最小的单张让他走
    const singles = plain.filter((g) => g.type === 'single').sort((a, b) => a.main - b.main)
    if (singles.length > 0) return play(singles[0]!)
  }

  if (difficulty === 'challenging') {
    // 记牌：剩下的组里至多一组可能被压 → 先出压不住的保住出牌权，最后再出那一组
    const unseen = unseenCards(view)
    const safe = groups.filter((g) => beatingPlays(unseen, g).length === 0)
    if (groups.length - safe.length <= 1 && safe.length > 0 && safe.length < groups.length) {
      return play([...safe].sort((a, b) => a.main - b.main)[0]!)
    }
  }

  // 盯人：对手剩 1 张不领单张（挑战档还会在剩 2 张时不领对子）；只剩这种牌就从大的出
  const min = enemyMin(view)
  const avoid = min === 1 ? 'single' : min === 2 && difficulty === 'challenging' ? 'pair' : null
  if (avoid) {
    const others = ordered.filter((g) => g.type !== avoid)
    ordered = others.length > 0 ? others : [...ordered].sort((a, b) => b.main - a.main)
  }
  return play(ordered[0]!)
}

/** 跟牌：能压就挑最省的压，队友领先就让，对手快出完就盯死 */
function decideFollow(view: SeatView, difficulty: DifficultyId, rng: Rng): Move {
  const top = topPattern(view)!
  const hand = view.hand
  const candidates = beatingPlays(hand, top)
  if (candidates.length === 0) return { kind: 'pass' }

  // 能一手出完就出完
  const finishing = candidates.find((c) => c.cards.length === hand.length)
  if (finishing) return play(finishing)

  const topIsFriend = sameSide(view, view.seat, view.top!.seat)
  const plain = candidates.filter((c) => !isBombLike(c))
  const bombs = candidates.filter(isBombLike)
  const min = enemyMin(view)

  if (difficulty === 'starter') {
    if (topIsFriend) return { kind: 'pass' }
    if (plain.length > 0 && rng.next() < 0.75) return play(plain[0]!)
    if (bombs.length > 0 && min <= 1) return play(bombs[0]!)
    return { kind: 'pass' }
  }

  if (topIsFriend) {
    // 队友领先：一般让。但如果下一个出牌的就是地主、队友出的又是小单张 / 小对子，
    // 坐在地主上家的农民要「顶」一张大的，逼地主拿大牌来压（不顶的话地主用小牌就过了）
    const landlordNext =
      difficulty === 'challenging' && view.landlord !== null && (view.seat + 1) % 3 === view.landlord
    const small = (top.type === 'single' || top.type === 'pair') && top.main < 12
    if (landlordNext && (small || min <= 2)) {
      const groups = decompose(hand)
      const blocker = plain.find(
        (c) =>
          c.main >= 12 &&
          c.main <= RANK_A &&
          groups.some((g) => g.type === c.type && g.main === c.main),
      )
      if (blocker) return play(blocker)
    }
    return { kind: 'pass' }
  }

  // 「干净」的压法：正好是拆牌里现成的一组（不拆顺子、三张、炸弹）
  const groups = decompose(hand)
  const baseType = (t: Pattern['type']): string => (t === 'triple1' || t === 'triple2' ? 'triple' : t)
  const clean = plain.filter((c) =>
    groups.some((g) => !isBombLike(g) && baseType(g.type) === baseType(c.type) && g.main === c.main),
  )
  const urgent = min <= 2 || view.counts[view.top!.seat] <= 3

  // 「留大牌」（不拿 2 / 王压小牌）实测会让挑战档当地主时太被动（农民对它的胜率反而更高），已去掉
  if (clean.length > 0) return play(clean[0]!)
  if (plain.length > 0 && (urgent || view.landlord === view.seat || view.top!.seat === view.landlord)) {
    // 必须压：拆也要压（地主压农民 / 农民压地主）
    return play(plain[0]!)
  }
  if (bombs.length > 0) {
    const bomb = bombs[0]!
    const leftAfter = hand.length - bomb.cards.length
    const worth = difficulty === 'challenging' ? min <= 2 || leftAfter <= 2 : min <= 3 || leftAfter <= 3
    if (worth) return play(bomb)
  }
  return { kind: 'pass' }
}

export function decideMove(view: SeatView, difficulty: DifficultyId, rng: Rng): Move {
  if (view.phase === 'bidding') return decideBid(view, difficulty, rng)
  if (view.top === null || view.top.seat === view.seat) return decideLead(view, difficulty)
  return decideFollow(view, difficulty, rng)
}
