/**
 * 空当接龙的规则层（GameDef 层）。
 *
 * 状态只存 (difficulty, seed, dealNo, log)：牌面永远由 (seed, dealNo) 复算（cards.dealCards），
 * 局面再由日志一步步重放出来 —— 存档因此天然可续玩、可复现，decode 也能逐步校验
 * （与斗地主 / 恶魔轮盘赌同一套做法）。
 *
 * 日志里只记**真实发生的移动**：
 *   - draw    抽牌堆翻到弃牌堆（一次 1 张或 3 张，由难度决定）
 *   - recycle 弃牌堆整叠翻回抽牌堆
 *   - move    从某个牌堆顶部搬 count 张到另一个牌堆（整段合法序列就是 count > 1 的那一种）
 * 「选中某张牌」只是本地点选（进存档、不进日志），与斗地主的选牌同理：撤销退的是**上一步移动**，
 * 而不是「上一次点击」。
 *
 * 自动收牌（collect）不是日志里的一种动作，而是**连续执行合法动作**：每一步都是一张牌进基础堆，
 * 一步一步追加进日志（`autoCollect` 就是那个循环）。因此自动收牌之后一步一步撤销回去也是合法的。
 *
 * 不变量（贯穿全部规则，校验与展示都依赖它）：
 *   1. 每列的牌背永远压在明牌下面（faceDown 是前缀长度）；
 *   2. 每列的明牌永远构成「红黑交替、点数递减」的一段（移动只搬运合法序列，露出牌背时只翻一张）；
 *   3. 只有列顶 / 弃牌堆顶 / 抽牌堆可以动，基础堆上的牌永远不再拿出来（标准克朗代克规则）。
 */
import { IllegalActionError, type GameStatus } from '@eink/core'
import {
  FOUNDATION_COUNT,
  RANK_A,
  RANK_K,
  RANKS_PER_SUIT,
  STOCK,
  TABLEAU_COUNT,
  WASTE,
  clickIdOf,
  dealCards,
  decodeClickId,
  foundation,
  isOppositeColor,
  isPileRef,
  rankOf,
  samePile,
  suitOf,
  tableau,
  type CardId,
  type PileRef,
} from './cards.js'

export const GAME_ID = 'klondike'
/** 规则版本：0 号位是「选中不进日志」「自动收牌按合法动作循环」这一版语义 */
export const RULES_VERSION = 1
export const CONTENT_VERSION = 1

/**
 * 两档难度就是两种抽牌方式：入门每次翻 1 张、熟练每次翻 3 张。
 * 不做第三档 —— 翻 3 张本身就是难度的分水岭，再往上只有「更难」而没有新玩法。
 */
export const DIFFICULTY_IDS = ['starter', 'skilled'] as const
export type DifficultyId = (typeof DIFFICULTY_IDS)[number]

export const DRAW_COUNTS: Record<DifficultyId, number> = { starter: 1, skilled: 3 }

export function isDifficulty(value: unknown): value is DifficultyId {
  return typeof value === 'string' && (DIFFICULTY_IDS as readonly string[]).includes(value)
}

export function drawCountOf(difficulty: DifficultyId): number {
  return DRAW_COUNTS[difficulty]
}

function illegal(reason: string): never {
  throw new IllegalActionError(GAME_ID, reason)
}

/* ------------------------------------------------------------------ 局面 */

export interface TableauPile {
  /** 末尾 = 列顶（可动的那一头） */
  cards: CardId[]
  /** 底下压着几张牌背（前 faceDown 张）；明牌永远在牌背之上 */
  faceDown: number
}

export interface TableState {
  /** 抽牌堆：末尾 = 堆顶（下一张抽它） */
  stock: CardId[]
  /** 弃牌堆：末尾 = 堆顶（只有它能动） */
  waste: CardId[]
  /** 4 个基础堆，末尾 = 堆顶 */
  foundations: CardId[][]
  /** 7 列 */
  tableau: TableauPile[]
  /** 一次翻几张（由难度决定；存在牌局里，省得 applyMove 到处传难度） */
  drawCount: number
}

/** 玩家当前提起来的那一段：pile 里从 cardIndex 到堆顶（弃牌堆只能是堆顶那一张） */
export interface Selection {
  pile: PileRef
  cardIndex: number
}

export type Move =
  | { kind: 'draw' }
  | { kind: 'recycle' }
  | { kind: 'move'; from: PileRef; to: PileRef; count: number }

