/**
 * 空当接龙的规则测试。
 *
 * 两类手法：
 *  - **真发牌**：断言发牌形状、抽牌顺序、回收、存档往返 —— 这些都是「种子 + 日志」的性质；
 *  - **手搓牌局**：把牌摆成想测的形状再调 applyMove / moveError（红黑交替、同花升序、空列只收 K…），
 *    因为这些形状在真发牌里要凑出来得先赢一百局。
 */
import { describe, expect, it } from 'vitest'
import { IllegalActionError, createRng } from '@eink/core'
import {
  FOUNDATION_COUNT,
  RANKS_PER_SUIT,
  TABLEAU_COUNT,
  WASTE,
  clickIdOf,
  foundation,
  rankOf,
  tableau,
} from '../src/cards.js'
import {
  applyMove,
  autoCollect,
  collectStep,
  createState,
  decodeState,
  encodeState,
  isWon,
  legalActions,
  moveError,
  movesOf,
  reduceState,
  statusOf,
  statusOfTable,
  tableOf,
  type KlondikeState,
} from '../src/engine.js'
import {
  ALL_CARD_IDS,
  CLUB,
  DIAMOND,
  HEART,
  SPADE,
  allCards,
  card,
  column,
  emptyTable,
  firstStateWithRunMove,
  freshState,
  freshTable,
} from './helpers.js'

const SEEDS = [1, 7, 99, 20261010, 0xffffffff]

describe('发牌', () => {
  it('7 列依次 1..7 张、每列只有最后一张翻开，抽牌堆 24 张', () => {
    for (const seed of SEEDS) {
      const table = freshTable(seed)
      table.tableau.forEach((pile, index) => {
        expect(pile.cards, `seed ${seed} 第 ${index} 列`).toHaveLength(index + 1)
        // faceDown = 列内序号：只有最后一张（列顶）是明牌
        expect(pile.faceDown).toBe(index)
      })
      expect(table.stock).toHaveLength(24)
      expect(table.waste).toHaveLength(0)
      expect(table.foundations.map((pile) => pile.length)).toEqual([0, 0, 0, 0])
    }
  })

  it('52 张牌一张不多、一张不少、没有重复', () => {
    for (const seed of SEEDS) {
      const cards = [...allCards(freshTable(seed))].sort((a, b) => a - b)
      expect(cards, `seed ${seed}`).toEqual([...ALL_CARD_IDS])
    }
  })

  it('同种子同牌序；换种子、换局号都是另一副牌', () => {
    expect(freshTable(1234)).toEqual(freshTable(1234))
    expect(freshTable(1234).tableau).not.toEqual(freshTable(1235).tableau)
    const deal0 = freshTable(1234)
    // 同一存档里「换一局」只改局号：种子不变，牌也必须变
    const deal1 = tableOf({ ...freshState(1234), dealNo: 1 })
    expect(deal1.tableau).not.toEqual(deal0.tableau)
    expect(deal1.stock).toHaveLength(24)
  })
})

