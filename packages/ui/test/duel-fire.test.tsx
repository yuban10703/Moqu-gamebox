// @vitest-environment jsdom
/**
 * 开枪定格画面（壳层侧）：`DuelView.fire` 怎么画。
 *
 * 墨水屏的约束在这里体现为三条硬要求，测试逐条钉住：
 * 1. **实弹与空包必须一眼可辨**：两者都是白底黑字（黑带白字在真机上被否过，
 *    见 docs/eink-guidelines.md 第 51 行），靠 data-shell 切换框线与图形：
 *    实弹 = 实线粗框 + 实心爆闪，空包 = 虚线框 + 空心打叉，全程不靠灰阶；
 * 2. **图形只用纯色块**：实弹画枪口爆闪（.eink-duel__blast），空包画空膛打叉（.eink-duel__dud），
 *    两者互斥，不出现"又爆闪又打叉"；
 * 3. **不能挡住战斗日志、也不能挡住操作入口**（用户明确要求「不要把战斗日志挡住」）：
 *    画面只盖住枪 / 弹仓 / 说明那一段（`.eink-duel__stage` 只包 `.eink-duel__table`，
 *    画面是它的绝对定位子元素），战斗记录与两侧的血量、道具都留在外面 ——
 *    记录随时能翻，道具随时能点。
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
    'test.item.magnifier': 'Magnifier',
  },
}

function duelView(fire: DuelView['fire']): DuelView {
  const side = (position: 'top' | 'bottom', nameKey: string) => ({
    position,
    nameKey,
    portrait: position === 'top' ? 'devil' : 'player',
    hp: 1,
    maxHp: 2,
    items: [{ id: 0, icon: 'magnifier', labelKey: 'test.item.magnifier', selectable: position === 'bottom' }],
    itemCapacity: 2,
    active: position === 'bottom',
    wins: 0,
  })
  return {
    kind: 'duel',
    sides: [side('top', 'test.name.devil'), side('bottom', 'test.name.you')],
    spent: [],
    chamber: ['unknown', 'unknown'],
    caption: { key: 'shell.duel.chamber' },
    remaining: null,
    tags: [],
    sawn: false,
    log: [{ key: 'shell.duel.chamber' }],
    fire,
  }
}

async function mount(fire: DuelView['fire']) {
  const platform = await createPlatform({ kv: createMemoryKv() })
  return render(
    <UiProvider platform={platform} dicts={dicts} initialSettings={{ locale: 'en-US', fontScale: 1, timer: true, dpad: false, boldLines: true, perGame: {} }}>
      <DuelPanel duel={duelView(fire)} />
    </UiProvider>,
  )
}

describe('开枪定格画面', () => {
  it('实弹：实心标题带 + 枪口爆闪 + 伤害 + 掉血', async () => {
    const { container } = await mount({
      shooter: 'bottom',
      target: 'top',
      shell: 'live',
      damage: 2,
      sawn: true,
      hp: 0,
      hpBefore: 2,
      maxHp: 2,
      lethal: true,
    })
    const fire = container.querySelector('.eink-duel__fire') as HTMLElement
    expect(fire).not.toBeNull()
    expect(fire.dataset.shell).toBe('live')
    expect(fire.dataset.lethal).toBe('yes')
    expect(fire.textContent).toContain('LIVE ROUND!')
    expect(fire.querySelector('.eink-duel__blast')).not.toBeNull()
    expect(fire.querySelector('.eink-duel__dud')).toBeNull()
    // 伤害与掉血：手锯那一枪是 −2
    expect(fire.querySelector('.eink-duel__firedmg')?.textContent).toContain('2')
    expect(fire.querySelector('.eink-duel__firelost')?.textContent).toContain('2')
    // 爱心：血量归零 → 全是空心
    const hearts = [...fire.querySelectorAll('.eink-duel__heart')]
    expect(hearts).toHaveLength(2)
    expect(hearts.every((heart) => heart.getAttribute('data-full') === 'no')).toBe(true)
    // 打倒
    expect(fire.textContent).toContain('KNOCKDOWN!')
  })

  it('空包：空心虚框 + 空膛打叉，不出现伤害', async () => {
    const { container } = await mount({
      shooter: 'bottom',
      target: 'bottom',
      shell: 'blank',
      damage: 0,
      sawn: false,
      hp: 2,
      hpBefore: 2,
      maxHp: 2,
      lethal: false,
    })
    const fire = container.querySelector('.eink-duel__fire') as HTMLElement
    expect(fire.dataset.shell).toBe('blank')
    expect(fire.dataset.lethal).toBe('no')
    expect(fire.textContent).toContain('BLANK')
    expect(fire.querySelector('.eink-duel__dud')).not.toBeNull()
    expect(fire.querySelector('.eink-duel__blast')).toBeNull()
    expect(fire.querySelector('.eink-duel__firedmg')).toBeNull()
    expect(fire.querySelector('.eink-duel__firelost')).toBeNull()
    expect(fire.textContent).toContain('shoots themself')
    // 满血：两颗都是实心
    const hearts = [...fire.querySelectorAll('.eink-duel__heart')]
    expect(hearts.every((heart) => heart.getAttribute('data-full') === 'yes')).toBe(true)
  })

  it('画面只盖中间那一段：两侧的道具按钮仍在 DOM 里可用', async () => {
    const { container } = await mount({
      shooter: 'top',
      target: 'bottom',
      shell: 'live',
      damage: 1,
      sawn: false,
      hp: 1,
      hpBefore: 2,
      maxHp: 2,
      lethal: false,
    })
    const stage = container.querySelector('.eink-duel__stage') as HTMLElement
    expect(stage.querySelector('.eink-duel__fire')).not.toBeNull()
    // 画面是 stage 的子元素（不覆盖两侧）
    expect(container.querySelectorAll('.eink-duel__side')).toHaveLength(2)
    expect(container.querySelectorAll('.eink-duel__slot').length).toBeGreaterThanOrEqual(2)
    expect(container.querySelector('.eink-duel__fire')?.parentElement).toBe(stage)
  })

  it('不挡战斗日志：记录留在画面外面，仍然可见可读', async () => {
    const { container } = await mount({
      shooter: 'bottom',
      target: 'top',
      shell: 'live',
      damage: 1,
      sawn: false,
      hp: 1,
      hpBefore: 2,
      maxHp: 2,
      lethal: false,
    })
    const stage = container.querySelector('.eink-duel__stage') as HTMLElement
    const log = container.querySelector('.eink-duel__log') as HTMLElement
    const table = container.querySelector('.eink-duel__table') as HTMLElement
    // 记录在画面之外：既不是 stage 的子元素，也没被隐藏
    expect(log).not.toBeNull()
    expect(stage.contains(log)).toBe(false)
    expect(log.getAttribute('aria-hidden')).toBeNull()
    // stage 里只有枪那一段（table）+ 画面本身
    expect(stage.contains(table)).toBe(true)
    expect(stage.querySelector('.eink-duel__fire')).not.toBeNull()
    // 被画面真正盖住的 table 才隐藏，避免同一枪被读两遍；画面自己是播报源
    expect(table.getAttribute('aria-hidden')).toBe('true')
    expect(container.querySelector('.eink-duel__fire')?.getAttribute('role')).toBe('status')
  })

  it('布局稳定：还没开枪时「已打出」组与「剩余」行就已占位（日志不会被挤矮）', async () => {
    // 这是用户反馈的「首次射击导致战斗日志栏变小」的根因回归：
    // 枪那一段的高度必须是常量，日志（flex: 1 1 auto）才不会被挤。
    const { container } = await mount(null)
    const spent = container.querySelector('.eink-duel__spent') as HTMLElement
    expect(spent).not.toBeNull()
    expect(spent.dataset.empty).toBe('yes') // 没开过枪：不画，但位置占着
    const remaining = container.querySelector('.eink-duel__remaining') as HTMLElement
    expect(remaining).not.toBeNull() // 装填阶段也必须在
    expect(remaining.getAttribute('aria-hidden')).toBe('true') // 空行不念给读屏
  })

  it('打过枪之后：「已打出」组转为可见、占位标记翻面', async () => {
    const view = duelView(null)
    view.spent = ['live']
    view.remaining = { key: 'shell.duel.chamber' }
    const { container } = render(
      <UiProvider platform={await createPlatform({ kv: createMemoryKv() })} dicts={dicts} initialSettings={{ locale: 'en-US', fontScale: 1, timer: true, dpad: false, boldLines: true, perGame: {} }}>
        <DuelPanel duel={view} />
      </UiProvider>,
    )
    const spent = container.querySelector('.eink-duel__spent') as HTMLElement
    expect(spent.dataset.empty).toBe('no')
    expect(spent.querySelectorAll('.eink-duel__token[data-spent="yes"]')).toHaveLength(1)
    expect((container.querySelector('.eink-duel__remaining') as HTMLElement).getAttribute('aria-hidden')).toBeNull()
  })

  it('没有画面时不渲染（回归：平时不出现这块）', async () => {
    const { container } = await mount(null)
    expect(container.querySelector('.eink-duel__fire')).toBeNull()
    expect(container.querySelector('.eink-duel__stage')).not.toBeNull()
    // 平时不对读屏隐藏：这是回归重点（隐藏必须只发生在画面出现时）
    expect(container.querySelector('.eink-duel__table')?.getAttribute('aria-hidden')).toBeNull()
    expect(container.querySelector('.eink-duel__log')?.getAttribute('aria-hidden')).toBeNull()
    // 记录永远在画面之外
    const stage = container.querySelector('.eink-duel__stage') as HTMLElement
    expect(stage.contains(container.querySelector('.eink-duel__log') as HTMLElement)).toBe(false)
  })
})
