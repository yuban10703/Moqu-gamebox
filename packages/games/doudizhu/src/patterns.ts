/**
 * 牌型：识别、比较、枚举。纯函数，不知道座位、轮次与界面。
 *
 * 支持的牌型（标准斗地主）：
 *   单张 single、对子 pair、三张 triple、三带一 triple1、三带二 triple2、
 *   顺子 straight（≥5 张单牌连续）、连对 pairStraight（≥3 对连续）、
 *   飞机 plane（≥2 个三张连续）、飞机带单 plane1、飞机带对 plane2、
 *   四带二 four2（带两张单）、四带两对 four22、炸弹 bomb、王炸 rocket。
 * 顺子 / 连对 / 飞机只能用到 A。
 *
 * 比较：王炸最大；炸弹压一切非炸弹，炸弹之间比点数；
 * 其余牌型只能被「同类型、同张数」且主点数更大的牌压。
 */
import {
  MAX_CHAIN_RANK,
  RANK_2,
  RANK_BIG_JOKER,
  RANK_SMALL_JOKER,
  rankCounts,
  rankOf,
  type CardId,
} from './cards.js'

export type PatternType =
  | 'single'
  | 'pair'
  | 'triple'
  | 'triple1'
  | 'triple2'
  | 'straight'
  | 'pairStraight'
  | 'plane'
  | 'plane1'
  | 'plane2'
  | 'four2'
  | 'four22'
  | 'bomb'
  | 'rocket'

export interface Pattern {
  type: PatternType
  /** 比较用的主点数：链类取最小的那一节，带牌类取主体（三张 / 四张）的点数 */
  main: number
  /** 链长：顺子是张数，连对是对数，飞机是三张的个数；其余为 1 */
  chain: number
  cards: CardId[]
}

/** 牌型的「标识」：只有标识相同（或炸弹 / 王炸）才能互相压 */
export function patternKey(pattern: Pattern): string {
  return `${pattern.type}:${pattern.chain}:${pattern.cards.length}`
}

/** a 能否压过 b（b 为 null 表示自己领出，任何合法牌型都行） */
export function beats(a: Pattern, b: Pattern | null): boolean {
  if (!b) return true
  if (a.type === 'rocket') return true
  if (b.type === 'rocket') return false
  if (a.type === 'bomb') return b.type !== 'bomb' || a.main > b.main
  if (b.type === 'bomb') return false
  return patternKey(a) === patternKey(b) && a.main > b.main
}

/* ------------------------------------------------------------------ 识别 */

/** 从 lo 开始连续 len 个点数是否都满足 count >= need，且不越过 A */
function runOk(counts: readonly number[], lo: number, len: number, need: number): boolean {
  if (lo < 3 || lo + len - 1 > MAX_CHAIN_RANK) return false
  for (let r = lo; r < lo + len; r++) if (counts[r]! < need) return false
  return true
}

/** 剩下的牌（按点数计数）能否恰好拆成 n 对 */
function formsPairs(counts: readonly number[], n: number): boolean {
  let pairs = 0
  for (let r = 3; r <= RANK_BIG_JOKER; r++) {
    const c = counts[r]!
    if (c % 2 !== 0) return false
    pairs += c / 2
  }
  return pairs === n
}

/**
 * 一手牌的**全部**合法解读（同一组牌可能有多种读法，例如 333444555666 既是四连飞机，
 * 也是「444555666 带 3、3、3」的三连飞机带单）。跟牌时取与上家同标识的那一种；
 * 领出时取第一种（按下面的优先顺序）。不是合法牌型时返回空数组。
 */
