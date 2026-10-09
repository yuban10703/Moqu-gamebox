/**
 * 测试用的小工具：造牌、摆牌局、找出一步合法移动。
 *
 * 为什么需要「手搓牌局」：空当接龙的局面完全由 (seed, dealNo, log) 复算，
 * 而红黑交替、同花升序、空列只收 K 这些形状在真发牌里要凑出来得先赢一百局 ——
 * 所以规则测试直接把 TableState 摆成想测的形状，再调 applyMove / moveError。
 * 这些函数只在测试里用，不进 src/。
 */
import { CARD_COUNT, FOUNDATION_COUNT, TABLEAU_COUNT, WASTE, foundation, tableau, type CardId } from '../src/cards.js'
import {
  drawCountOf,
  moveError,
  replayTable,
  tableOf,
  type DifficultyId,
  type KlondikeState,
  type Move,
  type TableState,
} from '../src/engine.js'

/** 花色序号：与 cards.SUITS 一致（0 黑桃、1 红桃、2 梅花、3 方块） */
export const SPADE = 0
export const HEART = 1
export const CLUB = 2
export const DIAMOND = 3

/** 造一张牌：rank 1..13（1 = A、11 = J、12 = Q、13 = K） */
export function card(rank: number, suitIndex: number): CardId {
  return (rank - 1) * 4 + suitIndex
}

export function column(cards: readonly CardId[], faceDown = 0): { cards: CardId[]; faceDown: number } {
  return { cards: [...cards], faceDown }
}

/** 空牌局：默认 4 个空基础堆、7 个空列、空抽牌堆（给的列少时补足到 7 列） */
export function emptyTable(overrides: Partial<TableState> = {}): TableState {
  const table: TableState = {
    stock: [],
    waste: [],
    foundations: Array.from({ length: FOUNDATION_COUNT }, () => []),
    tableau: Array.from({ length: TABLEAU_COUNT }, () => column([])),
    drawCount: 1,
    ...overrides,
  }
  return {
    ...table,
    tableau: Array.from({ length: TABLEAU_COUNT }, (_, index) => table.tableau[index] ?? column([])),
  }
}

/** 某一局的真实发牌局面（日志为空） */
export function freshTable(seed: number, difficulty: DifficultyId = 'starter'): TableState {
  return replayTable(seed, 0, drawCountOf(difficulty), [])
}

export function freshState(seed: number, difficulty: DifficultyId = 'starter'): KlondikeState {
  return { difficulty, seed: seed >>> 0, dealNo: 0, log: [], selected: null }
}

/** 桌上现有的全部牌（按牌堆顺序，不做排序）：用来断言「52 张不多不少、没重复」 */
export function allCards(table: TableState): CardId[] {
  const out: CardId[] = [...table.stock, ...table.waste]
  for (const pile of table.foundations) out.push(...pile)
  for (const pile of table.tableau) out.push(...pile.cards)
  return out
}

export const ALL_CARD_IDS: readonly CardId[] = Array.from({ length: CARD_COUNT }, (_, id) => id)

/** 找出一步合法移动（先看弃牌堆、再从左到右各列；目标先基础堆、再从左到右各列） */
export function findMove(table: TableState, options: { toFoundation?: boolean; toColumn?: boolean } = {}): Move | null {
  const toFoundation = options.toFoundation ?? true
  const toColumn = options.toColumn ?? true
  const sources = []
  if (table.waste.length > 0) sources.push(WASTE)
  for (let index = 0; index < TABLEAU_COUNT; index++) sources.push(tableau(index))
  for (const from of sources) {
    for (let count = 1; count <= 13; count++) {
      if (toFoundation) {
        for (let index = 0; index < FOUNDATION_COUNT; index++) {
          const to = foundation(index)
          if (moveError(table, from, to, count) === null) return { kind: 'move', from, to, count }
        }
      }
      if (toColumn) {
        for (let index = 0; index < TABLEAU_COUNT; index++) {
          const to = tableau(index)
          if (from.zone === 'tableau' && from.index === index) continue
          if (moveError(table, from, to, count) === null) return { kind: 'move', from, to, count }
        }
      }
    }
  }
  return null
}

/** 找到一步「把一段两张以上的明牌序列搬到另一列」的走法（序列整段移动的测试要用它） */
export function findRunMove(table: TableState): { from: number; start: number; to: number; count: number } | null {
  for (let from = 0; from < TABLEAU_COUNT; from++) {
    const pile = table.tableau[from]!
    const faceUp = pile.cards.length - pile.faceDown
    for (let count = Math.min(faceUp, 13); count >= 2; count--) {
      const start = pile.cards.length - count
      for (let to = 0; to < TABLEAU_COUNT; to++) {
        if (to === from) continue
        if (moveError(table, tableau(from), tableau(to), count) === null) return { from, start, to, count }
      }
    }
  }
  return null
}

/**
 * 一边走一边找一个「真有一段多张明牌序列」的局面（用 findMove 推进，最多 40 步）。
 * 返回的是**真状态**（日志可重放），因此可以直接拿它测 tap / 撤销这些走日志的路径。
 */
export function stateWithRunMove(seed: number, difficulty: DifficultyId = 'starter'): KlondikeState | null {
  let state = freshState(seed, difficulty)
  for (let step = 0; step < 40; step++) {
    const table = tableOf(state)
    if (findRunMove(table)) return state
    const move = findMove(table, { toColumn: true })
    if (move) {
      state = { ...state, log: [...state.log, move] }
      continue
    }
    if (table.stock.length === 0) return null
    state = { ...state, log: [...state.log, { kind: 'draw' }] }
  }
  return null
}

/** 在若干种子里找第一个能凑出「可整段搬走的序列」的状态（确定性：同一种子范围同结果） */
export function firstStateWithRunMove(difficulty: DifficultyId = 'starter'): KlondikeState {
  for (let seed = 1; seed <= 60; seed++) {
    const state = stateWithRunMove(seed, difficulty)
    if (state) return state
  }
  throw new Error('no seed in 1..60 produced a movable run (test fixture out of date)')
}