describe('抽牌堆', () => {
  it('入门档一次翻 1 张、熟练档一次翻 3 张', () => {
    const one = freshTable(99, 'starter')
    const drawnOne = applyMove(one, { kind: 'draw' })
    expect(drawnOne.waste).toHaveLength(1)
    expect(drawnOne.stock).toHaveLength(23)
    // 翻出来的就是原来的堆顶
    expect(drawnOne.waste[0]).toBe(one.stock[one.stock.length - 1])

    const three = freshTable(99, 'skilled')
    const drawnThree = applyMove(three, { kind: 'draw' })
    expect(drawnThree.waste).toHaveLength(3)
    expect(drawnThree.stock).toHaveLength(21)
    // 一张一张翻：最后翻出来的那张在堆顶（也只有它能动），最早翻出来的压在下面
    const top = three.stock.length - 1
    expect(drawnThree.waste).toEqual([three.stock[top], three.stock[top - 1], three.stock[top - 2]])
  })

  it('抽到见底时只抽剩下的那几张', () => {
    const table = emptyTable({ stock: [card(1, SPADE), card(2, HEART)], drawCount: 3 })
    const drawn = applyMove(table, { kind: 'draw' })
    expect(drawn.stock).toHaveLength(0)
    // 先翻 ♡2（原来的堆顶），再翻 ♠A
    expect(drawn.waste).toEqual([card(2, HEART), card(1, SPADE)])
  })

  it('抽牌堆空了再点就是回收：整叠倒扣回去，下一轮翻出来的顺序与第一轮完全一样', () => {
    for (const difficulty of ['starter', 'skilled'] as const) {
      let table = freshTable(4321, difficulty)
      const firstRound: number[][] = []
      // 一直翻到抽牌堆空（每翻一次记一段，方便逐段比对第二轮）
      for (;;) {
        if (table.stock.length === 0) break
        const before = table.waste.length
        table = applyMove(table, { kind: 'draw' })
        firstRound.push(table.waste.slice(before))
      }
      expect(table.waste).toHaveLength(24)
      const recycled = applyMove(table, { kind: 'recycle' })
      expect(recycled.stock).toHaveLength(24)
      expect(recycled.waste).toHaveLength(0)
      // 第二轮：同样的段落、同样的顺序
      let again = recycled
      const secondRound: number[][] = []
      for (;;) {
        if (again.stock.length === 0) break
        const before = again.waste.length
        again = applyMove(again, { kind: 'draw' })
        secondRound.push(again.waste.slice(before))
      }
      expect(secondRound).toEqual(firstRound)
    }
  })

  it('抽牌堆和弃牌堆都空时点它没有动作', () => {
    const table = emptyTable()
    expect(() => applyMove(table, { kind: 'draw' })).toThrow(IllegalActionError)
    expect(() => applyMove(table, { kind: 'recycle' })).toThrow(IllegalActionError)
    // 抽牌堆还有牌时不能回收（回收只发生在抽牌堆空了之后）
    expect(() => applyMove(freshTable(3), { kind: 'recycle' })).toThrow(IllegalActionError)
  })
})

describe('牌列：红黑交替降序', () => {
  it('异色且差 1 才叠得上', () => {
    const table = emptyTable({ tableau: [column([card(9, SPADE)]), column([card(8, HEART)]), column([card(8, CLUB)]), column([card(7, DIAMOND)])] })
    // ♠9 ← ♡8：黑 9 上放红 8 ✓
    expect(moveError(table, tableau(1), tableau(0), 1)).toBeNull()
    // ♠9 ← ♣8：同色 ✗
    expect(moveError(table, tableau(2), tableau(0), 1)).toBe('a column builds down in alternating colors')
    // ♠9 ← ♢7：点数不连 ✗
    expect(moveError(table, tableau(3), tableau(0), 1)).toBe('a column builds down in alternating colors')
    // 反过来 8 上放 9 也不行（只能降序）
    expect(moveError(table, tableau(0), tableau(1), 1)).toBe('a column builds down in alternating colors')
  })

  it('空列只收 K，或 K 打头的整段序列', () => {
    const table = emptyTable({
      tableau: [column([]), column([card(13, SPADE)]), column([card(12, HEART)]), column([card(13, CLUB), card(12, HEART), card(11, SPADE)])],
    })
    expect(moveError(table, tableau(1), tableau(0), 1)).toBeNull()
    expect(moveError(table, tableau(2), tableau(0), 1)).toBe('only a king can start an empty column')
    // K 打头的三段一起搬进空列 ✓
    expect(moveError(table, tableau(3), tableau(0), 3)).toBeNull()
    // 只有 Q 打头的两段搬不进空列 ✗
    expect(moveError(table, tableau(3), tableau(0), 2)).toBe('only a king can start an empty column')
  })

  it('非法的段（同色、断层、含牌背）搬不动', () => {
    const table = emptyTable({
      tableau: [
        column([card(10, CLUB)]),
        column([card(9, SPADE), card(8, SPADE)]), // 同色的两段：不是合法序列
        column([card(9, SPADE), card(7, HEART)]), // 断层
        column([card(6, CLUB), card(9, DIAMOND)], 1), // 底下压着一张牌背
      ],
    })
    expect(moveError(table, tableau(1), tableau(0), 2)).toBe('that run is not a descending alternating run')
    expect(moveError(table, tableau(2), tableau(0), 2)).toBe('that run is not a descending alternating run')
    // 只能提明牌：整列两张里有一张牌背 ✗，只提列顶那张 ✓
    expect(moveError(table, tableau(3), tableau(0), 2)).toBe('not enough face-up cards in that pile')
    expect(moveError(table, tableau(3), tableau(0), 1)).toBeNull()
  })

  it('同一堆、抽牌堆、弃牌堆这些目标都不合法', () => {
    const table = emptyTable({ waste: [card(5, SPADE)], tableau: [column([card(9, SPADE)]), column([card(8, HEART)])] })
    expect(moveError(table, tableau(0), tableau(0), 1)).toBe('source and target are the same pile')
    expect(moveError(table, tableau(1), WASTE, 1)).toBe('the stock and the waste never take cards')
    expect(moveError(table, tableau(1), { zone: 'stock', index: 0 }, 1)).toBe('the stock and the waste never take cards')
    expect(moveError(table, { zone: 'stock', index: 0 }, tableau(0), 1)).toBe('the stock is flipped by drawing, not by moving')
  })

  it('弃牌堆只有堆顶一张能动，而且只能一张一张地走', () => {
    const table = emptyTable({ waste: [card(5, SPADE), card(8, HEART)], tableau: [column([card(9, SPADE)]), column([])] })
    expect(moveError(table, WASTE, tableau(0), 1)).toBeNull()
    expect(moveError(table, WASTE, tableau(0), 2)).toBe('only the top waste card can be moved')
    const moved = applyMove(table, { kind: 'move', from: WASTE, to: tableau(0), count: 1 })
    expect(moved.waste).toEqual([card(5, SPADE)])
    expect(moved.tableau[0]!.cards).toEqual([card(9, SPADE), card(8, HEART)])
  })

  it('抽牌堆和弃牌堆里的牌不会凭空移动错位', () => {
    const table = emptyTable({ stock: [card(3, SPADE)], waste: [card(4, HEART)] })
    expect(moveError(table, WASTE, { zone: 'stock', index: 0 }, 1)).toBe('the stock and the waste never take cards')
    expect(moveError(table, WASTE, WASTE, 1)).toBe('source and target are the same pile')
  })
})

