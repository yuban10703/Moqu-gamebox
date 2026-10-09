// @vitest-environment jsdom
/**
 * 牌堆布局（`CardTableView.piles`）：空当接龙这类「一桌 13 个牌堆、每个都能点」的玩法用。
 *
 * 由来：`CardTable` 原来只给 `hand` 那一行的牌绑了点击，`center` / `played` / 座位块全是 `<span>`，
 * 而空当接龙有 13 个各自可点的牌堆 —— 权宜做法是把整桌牌摊成一条塞进 `hand`，
 * 功能通了但竖着的牌列在屏幕上变成一条横条，只能靠固定顺序辨认。
 * 现在给牌桌加了**可选**的 piles 布局（不给就还是老样子），这里守四件事：
 *   ① 没有 piles 时老牌桌一个字节都不变（斗地主那条通道的回归护栏）；
 *   ② 有 piles 时**每张牌都是可点 button**，点击回传的 id 与 `cards[].id` 一一对应；
 *   ③ `layout:'row'` 与 `'stack'` 两种排布都渲染出来，`hidden` 张画牌背（斜纹、不发牌面、不用字符冒充）；
 *   ④ `selected` 的牌堆带标记属性（线宽 / 线型 / 反白由 CSS 给）。
 *   ⑤ **空堆**（`cards: []`）给了 `id` 时空位本身是可点 button（点击回传这个 id）；
 *      没给 `id` 时空位保持原来的虚线占位、点不动 —— 空当接龙「把 K 放到空列 / 把 A 放进空基础堆」
 *      靠 ⑤ 才有下手的地方（引擎一直支持，缺的只是界面入口）。
 *
 * 另外把「放得下」的那几条 CSS 关键值钉在源码文本上（jsdom 不加载样式表，算不出 grid 与 cq 单位）——
 * 与 duel-items-css.test.ts / board-css-layout.test.tsx 同一套路：谁改了这些值，这条会红。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { createMemoryKv, coreDictEn, type CardFace, type CardPileView, type CardTableView } from '@eink/core'
import { createPlatform } from '@eink/platform'
import { CardTable } from '../src/CardTable.js'
import { UiProvider } from '../src/contexts.js'

afterEach(cleanup)

// jsdom 环境里 import.meta.url 不是 file://（duel-items-css.test.ts 是 node 环境所以能用），
// 这里按仓库根目录取 —— vitest 的 root 就是仓库根（npm scripts 也从根跑）。
const css = readFileSync(resolve(process.cwd(), 'packages/ui/src/styles.css'), 'utf8')

function ruleBody(selector: string): string {
  const index = css.indexOf(selector)
  expect(index, `styles.css 里找不到 ${selector}`).toBeGreaterThanOrEqual(0)
  const open = css.indexOf('{', index)
  const close = css.indexOf('}', open)
  return css.slice(open + 1, close)
}

const dicts = {
  'en-US': {
    ...coreDictEn,
    'test.pile.stock': 'Stock',
    'test.pile.waste': 'Waste',
    'test.pile.foundation': 'Foundation',
    'test.pile.tableau': 'Column',
    'test.banner': 'tap a card',
  },
}

function card(id: number, rank: string, suit: CardFace['suit'] = 'spade', patch: Partial<CardFace> = {}): CardFace {
  return { id, rank, suit, ...patch }
}

/** 老牌桌（没有 piles）：两家座位 + 一张底牌 + 三张手牌 —— 斗地主用的就是这条通道 */
function handTable(): CardTableView {
  return {
    kind: 'cards',
    seats: [
      { position: 'left', nameKey: 'test.pile.foundation', avatar: 0, count: 17, active: true, played: [card(900, '3')] },
      { position: 'right', nameKey: 'test.pile.waste', avatar: 1, count: 17, active: false, played: null },
    ],
    center: { cards: [card(901, 'A', 'heart')], hidden: 2 },
    hand: [card(10, '3'), card(11, 'K', 'heart'), card(12, '2', 'club')],
    bannerKey: 'test.banner',
  }
}