export function classifyAll(cards: readonly CardId[]): Pattern[] {
  const n = cards.length
  if (n === 0) return []
  const list = [...cards]
  const counts = rankCounts(cards)
  const ranks = [...new Set(cards.map(rankOf))].sort((a, b) => a - b)
  const out: Pattern[] = []
  const add = (type: PatternType, main: number, chain = 1): void => {
    out.push({ type, main, chain, cards: list })
  }

  if (n === 2 && counts[RANK_SMALL_JOKER] === 1 && counts[RANK_BIG_JOKER] === 1) {
    add('rocket', RANK_BIG_JOKER)
    return out
  }
  if (n === 1) add('single', ranks[0]!)
  if (n === 2 && ranks.length === 1) add('pair', ranks[0]!)
  if (n === 3 && ranks.length === 1) add('triple', ranks[0]!)
  if (n === 4 && ranks.length === 1) add('bomb', ranks[0]!)
  if (n === 4 && ranks.length === 2) {
    const three = ranks.find((r) => counts[r] === 3)
    if (three !== undefined) add('triple1', three)
  }
  if (n === 5 && ranks.length === 2) {
    const three = ranks.find((r) => counts[r] === 3)
    const two = ranks.find((r) => counts[r] === 2)
    if (three !== undefined && two !== undefined) add('triple2', three)
  }

  const lo = ranks[0]!
  const span = ranks.length
  const consecutive = ranks[span - 1]! - lo + 1 === span && ranks[span - 1]! <= MAX_CHAIN_RANK
  if (consecutive && n >= 5 && span === n) add('straight', lo, n)
  if (consecutive && span >= 3 && n === span * 2 && ranks.every((r) => counts[r] === 2)) {
    add('pairStraight', lo, span)
  }
  if (consecutive && span >= 2 && n === span * 3 && ranks.every((r) => counts[r] === 3)) {
    add('plane', lo, span)
  }

  // 飞机带单：k 个连续三张 + k 张任意单牌
  if (n % 4 === 0 && n >= 8) {
    const k = n / 4
    for (let s = 3; s + k - 1 <= MAX_CHAIN_RANK; s++) {
      if (runOk(counts, s, k, 3)) add('plane1', s, k)
    }
  }
  // 飞机带对：k 个连续三张 + k 对
  if (n % 5 === 0 && n >= 10) {
    const k = n / 5
    for (let s = 3; s + k - 1 <= MAX_CHAIN_RANK; s++) {
      if (!runOk(counts, s, k, 3)) continue
      const rest = [...counts]
      for (let r = s; r < s + k; r++) rest[r]! -= 3
      if (formsPairs(rest, k)) add('plane2', s, k)
    }
  }
  // 四带二（两张单）/ 四带两对
  if (n === 6 || n === 8) {
    for (const r of ranks) {
      if (counts[r] !== 4) continue
      if (n === 6) add('four2', r)
      else {
        const rest = [...counts]
        rest[r] = 0
        if (formsPairs(rest, 2)) add('four22', r)
      }
    }
  }
  return out
}

export function classify(cards: readonly CardId[]): Pattern | null {
  return classifyAll(cards)[0] ?? null
}

/** 用这组牌跟 top（null = 领出）：返回能压过的那种解读，压不过 / 不是牌型则 null */
export function asPlayAgainst(cards: readonly CardId[], top: Pattern | null): Pattern | null {
  const all = classifyAll(cards)
  if (!top) return all[0] ?? null
  return all.find((pattern) => beats(pattern, top)) ?? null
}

/* ------------------------------------------------------------------ 枚举 */

/** 手牌按点数分组（每组内按 id 升序，取牌时总拿最前面的） */
export function cardsByRank(hand: readonly CardId[]): CardId[][] {
  const groups: CardId[][] = Array.from({ length: RANK_BIG_JOKER + 1 }, () => [])
  for (const card of [...hand].sort((a, b) => a - b)) groups[rankOf(card)]!.push(card)
  return groups
}

/**
 * 挑带牌：从 exclude 之外挑 count 张单牌（size=1）或 count 对（size=2）。
 * 优先拆「本来就是这个张数」的点数（单牌找落单的、对子找成对的），再按点数从小到大；
 * 尽量不拆炸弹与王炸。挑不够返回 null。
 */
function pickKickers(
  groups: readonly CardId[][],
  exclude: ReadonlySet<number>,
  count: number,
  size: 1 | 2,
): CardId[] | null {
  const hasRocket = groups[RANK_SMALL_JOKER]!.length > 0 && groups[RANK_BIG_JOKER]!.length > 0
  const candidates: number[] = []
  for (let r = 3; r <= RANK_BIG_JOKER; r++) {
    if (exclude.has(r)) continue
    if (groups[r]!.length >= size) candidates.push(r)
  }
  const cost = (r: number): number => {
    const have = groups[r]!.length
    const exact = have === size ? 0 : have === 4 ? 30 : 10
    const rocket = hasRocket && r >= RANK_SMALL_JOKER ? 40 : 0
    return exact + rocket + r
  }
  candidates.sort((a, b) => cost(a) - cost(b))
  // 以「单位」计（带单 = 1 张、带对 = 2 张）：第一轮每个点数最多出一个单位，
  // 不够再允许同一点数出多个单位（例如带单时拆一个对子出两张）
  const used = new Map<number, number>()
  const out: CardId[] = []
  let units = 0
  for (const pass of [1, 2]) {
    for (const r of candidates) {
      if (units >= count) break
      const already = used.get(r) ?? 0
      if (pass === 1 && already > 0) continue
      let available = Math.floor(groups[r]!.length / size) - already
      if (pass === 1) available = Math.min(available, 1)
      let taken = 0
      for (; taken < available && units < count; taken++) {
        const from = (already + taken) * size
        out.push(...groups[r]!.slice(from, from + size))
        units++
      }
      used.set(r, already + taken)
    }
  }
  return units === count ? out : null
}