describe('基础堆：同花升序', () => {
  it('空基础堆只收 A，之后同花差 1 才收得上', () => {
    const empty = emptyTable({ tableau: [column([card(2, SPADE)]), column([card(1, SPADE)]), column([card(1, HEART)])] })
    expect(moveError(empty, tableau(0), foundation(0), 1)).toBe('a foundation starts with an ace')
    expect(moveError(empty, tableau(1), foundation(0), 1)).toBeNull()
    expect(moveError(empty, tableau(2), foundation(0), 1)).toBeNull()

    const withAce = emptyTable({ foundations: [[card(1, SPADE)], [], [], []], tableau: [column([card(2, SPADE)]), column([card(2, HEART)]), column([card(3, SPADE)])] })
    expect(moveError(withAce, tableau(0), foundation(0), 1)).toBeNull()
    expect(moveError(withAce, tableau(1), foundation(0), 1)).toBe('a foundation builds up in one suit')
    expect(moveError(withAce, tableau(2), foundation(0), 1)).toBe('a foundation builds up in one suit')
  })

  it('一次只能收一张；基础堆上的牌永远不再拿出来', () => {
    const table = emptyTable({
      foundations: [[card(1, SPADE)], [], [], []],
      // 第 2 列顶上两张是一段合法序列（♠2 压 ♡A），第 1 列只有 ♠2
      tableau: [column([card(2, SPADE)]), column([card(2, SPADE), card(1, HEART)])],
    })
    // 两张一起收 ✗
    expect(moveError(table, tableau(1), foundation(0), 2)).toBe('a foundation takes one card at a time')
    expect(moveError(table, tableau(0), foundation(0), 1)).toBeNull()
    // 从基础堆往外拿 ✗
    expect(moveError(table, foundation(0), tableau(0), 1)).toBe('cards are never taken back out of a foundation')
    expect(moveError(table, foundation(0), foundation(1), 1)).toBe('cards are never taken back out of a foundation')
  })
})

