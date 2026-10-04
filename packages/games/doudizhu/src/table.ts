/**
 * 牌局引擎（一副牌从发牌到结算）：**按座位驱动的纯状态机**。
 *
 * 它只认「哪个座位、做了什么」（Move），不知道谁是真人、谁是电脑、谁在网络另一头 ——
 * 单机时由 GameDef 把真人操作与电脑决策翻译成 Move，联机时由牌桌主机（net/host.ts）把各端消息翻译成 Move，
 * 两条路径共用这里同一份规则校验。
 *
 * 座位：0 = 自己（画面下方），1 = 下家（右），2 = 上家（左）；出牌顺序 0 → 1 → 2 → 0。
 *
 * 流程：
 *   叫分：从 firstBidder 起每家叫一次（1 / 2 / 3 分，或不叫），必须比当前最高分高；
 *         叫到 3 分立即成为地主；三家都叫完时最高者为地主；都不叫 → 'redeal'（重新发牌）。
 *   出牌：地主拿 3 张底牌先出；跟牌必须压过当前最大的一手，或不出；
 *         连续两家不出，最后出牌的人重新领出；先出完手牌的一方获胜。
 *   倍数：起始 1；每出一次炸弹 / 王炸 ×2；春天（农民一张没出）/ 反春（地主只出过第一手）再 ×2。
 *   结算：每份 = 底分（叫到的分）× 倍数；地主赢 → 地主 +2 份、农民各 −1 份；地主输则相反。
 */
import { IllegalActionError } from '@eink/core'
import { dealCards, isCardId, sortForDisplay, type CardId } from './cards.js'
import { asPlayAgainst, type Pattern } from './patterns.js'

export const GAME_ID = 'doudizhu'
export const SEAT_COUNT = 3
export type Seat = 0 | 1 | 2
export const SEATS: readonly Seat[] = [0, 1, 2]

export type Move =
  | { kind: 'bid'; value: 0 | 1 | 2 | 3 }
  | { kind: 'play'; cards: CardId[] }
  | { kind: 'pass' }

export interface LoggedMove {
  seat: Seat
  move: Move
}

/** 某个座位在当前这一轮（一圈出牌）里最近做了什么，用于在座位旁显示 */
export type LastAction = { kind: 'play'; cards: CardId[] } | { kind: 'pass' } | null

export type Phase = 'bidding' | 'playing' | 'over' | 'redeal'

export interface TableState {
  phase: Phase
  hands: [CardId[], CardId[], CardId[]]
  bottom: CardId[]
  firstBidder: Seat
  /** 每家叫的分：null = 还没轮到 / 没叫；0 = 不叫 */
  bids: [number | null, number | null, number | null]
  highestBid: number
  highestBidder: Seat | null
  landlord: Seat | null
  turn: Seat
  /** 底分（叫到的分）；叫分阶段为 0 */
  base: number
  multiplier: number
  /** 当前一轮里最大的一手 */
  top: { seat: Seat; pattern: Pattern } | null
  /** top 之后连续不出的家数 */
  passes: number
  lastActions: [LastAction, LastAction, LastAction]
  /** 每家出过几手牌（判春天 / 反春） */
  playCounts: [number, number, number]
  /** 已经出过的全部牌（公开信息，电脑记牌用） */
  played: CardId[]
  winner: Seat | null
  /** 本副牌出过的炸弹 + 王炸次数 */
  bombs: number
  spring: 'spring' | 'antiSpring' | null
}

export function nextSeat(seat: Seat): Seat {
  return ((seat + 1) % SEAT_COUNT) as Seat
}

export function isFarmer(state: TableState, seat: Seat): boolean {
  return state.landlord !== null && state.landlord !== seat
}

/** 两个座位是不是一伙（农民之间是一伙；地主只和自己一伙） */
export function sameSide(state: TableState, a: Seat, b: Seat): boolean {
  if (a === b) return true
  return isFarmer(state, a) && isFarmer(state, b)
}

/** 新发一副牌（还没有任何动作） */
export function startTable(seed: number, dealNo: number): TableState {
  const deal = dealCards(seed, dealNo)
  const firstBidder = deal.firstBidder as Seat
  return {
    phase: 'bidding',
    hands: deal.hands,
    bottom: deal.bottom,
    firstBidder,
    bids: [null, null, null],
    highestBid: 0,
    highestBidder: null,
    landlord: null,
    turn: firstBidder,
    base: 0,
    multiplier: 1,
    top: null,
    passes: 0,
    lastActions: [null, null, null],
    playCounts: [0, 0, 0],
    played: [],
    winner: null,
    bombs: 0,
    spring: null,
  }
}

function illegal(reason: string): never {
  throw new IllegalActionError(GAME_ID, reason)
}

function withTuple<T>(tuple: readonly [T, T, T], seat: Seat, value: T): [T, T, T] {
  const out = [...tuple] as [T, T, T]
  out[seat] = value
  return out
}