/** 搬牌那一种移动（自动收牌的每一步都是它，返回值收窄后调用方不必再判 kind） */
export type PileMove = Extract<Move, { kind: 'move' }>

export type KlondikeAction =
  /** 点一下某张牌 / 某个牌堆（编号由 view 给出，见 cards.clickIdOf） */
  | { type: 'tap'; id: number }
  /** 自动收牌：把现在能收进基础堆的牌都收掉 */
  | { type: 'collect' }
  /** 重开本局（同一编号、同一副牌） */
  | { type: 'restart' }
  /** 换一局（编号 +1，重新洗牌） */
  | { type: 'nextDeal' }
  /** 壳层的结果面板按钮发的动作名（与 nextDeal 同义，名字是壳层契约的一部分） */
  | { type: 'nextLevel' }
  /** 壳层撤销：回退上一步移动 */
  | { type: 'undo' }

export interface KlondikeState {
  difficulty: DifficultyId
  seed: number
  /** 这份存档里第几局（0 起）：换一局 +1，牌面由 (seed, dealNo) 复算 */
  dealNo: number
  log: Move[]
  /** 本地点选（进存档、不进日志） */
  selected: Selection | null
}

export function createState(seed: number, difficulty: string): KlondikeState {
  if (!isDifficulty(difficulty)) illegal(`unknown difficulty ${difficulty}`)
  return { difficulty, seed: seed >>> 0, dealNo: 0, log: [], selected: null }
}

/* ------------------------------------------------------------------ 读牌堆 */

export function pileCards(table: TableState, pile: PileRef): readonly CardId[] {
  switch (pile.zone) {
    case 'stock':
      return table.stock
    case 'waste':
      return table.waste
    case 'foundation':
      return table.foundations[pile.index]!
    case 'tableau':
      return table.tableau[pile.index]!.cards
  }
}

export function topOf(table: TableState, pile: PileRef): CardId | null {
  const cards = pileCards(table, pile)
  return cards.length > 0 ? cards[cards.length - 1]! : null
}

/** 这一堆底下压着几张牌背（只有牌列有） */
export function faceDownOf(table: TableState, pile: PileRef): number {
  return pile.zone === 'tableau' ? table.tableau[pile.index]!.faceDown : 0
}

/** 点数严格递减、红黑交替 —— 牌列上唯一允许叠放的形状 */
export function isValidRun(cards: readonly CardId[]): boolean {
  for (let index = 1; index < cards.length; index++) {
    const lower = cards[index - 1]!
    const upper = cards[index]!
    if (rankOf(upper) !== rankOf(lower) - 1) return false
    if (!isOppositeColor(upper, lower)) return false
  }
  return true
}

/**
 * 这一步能不能走（null = 能）。合法性的**唯一**判据：
 * `legal()` 列动作、`reduce` 抛错、自动收牌挑牌全都问它，三处因此不可能互相打架。
 */
export function moveError(table: TableState, from: PileRef, to: PileRef, count: number): string | null {
  if (!isPileRef(from) || !isPileRef(to)) return 'unknown pile'
  if (samePile(from, to)) return 'source and target are the same pile'
  if (from.zone === 'foundation') return 'cards are never taken back out of a foundation'
  if (from.zone === 'stock') return 'the stock is flipped by drawing, not by moving'
  if (to.zone === 'stock' || to.zone === 'waste') return 'the stock and the waste never take cards'
  if (!Number.isInteger(count) || count < 1) return 'bad card count'
  if (from.zone === 'waste' && count !== 1) return 'only the top waste card can be moved'

  const source = pileCards(table, from)
  const movable = source.length - faceDownOf(table, from)
  if (count > movable) return 'not enough face-up cards in that pile'
  const moving = source.slice(source.length - count)
  if (!isValidRun(moving)) return 'that run is not a descending alternating run'

  const head = moving[0]!
  const top = topOf(table, to)
  if (to.zone === 'foundation') {
    if (count !== 1) return 'a foundation takes one card at a time'
    if (top === null) return rankOf(head) === RANK_A ? null : 'a foundation starts with an ace'
    if (rankOf(head) !== rankOf(top) + 1 || suitOf(head) !== suitOf(top)) {
      return 'a foundation builds up in one suit'
    }
    return null
  }
  // to.zone === 'tableau'
  if (top === null) return rankOf(head) === RANK_K ? null : 'only a king can start an empty column'
  if (rankOf(head) !== rankOf(top) - 1 || !isOppositeColor(head, top)) {
    return 'a column builds down in alternating colors'
  }
  return null
}