describe('整段合法序列一起移动', () => {
  it('三段一起搬到 ♡10 上，两段就搬不动', () => {
    const table = emptyTable({
      tableau: [column([card(10, HEART)]), column([card(9, SPADE), card(8, HEART), card(7, SPADE)])],
    })
    expect(moveError(table, tableau(1), tableau(0), 3)).toBeNull()
    expect(moveError(table, tableau(1), tableau(0), 2)).toBe('a column builds down in alternating colors')
    expect(moveError(table, tableau(1), tableau(0), 1)).toBe('a column builds down in alternating colors')

    const moved = applyMove(table, { kind: 'move', from: tableau(1), to: tableau(0), count: 3 })
    expect(moved.tableau[1]!.cards).toEqual([])
    expect(moved.tableau[1]!.faceDown).toBe(0)
    expect(moved.tableau[0]!.cards).toEqual([card(10, HEART), card(9, SPADE), card(8, HEART), card(7, SPADE)])
    // 纯函数：原局面一个字都没变
    expect(table.tableau[1]!.cards).toHaveLength(3)
    expect(table.tableau[0]!.cards).toHaveLength(1)
  })

  it('搬走明牌后露出的牌背自动翻开（不算玩家的步数）', () => {
    const table = emptyTable({
      tableau: [column([card(10, HEART)]), column([card(4, CLUB), card(9, SPADE), card(8, HEART)], 1)],
    })
    const moved = applyMove(table, { kind: 'move', from: tableau(1), to: tableau(0), count: 2 })
    expect(moved.tableau[1]!.cards).toEqual([card(4, CLUB)])
    // 4♣ 原来是牌背，现在露出来了 → 自动翻开
    expect(moved.tableau[1]!.faceDown).toBe(0)
    // 翻开的牌马上就能用：4♣ 可以放到 ♡5 上
    const withFive = { ...moved, tableau: [...moved.tableau] }
    withFive.tableau[2] = column([card(5, DIAMOND)])
    expect(moveError(withFive, tableau(1), tableau(2), 1)).toBeNull()
  })

  it('真局面里也能靠两次点击整段搬走（点源 → 点目标）', () => {
    const state = firstStateWithRunMove()
    const table = tableOf(state)
    let found: { from: number; start: number; to: number; count: number } | null = null
    for (let from = 0; from < TABLEAU_COUNT && !found; from++) {
      const pile = table.tableau[from]!
      const faceUp = pile.cards.length - pile.faceDown
      for (let count = Math.min(faceUp, 13); count >= 2 && !found; count--) {
        for (let to = 0; to < TABLEAU_COUNT && !found; to++) {
          if (to === from) continue
          if (moveError(table, tableau(from), tableau(to), count) === null) {
            found = { from, start: pile.cards.length - count, to, count }
          }
        }
      }
    }
    expect(found, '这个局面里应该有一段能整段搬走的序列').not.toBeNull()
    const { from, start, to, count } = found!
    const picked = reduceState(state, { type: 'tap', id: clickIdOf(tableau(from), start) })
    expect(picked.selected).toEqual({ pile: tableau(from), cardIndex: start })
    const moved = reduceState(picked, { type: 'tap', id: clickIdOf(tableau(to), table.tableau[to]!.cards.length - 1) })
    expect(moved.log).toHaveLength(state.log.length + 1)
    expect(moved.log[moved.log.length - 1]).toEqual({ kind: 'move', from: tableau(from), to: tableau(to), count })
    expect(moved.selected).toBeNull()
    // 整段都过去了，源列少了 count 张
    expect(tableOf(moved).tableau[from]!.cards).toHaveLength(table.tableau[from]!.cards.length - count)
    expect(tableOf(moved).tableau[to]!.cards).toHaveLength(table.tableau[to]!.cards.length + count)
  })
})