/** 校验并执行一个座位的动作；非法（不是你的回合 / 叫分不够高 / 牌不在手里 / 压不过）抛 IllegalActionError */
export function applyMove(state: TableState, seat: Seat, move: Move): TableState {
  if (state.phase === 'over' || state.phase === 'redeal') illegal('deal is finished')
  if (seat !== state.turn) illegal(`not seat ${seat}'s turn`)

  if (state.phase === 'bidding') {
    if (move.kind !== 'bid') illegal('bidding phase only accepts bids')
    const value = move.value
    if (![0, 1, 2, 3].includes(value)) illegal('bad bid')
    if (value !== 0 && value <= state.highestBid) illegal('bid must be higher than the current bid')
    const bids = withTuple(state.bids, seat, value)
    const highestBid = value > state.highestBid ? value : state.highestBid
    const highestBidder = value > state.highestBid ? seat : state.highestBidder
    const everyoneBid = bids.every((bid) => bid !== null)
    if (value === 3 || everyoneBid) {
      if (highestBidder === null) return { ...state, bids, phase: 'redeal' }
      const landlord = highestBidder
      const hands = withTuple(state.hands, landlord, sortForDisplay([...state.hands[landlord], ...state.bottom]))
      return {
        ...state,
        bids,
        highestBid,
        highestBidder,
        landlord,
        hands,
        phase: 'playing',
        turn: landlord,
        base: highestBid,
      }
    }
    return { ...state, bids, highestBid, highestBidder, turn: nextSeat(seat) }
  }

  // 出牌阶段
  if (move.kind === 'bid') illegal('bidding is over')
  if (move.kind === 'pass') {
    if (!state.top || state.top.seat === seat) illegal('the leader cannot pass')
    const passes = state.passes + 1
    const lastActions = withTuple(state.lastActions, seat, { kind: 'pass' } as LastAction)
    if (passes >= SEAT_COUNT - 1) {
      // 一圈结束：最后出牌的人重新领出，桌面清空
      return { ...state, passes: 0, top: null, turn: state.top.seat, lastActions: [null, null, null] }
    }
    return { ...state, passes, lastActions, turn: nextSeat(seat) }
  }

  const cards = move.cards
  if (!Array.isArray(cards) || cards.length === 0) illegal('no cards')
  if (!cards.every(isCardId) || new Set(cards).size !== cards.length) illegal('bad cards')
  const hand = state.hands[seat]
  if (!cards.every((card) => hand.includes(card))) illegal('cards are not in hand')
  const pattern = asPlayAgainst(cards, state.top?.pattern ?? null)
  if (!pattern) illegal(state.top ? 'does not beat the current play' : 'not a valid combination')

  const remaining = hand.filter((card) => !cards.includes(card))
  const isBomb = pattern.type === 'bomb' || pattern.type === 'rocket'
  const playCounts = withTuple(state.playCounts, seat, state.playCounts[seat] + 1)
  let next: TableState = {
    ...state,
    hands: withTuple(state.hands, seat, remaining),
    top: { seat, pattern: { ...pattern, cards: sortForDisplay(cards) } },
    passes: 0,
    // 新的一手：本轮里别人之前的「不出」仍保留显示，自己这格换成刚出的牌
    lastActions: withTuple(state.lastActions, seat, { kind: 'play', cards: sortForDisplay(cards) } as LastAction),
    playCounts,
    played: [...state.played, ...cards],
    bombs: state.bombs + (isBomb ? 1 : 0),
    multiplier: state.multiplier * (isBomb ? 2 : 1),
    turn: nextSeat(seat),
  }
  if (remaining.length === 0) {
    const landlord = state.landlord!
    let spring: TableState['spring'] = null
    if (seat === landlord && SEATS.every((s) => s === landlord || playCounts[s] === 0)) spring = 'spring'
    if (seat !== landlord && playCounts[landlord] === 1) spring = 'antiSpring'
    next = {
      ...next,
      phase: 'over',
      winner: seat,
      spring,
      multiplier: next.multiplier * (spring ? 2 : 1),
    }
  }
  return next
}

/** 从发牌开始按动作日志复算到当前局面（存档只存日志，局面永远由它推出来） */
export function replayTable(seed: number, dealNo: number, log: readonly LoggedMove[]): TableState {
  let state = startTable(seed, dealNo)
  for (const entry of log) state = applyMove(state, entry.seat, entry.move)
  return state
}

/** 本副牌的积分变化（未结束为全 0）：每份 = 底分 × 倍数；地主赢 +2 份，农民各 −1 份，反之亦然 */
export function settlement(state: TableState): [number, number, number] {
  if (state.phase !== 'over' || state.winner === null || state.landlord === null) return [0, 0, 0]
  const unit = state.base * state.multiplier
  const landlordWon = state.winner === state.landlord
  return SEATS.map((seat) => {
    const landlordSide = seat === state.landlord
    const sign = landlordSide === landlordWon ? 1 : -1
    return sign * unit * (landlordSide ? 2 : 1)
  }) as [number, number, number]
}