/** 走一步（纯函数，不合法时抛 IllegalActionError）；只负责牌面，选中状态由 reduceState 管 */
export function applyMove(table: TableState, move: Move): TableState {
  switch (move.kind) {
    case 'draw': {
      if (table.stock.length === 0) illegal('the stock is empty')
      // 抽到一半不够了（熟练档只剩 1、2 张）就按剩下的抽 —— 日志记的是「抽一次」，不是「抽几张」
      const count = Math.min(table.drawCount, table.stock.length)
      /*
       * 一张一张翻到弃牌堆上：最后翻出来的那张在堆顶（也只有它能动）。
       * 所以进弃牌堆的顺序是「抽牌堆顶 → 次顶 → …」，即切片反过来。
       * 反过来这一步很关键：整叠回收之后重翻，翻出来的顺序必须与第一轮**完全一样**
       * （回归测试见 test/engine.test.ts 的「回收之后重新翻」）。
       */
      const drawn = table.stock.slice(table.stock.length - count).reverse()
      return {
        ...table,
        stock: table.stock.slice(0, table.stock.length - count),
        waste: [...table.waste, ...drawn],
      }
    }
    case 'recycle': {
      if (table.waste.length === 0) illegal('the waste is empty')
      if (table.stock.length > 0) illegal('the stock is not empty yet')
      /*
       * 整叠翻过来：原来压在弃牌堆最下面的那张变成新抽牌堆的堆顶。
       * 于是下一次翻牌翻出来的还是当初那一张，整副牌的抽牌顺序与第一次完全一致
       * （这是实体玩法里「把弃牌堆倒扣回去」的结果，也是标准克朗代克允许无限次回收的根据）。
       */
      return { ...table, stock: table.waste.slice().reverse(), waste: [] }
    }
    case 'move': {
      const reason = moveError(table, move.from, move.to, move.count)
      if (reason) illegal(reason)
      const source = pileCards(table, move.from)
      const moving = source.slice(source.length - move.count)
      return withTop(withoutTop(table, move.from, move.count), move.to, moving)
    }
  }
}

/** 从某一堆顶部拿走 count 张；牌列因此露出的牌背会自动翻开 */
function withoutTop(table: TableState, pile: PileRef, count: number): TableState {
  if (pile.zone === 'waste') return { ...table, waste: table.waste.slice(0, table.waste.length - count) }
  const columns = [...table.tableau]
  const column = columns[pile.index]!
  const remaining = column.cards.slice(0, column.cards.length - count)
  let faceDown = Math.min(column.faceDown, remaining.length)
  /*
   * 拿走明牌之后，如果底下只剩牌背，最上面那张自动翻开。
   * 这是规则的一部分（不是玩家的动作），所以不进日志、也不占步数 —— 但它决定了
   * 后续能走哪些牌，因此**必须**由 applyMove 统一处理，不能交给界面。
   */
  if (remaining.length > 0 && faceDown === remaining.length) faceDown--
  columns[pile.index] = { cards: remaining, faceDown }
  return { ...table, tableau: columns }
}

/** 把 cards 叠到某一堆顶部（基础堆只能一张一张进，由 moveError 保证 count === 1） */
function withTop(table: TableState, pile: PileRef, cards: readonly CardId[]): TableState {
  if (pile.zone === 'foundation') {
    const foundations = [...table.foundations]
    foundations[pile.index] = [...foundations[pile.index]!, ...cards]
    return { ...table, foundations }
  }
  const columns = [...table.tableau]
  const column = columns[pile.index]!
  columns[pile.index] = { cards: [...column.cards, ...cards], faceDown: column.faceDown }
  return { ...table, tableau: columns }
}

/** 从发牌开始重放整份日志；任何一步不合法都会抛错（decode 因此能挡住损坏存档） */
export function replayTable(seed: number, dealNo: number, drawCount: number, log: readonly Move[]): TableState {
  const deal = dealCards(seed, dealNo)
  let table: TableState = {
    stock: [...deal.stock],
    waste: [],
    foundations: Array.from({ length: FOUNDATION_COUNT }, () => []),
    // 发牌时每列只有最后一张是明牌
    tableau: deal.tableau.map((cards) => ({ cards: [...cards], faceDown: cards.length - 1 })),
    drawCount,
  }
  for (const move of log) table = applyMove(table, move)
  return table
}