/**
 * 空当接龙的形状：上排 6 个横排堆（抽牌堆 / 弃牌堆 / 4 个基础堆）+ 下排 7 个竖排牌列。
 * 抽牌堆刻意做成「整堆只有一个入口」：一张 faceDown 的牌当可点编号 + hidden 里记其余张数。
 */
function pileTable(): CardTableView {
  const piles: CardPileView[] = [
    { labelKey: 'test.pile.stock', cards: [card(100, '', null, { faceDown: true })], hidden: 3, layout: 'row' },
    { labelKey: 'test.pile.waste', cards: [card(200, 'K', 'heart')], hidden: 0, layout: 'row' },
  ]
  for (let index = 0; index < 4; index++) {
    // 第一堆有牌、其余三堆是空位（空位画虚线框、没有可点的牌）
    piles.push({
      labelKey: 'test.pile.foundation',
      cards: index === 0 ? [card(300 + index, 'A')] : [],
      hidden: 0,
      layout: 'row',
    })
  }
  for (let column = 0; column < 7; column++) {
    piles.push({
      labelKey: 'test.pile.tableau',
      cards: [
        card(400 + column * 10, String(column + 2)),
        card(401 + column * 10, '9', 'club', { selected: column === 0 }),
      ],
      hidden: column === 1 ? 2 : 0,
      layout: 'stack',
      ...(column === 2 ? { selected: true } : {}),
    })
  }
  return { kind: 'cards', seats: [], center: null, hand: [], piles, bannerKey: 'test.banner' }
}

/** 牌堆在 DOM 里的顺序：先上排（layout:'row'），再下排（layout:'stack'），堆内按 cards 顺序 */
function domOrder(piles: readonly CardPileView[]): number[] {
  return [...piles.filter((pile) => pile.layout === 'row'), ...piles.filter((pile) => pile.layout !== 'row')]
    .flatMap((pile) => pile.cards.map((face) => face.id))
}

/**
 * 空堆的形状（空当接龙接上空位入口以后的样子）：
 *   - 横排的空基础堆**给了 id**（放 A 的入口）；
 *   - 横排的另一个空基础堆**没给 id**（回归：虚线占位、点不动）；
 *   - 竖排的空牌列**给了 id**（放 K 的入口）。
 */
function emptyPileTable(): CardTableView {
  const piles: CardPileView[] = [
    { labelKey: 'test.pile.stock', cards: [card(100, '', null, { faceDown: true })], hidden: 3, layout: 'row' },
    { labelKey: 'test.pile.foundation', cards: [], hidden: 0, layout: 'row', id: 70 },
    { labelKey: 'test.pile.foundation', cards: [], hidden: 0, layout: 'row' },
  ]
  for (let column = 0; column < 7; column++) {
    piles.push(
      column === 3
        ? { labelKey: 'test.pile.tableau', cards: [], hidden: 0, layout: 'stack', id: 600 }
        : { labelKey: 'test.pile.tableau', cards: [card(400 + column, String(column + 2))], hidden: 0, layout: 'stack' },
    )
  }
  return { kind: 'cards', seats: [], center: null, hand: [], piles, bannerKey: 'test.banner' }
}

async function mount(table: CardTableView, onCardSelect?: (id: number) => void) {
  const platform = await createPlatform({ kv: createMemoryKv() })
  return render(
    <UiProvider
      platform={platform}
      dicts={dicts}
      initialSettings={{ locale: 'en-US', fontScale: 1, timer: true, dpad: false, boldLines: true, perGame: {} }}
    >
      <CardTable table={table} {...(onCardSelect ? { onCardSelect } : {})} />
    </UiProvider>,
  )
}

