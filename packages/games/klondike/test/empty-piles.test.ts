/**
 * 空堆的空位（`CardPileView.id`）：空当接龙的核心操作 ——「把 K 放到空列」「把 A 放进空基础堆」
 * —— 在界面上到底有没有可点的入口，以及点了之后规则层认不认。
 *
 * 为什么单独一个文件：这两步要**真的做出来**，得先有一个空列。真发牌里第 1 列开局只发到一张牌，
 * 那张正好是 A 时收进基础堆，这一列就空了 —— 所以这里在种子里搜一个可复现的局面
 * （与 helpers.stateWithRunMove 同一套路），而不是手搓 TableState：
 * 视图只认 (seed, dealNo, log) 复算出来的局面，手搓的牌局喂不进 buildTable。
 *
 * 守三件事：
 *   ① 视图里空列与空基础堆**有可点编号**，编号能原样解回那一堆（与 cards.clickIdOf 同一套体系）；
 *   ② 用那个编号真的能把 K 移到空列、把 A 移到空基础堆（走壳层那条 selectAction → reduce 的路）；
 *   ③ 反过来，非 K 的牌移到空列照样被拒（合法性的唯一判据仍然是 moveError）。
 */
import { describe, expect, it } from 'vitest'
import { IllegalActionError } from '@eink/core'
import {
  RANK_A,
  RANK_K,
  STOCK,
  WASTE,
  clickIdOf,
  decodeClickId,
  foundation,
  rankOf,
  tableau,
} from '../src/cards.js'
import { reduceState, tableOf, type KlondikeState } from '../src/engine.js'
import { klondikeGame } from '../src/index.js'
import { buildTable, clickTargets, emptyPileClickId, isClickable } from '../src/view.js'
import { SPADE, card, emptyTable, freshState, freshTable } from './helpers.js'

const STOCK_ID = clickIdOf(STOCK)

/** selectAction 的一层薄包装：这里只用来强调「点的是壳层递回来的那个编号」 */
function selectOf(state: KlondikeState, id: number) {
  const action = klondikeGame.selectAction!(state, id)
  expect(action, `编号 ${id} 现在应该点得动`).not.toBeNull()
  return action!
}


/** 视图里的 13 个牌堆（顺序：抽牌堆 / 弃牌堆 / 4 个基础堆 / 7 个牌列） */
function pilesOf(state: KlondikeState) {
  return buildTable(state).piles!
}

/** 第一个空牌列（这就是「放 K」的目标） */
function emptyColumn(state: KlondikeState) {
  return pilesOf(state).find((pile) => pile.layout === 'stack' && pile.cards.length === 0) ?? null
}

/** 第一个空基础堆（这就是「放 A」的目标） */
function emptyFoundation(state: KlondikeState) {
  return (
    pilesOf(state).find(
      (pile) => pile.labelKey === 'klondike.pile.foundation' && pile.cards.length === 0,
    ) ?? null
  )
}

interface Scenario {
  /** 开局局面（4 个基础堆全空、第 1 列只有一张 A）：演示「A 进空基础堆」用它 */
  initial: KlondikeState
  /** 第 1 列已经空了，而且手上（弃牌堆顶或某一列的列顶）有一张能放上去的 K */
  state: KlondikeState
  /** 第 1 列开局那张 A 的点击编号 */
  aceId: number
  /** 把那张 A 放进去的空基础堆编号（**视图给的**，不是测试自己算的） */
  aceFoundationId: number
  /** 放完 A 之后**仍然空着**的另一个基础堆编号（视图给的） */
  emptyFoundationId: number
  /** 空列的编号（视图给的） */
  emptyColumnId: number
  /** 那张能放到空列上的 K 的编号 */
  kingId: number
}

/**
 * 搜一个可复现的局面：第 1 列开局是单张 A（收进基础堆 → 这一列空出来），
 * 之后翻牌 / 看列顶找一张能放到空列上的 K。种子从 1 往上搜，搜不到就抛（说明发牌规则改了）。
 */
