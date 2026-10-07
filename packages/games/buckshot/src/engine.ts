/**
 * 恶魔轮盘赌的对局引擎：**按座位驱动的纯状态机**（0 号位在下方，1 号位在上方）。
 *
 * 它只认「哪个座位、做了什么」（Move），不知道对面是恶魔（电脑）还是同屏的另一个人 ——
 * 单机对恶魔、双人同屏两种模式共用这一份规则；联机时也可以原样搬到主机上。
 *
 * 一场比赛 3 轮，血量 2 → 4 → 6 格。每轮由若干次「装填」组成：
 *   装填：随机 2～8 发（随轮数变多），实弹 / 空包弹至少各 1 发，公开数量后打乱顺序；
 *         第 2 轮起每次装填双方各得 2 / 4 件道具（最多存 8 件）。
 *   回合：轮到的人可以先用任意件道具，再选择对自己或对对方开枪 ——
 *         实弹扣血（手锯让这一枪 ×2）；对自己打出空包弹可以继续行动，其余情况换人；
 *         被手铐铐住的人跳过下一回合。枪打空就重新装填（回合归属不变）。
 *   一方血量归零，这一轮结束。
 *   对恶魔：三轮都赢才算通关，输掉任何一轮即失败；双人同屏：三局两胜；
 *   无尽（endless）：对恶魔一轮接一轮，输掉一轮才结束；第 3 轮之后都按第 3 轮的设定（6 血、每次 4 件道具），成绩是赢下的轮数。
 *
 * 道具（8 种）：放大镜（看当前这一发）、香烟（+1 血）、啤酒（退掉当前这一发）、手铐（对方跳过下一回合）、
 *   手锯（下一枪伤害 ×2）、手机（随机得知后面某一发）、逆转器（当前这一发实弹 / 空包互换）、
 *   过期药（一半概率 +2 血，一半概率 −1 血）。
 *
 * 放大镜 / 手机的结果只有使用者知道（knowledge），座位视角（observe.ts）据此裁剪。
 * 随机性全部来自 createRng(seed + 计数)，同一份日志永远复算出同一个局面。
 */
import { IllegalActionError, createRng } from '@eink/core'

export const GAME_ID = 'buckshot'
export type Seat = 0 | 1
export const SEATS: readonly Seat[] = [0, 1]
export type Mode = 'vs' | 'hotseat' | 'endless'

export const ITEM_IDS = [
  'magnifier',
  'cigarettes',
  'beer',
  'handcuffs',
  'saw',
  'phone',
  'inverter',
  'medicine',
  'adrenaline',
] as const
export type ItemId = (typeof ITEM_IDS)[number]

export const ROUND_COUNT = 3
export const MAX_HP_BY_ROUND: readonly number[] = [2, 4, 6]
export const ITEMS_PER_LOAD_BY_ROUND: readonly number[] = [0, 2, 4]
export const MAX_ITEMS = 8
/** 每轮装填的弹数范围（含两端） */
export const SHELLS_BY_ROUND: ReadonlyArray<readonly [number, number]> = [
  [2, 4],
  [3, 6],
  [4, 8],
]

/** 第几轮用哪一档设定：无尽模式第 3 轮之后一直沿用最后一档 */
export function roundTier(round: number): number {
  return Math.min(round, ROUND_COUNT - 1)
}

export type Move =
  | { kind: 'begin' }
  | { kind: 'item'; slot: number }
  | { kind: 'steal'; slot: number }
  | { kind: 'shoot'; target: 'self' | 'opponent' }
  | { kind: 'nextRound' }

export interface LoggedMove {
  seat: Seat
  move: Move
}

