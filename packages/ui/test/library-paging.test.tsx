// @vitest-environment jsdom
/**
 * 首页分页回归（用户实测出来的两个问题）：
 *   1. 翻页控件原来挤在「全部游戏」标题行右侧，现在必须在**网格下方、右对齐**；
 *   2. 进对局会让 LibraryScreen 卸载，返回首页时原来会跳回第 1 页 —— 页码必须保留，
 *      并且页数变少时要被钳回合法范围（而不是停在一个不存在的页上）。
 *
 * jsdom 里量不到尺寸（getBoundingClientRect 全是 0），measure() 会保持首帧的
 * PAGE_SIZE_FALLBACK=24，所以这里用 30 款游戏来得到「2 页」这个真实会发生的状态。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { coreDictEn, coreDictZh, createMemoryKv, type KvBackend } from '@eink/core'
import { createPlatform } from '@eink/platform'
import { sokobanEn, sokobanGame, sokobanZh } from '@eink/sokoban'
import { App } from '../src/App.js'
import { defineGame, type GameLibrary } from '../src/registry.js'

afterEach(cleanup)

const MANY = 30

/** 30 款只换了 id / 文案命名空间的「克隆游戏」：分页只看条目数，玩法无关紧要 */
const manyNamespaces = Array.from({ length: MANY }, (_, index) => `probe${index}`)
const manyEntries = manyNamespaces.map((namespace) =>
  defineGame({
    game: { ...sokobanGame, id: namespace, i18nNamespace: namespace },
    rulesKeys: ['sokoban.rules.body'],
    defaultDifficulty: 'starter',
  }),
)

function titles(prefix: string): Record<string, string> {
  return Object.fromEntries(manyNamespaces.map((ns, index) => [`${ns}.title`, `${prefix} ${index + 1}`]))
}

const manyLibrary: GameLibrary = {
  entries: manyEntries,
  dicts: {
    'zh-CN': { ...coreDictZh, ...sokobanZh, ...titles('游戏') },
    'en-US': { ...coreDictEn, ...sokobanEn, ...titles('Game') },
  },
}

/** 只有 3 款的库：一页放得下 → 不该出现翻页控件 */
const smallLibrary: GameLibrary = {
  entries: manyEntries.slice(0, 3),
  dicts: manyLibrary.dicts,
}

async function mount(library: GameLibrary, kv: KvBackend = createMemoryKv()) {
  const platform = await createPlatform({ kv, now: () => 1_700_000_000_000 })
  const utils = render(<App platform={platform} library={library} />)
  await waitFor(() => expect(document.querySelector('.eink-grid')).toBeTruthy())
  return { platform, kv, ...utils }
}

const pager = (): HTMLElement | null => document.querySelector('.eink-pager')
const pagerInfo = (): string => document.querySelector('.eink-pager__info')?.textContent?.trim() ?? ''
const pageButton = (which: 'prev' | 'next'): HTMLButtonElement | null =>
  document.querySelector(`button[data-page="${which}"]`)
const tileTitles = (): string[] =>
  [...document.querySelectorAll('.eink-tile__title')].map((node) => node.textContent?.trim() ?? '')

/** 回到第 1 页（测试之间共享模块级页码缓存，先归零再断言） */
function rewindToFirstPage(): void {
  for (let guard = 0; guard < 10; guard++) {
    const prev = pageButton('prev')
    if (!prev || prev.disabled) return
    fireEvent.click(prev)
  }
  throw new Error('回不到第 1 页')
}

