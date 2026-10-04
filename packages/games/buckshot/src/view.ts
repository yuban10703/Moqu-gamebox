/**
 * 展示模型：把局面翻译成壳层的对决面板（DuelView）与按钮。
 *
 * 视角：对恶魔时永远是真人（0 号位）；双人同屏时是「当前行动者」（放大镜 / 手机的结果给正在操作的人看）。
 * 只用 SeatView，不碰枪里弹的真实顺序。
 */
import type { ControlSpec, DuelLine, GameStatus, DuelSide, DuelToken, DuelView, GameView, StatView } from '@eink/core'
import { MAX_ITEMS, ROUND_COUNT, opponent, type DuelEvent, type Seat } from './engine.js'
import { observe, remainingShells, type SeatView } from './observe.js'
import { devilLevelAt, duelOf, humanActor, isHuman, itemUsable, modeOf, statusOf, type BuckshotState } from './rules.js'

export function nameKey(state: BuckshotState, seat: Seat): string {
  if (modeOf(state.difficulty) === 'hotseat') return seat === 0 ? 'buckshot.name.p1' : 'buckshot.name.p2'
  return seat === 0 ? 'buckshot.name.you' : 'buckshot.name.devil'
}

function perspective(state: BuckshotState): SeatView {
  const duel = duelOf(state)
  const seat: Seat = modeOf(state.difficulty) === 'hotseat' ? duel.turn : 0
  return observe(duel, seat)
}

/** 这条事件是在谁的回合里发生的（装填 / 一轮结束不属于任何一方） */
function turnOwner(event: DuelEvent): Seat | null {
  switch (event.type) {
    case 'shoot':
      return event.shooter
    case 'item':
    case 'peek':
    case 'eject':
    case 'heal':
    case 'hurt':
      return event.user
    case 'skip':
      // 「某某被铐住、跳过」发生在铐人的那一方回合里
      return opponent(event.seat)
    default:
      return null
  }
}

/** 道具的效果：紧跟在 item 事件后面、同一个使用者的那条（看到的结果 / 回血 / 掉血 / 退弹） */
type Effect = Extract<DuelEvent, { type: 'peek' | 'eject' | 'heal' | 'hurt' }>

function isEffectOf(item: Extract<DuelEvent, { type: 'item' }>, next: DuelEvent | undefined): next is Effect {
  if (!next || !('user' in next) || next.user !== item.user) return false
  return next.type === 'peek' || next.type === 'eject' || next.type === 'heal' || next.type === 'hurt'
}

/** 「你用了 X：效果」—— 看不到的结果（对手的放大镜 / 手机）只说他看了 */
function itemLine(state: BuckshotState, event: Extract<DuelEvent, { type: 'item' }>, effect: Effect | null): DuelLine {
  const subjectKey = nameKey(state, event.user)
  const base = `buckshot.log.use.${event.item}`
  switch (event.item) {
    case 'magnifier':
      if (effect?.type !== 'peek') return { key: `${base}.hidden`, subjectKey }
      return { key: `${base}.${effect.live ? 'live' : 'blank'}`, subjectKey }
    case 'phone':
      if (effect?.type !== 'peek') return { key: `${base}.hidden`, subjectKey }
      if (effect.live === null) return { key: `${base}.none`, subjectKey }
      return { key: `${base}.${effect.live ? 'live' : 'blank'}`, subjectKey, params: { n: effect.offset } }
    case 'beer':
      return { key: `${base}.${effect?.type === 'eject' && effect.live ? 'live' : 'blank'}`, subjectKey }
    case 'cigarettes':
    case 'medicine':
      if (effect?.type === 'hurt') return { key: `${base}.hurt`, subjectKey, params: { amount: effect.amount } }
      if (effect?.type === 'heal' && effect.amount > 0) return { key: `${base}.heal`, subjectKey, params: { amount: effect.amount } }
      return { key: `${base}.full`, subjectKey }
    case 'handcuffs':
      return { key: base, subjectKey, objectKey: nameKey(state, opponent(event.user)) }
    default:
      return { key: base, subjectKey }
  }
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
      return itemLine(state, event, null)
    case 'peek':
      // 正常情况下已并进道具那一条；单独出现时按「看到了什么」兜底
      if (event.live === null) return { key: 'buckshot.log.use.phone.none', subjectKey: name(event.user) }
      return { key: `buckshot.log.use.magnifier.${event.live ? 'live' : 'blank'}`, subjectKey: name(event.user) }
    case 'eject':
      return { key: `buckshot.log.use.beer.${event.live ? 'live' : 'blank'}`, subjectKey: name(event.user) }
    case 'heal':
      return { key: 'buckshot.log.use.medicine.heal', subjectKey: name(event.user), params: { amount: event.amount } }
    case 'hurt':
      return { key: 'buckshot.log.use.medicine.hurt', subjectKey: name(event.user), params: { amount: event.amount } }
    case 'skip':
      return { key: 'buckshot.log.skip', subjectKey: name(event.seat) }
    case 'round':
      return { key: 'buckshot.log.round', subjectKey: name(event.winner), params: { round: event.round + 1 } }
  }
}