describe('自动收牌', () => {
  it('一步一步收，每一步都是合法动作，收不动的牌原地不动', () => {
    const table = emptyTable({
      waste: [card(1, SPADE)],
      tableau: [
        column([card(2, SPADE), card(1, HEART)]),
        column([card(5, CLUB)]),
        column([card(13, SPADE), card(12, HEART)]),
      ],
    })
    const { table: after, moves } = autoCollect(table)
    // 顺序固定：先弃牌堆（A♠），再各列从左到右（A♥，然后是露出来的 2♠）
    expect(moves).toEqual([
      { kind: 'move', from: WASTE, to: foundation(0), count: 1 },
      { kind: 'move', from: tableau(0), to: foundation(1), count: 1 },
      { kind: 'move', from: tableau(0), to: foundation(0), count: 1 },
    ])
    for (const move of moves) {
      expect(move.count).toBe(1)
      expect(move.to.zone).toBe('foundation')
    }
    expect(after.foundations[0]).toEqual([card(1, SPADE), card(2, SPADE)])
    expect(after.foundations[1]).toEqual([card(1, HEART)])
    // 收不进去的留在原地：5♣ 还在第 2 列
    expect(after.tableau[1]!.cards).toEqual([card(5, CLUB)])
    expect(after.tableau[2]!.cards).toEqual([card(13, SPADE), card(12, HEART)])
    // 收干净了：再也找不到能收的牌
    expect(collectStep(after)).toBeNull()
    // 纯函数：输入局面没被改动
    expect(table.waste).toEqual([card(1, SPADE)])
    expect(table.tableau[0]!.cards).toEqual([card(2, SPADE), card(1, HEART)])
  })

  it('每一步都必须是当时局面下的合法动作（用 moveError 逐步复核）', () => {
    let table = freshTable(2026, 'skilled')
    for (let step = 0; step < 30; step++) {
      const drawn = table.stock.length > 0 ? applyMove(table, { kind: 'draw' }) : table
      const next = collectStep(drawn)
      if (!next) {
        table = drawn
        continue
      }
      expect(moveError(drawn, next.from, next.to, next.count)).toBeNull()
      table = applyMove(drawn, next)
    }
    expect(allCards(table).sort((a, b) => a - b)).toEqual([...ALL_CARD_IDS])
  })

  it('没什么可收的时候，collect 动作被拒绝', () => {
    const state = freshState(1)
    if (collectStep(tableOf(state)) === null) {
      expect(() => reduceState(state, { type: 'collect' })).toThrow(IllegalActionError)
    }
    // 找一个开局就有 A 露在外面的种子：collect 应该真的收掉它
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
    const seed = seeds.find((candidate) => collectStep(tableOf(freshState(candidate))) !== null)
    expect(seed, '12 个种子里总该有一个开局能收牌').toBeDefined()
    const before = freshState(seed!)
    const step = collectStep(tableOf(before))!
    const after = reduceState(before, { type: 'collect' })
    // 自动收牌 = 一连串合法动作：第一条就是刚问出来的那一步，一直收到收不动为止
    expect(after.log[0]).toEqual(step)
    expect(after.log.length).toBeGreaterThanOrEqual(1)
    expect(movesOf(after)).toBe(after.log.length)
    expect(collectStep(tableOf(after))).toBeNull()
    // 收进来的正是刚才那一堆的堆顶那张
    const source = step.from.zone === 'waste' ? tableOf(before).waste : tableOf(before).tableau[step.from.index]!.cards
    expect(tableOf(after).foundations.flat()[0]).toBe(source[source.length - 1])
    expect(tableOf(after).foundations.flat().length).toBe(after.log.length)
  })
})

describe('通关判定', () => {
  it('四个基础堆各 13 张就是赢', () => {
    const full = Array.from({ length: FOUNDATION_COUNT }, (_, suit) =>
      Array.from({ length: RANKS_PER_SUIT }, (_, index) => card(index + 1, suit)),
    )
    expect(isWon(emptyTable({ foundations: full }))).toBe(true)
    expect(statusOfTable(emptyTable({ foundations: full }))).toBe('won')
    // 少一张就不算
    const almost = full.map((pile, index) => (index === 0 ? pile.slice(0, RANKS_PER_SUIT - 1) : pile))
    expect(isWon(emptyTable({ foundations: almost }))).toBe(false)
    expect(statusOfTable(emptyTable({ foundations: almost }))).toBe('playing')
    // 真发牌的开局当然也还没赢
    expect(statusOf(freshState(1))).toBe('playing')
    expect(isWon(freshTable(1))).toBe(false)
  })

  it('差最后一张时，自动收牌正好把这一局收完', () => {
    const foundations = Array.from({ length: FOUNDATION_COUNT }, (_, suit) =>
      Array.from({ length: suit === SPADE ? RANKS_PER_SUIT - 1 : RANKS_PER_SUIT }, (_, index) => card(index + 1, suit)),
    )
    const table = emptyTable({ foundations, tableau: [column([card(RANKS_PER_SUIT, SPADE)])] })
    expect(isWon(table)).toBe(false)
    const { table: after, moves } = autoCollect(table)
    expect(moves).toEqual([{ kind: 'move', from: tableau(0), to: foundation(0), count: 1 }])
    expect(isWon(after)).toBe(true)
    expect(statusOfTable(after)).toBe('won')
  })
})

