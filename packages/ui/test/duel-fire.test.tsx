// @vitest-environment jsdom
/**
 * 开枪标记（壳层侧）：**加在原来的枪旁边，不盖住枪与子弹**。
 *
 * 设计口径来自用户两次明确要求：
 *   1. 「不要把战斗日志挡住」—— 标记与记录是兄弟节点，记录永远可见；
 *   2. 「画面在原本的基础上改，不要挡住原来的枪和子弹」—— 所以标记是**行内小块**，
 *      不是铺满整块的覆盖层：枪（`svg`）与弹仓（`.eink-duel__token`）都必须照旧渲染，
 *      说明行换成这一枪的结果（说明行本来就占位，高度不会跳）。
 *
 * 实弹与空包仍要一眼可辨：白底黑字 + 实心爆闪 / 空心打叉（黑带白字在真机被否过）。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
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
    'shell.duel.fire.live': 'LIVE ROUND!',
    'shell.duel.fire.blank': 'BLANK',
    'shell.duel.fire.at': '{subject} → {object}',
    'shell.duel.fire.self': '{subject} shoots themself',
    'shell.duel.fire.damage': '−{amount}',
    'shell.duel.fire.lost': 'lost {amount} HP',
    'shell.duel.fire.knockdown': 'KNOCKDOWN!',
    'shell.duel.recent': 'Recent',
  },
}

function duelView(fire: DuelView['fire']): DuelView {
  const side = (position: 'top' | 'bottom', nameKey: string) => ({
    position,
    nameKey,
    portrait: position === 'top' ? 'devil' : 'player',
    hp: 1,
    maxHp: 2,
    items: [{ id: 0, icon: 'beer', labelKey: 'test.item.beer', selectable: position === 'bottom' }],
    itemCapacity: 8,
    active: position === 'bottom',
    wins: 0,
  })
  return {
    kind: 'duel',
    sides: [side('top', 'test.name.devil'), side('bottom', 'test.name.you')],
    spent: [],
    chamber: [
      { kind: 'shell', id: 0, state: 'unknown' },
      { kind: 'shell', id: 1, state: 'unknown' },
    ],
    caption: { key: 'test.caption' },
    tags: [],
    sawn: false,
    log: [{ key: 'test.log' }],
    fire,
  } as unknown as DuelView
}

async function mount(fire: DuelView['fire']) {
  const platform = await createPlatform({ kv: createMemoryKv() })
  return render(
    <UiProvider
      platform={platform}
      dicts={{ ...dicts, 'en-US': { ...dicts['en-US'], 'test.item.beer': 'Beer', 'test.log': 'a log line', 'test.caption': 'your turn' } }}
      initialSettings={{ locale: 'en-US', fontScale: 1, timer: true, dpad: false, boldLines: true, perGame: {} }}
    >
      <DuelPanel duel={duelView(fire)} />
    </UiProvider>,
  )
}

const liveFire = {
  shooter: 'bottom',
  target: 'top',
  shell: 'live',
  damage: 1,
  sawn: false,
  hp: 1,
  hpBefore: 2,
  maxHp: 2,
  lethal: false,
} as unknown as DuelView['fire']

describe('开枪标记：在原画面上加，不盖住枪与子弹', () => {
  it('标记落在枪那一行里（行内小块），枪与弹仓照旧渲染', async () => {
    const { container } = await mount(liveFire)
    const gunrow = container.querySelector('.eink-duel__gunrow')!
    const mark = container.querySelector('.eink-duel__fire')!
    expect(gunrow.contains(mark)).toBe(true) // 就在枪旁边，不是盖在上面的一层
    expect(container.querySelector('.eink-duel__stage')!.contains(mark)).toBe(true)
    // 枪与弹仓都还在（这正是用户要求不能挡住的"原来的枪和子弹"）
    expect(gunrow.querySelector('svg')).not.toBeNull()
    expect(container.querySelectorAll('.eink-duel__chamber .eink-duel__token').length).toBeGreaterThan(0)
    // 表盘不再对读屏隐藏：没有东西被盖住
    expect(container.querySelector('.eink-duel__table')!.getAttribute('aria-hidden')).toBeNull()
    // 战斗记录仍是可见可读的兄弟节点
    const log = container.querySelector('.eink-duel__log')!
    expect(log.getAttribute('aria-hidden')).toBeNull()
    expect(log.textContent).toContain('a log line')
    expect(log.closest('.eink-duel__fire')).toBeNull()
  })

  it('实弹：实心爆闪 + 伤害；说明行换成这一枪的结果', async () => {
    const { container } = await mount(liveFire)
    const mark = container.querySelector('.eink-duel__fire')!
    expect(mark.getAttribute('data-shell')).toBe('live')
    expect(mark.querySelector('.eink-duel__blast')).not.toBeNull()
    expect(mark.querySelector('.eink-duel__dud')).toBeNull()
    const caption = container.querySelector('.eink-duel__caption')!.textContent ?? ''
    expect(caption).toContain('Devil') // 谁挨打
    expect(caption).toContain('lost 1 HP')
    expect(caption).not.toContain('your turn')
  })

  it('空包：空心打叉、不出现伤害；自击文案走 themself', async () => {
    const { container } = await mount({
      ...(liveFire as object),
      shooter: 'top',
      target: 'top',
      shell: 'blank',
      damage: 0,
      hp: 2,
      hpBefore: 2,
    } as unknown as DuelView['fire'])
    const mark = container.querySelector('.eink-duel__fire')!
    expect(mark.getAttribute('data-shell')).toBe('blank')
    expect(mark.querySelector('.eink-duel__dud')).not.toBeNull()
    expect(mark.querySelector('.eink-duel__blast')).toBeNull()
    const caption = container.querySelector('.eink-duel__caption')!.textContent ?? ''
    expect(caption).toContain('shoots themself')
    expect(caption).not.toContain('lost')
  })

  it('没有开枪时什么都不加（回归：平时不出现这块）', async () => {
    const { container } = await mount(null)
    expect(container.querySelector('.eink-duel__fire')).toBeNull()
    expect(container.querySelector('.eink-duel__table')!.getAttribute('aria-hidden')).toBeNull()
  })
})