/** 复算当前局面（同一份日志只算一次：view / status / controls 都会来问） */
const tableCache = new WeakMap<readonly Move[], { seed: number; dealNo: number; drawCount: number; table: TableState }>()

export function tableOf(state: KlondikeState): TableState {
  const drawCount = drawCountOf(state.difficulty)
  const hit = tableCache.get(state.log)
  if (hit && hit.seed === state.seed && hit.dealNo === state.dealNo && hit.drawCount === drawCount) {
    return hit.table
  }
  const table = replayTable(state.seed, state.dealNo, drawCount, state.log)
  tableCache.set(state.log, { seed: state.seed, dealNo: state.dealNo, drawCount, table })
  return table
}

/* ------------------------------------------------------------------ 选中与自动收牌 */

/** 这一堆上能被提起来的那一段的起点序号（null = 提不起来：牌背 / 空堆 / 基础堆） */
export function grabStart(table: TableState, pile: PileRef, cardIndex: number): number | null {
  if (pile.zone === 'tableau') {
    const column = table.tableau[pile.index]!
    if (cardIndex < column.faceDown || cardIndex >= column.cards.length) return null
    return cardIndex
  }
  // 弃牌堆只有堆顶动得了（编号也只有那一个）
  if (pile.zone === 'waste') return table.waste.length > 0 ? 0 : null
  return null
}

/** 选中的那一段有多长（弃牌堆只有堆顶一张） */
export function runLength(table: TableState, selection: Selection): number {
  if (selection.pile.zone === 'waste') return 1
  return table.tableau[selection.pile.index]!.cards.length - selection.cardIndex
}

/** 选中的那一段（从起点到堆顶），展示与校验共用 */
export function runOf(table: TableState, selection: Selection): CardId[] {
  const cards = pileCards(table, selection.pile)
  return cards.slice(cards.length - runLength(table, selection))
}

/**
 * 自动收牌的一步：按固定顺序（先弃牌堆、再从左到右各列）找第一张能进基础堆的牌。
 * 顺序固定是为了确定性 —— 同一个局面下自动收牌的结果必须完全一样（存档只靠重放）。
 */
export function collectStep(table: TableState): PileMove | null {
  const sources: PileRef[] = []
  if (table.waste.length > 0) sources.push(WASTE)
  for (let column = 0; column < TABLEAU_COUNT; column++) sources.push(tableau(column))
  for (const from of sources) {
    for (let index = 0; index < FOUNDATION_COUNT; index++) {
      const to = foundation(index)
      if (moveError(table, from, to, 1) === null) return { kind: 'move', from, to, count: 1 }
    }
  }
  return null
}

/** 一直收到收不动为止；返回每一步（每一步都是一张牌进基础堆，会被原样追加进日志） */
export function autoCollect(table: TableState): { table: TableState; moves: PileMove[] } {
  const moves: PileMove[] = []
  let current = table
  for (;;) {
    const move = collectStep(current)
    if (!move) break
    current = applyMove(current, move)
    moves.push(move)
  }
  return { table: current, moves }
}

/* ------------------------------------------------------------------ 动作 */

/** 点一张牌：没有选中时是「选源」，有选中时是「点目标」（同一张再点一下 = 取消） */
function tap(state: KlondikeState, id: number): KlondikeState {
  const target = decodeClickId(id)
  if (!target) illegal(`bad tap id ${id}`)
  const table = tableOf(state)
  const { pile, cardIndex } = target

  // 抽牌堆：点它永远是「翻牌 / 回收」，顺手取消当前选择（玩家点这里就是想接着翻）
  if (pile.zone === 'stock') {
    if (table.stock.length > 0) return { ...state, log: [...state.log, { kind: 'draw' }], selected: null }
    if (table.waste.length > 0) return { ...state, log: [...state.log, { kind: 'recycle' }], selected: null }
    illegal('the stock and the waste are both empty')
  }

  const selected = state.selected
  if (selected === null) {
    if (pile.zone === 'foundation') illegal('cards are never taken back out of a foundation')
    if (grabStart(table, pile, cardIndex) === null) illegal('that card is face down')
    return { ...state, selected: { pile, cardIndex } }
  }

  // 同一堆：点同一张 = 取消；点别的明牌 = 改选从那张开始的一段
  if (samePile(selected.pile, pile)) {
    const start = grabStart(table, pile, cardIndex)
    if (start === null || start === selected.cardIndex) return { ...state, selected: null }
    return { ...state, selected: { pile, cardIndex: start } }
  }

  // 弃牌堆永远不是目标（没有牌能放回去）：点它 = 改选它的堆顶
  if (pile.zone === 'waste') {
    if (grabStart(table, pile, 0) === null) illegal('the waste is empty')
    return { ...state, selected: { pile, cardIndex: 0 } }
  }

  // 其余都是目标：把选中的整段移过去（不合法时抛出明确原因，壳层据此提示）
  const move: Move = { kind: 'move', from: selected.pile, to: pile, count: runLength(table, selected) }
  const reason = moveError(table, move.from, move.to, move.count)
  if (reason) illegal(reason)
  return { ...state, log: [...state.log, move], selected: null }
}