describe('首页分页：位置与显示条件', () => {
  it('翻页控件在网格之后（文档顺序），并带右下角修饰类', async () => {
    await mount(manyLibrary)
    const grid = document.querySelector('.eink-grid')!
    const control = pager()!
    expect(control).toBeTruthy()
    // 真实结构判定：分页控件在网格之后（不是靠文案猜）
    expect(grid.compareDocumentPosition(control) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(control.classList.contains('eink-pager--footer')).toBe(true)
    // 设计语言沿用既有三个类，没有新造按钮体系
    expect(control.querySelectorAll('.eink-pager__btn').length).toBe(2)
    expect(control.querySelector('.eink-pager__info')).toBeTruthy()
  })

  it('只有一页时不显示翻页控件', async () => {
    await mount(smallLibrary)
    expect(document.querySelectorAll('.eink-tile').length).toBe(3)
    expect(pager()).toBeNull()
  })
})

describe('首页分页：左右滑动翻页', () => {
  /** 在首页上滑一把：pointerdown → pointerup（方向由 dx 决定，dy 默认 0） */
  const swipe = (dx: number, dy = 0): void => {
    const screen = document.querySelector('.eink-screen--library')!
    const from = { pointerId: 7, clientX: 220, clientY: 400 }
    fireEvent.pointerDown(screen, from)
    fireEvent.pointerUp(screen, { ...from, clientX: 220 + dx, clientY: 400 + dy })
  }

  it('左滑进入下一页，右滑回到上一页（内容跟着手指走）', async () => {
    await mount(manyLibrary)
    rewindToFirstPage()
    expect(pagerInfo()).toBe('Page 1/2')

    swipe(-120)
    await waitFor(() => expect(pagerInfo()).toBe('Page 2/2'))
    expect(tileTitles()[0]).toBe('Game 25')

    swipe(120)
    await waitFor(() => expect(pagerInfo()).toBe('Page 1/2'))
    expect(tileTitles()[0]).toBe('Game 1')
  })

  it('到头的方向不动：第 1 页右滑、最后一页左滑都不越界', async () => {
    await mount(manyLibrary)
    rewindToFirstPage()
    swipe(140)
    expect(pagerInfo()).toBe('Page 1/2')

    fireEvent.click(pageButton('next')!)
    await waitFor(() => expect(pagerInfo()).toBe('Page 2/2'))
    swipe(-140)
    expect(pagerInfo()).toBe('Page 2/2')
  })

  it('触摸滑动也翻页（真机上 pointer 流会被浏览器 cancel，只有 touch 流能撑到抬手）', async () => {
    await mount(manyLibrary)
    rewindToFirstPage()
    const screen = document.querySelector('.eink-screen--library')!
    fireEvent.touchStart(screen, { touches: [{ clientX: 300, clientY: 400, identifier: 3 }] })
    fireEvent.touchEnd(screen, { changedTouches: [{ clientX: 180, clientY: 400, identifier: 3 }] })
    await waitFor(() => expect(pagerInfo()).toBe('Page 2/2'))
    // 触摸还会同时产生 pointer 事件（pointerType='touch'）：必须被忽略，否则一次滑动翻两页
    fireEvent.pointerDown(screen, { pointerId: 9, pointerType: 'touch', clientX: 300, clientY: 400 })
    fireEvent.pointerUp(screen, { pointerId: 9, pointerType: 'touch', clientX: 180, clientY: 400 })
    expect(pagerInfo()).toBe('Page 2/2')
  })

  it('触摸的纵向拖动不翻页（那是滚动，浏览器随后会 touchcancel）', async () => {
    await mount(manyLibrary)
    rewindToFirstPage()
    const screen = document.querySelector('.eink-screen--library')!
    fireEvent.touchStart(screen, { touches: [{ clientX: 220, clientY: 300, identifier: 4 }] })
    fireEvent.touchMove(screen, { touches: [{ clientX: 210, clientY: 460, identifier: 4 }] })
    fireEvent.touchCancel(screen, { touches: [] })
    fireEvent.touchEnd(screen, { changedTouches: [{ clientX: 210, clientY: 460, identifier: 4 }] })
    expect(pagerInfo()).toBe('Page 1/2')
  })

  it('触摸滑动中途的 pointercancel 不许作废这次触摸（真机就长这样）', async () => {
    /*
     * 真机探针实测的事件序列：pointerdown(touch) → touchstart → **pointercancel** → touchend。
     * 浏览器用 pointercancel 表示"这个 pointer 流我接管了"（滚动手势仲裁），
     * 但 touch 流会照常走到 touchend —— 早先的实现把 pointercancel 当成"手势结束"，
     * 结果横滑永远算不出位移（首页滑动翻页完全失效）。
     */
    await mount(manyLibrary)
    rewindToFirstPage()
    const screen = document.querySelector('.eink-screen--library')!
    fireEvent.pointerDown(screen, { pointerId: 11, pointerType: 'touch', clientX: 300, clientY: 400 })
    fireEvent.touchStart(screen, { touches: [{ clientX: 300, clientY: 400, identifier: 11 }] })
    fireEvent.pointerCancel(screen, { pointerId: 11, pointerType: 'touch' })
    fireEvent.touchEnd(screen, { changedTouches: [{ clientX: 170, clientY: 400, identifier: 11 }] })
    await waitFor(() => expect(pagerInfo()).toBe('Page 2/2'))

    // 反过来：touchcancel（浏览器真的接管去滚动了）必须作废，不能翻页
    fireEvent.touchStart(screen, { touches: [{ clientX: 300, clientY: 400, identifier: 12 }] })
    fireEvent.touchCancel(screen, { touches: [] })
    fireEvent.touchEnd(screen, { changedTouches: [{ clientX: 160, clientY: 400, identifier: 12 }] })
    expect(pagerInfo()).toBe('Page 2/2')
  })

  it('小位移与纵向拖动都**不**翻页（点击/滚动不能被误判）', async () => {
    await mount(manyLibrary)
    rewindToFirstPage()
    // 轻点：位移小于阈值 → 当成点击（卡片的 onClick 该照常走，这里只断言不翻页）
    swipe(-12)
    expect(pagerInfo()).toBe('Page 1/2')
    // 纵向为主：竖屏内容比一屏高时这是「滚动」，不是翻页
    swipe(-120, 180)
    expect(pagerInfo()).toBe('Page 1/2')
    swipe(-90, -140)
    expect(pagerInfo()).toBe('Page 1/2')
  })

  it('只有一页时滑动不做任何事（也没有翻页控件）', async () => {
    await mount(smallLibrary)
    expect(pager()).toBeNull()
    swipe(-160)
    expect(tileTitles().length).toBe(3)
    expect(tileTitles()[0]).toBe('Game 1')
  })
})

describe('首页分页：页码保留', () => {
  it('在第 2 页点进游戏、返回首页后仍在第 2 页', async () => {
    await mount(manyLibrary)
    rewindToFirstPage()
    expect(pagerInfo()).toBe('Page 1/2')
    expect(tileTitles()[0]).toBe('Game 1')

    fireEvent.click(pageButton('next')!)
    await waitFor(() => expect(pagerInfo()).toBe('Page 2/2'))
    expect(tileTitles()[0]).toBe('Game 25')

    // 点进游戏（详情页）——LibraryScreen 因此被卸载
    fireEvent.click(document.querySelector('.eink-tile')!)
    await waitFor(() => expect(pager()).toBeNull())
    expect(document.querySelector('.eink-topbar')).toBeTruthy()

    // 返回首页：必须还是第 2 页（原实现在这里跳回第 1 页）
    fireEvent.click(document.querySelector('.eink-button--back')!)
    await waitFor(() => expect(pagerInfo()).toBe('Page 2/2'))
    expect(tileTitles()[0]).toBe('Game 25')
  })

  it('页数变少时页码被钳回合法范围（不会停在空页）', async () => {
    const kv = createMemoryKv()
    const first = await mount(manyLibrary, kv)
    rewindToFirstPage()
    fireEvent.click(pageButton('next')!)
    await waitFor(() => expect(pagerInfo()).toBe('Page 2/2'))
    first.unmount()

    // 同一个模块缓存里页码仍是 2，但新库只有 3 款（1 页）→ 必须回到第 1 页
    await mount(smallLibrary, kv)
    expect(pager()).toBeNull()
    expect(tileTitles().length).toBe(3)
    expect(tileTitles()[0]).toBe('Game 1')
  })

  it('首帧兜底每页数不得冲掉记住的页码', async () => {
    /*
     * 真机实测过的回归（26px 档）：在第 2 页点进游戏、返回首页却回到第 1 页。
     *
     * 原因不是缓存没生效，而是「把越界页码回写缓存」这件事在第一帧就跑了：
     * 首帧 pageSize 是兜底 24，12 款游戏在兜底里只有 1 页 → current 被钳成 0 →
     * 回写把刚记住的第 2 页冲掉。这里用一个「兜底只有 1 页」的库把那一帧复现出来。
     */
    const kv = createMemoryKv()
    const first = await mount(manyLibrary, kv)
    rewindToFirstPage()
    fireEvent.click(pageButton('next')!)
    await waitFor(() => expect(pagerInfo()).toBe('Page 2/2'))
    first.unmount()

    // 这一帧真实每页数还没量出来，钳位是假的，不许回写
    const middle = await mount(smallLibrary, kv)
    expect(pager()).toBeNull()
    middle.unmount()

    // 回到多游戏库：缓存里记的第 2 页必须还在（被冲掉的话这里会显示第 1 页）
    await mount(manyLibrary, kv)
    expect(pagerInfo()).toBe('Page 2/2')
    expect(tileTitles()[0]).toBe('Game 25')
  })
})