/** 发生过的事（界面的「最近」记录）；带 privateTo 的只有那个座位看得到 */
export type DuelEvent =
  | { type: 'load'; total: number; live: number; blank: number }
  | { type: 'shoot'; shooter: Seat; target: Seat; live: boolean; damage: number }
  | { type: 'item'; user: Seat; item: ItemId }
  /** 用肾上腺素抢走对手一件道具（随后紧跟这件道具自己的效果事件） */
  | { type: 'steal'; user: Seat; item: ItemId }
  | { type: 'peek'; user: Seat; offset: number; live: boolean | null; privateTo: Seat }
  | { type: 'eject'; user: Seat; live: boolean }
  | { type: 'heal'; user: Seat; amount: number }
  | { type: 'hurt'; user: Seat; amount: number }
  | { type: 'skip'; seat: Seat }
  | { type: 'round'; winner: Seat; round: number }

export type Phase = 'load' | 'turn' | 'roundOver' | 'matchOver'

export interface SpentShell {
  live: boolean
  by: 'shot' | 'beer'
  flipped: boolean
}

export interface DuelState {
  mode: Mode
  seed: number
  phase: Phase
  /** 第几轮（0..2） */
  round: number
  roundWins: [number, number]
  maxHp: number
  hp: [number, number]
  /** 这一管弹的完整顺序（true = 实弹）；pos 之前的已经打出 / 退出 */
  load: boolean[]
  pos: number
  /** 装填时公开的数量 */
  loadLive: number
  loadBlank: number
  /** 这一管里打出 / 退出过的弹（公开）；flipped = 它在打出前被逆转过（奇数次），原本是另一种 */
  spent: SpentShell[]
  /** 当前这一发被逆转过（奇数次，公开）：它的实空与装填时的身份相反；换下一发时清掉 */
  inverted: boolean
  items: [ItemId[], ItemId[]]
  /** 最近一次装填各自新拿到几件（界面标「新」） */
  fresh: [number, number]
  turn: Seat
  /** 当前行动者的下一枪伤害 ×2 */
  saw: boolean
  /** 被铐住、会跳过下一回合的座位 */
  cuffed: [boolean, boolean]
  /** 各座位知道的弹（按这一管里的位置）：true 实弹 / false 空包 / null 不知道 */
  known: [Array<boolean | null>, Array<boolean | null>]
  /** 全部装填次数（发弹与发道具的随机种子用） */
  loadNo: number
  /** 已执行的动作数（过期药 / 手机的随机种子用） */
  steps: number
  events: DuelEvent[]
  /** 本轮 / 本场的胜者 */
  winner: Seat | null
}

export function opponent(seat: Seat): Seat {
  return seat === 0 ? 1 : 0
}

function illegal(reason: string): never {
  throw new IllegalActionError(GAME_ID, reason)
}

function pair<T>(tuple: readonly [T, T], seat: Seat, value: T): [T, T] {
  const out = [...tuple] as [T, T]
  out[seat] = value
  return out
}

function rngFor(seed: number, salt: number, counter: number) {
  return createRng((seed ^ Math.imul(salt, 0x9e3779b1) ^ Math.imul(counter + 1, 0x85ebca6b)) >>> 0)
}

/** 新装一管弹（并按轮数发道具）；回合归属不变 */
function reload(state: DuelState): DuelState {
  const rng = rngFor(state.seed, 0x51ed, state.loadNo)
  const [lo, hi] = SHELLS_BY_ROUND[roundTier(state.round)]!
  const total = lo + rng.int(hi - lo + 1)
  /*
   * 实弹/空包**尽量对半**：两者数量最多相差 1（原版规则）。
   *
   * 原来写的是 `live = 1 + rng.int(total - 1)`（1…total−1 均匀）——
   * 管长 4 发时有 2/3 的局面是 1实3空 或 3实1空，8 发时甚至能出 1实7空，
   * 与原版「先对半分、奇数才抛硬币决定哪边多一枚」的配比不符，也让局面极端化。
   */
  const half = Math.floor(total / 2)
  const live = total % 2 === 0 ? half : half + rng.int(2)
  const load = rng.shuffle([...Array<boolean>(live).fill(true), ...Array<boolean>(total - live).fill(false)])
  const perLoad = ITEMS_PER_LOAD_BY_ROUND[roundTier(state.round)]!
  const items = [...state.items] as [ItemId[], ItemId[]]
  const fresh: [number, number] = [0, 0]
  for (const seat of SEATS) {
    const room = Math.max(0, MAX_ITEMS - items[seat].length)
    const gained = Array.from({ length: Math.min(perLoad, room) }, () => rng.pick(ITEM_IDS))
    items[seat] = [...items[seat], ...gained]
    fresh[seat] = gained.length
  }
  return {
    ...state,
    phase: 'load',
    load,
    pos: 0,
    loadLive: live,
    loadBlank: total - live,
    spent: [],
    inverted: false,
    items,
    fresh,
    saw: false,
    known: [Array<boolean | null>(total).fill(null), Array<boolean | null>(total).fill(null)],
    loadNo: state.loadNo + 1,
    events: [...state.events, { type: 'load', total, live, blank: total - live }],
  }
}

