/**
 * 座位视角：某个座位**能看到**的信息（联机时服务器发给该端的就是它）。
 *
 * 隐藏信息只有两样：别人的手牌（只给张数）、定地主之前的底牌。
 * 一副牌打完之后全部公开（revealed），方便复盘输在哪。
 * 电脑出牌（ai.ts）与界面（view.ts）都只吃 SeatView，从不碰 TableState 里的隐藏信息 ——
 * 于是：电脑不会作弊；换成联机后，界面拿服务器下发的 SeatView 就能原样渲染。
 */
import type { CardId } from './cards.js'
import type { PatternType } from './patterns.js'
import type { LastAction, Phase, Seat, TableState } from './table.js'

export interface SeatView {
  seat: Seat
  phase: Phase
  /** 自己的手牌（理牌顺序） */
  hand: CardId[]
  /** 三家各剩几张 */
  counts: [number, number, number]
  /** 底牌：定地主之后才公开，叫分阶段为 null */
  bottom: CardId[] | null
  firstBidder: Seat
  bids: [number | null, number | null, number | null]
  highestBid: number
  landlord: Seat | null
  turn: Seat
  base: number
  multiplier: number
  /** 当前一轮里最大的一手（null = 轮到的人领出） */
  top: { seat: Seat; type: PatternType; main: number; chain: number; cards: CardId[] } | null
  lastActions: [LastAction, LastAction, LastAction]
  playCounts: [number, number, number]
  /** 已出过的全部牌（公开） */
  played: CardId[]
  winner: Seat | null
  bombs: number
  spring: TableState['spring']
  /** 打完之后亮出的三家剩余手牌（未结束为 null） */
  revealed: [CardId[], CardId[], CardId[]] | null
}

export function observe(state: TableState, seat: Seat): SeatView {
  return {
    seat,
    phase: state.phase,
    hand: [...state.hands[seat]],
    counts: [state.hands[0].length, state.hands[1].length, state.hands[2].length],
    bottom: state.landlord === null ? null : [...state.bottom],
    firstBidder: state.firstBidder,
    bids: [...state.bids] as SeatView['bids'],
    highestBid: state.highestBid,
    landlord: state.landlord,
    turn: state.turn,
    base: state.base,
    multiplier: state.multiplier,
    top: state.top
      ? {
          seat: state.top.seat,
          type: state.top.pattern.type,
          main: state.top.pattern.main,
          chain: state.top.pattern.chain,
          cards: [...state.top.pattern.cards],
        }
      : null,
    lastActions: state.lastActions.map((action) =>
      action && action.kind === 'play' ? { kind: 'play', cards: [...action.cards] } : action,
    ) as SeatView['lastActions'],
    playCounts: [...state.playCounts] as SeatView['playCounts'],
    played: [...state.played],
    winner: state.winner,
    bombs: state.bombs,
    spring: state.spring,
    revealed: state.phase === 'over' ? [[...state.hands[0]], [...state.hands[1]], [...state.hands[2]]] : null,
  }
}