function searchScenario(): Scenario {
  for (let seed = 1; seed <= 400; seed++) {
    const deal = freshTable(seed)
    const first = deal.tableau[0]!
    // 发牌规则：第 i 列发 i+1 张 —— 第 1 列只有一张，它正好是 A 时这一列能空出来
    if (first.cards.length !== 1 || rankOf(first.cards[0]!) !== RANK_A) continue

    const initial = freshState(seed)
    const aceId = clickIdOf(tableau(0), 0)
    const aceFoundation = emptyFoundation(initial)
    if (!aceFoundation || aceFoundation.id === undefined) continue

    // ① 这张 A 进空基础堆（用的就是视图给的空基础堆编号）
    let state = reduceState(initial, { type: 'tap', id: aceId })
    state = reduceState(state, { type: 'tap', id: aceFoundation.id })
    const empty = emptyColumn(state)
    const stillEmpty = emptyFoundation(state)
    if (!empty || empty.id === undefined || !stillEmpty || stillEmpty.id === undefined) continue

    // ② 找一张 K：先看弃牌堆顶与各列列顶，都没有就继续翻牌（最多翻空整个抽牌堆）
    for (let step = 0; step <= 24; step++) {
      const table = tableOf(state)
      const rest = {
        initial,
        state,
        aceId,
        aceFoundationId: aceFoundation.id,
        emptyFoundationId: stillEmpty.id,
        emptyColumnId: empty.id,
      }
      const wasteTop = table.waste[table.waste.length - 1]
      if (wasteTop !== undefined && rankOf(wasteTop) === RANK_K) {
        return { ...rest, kingId: clickIdOf(WASTE) }
      }
      const column = table.tableau.findIndex(
        (pile) => pile.cards.length > 0 && rankOf(pile.cards[pile.cards.length - 1]!) === RANK_K,
      )
      if (column >= 0) {
        const cards = table.tableau[column]!.cards
        return { ...rest, kingId: clickIdOf(tableau(column), cards.length - 1) }
      }
      if (table.stock.length === 0) break
      state = reduceState(state, { type: 'tap', id: STOCK_ID })
    }
  }
  throw new Error('种子 1..400 里没有搜到「第 1 列是单张 A」的可复现局面（发牌规则改了吗？）')
}

// 搜索只做一次：局面是纯数据，测试里只用 reduceState（纯函数）派生新局面，不会改它
let cached: Scenario | null = null
function scenario(): Scenario {
  cached ??= searchScenario()
  return cached
}

