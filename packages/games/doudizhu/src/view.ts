/**
 * 展示模型：把真人座位的视角（observe(table, 0)）翻译成壳层的牌桌（CardTableView）与按钮。
 *
 * 只用 SeatView，不碰别人的手牌 —— 联机时客户端拿服务器下发的 SeatView 调同一个函数即可。
 * 1-bit：牌面由壳层画（黑桃 / 梅花实心、红桃 / 方块空心，王用星号区分大小），这里只给点数与花色。
 */
import type { CardFace, CardTableSeat, CardTableView, ControlSpec, GameView, StatView } from '@eink/core'
import { BIG_JOKER, SMALL_JOKER, rankLabel, rankOf, suitOf, type CardId } from './cards.js'
import { observe, type SeatView } from './observe.js'
import { HUMAN_SEAT, hintOptions, statusOf, tableOf, type DoudizhuState } from './rules.js'
import { settlement, type Seat } from './table.js'

export function cardFace(card: CardId, selected = false): CardFace {
  return {
    id: card,
    rank: card >= SMALL_JOKER ? '' : rankLabel(rankOf(card)),
    suit: suitOf(card),
    ...(card === SMALL_JOKER ? { joker: 'small' as const } : {}),
    ...(card === BIG_JOKER ? { joker: 'big' as const } : {}),
    ...(selected ? { selected: true } : {}),
  }
}

const POSITIONS: Record<Seat, CardTableSeat['position']> = { 0: 'bottom', 1: 'right', 2: 'left' }

function seatView(view: SeatView, seat: Seat): CardTableSeat {
  const out: CardTableSeat = {
    position: POSITIONS[seat],
    nameKey: `doudizhu.seat.${seat}`,
    avatar: seat,
    count: seat === HUMAN_SEAT ? null : view.counts[seat],
    active: (view.phase === 'bidding' || view.phase === 'playing') && view.turn === seat,
    played: null,
    ...(view.landlord === seat ? { badgeKey: 'doudizhu.badge.landlord' } : {}),
  }
  if (view.phase === 'bidding') {
    const bid = view.bids[seat]
    if (bid === 0) out.statusKey = 'doudizhu.bid.none'
    else if (bid !== null) {
      out.statusKey = 'doudizhu.bid.points'
      out.statusParams = { count: bid }
    }
    return out
  }
  // 打完之后：两家电脑亮出剩下的牌（自己的剩牌就是手牌区）
  if (view.revealed && seat !== HUMAN_SEAT && view.revealed[seat].length > 0) {
    out.played = view.revealed[seat].map((card) => cardFace(card))
    return out
  }
  const last = view.lastActions[seat]
  if (last?.kind === 'play') out.played = last.cards.map((card) => cardFace(card))
  else if (last?.kind === 'pass') out.statusKey = 'doudizhu.action.pass'
  return out
}

export function buildTable(state: DoudizhuState): CardTableView {
  const table = tableOf(state)
  const view = observe(table, HUMAN_SEAT)
  const myTurn = (view.phase === 'bidding' || view.phase === 'playing') && view.turn === HUMAN_SEAT
  const banner =
    !myTurn ? undefined : view.phase === 'bidding' ? 'doudizhu.banner.bid' : 'doudizhu.banner.yourTurn'
  return {
    kind: 'cards',
    seats: ([2, 1, 0] as Seat[]).map((seat) => seatView(view, seat)),
    center: view.bottom
      ? { cards: view.bottom.map((card) => cardFace(card)), hidden: 0 }
      : { cards: [], hidden: 3 },
    hand: view.hand.map((card) => cardFace(card, state.selected.includes(card))),
    ...(banner ? { bannerKey: banner } : {}),
  }
}

export function buildStats(state: DoudizhuState): StatView[] {
  const table = tableOf(state)
  return [
    { labelKey: 'doudizhu.stat.score', value: String(state.scores[HUMAN_SEAT]) },
    { labelKey: 'doudizhu.stat.base', value: table.base > 0 ? String(table.base) : '—' },
    { labelKey: 'doudizhu.stat.multiplier', value: String(table.multiplier) },
  ]
}

export function buildControls(state: DoudizhuState): ControlSpec[] {
  const table = tableOf(state)
  if (table.phase === 'over') {
    return [{ id: 'next-level', labelKey: 'doudizhu.next', role: 'action', enabled: true, emphasis: 'primary' }]
  }
  const myTurn = table.turn === HUMAN_SEAT
  if (table.phase === 'bidding') {
    return ([0, 1, 2, 3] as const).map((value) => ({
      id: `bid-${value}`,
      labelKey: value === 0 ? 'doudizhu.bid.none' : 'doudizhu.bid.points',
      ...(value === 0 ? {} : { labelParams: { count: value } }),
      role: 'action' as const,
      enabled: myTurn && (value === 0 || value > table.highestBid),
      emphasis: value === 3 ? ('primary' as const) : ('normal' as const),
    }))
  }
  const canPass = myTurn && table.top !== null && table.top.seat !== HUMAN_SEAT
  /*
   * 提示按钮：轮到自己、且**真的有牌可出**时才可点。
   * 原先只判 `myTurn`，于是「提示 (0)」仍然是个可按的按钮 —— 点下去没反应，
   * 玩家会以为是卡住了（压不过上家时正是 0 个候选）。
   */
  const hints = myTurn ? hintOptions(table) : []
  return [
    { id: 'pass', labelKey: 'doudizhu.action.pass', role: 'action', enabled: canPass, emphasis: 'normal' },
    { id: 'clear', labelKey: 'doudizhu.action.clear', role: 'action', enabled: state.selected.length > 0, emphasis: 'normal' },
    {
      id: 'hint',
      labelKey: 'doudizhu.action.hint',
      labelParams: { count: hints.length },
      role: 'action',
      enabled: hints.length > 0,
      emphasis: 'normal',
    },
    {
      id: 'play',
      labelKey: 'doudizhu.action.play',
      role: 'action',
      enabled: myTurn && state.selected.length > 0,
      emphasis: 'primary',
    },
  ]
}

export function buildView(state: DoudizhuState): GameView {
  const table = tableOf(state)
  const status = statusOf(state)
  let result: GameView['result'] = null
  if (status !== 'playing' && table.landlord !== null) {
    const delta = settlement(table)[HUMAN_SEAT]
    const details: NonNullable<GameView['result']>['details'] = [
      { key: table.winner === table.landlord ? 'doudizhu.result.landlordWins' : 'doudizhu.result.farmersWin' },
      { key: 'doudizhu.result.unit', params: { count: table.multiplier, base: table.base } },
    ]
    if (table.spring) details.push({ key: `doudizhu.result.${table.spring}` })
    details.push(
      { key: delta >= 0 ? 'doudizhu.result.gain' : 'doudizhu.result.loss', params: { count: Math.abs(delta) } },
      { key: 'doudizhu.result.score', params: { count: state.scores[HUMAN_SEAT] } },
    )
    result = { titleKey: status === 'won' ? 'doudizhu.won.title' : 'doudizhu.lost.title', details }
  }
  return {
    board: null,
    table: buildTable(state),
    stats: buildStats(state),
    result,
    notice: state.notice ? { textKey: state.notice } : null,
  }
}