describe('点选（点源 → 点目标）', () => {
  it('点抽牌堆就是翻牌，翻牌会取消当前的选择', () => {
    const state = freshState(5)
    const drawn = reduceState(state, { type: 'tap', id: clickIdOf({ zone: 'stock', index: 0 }) })
    expect(drawn.log).toEqual([{ kind: 'draw' }])
    // 选一张牌，再点抽牌堆：牌翻了、选择也取消了
    const column = 0
    const top = tableOf(state).tableau[column]!.cards.length - 1
    const picked = reduceState(state, { type: 'tap', id: clickIdOf(tableau(column), top) })
    expect(picked.selected).not.toBeNull()
    const drawAgain = reduceState(picked, { type: 'tap', id: clickIdOf({ zone: 'stock', index: 0 }) })
    expect(drawAgain.log).toHaveLength(1)
    expect(drawAgain.selected).toBeNull()
  })

  it('点牌背不可选，点基础堆（不选源）也不可选', () => {
    const state = freshState(6)
    const table = tableOf(state)
    // 第 3 列（序号 2）有两张牌，底下那张是牌背
    expect(table.tableau[2]!.faceDown).toBe(2)
    expect(() => reduceState(state, { type: 'tap', id: clickIdOf(tableau(2), 0) })).toThrow(IllegalActionError)
    expect(() => reduceState(state, { type: 'tap', id: clickIdOf(foundation(0)) })).toThrow(IllegalActionError)
    // 编号根本不存在
    expect(() => reduceState(state, { type: 'tap', id: 9999 })).toThrow(IllegalActionError)
    expect(() => reduceState(state, { type: 'tap', id: -1 })).toThrow(IllegalActionError)
  })

  it('点同一张取消；点同一列的更深/更浅一张就是改选那一段', () => {
    const state = freshState(8)
    const column = 3
    const top = tableOf(state).tableau[column]!.cards.length - 1
    const picked = reduceState(state, { type: 'tap', id: clickIdOf(tableau(column), top) })
    expect(picked.selected).toEqual({ pile: tableau(column), cardIndex: top })
    const cancelled = reduceState(picked, { type: 'tap', id: clickIdOf(tableau(column), top) })
    expect(cancelled.selected).toBeNull()
    // 牌列里唯一提得起来的就是列顶那张；点牌背 = 取消
    const cancelledByBack = reduceState(picked, { type: 'tap', id: clickIdOf(tableau(column), 0) })
    expect(cancelledByBack.selected).toBeNull()
  })

  it('放不下的一步会被拒绝，而且不会把原来的选择弄丢', () => {
    const state = freshState(9)
    const table = tableOf(state)
    const column = 0
    const top = table.tableau[column]!.cards.length - 1
    const picked = reduceState(state, { type: 'tap', id: clickIdOf(tableau(column), top) })
    // 基础堆是空的：只有 A 放得进去，列顶那张（不可能是 A，因为第 1 列只有 1 张、且不是 A 时）——
    // 直接用规则层问一句，避免依赖具体牌面
    const cardAtTop = table.tableau[column]!.cards[top]!
    if (rankOf(cardAtTop) !== 1) {
      expect(() => reduceState(picked, { type: 'tap', id: clickIdOf(foundation(0)) })).toThrow(IllegalActionError)
      expect(picked.selected).toEqual({ pile: tableau(column), cardIndex: top })
    }
    // 弃牌堆空的时候点弃牌堆 = 报错（没有牌可以改选）
    expect(() => reduceState(picked, { type: 'tap', id: clickIdOf(WASTE) })).toThrow(IllegalActionError)
  })

  it('把弃牌堆顶那张搬到列上：整条链路（翻牌 → 选牌 → 落牌）都进日志', () => {
    // 找一个「翻出来的牌正好能放到某一列顶」的种子
    let found: { seed: number; to: number } | null = null
    for (let seed = 1; seed <= 40 && !found; seed++) {
      const state = freshState(seed)
      const drawn = reduceState(state, { type: 'tap', id: clickIdOf({ zone: 'stock', index: 0 }) })
      const table = tableOf(drawn)
      for (let to = 0; to < TABLEAU_COUNT && !found; to++) {
        if (moveError(table, WASTE, tableau(to), 1) === null) found = { seed, to }
      }
    }
    expect(found, '40 个种子里总该有一个「翻出来就能落」的开局').not.toBeNull()
    const state = freshState(found!.seed)
    const drawn = reduceState(state, { type: 'tap', id: clickIdOf({ zone: 'stock', index: 0 }) })
    const picked = reduceState(drawn, { type: 'tap', id: clickIdOf(WASTE) })
    expect(picked.selected).toEqual({ pile: WASTE, cardIndex: 0 })
    const moved = reduceState(picked, { type: 'tap', id: clickIdOf(tableau(found!.to)) })
    expect(moved.log).toEqual([
      { kind: 'draw' },
      { kind: 'move', from: WASTE, to: tableau(found!.to), count: 1 },
    ])
    expect(tableOf(moved).waste).toHaveLength(0)
  })
})