export function reduceState(state: KlondikeState, action: KlondikeAction): KlondikeState {
  switch (action?.type) {
    case 'tap':
      return tap(state, action.id)
    case 'collect': {
      const { moves } = autoCollect(tableOf(state))
      if (moves.length === 0) illegal('nothing can be collected right now')
      return { ...state, log: [...state.log, ...moves], selected: null }
    }
    // 重开本局：日志清空 = 回到同一副牌的初始局面（同编号），种子与局号都不动
    case 'restart':
      return state.log.length === 0 && state.selected === null ? state : { ...state, log: [], selected: null }
    case 'nextDeal':
    case 'nextLevel':
      // 换一局：只改局号，牌面由 (seed, dealNo) 复算，因此同一份存档仍然可复现
      return { ...state, dealNo: state.dealNo + 1, log: [], selected: null }
    case 'undo': {
      if (state.log.length === 0) illegal('nothing to undo')
      return { ...state, log: state.log.slice(0, -1), selected: null }
    }
    default:
      illegal(`unknown action ${JSON.stringify(action)}`)
  }
}

export function isWon(table: TableState): boolean {
  return table.foundations.every((pile) => pile.length === RANKS_PER_SUIT)
}

/** 由牌局判定状态：statusOf 的纯函数内核（手搓牌局做测试、展示层补算都用它） */
export function statusOfTable(table: TableState): GameStatus {
  // 空当接龙没有「输」：牌走不下去就是走不下去，玩家自己决定重开或换一局
  return isWon(table) ? 'won' : 'playing'
}

export function statusOf(state: KlondikeState): GameStatus {
  return statusOfTable(tableOf(state))
}

/** 计步数：日志长度就是玩家实际走的步数（自动收牌收了几张就算几步），用于记「最佳成绩」 */
export function movesOf(state: KlondikeState): number {
  return state.log.length
}

export function legalActions(state: KlondikeState): KlondikeAction[] {
  const table = tableOf(state)
  const out: KlondikeAction[] = []
  const selected = state.selected
  if (selected === null) {
    // 能当源的：抽牌堆（还有牌可翻，或弃牌堆还能回收）、弃牌堆顶、每一列的所有明牌
    if (table.stock.length > 0 || table.waste.length > 0) out.push({ type: 'tap', id: clickIdOf(STOCK) })
    if (table.waste.length > 0) out.push({ type: 'tap', id: clickIdOf(WASTE) })
    for (let column = 0; column < TABLEAU_COUNT; column++) {
      const pile = table.tableau[column]!
      for (let cardIndex = pile.faceDown; cardIndex < pile.cards.length; cardIndex++) {
        out.push({ type: 'tap', id: clickIdOf(tableau(column), cardIndex) })
      }
    }
  } else {
    // 取消 / 同一堆里改选
    out.push({ type: 'tap', id: clickIdOf(selected.pile, selected.cardIndex) })
    for (let column = 0; column < TABLEAU_COUNT; column++) {
      if (!samePile(selected.pile, tableau(column))) continue
      const pile = table.tableau[column]!
      for (let cardIndex = pile.faceDown; cardIndex < pile.cards.length; cardIndex++) {
        if (cardIndex !== selected.cardIndex) out.push({ type: 'tap', id: clickIdOf(tableau(column), cardIndex) })
      }
    }
    // 点抽牌堆仍然可以翻牌（并取消选择）
    if (table.stock.length > 0 || table.waste.length > 0) out.push({ type: 'tap', id: clickIdOf(STOCK) })
    // 弃牌堆只能改选，不能当目标
    if (selected.pile.zone !== 'waste' && table.waste.length > 0) out.push({ type: 'tap', id: clickIdOf(WASTE) })
    // 真正的目标：只列真的放得下的那些（放不下的点击由 selectAction 交给 reduce 报错提示）
    const count = runLength(table, selected)
    for (let index = 0; index < FOUNDATION_COUNT; index++) {
      if (moveError(table, selected.pile, foundation(index), count) === null) {
        out.push({ type: 'tap', id: clickIdOf(foundation(index)) })
      }
    }
    for (let column = 0; column < TABLEAU_COUNT; column++) {
      const pile = tableau(column)
      if (samePile(selected.pile, pile)) continue
      if (moveError(table, selected.pile, pile, count) === null) out.push({ type: 'tap', id: clickIdOf(pile) })
    }
  }
  if (collectStep(table) !== null) out.push({ type: 'collect' })
  out.push({ type: 'nextDeal' })
  if (state.log.length > 0 || selected !== null) out.push({ type: 'restart' })
  if (state.log.length > 0) out.push({ type: 'undo' })
  return out
}