function startRound(state: DuelState, round: number): DuelState {
  const maxHp = MAX_HP_BY_ROUND[roundTier(round)]!
  return reload({
    ...state,
    round,
    maxHp,
    hp: [maxHp, maxHp],
    items: [[], []],
    turn: 0,
    saw: false,
    cuffed: [false, false],
    winner: null,
  })
}

export function startDuel(seed: number, mode: Mode): DuelState {
  return startRound(
    {
      mode,
      seed: seed >>> 0,
      phase: 'load',
      round: 0,
      roundWins: [0, 0],
      maxHp: 0,
      hp: [0, 0],
      load: [],
      pos: 0,
      loadLive: 0,
      loadBlank: 0,
      spent: [],
      inverted: false,
      items: [[], []],
      fresh: [0, 0],
      turn: 0,
      saw: false,
      cuffed: [false, false],
      known: [[], []],
      loadNo: 0,
      steps: 0,
      events: [],
      winner: null,
    },
    0,
  )
}

/** 这一管还剩几发 */
export function shellsLeft(state: DuelState): number {
  return state.load.length - state.pos
}

/** 有人血量归零：结束这一轮，并判断整场是否结束 */
function endRound(state: DuelState, winner: Seat): DuelState {
  const roundWins = pair(state.roundWins, winner, state.roundWins[winner] + 1)
  const events: DuelEvent[] = [...state.events, { type: 'round', winner, round: state.round }]
  let matchWinner: Seat | null = null
  if (state.mode === 'vs') {
    // 对恶魔：输掉任何一轮即失败，三轮全赢才算通关
    if (winner === 1) matchWinner = 1
    else if (roundWins[0] >= ROUND_COUNT) matchWinner = 0
  } else if (state.mode === 'endless') {
    // 无尽：只有输掉一轮才结束
    if (winner === 1) matchWinner = 1
  } else {
    // 双人同屏：三局两胜
    if (roundWins[winner] >= Math.ceil(ROUND_COUNT / 2)) matchWinner = winner
  }
  return {
    ...state,
    roundWins,
    events,
    winner: matchWinner ?? winner,
    phase: matchWinner !== null ? 'matchOver' : 'roundOver',
  }
}

/** 换人：被铐住的人跳过一回合（手铐随即失效） */
function passTurn(state: DuelState, from: Seat): DuelState {
  const next = opponent(from)
  if (state.cuffed[next]) {
    return {
      ...state,
      turn: from,
      cuffed: pair(state.cuffed, next, false),
      events: [...state.events, { type: 'skip', seat: next }],
    }
  }
  return { ...state, turn: next }
}

/**
 * 道具效果本体：不区分这件道具本来就在自己手里，还是用肾上腺素抢来的。
 * 传入的 state 里**已经**带好了「用了哪件道具」的事件，效果事件由这里追加。
 */