describe('① 没有 piles：老牌桌一个字节都不变（回归）', () => {
  it('不渲染任何牌堆元素，座位 / 底牌 / 手牌照旧', async () => {
    const { container } = await mount(handTable())
    expect(container.querySelector('.eink-cardtable')).not.toBeNull()
    expect(container.querySelector('.eink-cardtable--piles')).toBeNull()
    expect(container.querySelectorAll('.eink-pile')).toHaveLength(0)
    expect(container.querySelectorAll('.eink-cardpiles__row')).toHaveLength(0)

    expect(container.querySelectorAll('.eink-cardtable__seat')).toHaveLength(2)
    expect(container.querySelector('.eink-cardtable__center .eink-cardrow')).not.toBeNull()
    expect(container.querySelector('.eink-cardtable__banner')?.textContent).toBe('tap a card')
    expect(container.querySelectorAll('.eink-cardtable__hand button')).toHaveLength(3)
  })

  it('手牌那条点击通道照旧：点第几张就回传第几张的 id', async () => {
    const onSelect = vi.fn()
    const { container } = await mount(handTable(), onSelect)
    const buttons = container.querySelectorAll<HTMLButtonElement>('.eink-cardtable__hand button')
    for (const button of buttons) fireEvent.click(button)
    expect(onSelect.mock.calls.map(([id]) => id)).toEqual([10, 11, 12])
  })

  it('空数组的 piles 也走老布局（"给了就渲染"的前提是非空）', async () => {
    const { container } = await mount({ ...handTable(), piles: [] })
    expect(container.querySelector('.eink-cardtable--piles')).toBeNull()
    expect(container.querySelectorAll('.eink-cardtable__hand button')).toHaveLength(3)
  })
})

describe('② 有 piles：每张牌都是可点 button，id 原样回传', () => {
  it('按钮数 = cards 张数，点击顺序与「上排 → 下排、堆内按 cards 顺序」一致', async () => {
    const table = pileTable()
    const onSelect = vi.fn()
    const { container } = await mount(table, onSelect)
    const buttons = container.querySelectorAll<HTMLButtonElement>('button.eink-card--pile')
    const expected = domOrder(table.piles!)
    expect(buttons).toHaveLength(expected.length)
    for (const button of buttons) fireEvent.click(button)
    expect(onSelect.mock.calls.map(([id]) => id)).toEqual(expected)
    // 牌背（faceDown）也是可点的入口：抽牌堆整堆只有它一张有编号
    expect(expected[0]).toBe(100)
  })

  it('没有 onCardSelect 时按钮照旧渲染（只是点不动，不炸）', async () => {
    const { container } = await mount(pileTable())
    expect(container.querySelectorAll('button.eink-card--pile').length).toBeGreaterThan(0)
    expect(() => fireEvent.click(container.querySelector('button.eink-card--pile')!)).not.toThrow()
  })
})

