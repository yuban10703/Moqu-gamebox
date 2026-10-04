/**
 * 展示模型：把局面翻译成壳层的对决面板（DuelView）与按钮。
 *
 * 视角：对恶魔时永远是真人（0 号位）；双人同屏时是「当前行动者」（放大镜 / 手机的结果给正在操作的人看）。
 * 只用 SeatView，不碰枪里弹的真实顺序。
 */
import type { ControlSpec, DuelLine, DuelSide, DuelToken, DuelView, GameView, StatView } from '@eink/core'
import { MAX_ITEMS, ROUND_COUNT, type DuelEvent, type Seat } from './engine.js'
import { observe, type SeatView } from './observe.js'
import { duelOf, humanActor, isHuman, itemUsable, modeOf, statusOf, type BuckshotState } from './rules.js'

/** 最近记录显示几条 */
export const LOG_LINES = 4

export function nameKey(state: BuckshotState, seat: Seat): string {
  if (modeOf(state.difficulty) === 'hotseat') return seat === 0 ? 'buckshot.name.p1' : 'buckshot.name.p2'
  return seat === 0 ? 'buckshot.name.you' : 'buckshot.name.devil'
}

function perspective(state: BuckshotState): SeatView {
  const duel = duelOf(state)
  const seat: Seat = modeOf(state.difficulty) === 'hotseat' ? duel.turn : 0
  return observe(duel, seat)
}

function lineFor(state: BuckshotState, event: DuelEvent): DuelLine {
  const name = (seat: Seat): string => nameKey(state, seat)
  switch (event.type) {
    case 'load':
      return { key: 'buckshot.log.load', params: { total: event.total, live: event.live, blank: event.blank } }
    case 'shoot':
      if (event.target === event.shooter) {
        return {
          key: event.live ? 'buckshot.log.shootSelfLive' : 'buckshot.log.shootSelfBlank',
          subjectKey: name(event.shooter),
          params: { damage: event.damage },
        }
      }
      return {
        key: event.live ? 'buckshot.log.shootLive' : 'buckshot.log.shootBlank',
        subjectKey: name(event.shooter),
        objectKey: name(event.target),
        params: { damage: event.damage },
      }
    case 'item':
      return { key: `buckshot.log.item.${event.item}`, subjectKey: name(event.user) }
    case 'peek':
      if (event.live === null) return { key: 'buckshot.log.phoneNone' }
      if (event.offset === 1) return { key: event.live ? 'buckshot.log.peekLive' : 'buckshot.log.peekBlank' }
      return { key: event.live ? 'buckshot.log.phoneLive' : 'buckshot.log.phoneBlank', params: { n: event.offset } }
    case 'eject':
      return { key: event.live ? 'buckshot.log.ejectLive' : 'buckshot.log.ejectBlank', subjectKey: name(event.user) }
    case 'heal':
      return { key: 'buckshot.log.heal', subjectKey: name(event.user), params: { amount: event.amount } }
    case 'hurt':
      return { key: 'buckshot.log.hurt', subjectKey: name(event.user), params: { amount: event.amount } }
    case 'skip':
      return { key: 'buckshot.log.skip', subjectKey: name(event.seat) }
    case 'round':
      return { key: 'buckshot.log.round', subjectKey: name(event.winner), params: { round: event.round + 1 } }
  }
}

function sideFor(state: BuckshotState, view: SeatView, seat: Seat): DuelSide {
  const duel = duelOf(state)
  const actor = humanActor(state)
  const hotseat = modeOf(state.difficulty) === 'hotseat'
  const items = view.items[seat]
  const freshFrom = items.length - view.fresh[seat]
  return {
    position: seat === 0 ? 'bottom' : 'top',
    nameKey: nameKey(state, seat),
    portrait: hotseat ? (seat === 0 ? 'player1' : 'player2') : seat === 0 ? 'player' : 'devil',
    hp: view.hp[seat],
    maxHp: view.maxHp,
    items: items.map((item, slot) => ({
      id: slot,
      icon: item,
      labelKey: `buckshot.item.${item}`,
      ...(view.phase === 'load' && slot >= freshFrom ? { fresh: true } : {}),
      selectable: view.phase === 'turn' && actor === seat && isHuman(state, seat) && itemUsable(duel, seat, slot),
    })),
    itemCapacity: MAX_ITEMS,
    active: (view.phase === 'turn' || view.phase === 'load') && view.turn === seat,
    ...(view.cuffed[seat] ? { statusKey: 'buckshot.status.cuffed' } : {}),
    wins: view.roundWins[seat],
  }
}