describe('① 视图：空列与空基础堆都有可点编号', () => {
  it('空列的编号 = 那一列的 clickIdOf，空基础堆的编号 = 那个基础堆的 clickIdOf，都能解回自己', () => {
    const { state, emptyColumnId, emptyFoundationId } = scenario()
    const table = tableOf(state)

    const column = emptyColumn(state)!
    expect(column.cards).toEqual([])
    expect(column.hidden).toBe(0)
    expect(column.id).toBe(emptyColumnId)
    expect(table.tableau[0]!.cards).toEqual([])
    // 编号与牌上的编号同一套体系：解回来就是「第 1 列的第 0 张」
    expect(decodeClickId(emptyColumnId)).toEqual({ pile: tableau(0), cardIndex: 0 })
    expect(emptyPileClickId(table, tableau(0))).toBe(emptyColumnId)

    const pile = emptyFoundation(state)!
    expect(pile.id).toBe(emptyFoundationId)
    const decoded = decodeClickId(emptyFoundationId)!
    expect(decoded.pile.zone).toBe('foundation')
    expect(decoded.cardIndex).toBe(0)
    expect(table.foundations[decoded.pile.index]).toEqual([])
    expect(emptyPileClickId(table, decoded.pile)).toBe(emptyFoundationId)
  })

  it('空位编号与牌上的编号不冲突；不空的堆一个空位编号都不给（界面上不会多出按钮）', () => {
    const { state, emptyColumnId, emptyFoundationId } = scenario()
    const ids = clickTargets(state).map((target) => target.id)
    expect(ids).not.toContain(emptyColumnId)
    expect(ids).not.toContain(emptyFoundationId)

    const table = tableOf(state)
    const piles = pilesOf(state)
    // 13 个堆：张数 = cards + hidden，且**只有空牌列 / 空基础堆**带空位编号
    expect(piles).toHaveLength(13)
    for (const pile of piles) {
      const slots = pile.cards.length + pile.hidden
      if (pile.cards.length > 0) {
        expect(pile.id).toBeUndefined()
        continue
      }
      if (pile.labelKey === 'klondike.pile.stock' || pile.labelKey === 'klondike.pile.waste') {
        // 抽牌堆 / 弃牌堆不给空位入口：抽牌堆空了还能回收时它已经是一个可点的牌背入口
        expect(pile.id).toBeUndefined()
        continue
      }
      expect(slots).toBe(0)
      expect(pile.id).toBeDefined()
    }
    // 空基础堆的空位编号就是 foundation(0..3) 的那几个（没有多给也没有少给）
    const emptyFoundations = table.foundations.filter((cards) => cards.length === 0).length
    const foundationIds = piles.filter((pile) => pile.labelKey === 'klondike.pile.foundation' && pile.id !== undefined)
    expect(foundationIds).toHaveLength(emptyFoundations)
  })

  it('没提起牌时空位点不动；提起一段之后它就是可点目标（壳层的 selectAction 也认）', () => {
    const { state, emptyColumnId, emptyFoundationId, kingId } = scenario()
    // 没提起牌：空位画得出来，但点它没有任何动作 → isClickable false、selectAction null
    expect(isClickable(state, emptyColumnId)).toBe(false)
    expect(klondikeGame.selectAction!(state, emptyColumnId)).toBeNull()
    expect(isClickable(state, emptyFoundationId)).toBe(false)
    expect(klondikeGame.selectAction!(state, emptyFoundationId)).toBeNull()

    // 提起一张牌之后：两个空位都是可点目标（放不放得下由规则层的 moveError 判）
    const picked = reduceState(state, klondikeGame.selectAction!(state, kingId)!)
    expect(picked.selected).not.toBeNull()
    expect(isClickable(picked, emptyColumnId)).toBe(true)
    expect(klondikeGame.selectAction!(picked, emptyColumnId)).toEqual({ type: 'tap', id: emptyColumnId })
    expect(isClickable(picked, emptyFoundationId)).toBe(true)
    expect(klondikeGame.selectAction!(picked, emptyFoundationId)).toEqual({ type: 'tap', id: emptyFoundationId })
  })

  it('空位编号只对「空堆」成立，而且抽牌堆 / 弃牌堆永远没有', () => {
    const empty = emptyTable()
    expect(emptyPileClickId(empty, tableau(3))).toBe(clickIdOf(tableau(3), 0))
    expect(emptyPileClickId(empty, foundation(2))).toBe(clickIdOf(foundation(2)))
    expect(emptyPileClickId(empty, STOCK)).toBeUndefined()
    expect(emptyPileClickId(empty, WASTE)).toBeUndefined()
    // 有牌了就不给：这一堆画的是牌，不是空位
    const filled = emptyTable({ foundations: [[card(RANK_A, SPADE)], [], [], []] })
    expect(emptyPileClickId(filled, foundation(0))).toBeUndefined()
    expect(emptyPileClickId(filled, foundation(1))).toBe(clickIdOf(foundation(1)))
  })
})