function applyItemEffect(state: DuelState, seat: Seat, item: ItemId): DuelState {
  const other = opponent(seat)
  let next: DuelState = state
  const cur = state.pos
  const rng = rngFor(state.seed, 0x1735, state.steps)

  switch (item) {
    case 'magnifier': {
      const known = pair(next.known, seat, next.known[seat].map((v, i) => (i === cur ? state.load[cur]! : v)))
      next = {
        ...next,
        known,
        events: [...next.events, { type: 'peek', user: seat, offset: 1, live: state.load[cur]!, privateTo: seat }],
      }
      break
    }
    case 'cigarettes': {
      const healed = Math.min(state.maxHp, state.hp[seat] + 1)
      next = {
        ...next,
        hp: pair(next.hp, seat, healed),
        events: [...next.events, { type: 'heal', user: seat, amount: healed - state.hp[seat] }],
      }
      break
    }
    case 'beer': {
      const live = state.load[cur]!
      next = {
        ...next,
        pos: cur + 1,
        inverted: false,
        spent: [...next.spent, { live, by: 'beer', flipped: state.inverted }],
        events: [...next.events, { type: 'eject', user: seat, live }],
      }
      if (shellsLeft(next) === 0) next = reload(next)
      break
    }
    case 'handcuffs': {
      if (state.cuffed[other]) illegal('the opponent is already cuffed')
      next = { ...next, cuffed: pair(next.cuffed, other, true) }
      break
    }
    case 'saw': {
      if (state.saw) illegal('the barrel is already sawn off')
      next = { ...next, saw: true }
      break
    }
    case 'phone': {
      // 随机得知后面（不含当前这一发）的某一发；只剩当前这一发时没有信息
      const future = state.load.length - cur - 1
      if (future <= 0) {
        next = { ...next, events: [...next.events, { type: 'peek', user: seat, offset: 0, live: null, privateTo: seat }] }
        break
      }
      const index = cur + 1 + rng.int(future)
      const known = pair(next.known, seat, next.known[seat].map((v, i) => (i === index ? state.load[index]! : v)))
      next = {
        ...next,
        known,
        events: [
          ...next.events,
          { type: 'peek', user: seat, offset: index - cur + 1, live: state.load[index]!, privateTo: seat },
        ],
      }
      break
    }
    case 'inverter': {
      const load = state.load.map((v, i) => (i === cur ? !v : v))
      // 逆转是公开的：谁原本知道这一发，现在也知道它被翻过来了
      const known = next.known.map((row) => row.map((v, i) => (i === cur && v !== null ? !v : v))) as DuelState['known']
      next = { ...next, load, known, inverted: !state.inverted }
      break
    }
    case 'medicine': {
      if (rng.next() < 0.5) {
        const healed = Math.min(state.maxHp, state.hp[seat] + 2)
        next = {
          ...next,
          hp: pair(next.hp, seat, healed),
          events: [...next.events, { type: 'heal', user: seat, amount: healed - state.hp[seat] }],
        }
      } else {
        const hp = Math.max(0, state.hp[seat] - 1)
        next = { ...next, hp: pair(next.hp, seat, hp), events: [...next.events, { type: 'hurt', user: seat, amount: 1 }] }
        if (hp === 0) next = endRound(next, other)
      }
      break
    }
  }
  return next
}

/**
 * 肾上腺素能不能抢对手这一格：**效果用得上才算**（枪管已经锯过就不能再抢锯子、
 * 对手已经铐住就不能再抢手铐），也不能抢肾上腺素本身（否则可以无限连锁）。
 * 界面可选项、AI 决策、stealItem 校验共用这一处判据。
 */
export function canSteal(state: DuelState, seat: Seat, slot: number): boolean {
  if (state.phase !== 'turn' || state.turn !== seat) return false
  if (!state.items[seat].includes('adrenaline')) return false
  const other = opponent(seat)
  const item = state.items[other][slot]
  if (item === undefined || item === 'adrenaline') return false
  if (item === 'saw' && state.saw) return false
  if (item === 'handcuffs' && state.cuffed[other]) return false
  return true
}

/** 这一方用肾上腺素能抢的对手道具下标（界面可选项、AI、合法动作共用） */
export function stealTargets(state: DuelState, seat: Seat): number[] {
  return state.items[opponent(seat)].map((_, slot) => slot).filter((slot) => canSteal(state, seat, slot))
}

