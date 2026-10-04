/**
 * 单机斗地主的游戏状态（GameDef 层）：真人坐 0 号位，1、2 号位是电脑。
 *
 * 状态里**不存牌面**：局面永远由 (seed, dealNo, log) 复算（table.ts 的 replayTable），
 * 存档因此天然可重放，decode 也能逐步校验（handover 的硬要求：decode 必须是重放式）。
 *
 * 真人与电脑都翻译成座位动作（Move）再交给牌局引擎：
 *   - 真人：叫分 / 出牌 / 不出 → 0 号位的 Move；点牌、重选、提示只改本地的选中状态，不进日志；
 *   - 电脑：轮到 1、2 号位时 tickMs 返回间隔，壳层到点派发 { type: 'tick' }，
 *     这里用电脑自己的座位视角（observe）做决定 —— 规则层依旧零时间引用。
 * 联机时把「电脑」换成「远端」即可（见 net/），这一层的真人路径不变。
 */
import { IllegalActionError, createRng, type GameStatus } from '@eink/core'
import { isCardId, sortForDisplay, type CardId } from './cards.js'
import { beatingPlays, classify, decompose, type Pattern } from './patterns.js'
import { decideMove, type DifficultyId } from './ai.js'
import { observe } from './observe.js'
import {
  GAME_ID,
  SEATS,
  applyMove,
  replayTable,
  sameSide,
  settlement,
  type LoggedMove,
  type Move,
  type Seat,
  type TableState,
} from './table.js'

export { GAME_ID }
export type { DifficultyId }

export const RULES_VERSION = 1
export const CONTENT_VERSION = 1
export const HUMAN_SEAT: Seat = 0
export const START_SCORE = 1000
/** 电脑每一手的间隔：墨水屏上看得清谁出了什么（≥ MIN_TICK_MS） */
export const BOT_DELAY_MS = 900
export const DIFFICULTY_IDS: readonly DifficultyId[] = ['starter', 'skilled', 'challenging']

/** 规则层可能给出的提示文案（状态里只存 key） */
export const NOTICE_KEYS = ['doudizhu.notice.redeal', 'doudizhu.notice.noBeat'] as const
export type NoticeKey = (typeof NOTICE_KEYS)[number]

export interface DoudizhuState {
  difficulty: DifficultyId
  seed: number
  /** 这份存档里第几次发牌（重新发牌、下一局都 +1）；牌面由 (seed, dealNo) 复算 */
  dealNo: number
  /** 已经打完的局数 */
  round: number
  /** 三家积分（零和：总数恒为 3 × START_SCORE） */
  scores: [number, number, number]
  /** 本副牌的动作日志 */
  log: LoggedMove[]
  /** 真人当前选中的牌（理牌顺序） */
  selected: CardId[]
  /** 「提示」循环到第几个方案（-1 = 还没按过） */
  hint: number
  notice: NoticeKey | null
}

export type DoudizhuAction =
  | { type: 'bid'; value: 0 | 1 | 2 | 3 }
  | { type: 'toggle'; card: CardId }
  | { type: 'clear' }
  | { type: 'hint' }
  | { type: 'play' }
  | { type: 'pass' }
  | { type: 'tick' }
  | { type: 'nextLevel' }

function illegal(reason: string): never {
  throw new IllegalActionError(GAME_ID, reason)
}

export function isDifficulty(value: unknown): value is DifficultyId {
  return typeof value === 'string' && (DIFFICULTY_IDS as readonly string[]).includes(value)
}

export function createState(seed: number, difficulty: string): DoudizhuState {
  if (!isDifficulty(difficulty)) illegal(`unknown difficulty ${difficulty}`)
  return {
    difficulty,
    seed: seed >>> 0,
    dealNo: 0,
    round: 0,
    scores: [START_SCORE, START_SCORE, START_SCORE],
    log: [],
    selected: [],
    hint: -1,
    notice: null,
  }
}

/** 复算当前牌局（同一份日志只算一次：view / status / controls / tickMs 都会来问） */
const tableCache = new WeakMap<readonly LoggedMove[], { seed: number; dealNo: number; table: TableState }>()
export function tableOf(state: DoudizhuState): TableState {
  const hit = tableCache.get(state.log)
  if (hit && hit.seed === state.seed && hit.dealNo === state.dealNo) return hit.table
  const table = replayTable(state.seed, state.dealNo, state.log)
  tableCache.set(state.log, { seed: state.seed, dealNo: state.dealNo, table })
  return table
}

/** 电脑做决定用的随机源：只由局面决定（同一局面同一结果） */
function botRng(state: DoudizhuState) {
  return createRng((state.seed ^ Math.imul(state.dealNo + 1, 0x85ebca6b) ^ Math.imul(state.log.length + 1, 0xc2b2ae35)) >>> 0)
}

