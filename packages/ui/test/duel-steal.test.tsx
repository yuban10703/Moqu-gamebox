// @vitest-environment jsdom
/**
 * 肾上腺素（壳层侧）：**两步点击** —— 先点自己那件，再点对手那一格。
 *
 * 为什么必须是两步而不是一个动作：抢哪一件是玩家的选择（引擎的 `steal` 动作只带一个 slot），
 * 而面板是纯展示组件、不碰规则；于是「正在选目标」这一步状态只活在面板里
 * （不进存档、不进规则层），点中目标后交给壳层的 `onStealSelect`。
 *
 * 这里钉住四件事：
 * 1. 点肾上腺素**不会**当成普通道具用掉（不能调 onItemSelect），而是进入选择状态；
 * 2. 进入后说明行换成提示（说明行本来就占着位置，所以高度不会跳）；
 * 3. 只有对手那几件「可抢」的变成可点，其余仍旧禁用；
 * 4. 点中目标只上报一次，并退出选择状态。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { createMemoryKv, coreDictEn, type DuelView } from '@eink/core'
import { createPlatform } from '@eink/platform'
import { DuelPanel } from '../src/DuelPanel.js'
import { UiProvider } from '../src/contexts.js'

afterEach(cleanup)

const dicts = {
  'en-US': {
    ...coreDictEn,
    'test.name.you': 'You',
    'test.name.devil': 'Devil',
    'buckshot.item.adrenaline': 'Adrenaline',
    'buckshot.item.magnifier': 'Magnifier',
    'buckshot.item.beer': 'Beer',
    'buckshot.steal.pick': 'Tap an opponent item to snatch',
    'buckshot.log.steal': '{subject} snatches {object}\u2019s {item} with adrenaline',
  },
}

function duelView(): DuelView {
  const side = (
    position: 'top' | 'bottom',
    nameKey: string,
    items: Array<{ id: number; icon: string; labelKey: string; selectable: boolean; stealable?: boolean }>,
  ) => ({
    position,
    nameKey,
    portrait: position === 'top' ? 'devil' : 'player',
    hp: 2,
    maxHp: 4,
    items,
    itemCapacity: 8,
    active: position === 'bottom',
    wins: 0,
  })
  return {
    kind: 'duel',
    sides: [
      side('top', 'test.name.devil', [
        { id: 0, icon: 'magnifier', labelKey: 'buckshot.item.magnifier', selectable: false, stealable: true },
        { id: 1, icon: 'beer', labelKey: 'buckshot.item.beer', selectable: false, stealable: false },
      ]),
      side('bottom', 'test.name.you', [
        { id: 0, icon: 'adrenaline', labelKey: 'buckshot.item.adrenaline', selectable: true },
        { id: 1, icon: 'beer', labelKey: 'buckshot.item.beer', selectable: false },
      ]),
    ],
    spent: [],
    chamber: [],
    caption: { key: 'shell.duel.caption' },
    tags: [],
    sawn: false,
    log: [],
    fire: null,
  } as unknown as DuelView
}

async function mount(onStealSelect?: (slot: number) => void, onItemSelect?: (id: number) => void) {
  const platform = await createPlatform({ kv: createMemoryKv() })
  return render(
    <UiProvider
      platform={platform}
      dicts={dicts}
      initialSettings={{ locale: 'en-US', fontScale: 1, timer: true, dpad: false, boldLines: true, perGame: {} }}
    >
      <DuelPanel duel={duelView()} {...(onItemSelect ? { onItemSelect } : {})} {...(onStealSelect ? { onStealSelect } : {})} />
    </UiProvider>,
  )
}

const slot = (container: HTMLElement, position: 'top' | 'bottom', index: number): HTMLElement =>
  container.querySelectorAll(`.eink-duel__items[data-position=${position}] .eink-duel__slot`)[index] as HTMLElement

describe('肾上腺素：点自己那件 → 点对手那一格', () => {
  it('第一步不消耗道具，只进入选择状态并换成提示', async () => {
    const onItem = vi.fn()
    const onSteal = vi.fn()
    const { container } = await mount(onSteal, onItem)
    fireEvent.click(slot(container, 'bottom', 0))
    expect(onItem).not.toHaveBeenCalled()
    expect(onSteal).not.toHaveBeenCalled()
    expect(container.querySelector('.eink-duel__caption')!.textContent).toContain('snatch')
    expect(container.querySelector(".eink-duel__items[data-position='top']")!.getAttribute('data-steal')).toBe('yes')
  })

  it('第二步只让「可抢」的那几件可点，并在点中后退出选择状态', async () => {
    const onSteal = vi.fn()
    const { container } = await mount(onSteal)
    fireEvent.click(slot(container, 'bottom', 0))
    const top = container.querySelectorAll(".eink-duel__items[data-position='top'] .eink-duel__slot")
    expect((top[0] as HTMLButtonElement).disabled).toBe(false) // stealable
    expect((top[1] as HTMLButtonElement).disabled).toBe(true) // 不可抢：仍旧禁用
    expect(container.querySelectorAll(".eink-duel__items[data-position='top'] .eink-duel__slot[data-stealable='yes']")).toHaveLength(1)
    fireEvent.click(top[0] as HTMLElement)
    expect(onSteal).toHaveBeenCalledTimes(1)
    expect(onSteal).toHaveBeenCalledWith(0)
    expect(container.querySelector(".eink-duel__items[data-position='top']")!.getAttribute('data-steal')).toBeNull()
  })

  it('记录里的道具名要翻好再填进去（真机抓到过 {item} 原样漏出来）', async () => {
    const view = duelView()
    view.log = [
      {
        key: 'buckshot.log.steal',
        subjectKey: 'test.name.you',
        objectKey: 'test.name.devil',
        itemKey: 'buckshot.item.magnifier',
      },
    ]
    const platform = await createPlatform({ kv: createMemoryKv() })
    const { container } = render(
      <UiProvider
        platform={platform}
        dicts={dicts}
        initialSettings={{ locale: 'en-US', fontScale: 1, timer: true, dpad: false, boldLines: true, perGame: {} }}
      >
        <DuelPanel duel={view} />
      </UiProvider>,
    )
    const text = container.querySelector('.eink-duel__log')!.textContent ?? ''
    expect(text).toContain('Magnifier') // itemKey 被翻译成道具名并作为 {item} 填进去
    expect(text).not.toContain('{item}') // 不能把占位符原样漏到界面上
  })

  it('再点一次肾上腺素可以取消（不进入也不上报）', async () => {
    const onSteal = vi.fn()
    const { container } = await mount(onSteal)
    fireEvent.click(slot(container, 'bottom', 0))
    fireEvent.click(slot(container, 'bottom', 0))
    expect(onSteal).not.toHaveBeenCalled()
    expect(container.querySelector(".eink-duel__items[data-position='top']")!.getAttribute('data-steal')).toBeNull()
  })
})