describe('撤销 / 重开本局 / 换一局', () => {
  it('撤销回退上一步移动（选中不进日志，所以不会被撤销吃掉）', () => {
    const state = freshState(11)
    expect(() => reduceState(state, { type: 'undo' })).toThrow(IllegalActionError)
    const drawn = reduceState(state, { type: 'tap', id: clickIdOf({ zone: 'stock', index: 0 }) })
    expect(drawn.log).toHaveLength(1)
    const undone = reduceState(drawn, { type: 'undo' })
    expect(undone.log).toEqual([])
    expect(tableOf(undone)).toEqual(tableOf(state))
    // 选中不进日志：选了牌再撤销，撤掉的是上一步移动
    const picked = reduceState(drawn, { type: 'tap', id: clickIdOf(tableau(0), tableOf(drawn).tableau[0]!.cards.length - 1) })
    const undoneWithSelection = reduceState(picked, { type: 'undo' })
    expect(undoneWithSelection.log).toEqual([])
    expect(undoneWithSelection.selected).toBeNull()
  })

  it('重开本局 = 同一编号、同一副牌，从头再来', () => {
    const state = freshState(12)
    let played = state
    for (let step = 0; step < 3; step++) {
      played = reduceState(played, { type: 'tap', id: clickIdOf({ zone: 'stock', index: 0 }) })
    }
    expect(played.log).toHaveLength(3)
    const restarted = reduceState(played, { type: 'restart' })
    expect(restarted.dealNo).toBe(played.dealNo)
    expect(restarted.log).toEqual([])
    expect(restarted.selected).toBeNull()
    expect(tableOf(restarted)).toEqual(tableOf(state))
    // 同一个种子重开出来的牌一模一样（「同编号」的含义）
    expect(tableOf(restarted)).toEqual(freshTable(12))
  })

  it('换一局 = 局号 +1、重新洗牌，且壳层的 nextLevel 是同一件事', () => {
    const state = freshState(13)
    const next = reduceState(state, { type: 'nextDeal' })
    expect(next.dealNo).toBe(1)
    expect(next.log).toEqual([])
    expect(tableOf(next)).not.toEqual(tableOf(state))
    const viaShellName = reduceState(state, { type: 'nextLevel' })
    expect(viaShellName).toEqual(next)
    // 局号参与发牌混合：换一局之后的牌面只由 (seed, dealNo) 决定
    expect(tableOf({ ...state, dealNo: 1 })).toEqual(tableOf({ ...state, dealNo: 1 }))
  })

  it('重开与换一局之后，局面的 52 张牌依旧一张不少', () => {
    const state = reduceState(freshState(14), { type: 'nextDeal' })
    const restarted = reduceState(state, { type: 'restart' })
    for (const candidate of [state, restarted]) {
      expect(allCards(tableOf(candidate)).sort((a, b) => a - b)).toEqual([...ALL_CARD_IDS])
    }
  })
})