function take(groups: readonly CardId[][], rank: number, n: number): CardId[] {
  return groups[rank]!.slice(0, n)
}

/**
 * 能压过 top 的出法（每个「主点数」给一种，带牌挑最省的）。
 * 顺序：同类型从小到大，然后炸弹从小到大，最后王炸 —— 「提示」按这个顺序循环，电脑也优先取靠前的。
 */
export function beatingPlays(hand: readonly CardId[], top: Pattern): Pattern[] {
  const groups = cardsByRank(hand)
  const counts = groups.map((g) => g.length)
  const out: Pattern[] = []
  const push = (type: PatternType, main: number, chain: number, cards: CardId[] | null): void => {
    if (cards) out.push({ type, main, chain, cards })
  }

  switch (top.type) {
    case 'single':
      for (let r = top.main + 1; r <= RANK_BIG_JOKER; r++) if (counts[r]! >= 1) push('single', r, 1, take(groups, r, 1))
      break
    case 'pair':
      for (let r = top.main + 1; r <= RANK_2; r++) if (counts[r]! >= 2) push('pair', r, 1, take(groups, r, 2))
      break
    case 'triple':
    case 'triple1':
    case 'triple2':
      for (let r = top.main + 1; r <= RANK_2; r++) {
        if (counts[r]! < 3) continue
        const body = take(groups, r, 3)
        if (top.type === 'triple') push('triple', r, 1, body)
        else {
          const kick = pickKickers(groups, new Set([r]), 1, top.type === 'triple1' ? 1 : 2)
          push(top.type, r, 1, kick ? [...body, ...kick] : null)
        }
      }
      break
    case 'straight':
    case 'pairStraight':
    case 'plane':
    case 'plane1':
    case 'plane2': {
      const need = top.type === 'straight' ? 1 : top.type === 'pairStraight' ? 2 : 3
      const k = top.chain
      for (let s = top.main + 1; s + k - 1 <= MAX_CHAIN_RANK; s++) {
        if (!runOk(counts, s, k, need)) continue
        const body: CardId[] = []
        const used = new Set<number>()
        for (let r = s; r < s + k; r++) {
          body.push(...take(groups, r, need))
          used.add(r)
        }
        if (top.type === 'plane1' || top.type === 'plane2') {
          const kick = pickKickers(groups, used, k, top.type === 'plane1' ? 1 : 2)
          push(top.type, s, k, kick ? [...body, ...kick] : null)
        } else push(top.type, s, k, body)
      }
      break
    }
    case 'four2':
    case 'four22':
      for (let r = top.main + 1; r <= RANK_2; r++) {
        if (counts[r] !== 4) continue
        const kick = pickKickers(groups, new Set([r]), 2, top.type === 'four2' ? 1 : 2)
        push(top.type, r, 1, kick ? [...take(groups, r, 4), ...kick] : null)
      }
      break
    case 'bomb':
    case 'rocket':
      break
  }

  if (top.type !== 'rocket') {
    const fromBomb = top.type === 'bomb' ? top.main + 1 : 3
    for (let r = fromBomb; r <= RANK_2; r++) if (counts[r] === 4) push('bomb', r, 1, take(groups, r, 4))
    if (counts[RANK_SMALL_JOKER] === 1 && counts[RANK_BIG_JOKER] === 1) {
      push('rocket', RANK_BIG_JOKER, 1, [...groups[RANK_SMALL_JOKER]!, ...groups[RANK_BIG_JOKER]!])
    }
  }
  return out
}

/* ------------------------------------------------------------------ 拆牌（领出 / 电脑用） */

/**
 * 把手牌拆成若干「组」，每组本身就是一个合法牌型，组与组不重叠、合起来正好是整手牌。
 * 这是电脑领出的依据，也是「提示」在领出时给出的方案。启发式：
 *   王炸 → 炸弹 → 飞机 → 顺子（只在能消掉更多单牌时才拆）→ 连对 → 三张 → 对子 → 单张，
 *   最后给三张 / 飞机挑最小的单牌或对子当带牌（不拿 2 与王当带牌，除非别无选择）。
 */