/** 领出时「提示」给的方案：能一手出完就整手，否则按拆牌结果（小的、能多走几张的在前） */
export function leadOptions(hand: readonly CardId[]): Pattern[] {
  const whole = classify(hand)
  if (whole) return [whole]
  const groups = decompose(hand)
  const score = (g: Pattern): number =>
    (g.type === 'bomb' || g.type === 'rocket' ? 100 : 0) + g.main - (g.cards.length >= 5 ? 2.5 : g.cards.length >= 3 ? 1 : 0)
  return [...groups].sort((a, b) => score(a) - score(b) || a.main - b.main)
}

/** 轮到真人出牌时「提示」可循环的方案 */
export function hintOptions(table: TableState): Pattern[] {
  const hand = table.hands[HUMAN_SEAT]
  if (!table.top) return leadOptions(hand)
  return beatingPlays(hand, table.top.pattern)
}

function humanTurn(table: TableState): boolean {
  return (table.phase === 'bidding' || table.phase === 'playing') && table.turn === HUMAN_SEAT
}

/** 把一个座位动作交给牌局引擎，并处理「都不叫重新发牌」「一副牌打完记分」 */
function commit(state: DoudizhuState, table: TableState, entry: LoggedMove): DoudizhuState {
  const next = applyMove(table, entry.seat, entry.move)
  if (next.phase === 'redeal') {
    return { ...state, dealNo: state.dealNo + 1, log: [], selected: [], hint: -1, notice: 'doudizhu.notice.redeal' }
  }
  const log = [...state.log, entry]
  tableCache.set(log, { seed: state.seed, dealNo: state.dealNo, table: next })
  const hand = next.hands[HUMAN_SEAT]
  const selected = entry.seat === HUMAN_SEAT ? [] : state.selected.filter((card) => hand.includes(card))
  let scores = state.scores
  if (next.phase === 'over') {
    const delta = settlement(next)
    scores = [scores[0] + delta[0], scores[1] + delta[1], scores[2] + delta[2]]
  }
  return { ...state, log, selected, scores, hint: entry.seat === HUMAN_SEAT ? -1 : state.hint, notice: null }
}

export function reduceState(state: DoudizhuState, action: DoudizhuAction): DoudizhuState {
  const table = tableOf(state)
  switch (action?.type) {
    case 'bid': {
      if (table.phase !== 'bidding' || !humanTurn(table)) illegal('not your bid')
      return commit(state, table, { seat: HUMAN_SEAT, move: { kind: 'bid', value: action.value } })
    }
    case 'toggle': {
      // 叫分阶段也允许先选牌（只是本地选中，不进日志）；打完之后不再能选
      if (table.phase !== 'playing' && table.phase !== 'bidding') illegal('the deal is finished')
      if (!isCardId(action.card) || !table.hands[HUMAN_SEAT].includes(action.card)) illegal('card not in hand')
      const selected = state.selected.includes(action.card)
        ? state.selected.filter((card) => card !== action.card)
        : sortForDisplay([...state.selected, action.card])
      return { ...state, selected, hint: -1, notice: null }
    }
    case 'clear': {
      if (state.selected.length === 0) illegal('nothing selected')
      return { ...state, selected: [], hint: -1, notice: null }
    }
    case 'hint': {
      if (table.phase !== 'playing' || !humanTurn(table)) illegal('not your turn')
      const options = hintOptions(table)
      if (options.length === 0) return { ...state, selected: [], hint: -1, notice: 'doudizhu.notice.noBeat' }
      const index = (state.hint + 1) % options.length
      return { ...state, selected: sortForDisplay(options[index]!.cards), hint: index, notice: null }
    }
    case 'play': {
      if (table.phase !== 'playing' || !humanTurn(table)) illegal('not your turn')
      if (state.selected.length === 0) illegal('nothing selected')
      return commit(state, table, { seat: HUMAN_SEAT, move: { kind: 'play', cards: [...state.selected] } })
    }
    case 'pass': {
      if (table.phase !== 'playing' || !humanTurn(table)) illegal('not your turn')
      return commit(state, table, { seat: HUMAN_SEAT, move: { kind: 'pass' } })
    }
    case 'tick': {
      if ((table.phase !== 'bidding' && table.phase !== 'playing') || table.turn === HUMAN_SEAT) {
        illegal('no bot is due to act')
      }
      const move = decideMove(observe(table, table.turn), state.difficulty, botRng(state))
      return commit(state, table, { seat: table.turn, move })
    }
    case 'nextLevel': {
      if (table.phase !== 'over') illegal('the deal is not finished')
      return {
        ...state,
        dealNo: state.dealNo + 1,
        round: state.round + 1,
        log: [],
        selected: [],
        hint: -1,
        notice: null,
      }
    }
    default:
      illegal(`unknown action ${JSON.stringify(action)}`)
  }
}

export function statusOf(state: DoudizhuState): GameStatus {
  const table = tableOf(state)
  if (table.phase !== 'over' || table.winner === null) return 'playing'
  return sameSide(table, table.winner, HUMAN_SEAT) ? 'won' : 'lost'
}