describe('③ 两种排布都渲染；hidden 张画牌背、不发牌面', () => {
  it('上排是 layout:row 的横排堆，下排是 layout:stack 的 7 列竖排牌列', async () => {
    const { container } = await mount(pileTable())
    const row = container.querySelector('.eink-cardpiles__row')!
    const grid = container.querySelector('.eink-cardpiles__grid')!
    expect(row.querySelectorAll(':scope > .eink-pile[data-layout="row"]')).toHaveLength(6)
    expect(grid.querySelectorAll(':scope > .eink-pile[data-layout="stack"]')).toHaveLength(7)
    // 每一堆都有小标题与张数
    const first = row.querySelector('.eink-pile')!
    expect(first.querySelector('.eink-pile__label')?.textContent).toBe('Stock')
    expect(first.querySelector('.eink-pile__count')?.textContent).toBe('4 cards')
    // 空堆标出来（CSS 给虚线框）
    expect(grid.querySelectorAll('.eink-pile[data-empty="yes"]')).toHaveLength(0)
    expect(row.querySelectorAll('.eink-pile[data-empty="yes"]')).toHaveLength(3)
  })

  it('hidden 张画的是牌背：斜纹类名、没有牌面、也不拿字符冒充', async () => {
    const { container } = await mount(pileTable())
    const stock = container.querySelector('.eink-cardpiles__row > .eink-pile')!
    const backs = stock.querySelectorAll('.eink-card--back')
    // 抽牌堆：1 张 faceDown 的入口 + hidden 3 张牌背
    expect(backs).toHaveLength(4)
    const decorative = stock.querySelectorAll('span.eink-card--pile.eink-card--back')
    expect(decorative).toHaveLength(3)
    for (const back of decorative) {
      expect(back.querySelector('.eink-card__corner')).toBeNull() // 不发牌面
      expect(back.textContent).toBe('') // 「▨」这种字符冒充牌背在这里会被抓到
      expect(back.getAttribute('role')).toBe('img')
    }
    // 牌列里同样：第 2 列 hidden 2 张
    const stacks = container.querySelectorAll('.eink-cardpiles__grid > .eink-pile')
    expect(stacks[1]!.querySelectorAll('span.eink-card--pile.eink-card--back')).toHaveLength(2)
    expect(stacks[0]!.querySelectorAll('.eink-card--back')).toHaveLength(0)
  })

  it('faceDown 的牌按钮上带标记：不给它画点数花色', async () => {
    const { container } = await mount(pileTable())
    const stock = container.querySelector('.eink-cardpiles__row > .eink-pile')!
    const entry = stock.querySelector<HTMLButtonElement>('button.eink-card--pile')!
    expect(entry.getAttribute('data-face-down')).toBe('yes')
    expect(entry.className).toContain('eink-card--back')
    expect(entry.querySelector('.eink-card__corner')).toBeNull()
    // 明牌不带这个标记，牌面照画
    const waste = container.querySelectorAll('.eink-cardpiles__row > .eink-pile')[1]!
    const faceUp = waste.querySelector<HTMLButtonElement>('button.eink-card--pile')!
    expect(faceUp.getAttribute('data-face-down')).toBeNull()
    expect(faceUp.querySelector('.eink-card__rank')?.textContent).toBe('K')
  })
})

