// @vitest-environment jsdom
/**
 * 空当接龙抽空抽牌堆之后，壳层**显示出来的**张数与空堆状态（走查问题 2 的用户可见面）。
 *
 * 走查实测（NoteX2）：连点抽牌堆把 24 张全抽进弃牌堆后，抽牌堆那格写着「1 张」、还画着一张牌背
 * （`data-empty=no`），13 堆张数合计 53。根因在玩法视图：回收入口当初是往 `cards` 里塞的一张假牌，
 * 而壳层按 `cards.length + hidden` 算张数（CardTable.tsx 的 slots）。
 *
 * 这里把**真实的**空当接龙视图喂给真实的 CardTable，量的就是玩家看到的两个数：
 *   ① 抽牌堆那格的张数文案 = 0 张、`data-empty=yes`、不画牌背，但空位仍是可点按钮；
 *   ② 13 堆张数文案合计 = 52；点那个空位回传的编号能真的把 24 张收回来（合计仍 52）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { coreDictEn, createMemoryKv } from '@eink/core'
import { createPlatform } from '@eink/platform'
import { STOCK, buildTable, clickIdOf, klondikeEn, klondikeGame, reduceState } from '@eink/klondike'
import { CardTable } from '../src/CardTable.js'
import { UiProvider } from '../src/contexts.js'

afterEach(cleanup)

const dicts = { 'en-US': { ...coreDictEn, ...klondikeEn } }
const STOCK_ID = clickIdOf(STOCK)

/** 抽牌堆原始张数（开局 24 张） */
const STOCK_CARDS = 24

/** 连点抽牌堆，把整叠抽空（走查里的复现步骤） */
function drawAll(seed: number): ReturnType<typeof klondikeGame.create> {
  let state = klondikeGame.create(seed, 'starter')
  for (let step = 0; step < STOCK_CARDS; step++) {
    state = reduceState(state, { type: 'tap', id: STOCK_ID })
  }
  return state
}

async function mount(state: ReturnType<typeof klondikeGame.create>, onCardSelect?: (id: number) => void) {
  const platform = await createPlatform({ kv: createMemoryKv() })
  return render(
    <UiProvider
      platform={platform}
      dicts={dicts}
      initialSettings={{ locale: 'en-US', fontScale: 1, timer: true, dpad: false, boldLines: true, perGame: {} }}
    >
      <CardTable table={buildTable(state)} {...(onCardSelect ? { onCardSelect } : {})} />
    </UiProvider>,
  )
}

/** 壳层写在每一堆小标题下面的张数文案 → 数字 */
function countOf(pile: Element): number {
  const text = pile.querySelector('.eink-pile__count')?.textContent ?? ''
  const match = /\d+/.exec(text)
  if (!match) throw new Error(`pile count not readable: ${text}`)
  return Number(match[0])
}

function pilesOf(container: HTMLElement): Element[] {
  return Array.from(container.querySelectorAll('.eink-pile'))
}

describe('抽空后的抽牌堆在壳层里的样子', () => {
  it('显示 0 张、data-empty=yes、不画牌背，但空位仍是一个可点按钮', async () => {
    const { container } = await mount(drawAll(2026))
    const piles = pilesOf(container)
    expect(piles).toHaveLength(13)

    const stock = piles[0]!
    expect(stock.querySelector('.eink-pile__label')?.textContent).toBe('Stock')
    expect(stock.querySelector('.eink-pile__count')?.textContent).toBe('0 cards')
    expect(countOf(stock)).toBe(0)
    expect(stock.getAttribute('data-empty')).toBe('yes')
    // 一张牌背都不许画（修前这里有那张「回收」假牌，看起来像还剩一张可翻）
    expect(stock.querySelectorAll('.eink-card--back')).toHaveLength(0)
    // 空位本身是可点按钮（回收入口）—— 整堆只有这一个可点元素
    const slot = stock.querySelector<HTMLButtonElement>('button.eink-card--pile[data-empty="yes"]')
    expect(slot).not.toBeNull()
    expect(stock.querySelectorAll('button')).toHaveLength(1)
    expect(slot!.getAttribute('aria-label')).toBe('Stock · 0 cards')
  })

  it('13 堆张数文案合计 52；点空位回传抽牌堆编号，回收后又是 24 张', async () => {
    const empty = drawAll(2027)
    const onSelect = vi.fn()
    const { container } = await mount(empty, onSelect)

    const counts = pilesOf(container).map(countOf)
    expect(counts).toHaveLength(13)
    expect(counts.reduce((sum, value) => sum + value, 0)).toBe(52)
    expect(counts[0]).toBe(0)
    expect(counts[1]).toBe(24) // 弃牌堆：24 张全在它那儿

    // 点空位 → 壳层把抽牌堆的编号递回来（与规则层同源）
    const slot = container.querySelector<HTMLButtonElement>('button.eink-card--pile[data-empty="yes"]')!
    fireEvent.click(slot)
    expect(onSelect).toHaveBeenCalledWith(STOCK_ID)

    // 拿这个编号走一遍规则层：24 张整叠回到抽牌堆
    const action = klondikeGame.selectAction!(empty, STOCK_ID)
    expect(action).toEqual({ type: 'tap', id: STOCK_ID })
    const recycled = reduceState(empty, action!)
    const { container: after } = await mount(recycled)
    const afterCounts = pilesOf(after).map(countOf)
    expect(afterCounts[0]).toBe(24)
    expect(afterCounts[1]).toBe(0)
    expect(afterCounts.reduce((sum, value) => sum + value, 0)).toBe(52)
    const table = buildTable(recycled).piles!
    expect(table[0]!.cards).toHaveLength(1)
    expect(table[0]!.id).toBeUndefined()
  })
})