describe('存档（种子 + 日志的确定性重放）', () => {
  it('刚开局：encode → decode 往返一致', () => {
    const state = createState(20261010, 'skilled')
    const raw = encodeState(state)
    expect(decodeState(raw)).toEqual(state)
    expect(encodeState(decodeState(raw))).toEqual(raw)
  })

  it('走过若干步（含选中、自动收牌）之后仍然往返一致', () => {
    const rng = createRng(20261010)
    let state = createState(4242, 'starter')
    let applied = 0
    let moves = 0
    for (let step = 0; step < 200; step++) {
      const actions = legalActions(state)
      if (actions.length === 0) break
      const action = actions[rng.int(actions.length)]!
      let next: KlondikeState
      try {
        next = reduceState(state, action)
      } catch {
        continue
      }
      applied++
      if (next.log.length > state.log.length) moves++
      state = next
      // 每一步都走一遍 JSON 存档：encode → JSON → parse → decode → 再 encode 必须逐字节一样
      const raw = JSON.parse(JSON.stringify(encodeState(state)))
      const decoded = decodeState(raw)
      expect(encodeState(decoded)).toEqual(raw)
      // 桌上永远 52 张、没有重复
      expect(allCards(tableOf(state)).sort((a, b) => a - b)).toEqual([...ALL_CARD_IDS])
    }
    // 随机走下来必须真的动过牌（不是在空转）
    expect(applied).toBeGreaterThan(100)
    expect(moves).toBeGreaterThan(0)
  })

  it('选中状态也存得住、读得回', () => {
    const state = freshState(15)
    const top = tableOf(state).tableau[2]!.cards.length - 1
    const picked = reduceState(state, { type: 'tap', id: clickIdOf(tableau(2), top) })
    const decoded = decodeState(encodeState(picked))
    expect(decoded.selected).toEqual({ pile: tableau(2), cardIndex: top })
    expect(decoded).toEqual(picked)
  })

  it('损坏的存档一律抛错（结构、日志、选中三类都挡）', () => {
    const state = freshState(16)
    const raw = encodeState(state) as Record<string, unknown>
    expect(() => decodeState(null)).toThrow(IllegalActionError)
    expect(() => decodeState(42)).toThrow(IllegalActionError)
    expect(() => decodeState({})).toThrow(IllegalActionError)
    expect(() => decodeState({ ...raw, difficulty: 'easy' })).toThrow(IllegalActionError)
    expect(() => decodeState({ ...raw, seed: -1 })).toThrow(IllegalActionError)
    expect(() => decodeState({ ...raw, seed: 1.5 })).toThrow(IllegalActionError)
    expect(() => decodeState({ ...raw, seed: 0x1_0000_0000 })).toThrow(IllegalActionError)
    expect(() => decodeState({ ...raw, dealNo: -1 })).toThrow(IllegalActionError)
    expect(() => decodeState({ ...raw, log: 'nope' })).toThrow(IllegalActionError)
    expect(() => decodeState({ ...raw, log: [{ kind: 'teleport' }] })).toThrow(IllegalActionError)
    expect(() => decodeState({ ...raw, log: [{ kind: 'move', from: { zone: 'tableau', index: 0 }, to: null, count: 1 }] })).toThrow(
      IllegalActionError,
    )
    expect(() =>
      decodeState({ ...raw, log: [{ kind: 'move', from: { zone: 'tableau', index: 0 }, to: { zone: 'tableau', index: 1 }, count: 0 }] }),
    ).toThrow(IllegalActionError)
    // 结构没问题、但这一步根本走不通（抽牌堆不能直接搬）——重放时抛错
    expect(() =>
      decodeState({
        ...raw,
        log: [{ kind: 'move', from: { zone: 'stock', index: 0 }, to: { zone: 'tableau', index: 0 }, count: 1 }],
      }),
    ).toThrow(IllegalActionError)
    // 选中一张牌背 / 选一张基础堆的牌：自相矛盾，挡掉
    const back = tableOf(state).tableau[6]!.cards.length - 1
    expect(() => decodeState({ ...raw, selected: { zone: 'tableau', index: 6, cardIndex: 0 } })).toThrow(IllegalActionError)
    expect(() => decodeState({ ...raw, selected: { zone: 'foundation', index: 0, cardIndex: 0 } })).toThrow(IllegalActionError)
    expect(() => decodeState({ ...raw, selected: { zone: 'waste', index: 0, cardIndex: 3 } })).toThrow(IllegalActionError)
    expect(() => decodeState({ ...raw, selected: { zone: 'tableau', index: 6, cardIndex: back } })).not.toThrow()
  })
})

describe('规则层拒绝不认识的动作', () => {
  it('未知动作 / 方向键一律报错', () => {
    const state = freshState(17)
    expect(() => reduceState(state, { type: 'move', dir: 'up' } as never)).toThrow(IllegalActionError)
    expect(() => reduceState(state, { type: 'restartLevel' } as never)).toThrow(IllegalActionError)
  })
})

describe('合法动作清单', () => {
  it('legal() 列出来的动作都真的能走', () => {
    const state = freshState(18)
    for (const action of legalActions(state)) {
      expect(() => reduceState(state, action)).not.toThrow()
    }
    // 选一段牌之后，清单里应该出现「取消」与「点抽牌堆」
    const top = tableOf(state).tableau[0]!.cards.length - 1
    const picked = reduceState(state, { type: 'tap', id: clickIdOf(tableau(0), top) })
    const ids = legalActions(picked)
      .filter((action): action is { type: 'tap'; id: number } => action.type === 'tap')
      .map((action) => action.id)
    expect(ids).toContain(clickIdOf(tableau(0), top))
    expect(ids).toContain(0)
    for (const action of legalActions(picked)) {
      expect(() => reduceState(picked, action)).not.toThrow()
    }
  })
})