export function buildDuel(state: BuckshotState): DuelView {
  const view = perspective(state)
  let chamber: DuelToken[]
  if (view.revealed) chamber = view.revealed.map((live) => (live ? 'live' : 'blank'))
  else {
    chamber = view.known.map((known) => (known === true ? 'knownLive' : known === false ? 'knownBlank' : 'unknown'))
  }
  let caption: DuelLine
  if (view.phase === 'load') {
    caption = { key: 'buckshot.caption.load', params: { total: view.loadTotal, live: view.loadLive, blank: view.loadBlank } }
  } else if (view.phase === 'roundOver') {
    caption = { key: 'buckshot.caption.round', subjectKey: nameKey(state, view.winner!), params: { round: view.round + 1 } }
  } else if (view.phase === 'matchOver') {
    caption = { key: 'buckshot.caption.match', subjectKey: nameKey(state, view.winner!) }
  } else {
    caption = {
      key: 'buckshot.caption.turn',
      subjectKey: nameKey(state, view.turn),
      params: { left: view.left, live: view.loadLive, blank: view.loadBlank },
    }
  }
  const tags: DuelLine[] = []
  if (view.saw) tags.push({ key: 'buckshot.tag.saw' })
  if (view.inverted) tags.push({ key: 'buckshot.tag.inverted' })
  return {
    kind: 'duel',
    sides: [sideFor(state, view, 1), sideFor(state, view, 0)],
    spent: view.phase === 'load' ? [] : view.spent.map((shell) => (shell.live ? 'live' : 'blank')),
    chamber,
    caption,
    tags,
    sawn: view.saw,
    log: view.events.slice(-LOG_LINES).map((event) => lineFor(state, event)),
  }
}

export function buildStats(state: BuckshotState): StatView[] {
  const duel = duelOf(state)
  return [
    { labelKey: 'buckshot.stat.round', value: `${duel.round + 1} / ${ROUND_COUNT}` },
    { labelKey: 'buckshot.stat.wins', value: `${duel.roundWins[0]} : ${duel.roundWins[1]}` },
  ]
}

export function buildControls(state: BuckshotState): ControlSpec[] {
  const duel = duelOf(state)
  if (duel.phase === 'load') {
    return [{ id: 'begin', labelKey: 'buckshot.action.begin', role: 'action', enabled: true, emphasis: 'primary' }]
  }
  if (duel.phase === 'roundOver') {
    return [{ id: 'next-round', labelKey: 'buckshot.action.nextRound', role: 'action', enabled: true, emphasis: 'primary' }]
  }
  if (duel.phase === 'matchOver') return []
  const mine = humanActor(state) !== null
  const hotseat = modeOf(state.difficulty) === 'hotseat'
  return [
    { id: 'shoot-self', labelKey: 'buckshot.action.shootSelf', role: 'action', enabled: mine, emphasis: 'normal' },
    {
      id: 'shoot-opponent',
      labelKey: hotseat ? 'buckshot.action.shootOther' : 'buckshot.action.shootDevil',
      role: 'action',
      enabled: mine,
      emphasis: 'primary',
    },
  ]
}

export function buildView(state: BuckshotState): GameView {
  const duel = duelOf(state)
  const status = statusOf(state)
  let result: GameView['result'] = null
  if (status !== 'playing') {
    const hotseat = modeOf(state.difficulty) === 'hotseat'
    const titleKey = hotseat
      ? duel.winner === 0
        ? 'buckshot.won.p1'
        : 'buckshot.won.p2'
      : status === 'won'
        ? 'buckshot.won.title'
        : 'buckshot.lost.title'
    result = {
      titleKey,
      details: [
        {
          key: 'buckshot.result.rounds',
          params: { count: duel.roundWins[0], other: duel.roundWins[1] },
        },
      ],
    }
  }
  return {
    board: null,
    duel: buildDuel(state),
    stats: buildStats(state),
    result,
    notice: null,
  }
}