export function decompose(hand: readonly CardId[]): Pattern[] {
  const groups = cardsByRank(hand).map((g) => [...g])
  const counts = groups.map((g) => g.length)
  const out: Pattern[] = []
  const grab = (rank: number, n: number): CardId[] => {
    counts[rank]! -= n
    return groups[rank]!.splice(0, n)
  }

  if (counts[RANK_SMALL_JOKER] === 1 && counts[RANK_BIG_JOKER] === 1) {
    out.push({ type: 'rocket', main: RANK_BIG_JOKER, chain: 1, cards: [...grab(RANK_SMALL_JOKER, 1), ...grab(RANK_BIG_JOKER, 1)] })
  }
  for (let r = 3; r <= RANK_2; r++) {
    if (counts[r] === 4) out.push({ type: 'bomb', main: r, chain: 1, cards: grab(r, 4) })
  }

  // 飞机：连续的三张（≥2 个）
  for (let s = 3; s <= MAX_CHAIN_RANK; s++) {
    let e = s
    while (e <= MAX_CHAIN_RANK && counts[e] === 3) e++
    if (e - s >= 2) {
      const cards: CardId[] = []
      for (let r = s; r < e; r++) cards.push(...grab(r, 3))
      out.push({ type: 'plane', main: s, chain: e - s, cards })
    }
    s = Math.max(s, e - 1)
  }

  // 顺子：找最长的连续段，只有「消掉的单牌」比「拆坏的对子 / 三张」多时才拆
  for (;;) {
    let best: { s: number; len: number } | null = null
    for (let s = 3; s <= MAX_CHAIN_RANK - 4; s++) {
      let e = s
      while (e <= MAX_CHAIN_RANK && counts[e]! >= 1) e++
      if (e - s >= 5 && (!best || e - s > best.len)) best = { s, len: e - s }
    }
    if (!best) break
    // 只保留能消掉单牌的部分：从两端剥掉会拆坏组的点数，直到剩下 5 张以上且划算
    let { s, len } = best
    const gain = (lo: number, l: number): number => {
      let singles = 0
      let broken = 0
      for (let r = lo; r < lo + l; r++) {
        if (counts[r] === 1) singles++
        else broken++
      }
      return singles - broken
    }
    while (len > 5 && counts[s] !== 1 && gain(s + 1, len - 1) >= gain(s, len)) {
      s++
      len--
    }
    while (len > 5 && counts[s + len - 1] !== 1 && gain(s, len - 1) >= gain(s, len)) len--
    if (gain(s, len) <= 0) break
    const cards: CardId[] = []
    for (let r = s; r < s + len; r++) cards.push(...grab(r, 1))
    out.push({ type: 'straight', main: s, chain: len, cards })
  }

  // 连对：连续的对子（≥3 对）
  for (let s = 3; s <= MAX_CHAIN_RANK; s++) {
    let e = s
    while (e <= MAX_CHAIN_RANK && counts[e] === 2) e++
    if (e - s >= 3) {
      const cards: CardId[] = []
      for (let r = s; r < e; r++) cards.push(...grab(r, 2))
      out.push({ type: 'pairStraight', main: s, chain: e - s, cards })
    }
    s = Math.max(s, e - 1)
  }

  const triples: Pattern[] = []
  for (let r = 3; r <= RANK_2; r++) {
    if (counts[r] === 3) triples.push({ type: 'triple', main: r, chain: 1, cards: grab(r, 3) })
  }
  const pairs: Pattern[] = []
  for (let r = 3; r <= RANK_2; r++) {
    if (counts[r] === 2) pairs.push({ type: 'pair', main: r, chain: 1, cards: grab(r, 2) })
  }
  const singles: Pattern[] = []
  for (let r = 3; r <= RANK_BIG_JOKER; r++) {
    while (counts[r]! > 0) singles.push({ type: 'single', main: r, chain: 1, cards: grab(r, 1) })
  }

  // 给三张 / 飞机配带牌：先用小单牌，再用小对子；不拿 2 与王当带牌
  const lowSingles = singles.filter((p) => p.main < RANK_2)
  const lowPairs = pairs.filter((p) => p.main < RANK_2)
  const withWings = (body: Pattern): Pattern => {
    const k = body.type === 'plane' ? body.chain : 1
    if (lowSingles.length >= k) {
      const wings = lowSingles.splice(0, k)
      for (const w of wings) singles.splice(singles.indexOf(w), 1)
      return {
        type: k > 1 ? 'plane1' : 'triple1',
        main: body.main,
        chain: k,
        cards: [...body.cards, ...wings.flatMap((w) => w.cards)],
      }
    }
    if (lowPairs.length >= k) {
      const wings = lowPairs.splice(0, k)
      for (const w of wings) pairs.splice(pairs.indexOf(w), 1)
      return {
        type: k > 1 ? 'plane2' : 'triple2',
        main: body.main,
        chain: k,
        cards: [...body.cards, ...wings.flatMap((w) => w.cards)],
      }
    }
    return body
  }
  for (let i = 0; i < out.length; i++) if (out[i]!.type === 'plane') out[i] = withWings(out[i]!)
  for (const t of triples) out.push(withWings(t))
  out.push(...pairs, ...singles)
  return out
}