function useItem(state: DuelState, seat: Seat, slot: number): DuelState {
  const owned = state.items[seat]
  if (!Number.isInteger(slot) || slot < 0 || slot >= owned.length) illegal('no item in that slot')
  const item = owned[slot]!
  if (item === 'adrenaline') illegal('adrenaline must name a target item')
  const items = pair(state.items, seat, owned.filter((_, index) => index !== slot))
  const withEvent: DuelState = { ...state, items, events: [...state.events, { type: 'item', user: seat, item }] }
  return applyItemEffect(withEvent, seat, item)
}

/** 肾上腺素：抢对手一件道具并立刻用掉（自己那件肾上腺素消耗掉） */
function stealItem(state: DuelState, seat: Seat, slot: number): DuelState {
  if (!canSteal(state, seat, slot)) illegal('cannot steal that item')
  const mine = state.items[seat]
  const own = mine.indexOf('adrenaline')
  const other = opponent(seat)
  const theirs = state.items[other]
  const stolen = theirs[slot]!
  const items = pair(
    pair(state.items, seat, mine.filter((_, index) => index !== own)),
    other,
    theirs.filter((_, index) => index !== slot),
  )
  const withEvent: DuelState = { ...state, items, events: [...state.events, { type: 'steal', user: seat, item: stolen }] }
  return applyItemEffect(withEvent, seat, stolen)
}

function shoot(state: DuelState, seat: Seat, at: 'self' | 'opponent'): DuelState {
  const target = at === 'self' ? seat : opponent(seat)
  const live = state.load[state.pos]!
  const damage = live ? (state.saw ? 2 : 1) : 0
  const hp = pair(state.hp, target, Math.max(0, state.hp[target] - damage))
  let next: DuelState = {
    ...state,
    hp,
    pos: state.pos + 1,
    saw: false,
    inverted: false,
    spent: [...state.spent, { live, by: 'shot', flipped: state.inverted }],
    events: [...state.events, { type: 'shoot', shooter: seat, target, live, damage }],
  }
  if (hp[target] === 0) return endRound(next, opponent(target))
  // 对自己打出空包弹：继续行动；其余情况换人
  if (!(target === seat && !live)) next = passTurn(next, seat)
  if (shellsLeft(next) === 0) next = reload(next)
  return next
}

/** 校验并执行一个座位的动作；非法（不是你的回合 / 没有这件道具 / 阶段不对）抛 IllegalActionError */
export function applyMove(state: DuelState, seat: Seat, move: Move): DuelState {
  let next: DuelState
  switch (move?.kind) {
    case 'begin':
      if (state.phase !== 'load') illegal('nothing to begin')
      next = { ...state, phase: 'turn' }
      break
    case 'nextRound':
      if (state.phase !== 'roundOver') illegal('the round is not over')
      next = startRound(state, state.round + 1)
      break
    case 'item':
      if (state.phase !== 'turn') illegal('items can only be used on your turn')
      if (seat !== state.turn) illegal(`not seat ${seat}'s turn`)
      next = useItem(state, seat, move.slot)
      break
    case 'steal':
      if (state.phase !== 'turn') illegal('items can only be used on your turn')
      if (seat !== state.turn) illegal(`not seat ${seat}'s turn`)
      next = stealItem(state, seat, move.slot)
      break
    case 'shoot':
      if (state.phase !== 'turn') illegal('nothing to shoot yet')
      if (seat !== state.turn) illegal(`not seat ${seat}'s turn`)
      if (move.target !== 'self' && move.target !== 'opponent') illegal('bad target')
      next = shoot(state, seat, move.target)
      break
    default:
      illegal('unknown move')
  }
  return { ...next, steps: state.steps + 1 }
}

export function replayDuel(seed: number, mode: Mode, log: readonly LoggedMove[]): DuelState {
  let state = startDuel(seed, mode)
  for (const entry of log) state = applyMove(state, entry.seat, entry.move)
  return state
}