describe('④ selected 的牌堆带标记属性（怎么画由 CSS 决定）', () => {
  it('选中的堆 data-selected=yes，其余是 no', async () => {
    const { container } = await mount(pileTable())
    const stacks = container.querySelectorAll('.eink-cardpiles__grid > .eink-pile')
    expect(stacks[2]!.getAttribute('data-selected')).toBe('yes')
    expect(stacks[0]!.getAttribute('data-selected')).toBe('no')
    // 牌本身的选中状态也要带出来（提起来的那几张）
    expect(stacks[0]!.querySelector('.eink-card--pile[data-selected="yes"]')).not.toBeNull()
    expect(stacks[1]!.querySelector('.eink-card--pile[data-selected="yes"]')).toBeNull()
  })

  it('CSS 里选中的堆靠线宽 / 线型（outline），不靠颜色或灰度', () => {
    const body = ruleBody(".eink-pile[data-selected='yes'] {")
    expect(body).toMatch(/outline:\s*calc\(var\(--line\)/)
    // outline 不占布局：选中 / 取消不会让牌挪一像素
    expect(body).not.toMatch(/border-width/)
    expect(body).not.toMatch(/color|opacity|gray|#[0-9a-fA-F]{3,6}/)
    // 堆名反白（黑底白字）是第二重标记
    const label = ruleBody(".eink-pile[data-selected='yes'] > .eink-pile__head > .eink-pile__label {")
    expect(label).toMatch(/background:\s*var\(--ink-black\)/)
    expect(label).toMatch(/color:\s*var\(--ink-white\)/)
  })
})

describe('⑤ 空堆的空位：给了 id 就是可点按钮，没给就还是不可点（回归）', () => {
  it('空基础堆 / 空牌列有 id → 渲染成可点 button，点击回传这个 id', async () => {
    const onSelect = vi.fn()
    const { container } = await mount(emptyPileTable(), onSelect)
    const slots = container.querySelectorAll<HTMLButtonElement>('button.eink-card--pile[data-empty="yes"]')
    expect(slots).toHaveLength(2)
    // 一个在上排（横排的空基础堆）、一个在下排（竖排的空牌列）
    expect(slots[0]!.closest('.eink-cardpiles__row')).not.toBeNull()
    expect(slots[1]!.closest('.eink-cardpiles__grid')).not.toBeNull()
    for (const slot of slots) fireEvent.click(slot)
    expect(onSelect.mock.calls.map(([id]) => id)).toEqual([70, 600])
  })

  it('空位按钮键盘可达（本来就是 button），并且带无障碍名', async () => {
    const { container } = await mount(emptyPileTable())
    const slot = container.querySelector<HTMLButtonElement>('button.eink-card--pile[data-empty="yes"]')!
    expect(slot.tagName).toBe('BUTTON')
    expect(slot.getAttribute('type')).toBe('button')
    expect(slot.disabled).toBe(false)
    // 堆名 + 张数：读屏听到「Foundation · 0 cards」才知道这儿是个空位
    expect(slot.getAttribute('aria-label')).toBe('Foundation · 0 cards')
    // 空位里不画牌面（它是空位，不是一张牌）
    expect(slot.textContent).toBe('')
    expect(slot.querySelector('.eink-card__corner')).toBeNull()
  })

  it('没有 onCardSelect 时空位照旧渲染（只是点不动，不炸）', async () => {
    const { container } = await mount(emptyPileTable())
    const slots = container.querySelectorAll('button.eink-card--pile[data-empty="yes"]')
    expect(slots).toHaveLength(2)
    expect(() => fireEvent.click(slots[0]!)).not.toThrow()
  })

  it('没有 id 的空堆：还是虚线占位、一个按钮都没有（点了也不回传）', async () => {
    const onSelect = vi.fn()
    const { container } = await mount(emptyPileTable(), onSelect)
    const row = container.querySelector('.eink-cardpiles__row')!
    const piles = row.querySelectorAll(':scope > .eink-pile')
    expect(piles).toHaveLength(3)
    // 第 3 堆没给 id：data-empty 还在（CSS 的虚线框照旧），但里面没有任何可点元素
    expect(piles[2]!.getAttribute('data-empty')).toBe('yes')
    expect(piles[2]!.querySelectorAll('button')).toHaveLength(0)
    expect(piles[1]!.querySelectorAll('button.eink-card--pile[data-empty="yes"]')).toHaveLength(1)
    // 点这一堆里能找到的一切，回传的编号里没有它那一堆的（它连编号都没有）
    expect(onSelect).not.toHaveBeenCalled()
  })
})

describe('放得下：牌堆布局的 CSS 关键值', () => {
  it('下排是 7 列网格，上排是均分的横排', () => {
    const grid = ruleBody('.eink-cardpiles__grid {')
    expect(grid).toMatch(/grid-template-columns:\s*repeat\(7,\s*minmax\(0,\s*1fr\)\)/)
    const row = ruleBody('.eink-cardpiles__row {')
    expect(row).toMatch(/flex-wrap:\s*wrap/)
  })

  it('尺寸走容器单位（cqw / cqh），并夹 48px 触摸下限', () => {
    const root = ruleBody('.eink-cardtable.eink-cardtable--piles {')
    expect(root).toMatch(/--pile-tap:\s*48px/)
    // 三个尺寸都从容器单位算：均分宽、容器高上限
    expect(root).toMatch(/--pile-share-w:\s*calc\(\(100cqw/)
    expect(root).toMatch(/--pile-col-w:\s*calc\(\(100cqw/)
    expect(root).toMatch(/16cqh/)
    expect(root).toMatch(/15cqh/)
    // 触摸下限只在「均分宽放得下」时生效（min 之后再取 max），窄屏不硬撑出横向溢出
    expect(root).toMatch(/max\(min\(var\(--pile-tap\),\s*var\(--pile-share-w\)\)/)
    expect(root).toMatch(/max\(min\(var\(--pile-tap\),\s*var\(--pile-col-w\)\)/)
    // 牌永远不许比牌堆格子宽
    expect(ruleBody(".eink-pile[data-layout='row'] .eink-card--pile {")).toMatch(/max-width:\s*100%/)
    expect(ruleBody(".eink-pile[data-layout='stack'] .eink-card--pile {")).toMatch(/max-width:\s*100%/)
  })

  it('叠合步长按「剩余空间 / 槽位数」算，并且夹 0（牌再多也不会溢出）', () => {
    const row = ruleBody(".eink-pile[data-layout='row'] .eink-card--pile {")
    expect(row).toMatch(/--pile-step:\s*max\(\s*0px,\s*min\(/)
    expect(row).toMatch(/var\(--pile-slots-1/)
    const stack = ruleBody(".eink-pile[data-layout='stack'] .eink-card--pile {")
    expect(stack).toMatch(/--pile-step:\s*max\(\s*0px,\s*min\(/)
    expect(stack).toMatch(/var\(--pile-slots-1/)
    // 下排那一行吃掉剩余高度：上排与提示行都是 auto
    const root = ruleBody('.eink-cardtable.eink-cardtable--piles {')
    expect(root).toMatch(/grid-template-rows:\s*auto auto minmax\(0,\s*1fr\)/)
    // 必须清掉手牌布局的 grid-template-areas（否则会被排成三列）
    expect(root).toMatch(/grid-template-areas:\s*none/)
  })

  it('hidden 的牌背点不动：不挡底下可点的牌', () => {
    expect(ruleBody('.eink-pile__cards > span.eink-card--pile {')).toMatch(/pointer-events:\s*none/)
  })

  it('空位按钮：虚线 + 48px 触摸下限，而且不许顶出牌区（min 里夹 100%）', () => {
    const body = ruleBody(".eink-pile__cards > button.eink-card--pile[data-empty='yes'] {")
    // 空位沿用「靠线型说」的约定：虚线，不是灰掉
    expect(body).toMatch(/border-style:\s*dashed/)
    // 48px 触摸下限（--pile-tap 在牌堆布局根上给），再夹一次 100%（牌区的高）——
    // 牌区本身不足 48px 的极窄 / 极矮屏上以牌区为准，绝不溢出容器
    expect(body).toMatch(/min-height:\s*min\(var\(--pile-tap\),\s*100%\)/)
    expect(body).toMatch(/left:\s*0/)
    expect(body).toMatch(/right:\s*0/)
    // 高度不能写死成牌的尺寸：写死就跟 .eink-card--pile 一样高，--pile-tap 也就白夹了
    expect(body).toMatch(/height:\s*auto/)
    expect(body).not.toMatch(/height:\s*var\(--pile-card/)
    expect(body).not.toMatch(/px;?\s*$/m)
  })

  it('JS 只给形状（第几张 / 槽位数），一个像素都不给', async () => {
    // 与 board-css-layout.test.tsx 同一条约定：几何全在 CSS，组件只给 --i 与 --pile-slots-1
    const { container } = await mount(pileTable())
    const pile = container.querySelector('.eink-cardpiles__grid > .eink-pile') as HTMLElement
    expect(pile.style.getPropertyValue('--pile-slots-1')).toBe('1') // 这一堆 2 张 → 2 − 1
    const cards = pile.querySelectorAll<HTMLButtonElement>('.eink-card--pile')
    expect([...cards].map((card) => card.style.getPropertyValue('--i'))).toEqual(['0', '1'])
    // 第一张压在最上面（后画的先被压住）
    expect(Number(cards[0]!.style.zIndex)).toBeGreaterThan(Number(cards[1]!.style.zIndex))
    // 行内样式里不许出现 px：尺寸是 CSS 从容器查询算的
    for (const el of container.querySelectorAll<HTMLElement>('.eink-pile, .eink-card--pile')) {
      expect(el.getAttribute('style') ?? '').not.toMatch(/px/)
    }
  })

  it('牌背是斜纹（1-bit 纹理），不是灰度也不是字符', () => {
    const back = ruleBody('.eink-card--back {')
    expect(back).toMatch(/repeating-linear-gradient\(45deg,\s*#000/)
    expect(back).not.toMatch(/color:|opacity|gray/i)
  })
})