describe('② 用空位的编号真的能放牌', () => {
  it('A 点进空基础堆（点的是视图给的空基础堆编号）', () => {
    const { initial, aceId, aceFoundationId, state } = scenario()
    const ace = tableOf(initial).tableau[0]!.cards[0]!
    const picked = reduceState(initial, selectOf(initial, aceId))
    expect(picked.selected).not.toBeNull()
    // 规则层的合法动作清单里也有这个编号：视图给的 = 规则层认的（两边同一套编号，不会各说各话）
    expect(klondikeGame.legal(picked)).toContainEqual({ type: 'tap', id: aceFoundationId })

    const placed = reduceState(picked, selectOf(picked, aceFoundationId))
    const index = decodeClickId(aceFoundationId)!.pile.index
    expect(tableOf(placed).foundations[index]).toEqual([ace])
    // 第 1 列腾空了：这一列真的空出来了（不是"看起来空"）—— scenario 里那个空列就是这么来的
    expect(tableOf(placed).tableau[0]!.cards).toEqual([])
    expect(emptyColumn(placed)?.id).toBe(emptyColumn(state)?.id)
    // 这一步记进了日志（可撤销）：空位放牌走的是与牌堆之间搬牌完全同一条 move 通道
    expect(placed.log).toEqual([{ kind: 'move', from: tableau(0), to: foundation(index), count: 1 }])
  })

  it('K 移到空列（点的是视图给的空列编号）', () => {
    const { state, emptyColumnId, kingId } = scenario()
    const picked = reduceState(state, klondikeGame.selectAction!(state, kingId)!)
    expect(picked.selected).not.toBeNull()
    // legal() 里也列着这个空列编号（规则层列的合法目标 = 界面上点得动的空位）
    expect(klondikeGame.legal(picked)).toContainEqual({ type: 'tap', id: emptyColumnId })

    const moved = reduceState(picked, klondikeGame.selectAction!(picked, emptyColumnId)!)
    const column = tableOf(moved).tableau[0]!
    expect(column.cards).toHaveLength(1)
    expect(rankOf(column.cards[0]!)).toBe(RANK_K)
    expect(column.faceDown).toBe(0)
    // 这一列有牌之后空位编号跟着消失（界面上不再画空位按钮）
    expect(emptyColumn(moved)).toBeNull()
    expect(moved.log).toHaveLength(state.log.length + 1)
    // 撤销回到原样（空位又能用了）—— 说明这一步真的进了日志，不是界面上的假动作
    const undone = reduceState(moved, { type: 'undo' })
    expect(tableOf(undone).tableau[0]!.cards).toEqual([])
    expect(emptyColumn(undone)?.id).toBe(emptyColumnId)
  })
})

describe('③ 非法的一步仍然被拒（moveError 是唯一判据）', () => {
  it('非 K 的牌放到空列：selectAction 给得出动作，reduce 抛错，空列照旧空着', () => {
    const { state, emptyColumnId, kingId } = scenario()
    const table = tableOf(state)
    // 找一张**不是 K** 的列顶牌（那个 K 自己那一列不能当反例：它本来就放得下）
    const source = table.tableau.findIndex((pile, index) => {
      if (index === 0 || pile.cards.length === 0) return false
      const top = pile.cards[pile.cards.length - 1]!
      return rankOf(top) !== RANK_K && clickIdOf(tableau(index), pile.cards.length - 1) !== kingId
    })
    expect(source).toBeGreaterThan(0)
    const sourceId = clickIdOf(tableau(source), table.tableau[source]!.cards.length - 1)
    const sourceCard = table.tableau[source]!.cards[table.tableau[source]!.cards.length - 1]!

    const picked = reduceState(state, selectOf(state, sourceId))
    expect(picked.selected).toEqual({ pile: tableau(source), cardIndex: table.tableau[source]!.cards.length - 1 })
    // 壳层那条通道照样给得出动作（界面不替规则做判断）……
    const action = klondikeGame.selectAction!(picked, emptyColumnId)
    expect(action).toEqual({ type: 'tap', id: emptyColumnId })
    // ……规则层拒绝：非 K 起不了空列
    expect(() => reduceState(picked, action!)).toThrow(IllegalActionError)
    expect(tableOf(picked).tableau[0]!.cards).toEqual([])
    expect(rankOf(sourceCard)).not.toBe(RANK_K)
  })
})