/**
 * 整场的记录（旧 → 新）：道具与它的效果合成一条；不是「我方」回合里发生的事标 highlight（壳层圈框）。
 * 「我方」= 对恶魔时的你；双人同屏时是当前行动者（于是框里正好是「对方上一回合做了什么」）。
 */
export function buildLog(state: BuckshotState, view: SeatView): DuelLine[] {
  const lines: DuelLine[] = []
  const events = view.events
  for (let i = 0; i < events.length; i++) {
    const event = events[i]!
    let line: DuelLine
    if (event.type === 'item') {
      const next = events[i + 1]
      const effect = isEffectOf(event, next) ? next : null
      if (effect) i++
      line = itemLine(state, event, effect)
    } else {
      line = lineFor(state, event)
    }
    const owner = turnOwner(event)
    lines.push(owner !== null && owner !== view.seat ? { ...line, highlight: true } : line)
    // 无尽模式：赢下一轮后恶魔要升档时，紧跟着记一条（墨水屏上没有动画，靠文字交代）
    if (event.type === 'round' && event.winner === 0 && state.difficulty === 'endless') {
      const before = devilLevelAt(state.difficulty, event.round)
      const after = devilLevelAt(state.difficulty, event.round + 1)
      if (after && after !== before) lines.push({ key: 'buckshot.log.levelUp', objectKey: `buckshot.difficulty.${after}` })
    }
  }
  return lines
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
    const params = { total: view.loadTotal, live: view.loadLive, blank: view.loadBlank }
    const level = state.difficulty === 'endless' ? devilLevelAt(state.difficulty, view.round) : null
    caption = level
      ? { key: 'buckshot.caption.loadEndless', objectKey: `buckshot.difficulty.${level}`, params }
      : { key: 'buckshot.caption.load', params }
  } else if (view.phase === 'roundOver') {
    caption = { key: 'buckshot.caption.round', subjectKey: nameKey(state, view.winner!), params: { round: view.round + 1 } }
  } else if (view.phase === 'matchOver') {
    caption =
      state.difficulty === 'endless'
        ? { key: 'buckshot.caption.endlessOver', params: { round: view.round + 1 } }
        : { key: 'buckshot.caption.match', subjectKey: nameKey(state, view.winner!) }
  } else {
    caption = { key: 'buckshot.caption.turn', subjectKey: nameKey(state, view.turn), params: { left: view.left } }
  }
  let remaining: DuelLine | null = null
  if (view.phase === 'turn') {
    const left = remainingShells(view)
    remaining = {
      key: left.approx ? 'buckshot.remaining.inverted' : 'buckshot.remaining.exact',
      params: { live: left.live, blank: left.blank },
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
    remaining,
    tags,
    sawn: view.saw,
    log: buildLog(state, view),
  }
}

export function buildStats(state: BuckshotState): StatView[] {
  const duel = duelOf(state)
  if (state.difficulty === 'endless') {
    return [
      { labelKey: 'buckshot.stat.round', value: String(duel.round + 1) },
      { labelKey: 'buckshot.stat.cleared', value: String(duel.roundWins[0]) },
    ]
  }
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

function buildResult(state: BuckshotState, status: GameStatus): NonNullable<GameView['result']> {
  const duel = duelOf(state)
  if (state.difficulty === 'endless') {
    return {
      titleKey: 'buckshot.endless.over',
      details: [{ key: 'buckshot.result.endless', params: { count: duel.roundWins[0], round: duel.round + 1 } }],
    }
  }
  let titleKey: string
  if (modeOf(state.difficulty) === 'hotseat') titleKey = duel.winner === 0 ? 'buckshot.won.p1' : 'buckshot.won.p2'
  else titleKey = status === 'won' ? 'buckshot.won.title' : 'buckshot.lost.title'
  return {
    titleKey,
    details: [{ key: 'buckshot.result.rounds', params: { count: duel.roundWins[0], other: duel.roundWins[1] } }],
  }
}

export function buildView(state: BuckshotState): GameView {
  const status = statusOf(state)
  let result: GameView['result'] = null
  if (status !== 'playing') result = buildResult(state, status)
  return {
    board: null,
    duel: buildDuel(state),
    stats: buildStats(state),
    result,
    notice: null,
  }
}