/* ------------------------------------------------------------------ 存档 */

export function encodeState(state: KlondikeState): unknown {
  return {
    difficulty: state.difficulty,
    seed: state.seed,
    dealNo: state.dealNo,
    log: state.log.map((move) =>
      move.kind === 'move'
        ? {
            kind: 'move',
            from: { zone: move.from.zone, index: move.from.index },
            to: { zone: move.to.zone, index: move.to.index },
            count: move.count,
          }
        : { kind: move.kind },
    ),
    selected:
      state.selected === null
        ? null
        : { zone: state.selected.pile.zone, index: state.selected.pile.index, cardIndex: state.selected.cardIndex },
  }
}

function readCount(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) illegal(`bad ${name}`)
  return value
}

function readPile(raw: unknown): PileRef {
  if (!isPileRef(raw)) illegal('bad pile')
  return { zone: raw.zone, index: raw.index }
}

function readMove(raw: unknown): Move {
  if (!raw || typeof raw !== 'object') illegal('bad move')
  const move = raw as { kind?: unknown; from?: unknown; to?: unknown; count?: unknown }
  if (move.kind === 'draw') return { kind: 'draw' }
  if (move.kind === 'recycle') return { kind: 'recycle' }
  if (move.kind === 'move') {
    const count = move.count
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 1) illegal('bad move count')
    return { kind: 'move', from: readPile(move.from), to: readPile(move.to), count }
  }
  illegal('bad move kind')
}

/**
 * 选中项必须仍指向当前局面里**真的提得起来**的一段：
 * 否则一份被改过的存档会出现「选中一张牌背」这种自相矛盾的状态，撤销 / 展示都会错。
 */
function readSelection(raw: unknown, table: TableState): Selection | null {
  if (raw === null || raw === undefined) return null
  if (!raw || typeof raw !== 'object') illegal('bad selection')
  const value = raw as { zone?: unknown; index?: unknown; cardIndex?: unknown }
  const pile = readPile({ zone: value.zone, index: value.index })
  const cardIndex = value.cardIndex
  if (typeof cardIndex !== 'number' || !Number.isInteger(cardIndex) || cardIndex < 0) illegal('bad selection index')
  if (grabStart(table, pile, cardIndex) === null) illegal('the selection is not a movable run')
  if (pile.zone === 'waste' && cardIndex !== 0) illegal('the waste only offers its top card')
  return { pile, cardIndex }
}

/**
 * 严格解码（重放式）：结构逐字段校验，再把日志从头重放 ——
 * 任何一步不合法（不是明牌、放不进基础堆、红黑不对…）都会抛错，被当作存档损坏保留原档。
 */
export function decodeState(raw: unknown): KlondikeState {
  if (!raw || typeof raw !== 'object') illegal('bad state')
  const value = raw as Record<string, unknown>
  if (!isDifficulty(value.difficulty)) illegal('bad difficulty')
  const seed = readCount(value.seed, 'seed')
  if (seed > 0xffffffff) illegal('bad seed')
  const dealNo = readCount(value.dealNo, 'dealNo')
  if (!Array.isArray(value.log)) illegal('bad log')
  const log: Move[] = value.log.map(readMove)
  const table = replayTable(seed, dealNo, drawCountOf(value.difficulty), log)
  const selected = readSelection(value.selected, table)
  return { difficulty: value.difficulty, seed, dealNo, log, selected }
}
