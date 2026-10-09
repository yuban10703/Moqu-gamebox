/**
 * 抽牌堆抽空之后的「回收」入口：它是**堆级 id**（`CardPileView.id`），不是一张假牌。
 *
 * 由来（2026-10-10 NoteX2 实机走查，问题 2）：连点抽牌堆把 24 张全抽进弃牌堆之后，
 * 抽牌堆仍显示「1 张」、还画着一张牌背（`data-empty=no`），13 堆合计变成 53。
 * 原因是 buildPiles 往 `cards` 里塞了一个「回收」入口（RECYCLE_GLYPH + faceDown），
 * 而壳层按 `cards.length + hidden` 算张数（CardTable.tsx 的 slots）—— 入口被当成了一张牌。
 *
 * 守三件事：
 *   ① 抽空后抽牌堆 `cards: []`、`hidden: 0`（张数 = 0、`data-empty` 正确），但有可点 id；
 *   ② 那个 id 与规则层同源：decodeClickId 解回抽牌堆，selectAction 给出动作，reduce 真的回收；
 *   ③ 抽牌全程 + 回收之后，13 堆的**可见张数合计**始终 = 52（壳层显示的就是这个数）。
 */
import { describe, expect, it } from 'vitest'
import type { CardPileView } from '@eink/core'
import { CARD_COUNT, STOCK, clickIdOf, decodeClickId } from '../src/cards.js'
import { reduceState, tableOf, type KlondikeState } from '../src/engine.js'
import { klondikeGame } from '../src/index.js'
import { freshState } from './helpers.js'

const STOCK_ID = clickIdOf(STOCK)

/** 视图里的 13 个牌堆（顺序：抽牌堆 / 弃牌堆 / 4 个基础堆 / 7 个牌列） */
function pilesOf(state: KlondikeState): CardPileView[] {
  return klondikeGame.view(state).table!.piles!
}

/** 壳层算「这一堆有几张」的公式（CardTable.tsx：slots = cards.length + hidden） */
function slotsOf(pile: CardPileView): number {
  return pile.cards.length + pile.hidden
}

/** 壳层显示出来的 13 堆张数合计 —— 就是走查里量到的那个数（修前会变成 53） */
function visibleTotal(state: KlondikeState): number {
  return pilesOf(state).reduce((sum, pile) => sum + slotsOf(pile), 0)
}

/** 规则层真实的牌数（52 张一张不多一张不少） */
function realTotal(state: KlondikeState): number {
  const table = tableOf(state)
  return (
    table.stock.length +
    table.waste.length +
    table.foundations.reduce((sum, pile) => sum + pile.length, 0) +
    table.tableau.reduce((sum, pile) => sum + pile.cards.length, 0)
  )
}

/** 抽牌堆入口：抽空之前是「一张牌背 + hidden」，抽空之后应当是「空堆 + id」 */
function drawAll(state: KlondikeState): KlondikeState {
  let next = state
  for (let step = 0; step < tableOf(state).stock.length; step++) {
    next = reduceState(next, { type: 'tap', id: STOCK_ID })
  }
  return next
}

describe('抽空抽牌堆：张数是 0，入口是堆级 id', () => {
  it('开局张数照旧（24 = 1 张入口 + 23 hidden），抽空后 cards 为空、hidden 为 0、id 可点', () => {
    const fresh = freshState(2026, 'starter')
    expect(tableOf(fresh).stock).toHaveLength(24)
    const opening = pilesOf(fresh)[0]!
    expect(slotsOf(opening)).toBe(24)
    expect(opening.cards).toHaveLength(1)
    expect(opening.cards[0]!.faceDown).toBe(true)
    // 还有牌可翻时不是空堆：不给堆级 id（入口就是那张牌背）
    expect(opening.id).toBeUndefined()
    expect(visibleTotal(fresh)).toBe(CARD_COUNT)

    // 连点 24 下：每一步的可见张数都必须守恒（走查里 13 堆合计第 24 步变成 53）
    let state = fresh
    for (let step = 0; step < 24; step++) {
      expect(visibleTotal(state), `第 ${step} 步`).toBe(CARD_COUNT)
      state = reduceState(state, { type: 'tap', id: STOCK_ID })
    }
    expect(tableOf(state).stock).toHaveLength(0)
    expect(tableOf(state).waste).toHaveLength(24)

    const stock = pilesOf(state)[0]!
    expect(slotsOf(stock), '抽牌堆张数').toBe(0)
    expect(stock.cards).toEqual([])
    expect(stock.hidden).toBe(0)
    // 空了但还能回收：空位本身带可点编号（壳层据此渲染成按钮，而不是画一张牌背）
    expect(stock.id).toBe(STOCK_ID)
    expect(decodeClickId(stock.id!)).toEqual({ pile: STOCK, cardIndex: 0 })
    // 13 堆一个不少，合计仍然是 52
    expect(pilesOf(state)).toHaveLength(13)
    expect(visibleTotal(state), '13 堆合计').toBe(CARD_COUNT)
    expect(realTotal(state)).toBe(CARD_COUNT)
    // 空位编号不重复出现在任何一张真实牌上（它属于堆，不属于牌）
    const cardIds = pilesOf(state).flatMap((pile) => pile.cards.map((card) => card.id))
    expect(cardIds).not.toContain(stock.id)
  })

  it('端到端：点那个 id → 24 张回到抽牌堆，合计仍 52', () => {
    const empty = drawAll(freshState(2027, 'starter'))
    const id = pilesOf(empty)[0]!.id!
    expect(id).toBe(STOCK_ID)

    // 壳层点空位 → selectAction → reduce，与真机走的是同一条链路
    const action = klondikeGame.selectAction!(empty, id)
    expect(action).toEqual({ type: 'tap', id })
    const recycled = reduceState(empty, action!)
    expect(tableOf(recycled).stock).toHaveLength(24)
    expect(tableOf(recycled).waste).toHaveLength(0)
    expect(visibleTotal(recycled), '回收后的 13 堆合计').toBe(CARD_COUNT)
    expect(realTotal(recycled)).toBe(CARD_COUNT)

    // 回收之后又是有牌可翻的正常状态：入口换回那张牌背（堆级 id 收回去）
    const stock = pilesOf(recycled)[0]!
    expect(slotsOf(stock)).toBe(24)
    expect(stock.cards).toHaveLength(1)
    expect(stock.id).toBeUndefined()
  })

  it('一次翻 3 张（熟练档）同样守恒：抽 8 次抽空，合计仍是 52', () => {
    let state = freshState(2028, 'skilled')
    expect(tableOf(state).stock).toHaveLength(24)
    for (let step = 0; step < 8; step++) {
      expect(visibleTotal(state), `第 ${step} 步`).toBe(CARD_COUNT)
      state = reduceState(state, { type: 'tap', id: STOCK_ID })
    }
    expect(tableOf(state).stock).toHaveLength(0)
    const stock = pilesOf(state)[0]!
    expect(slotsOf(stock)).toBe(0)
    expect(stock.id).toBe(STOCK_ID)
    expect(visibleTotal(state)).toBe(CARD_COUNT)
  })
})