export function tickMsOf(state: DoudizhuState): number | null {
  const table = tableOf(state)
  if (table.phase !== 'bidding' && table.phase !== 'playing') return null
  return table.turn === HUMAN_SEAT ? null : BOT_DELAY_MS
}

export function legalActions(state: DoudizhuState): DoudizhuAction[] {
  const table = tableOf(state)
  if (table.phase === 'over') return [{ type: 'nextLevel' }]
  const toggles: DoudizhuAction[] = table.hands[HUMAN_SEAT].map((card) => ({ type: 'toggle', card }))
  if (state.selected.length > 0) toggles.push({ type: 'clear' })
  if (!humanTurn(table)) return [{ type: 'tick' }, ...toggles]
  if (table.phase === 'bidding') {
    const bids: DoudizhuAction[] = ([0, 1, 2, 3] as const)
      .filter((value) => value === 0 || value > table.highestBid)
      .map((value) => ({ type: 'bid', value }))
    return [...bids, ...toggles]
  }
  const out: DoudizhuAction[] = [...toggles, { type: 'hint' }]
  if (state.selected.length > 0) out.push({ type: 'play' })
  if (table.top && table.top.seat !== HUMAN_SEAT) out.push({ type: 'pass' })
  return out
}

/* ------------------------------------------------------------------ 存档 */

export function encodeState(state: DoudizhuState): unknown {
  return {
    difficulty: state.difficulty,
    seed: state.seed,
    dealNo: state.dealNo,
    round: state.round,
    scores: [...state.scores],
    log: state.log.map((entry) => ({ seat: entry.seat, move: { ...entry.move } })),
    selected: [...state.selected],
    hint: state.hint,
    notice: state.notice,
  }
}

function readCount(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) illegal(`bad ${name}`)
  return value
}

function readMove(raw: unknown): Move {
  if (!raw || typeof raw !== 'object') illegal('bad move')
  const move = raw as { kind?: unknown; value?: unknown; cards?: unknown }
  if (move.kind === 'pass') return { kind: 'pass' }
  if (move.kind === 'bid') {
    if (move.value !== 0 && move.value !== 1 && move.value !== 2 && move.value !== 3) illegal('bad bid')
    return { kind: 'bid', value: move.value }
  }
  if (move.kind === 'play') {
    if (!Array.isArray(move.cards) || !move.cards.every(isCardId)) illegal('bad cards')
    return { kind: 'play', cards: [...move.cards] }
  }
  illegal('bad move kind')
}

/**
 * 严格解码（重放式）：结构逐字段校验，再把日志交给牌局引擎从发牌开始重放 ——
 * 任何一步不合法（不是该座位的回合、牌不在手里、压不过…）都会抛错，被当作存档损坏保留原档。
 */
export function decodeState(raw: unknown): DoudizhuState {
  if (!raw || typeof raw !== 'object') illegal('bad state')
  const value = raw as Record<string, unknown>
  if (!isDifficulty(value.difficulty)) illegal('bad difficulty')
  const seed = readCount(value.seed, 'seed')
  if (seed > 0xffffffff) illegal('bad seed')
  const dealNo = readCount(value.dealNo, 'dealNo')
  const round = readCount(value.round, 'round')
  if (round > dealNo) illegal('round ahead of deals')
  if (!Array.isArray(value.scores) || value.scores.length !== 3) illegal('bad scores')
  const scores = value.scores.map((score) => {
    if (typeof score !== 'number' || !Number.isInteger(score)) illegal('bad score')
    return score
  }) as [number, number, number]
  if (scores[0] + scores[1] + scores[2] !== START_SCORE * 3) illegal('scores must sum to the starting total')
  if (!Array.isArray(value.log)) illegal('bad log')
  const log: LoggedMove[] = value.log.map((entry) => {
    if (!entry || typeof entry !== 'object') illegal('bad log entry')
    const seat = (entry as { seat?: unknown }).seat
    if (!SEATS.includes(seat as Seat)) illegal('bad seat')
    return { seat: seat as Seat, move: readMove((entry as { move?: unknown }).move) }
  })
  const table = replayTable(seed, dealNo, log) // 非法步骤在这里抛错
  if (table.phase === 'redeal') illegal('a redeal is never stored')
  if (!Array.isArray(value.selected) || !value.selected.every(isCardId)) illegal('bad selection')
  const selected = value.selected as CardId[]
  if (new Set(selected).size !== selected.length || !selected.every((card) => table.hands[HUMAN_SEAT].includes(card))) {
    illegal('selection must be cards in hand')
  }
  const hint = value.hint
  if (typeof hint !== 'number' || !Number.isInteger(hint) || hint < -1) illegal('bad hint')
  const notice = value.notice
  if (notice !== null && !(NOTICE_KEYS as readonly unknown[]).includes(notice)) illegal('bad notice')
  return {
    difficulty: value.difficulty,
    seed,
    dealNo,
    round,
    scores,
    log,
    selected: [...selected],
    hint,
    notice: notice as NoticeKey | null,
  }
}
