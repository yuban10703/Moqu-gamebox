// @vitest-environment jsdom
/**
 * 方向键摆法：倒 T（缺省，撤销 / 重开收在上排两侧）与平铺（dpadLayout = 'row'，俄罗斯方块用）。
 *
 * 两种摆法的意义都是**把高度让给棋盘**；点下去派发的方向不能因为换了摆法而改变。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { createMemoryKv, type ControlSpec, type DpadLayout, type MoveDir } from '@eink/core'
import { createPlatform } from '@eink/platform'
import { Dpad } from '../src/components.js'
import { UiProvider } from '../src/contexts.js'

afterEach(cleanup)

const DIRS: MoveDir[] = ['up', 'down', 'left', 'right']
const controls: ControlSpec[] = DIRS.map((dir) => ({
  id: `move-${dir}`,
  labelKey: `test.dir.${dir}`,
  role: 'dpad',
  dir,
  enabled: true,
  emphasis: 'normal',
}))
const dicts = {
  'en-US': { 'test.dir.up': 'Up', 'test.dir.down': 'Down', 'test.dir.left': 'Left', 'test.dir.right': 'Right', 'test.dpad': 'Pad' },
}

async function mount(layout?: DpadLayout, withCorners = false) {
  const platform = await createPlatform({ kv: createMemoryKv() })
  const onMove = vi.fn()
  const corners = withCorners
    ? { left: <button type="button">Undo</button>, right: <button type="button">Restart</button> }
    : undefined
  const view = render(
    <UiProvider platform={platform} dicts={dicts} initialSettings={{ locale: 'en-US', fontScale: 1, timer: true, dpad: true, boldLines: true, perGame: {} }}>
      <Dpad
        controls={controls}
        onMove={onMove}
        size={58}
        labelKey="test.dpad"
        {...(layout ? { layout } : {})}
        {...(corners ? { corners } : {})}
      />
    </UiProvider>,
  )
  const pad = view.container.querySelector('.eink-dpad') as HTMLElement
  return { pad, onMove, container: view.container }
}

describe('方向键摆法：倒 T（缺省）', () => {
  it('四个方向键都在 .eink-dpad 里，DOM 顺序 上 · 左 · 下 · 右（位置交给 CSS 网格）', async () => {
    const { pad } = await mount()
    expect(pad.classList.contains('eink-dpad--tee')).toBe(true)
    expect(pad.parentElement?.classList.contains('eink-dpad-tee')).toBe(true)
    const labels = [...pad.querySelectorAll('button')].map((button) => button.textContent)
    expect(labels).toEqual(['Up', 'Left', 'Down', 'Right'])
    // 探索脚本按 `.eink-dpad button` 的第一个当方向键用：必须是方向键而不是撤销
    expect(pad.querySelector('button')?.textContent).toBe('Up')
  })

  it('撤销 / 重开放在两侧格子里，但不进方向键的分组（无障碍名与选择器都只覆盖方向键）', async () => {
    const { pad, container } = await mount('tee', true)
    expect(pad.querySelectorAll('button').length).toBe(4)
    const left = container.querySelector('.eink-dpad-tee__corner--left')
    const right = container.querySelector('.eink-dpad-tee__corner--right')
    expect(left?.textContent).toBe('Undo')
    expect(right?.textContent).toBe('Restart')
    expect(pad.contains(left)).toBe(false)
  })

  it('键高由 JS 给出、宽度只给下限；两侧格子的高度经 --dpad-key 对齐方向键', async () => {
    const { pad } = await mount()
    for (const button of pad.querySelectorAll('button')) {
      expect(button.style.height).toBe('58px')
      expect(button.style.minWidth).toBe('58px')
      expect(button.style.width).toBe('')
    }
    expect(pad.parentElement?.style.getPropertyValue('--dpad-key')).toBe('58px')
  })

  it('点下去派发对应方向', async () => {
    const { pad, onMove } = await mount()
    for (const button of pad.querySelectorAll('button')) fireEvent.click(button)
    expect(onMove.mock.calls.map((call) => call[0])).toEqual(['up', 'left', 'down', 'right'])
  })
})

describe('方向键摆法：平铺（row）', () => {
  it('只有四个按钮排成一行，键序 左 · 上 · 下 · 右；不会渲染两侧格子', async () => {
    const { pad, container } = await mount('row', true)
    expect(pad.classList.contains('eink-dpad--row')).toBe(true)
    const labels = [...pad.querySelectorAll('button')].map((button) => button.textContent)
    expect(labels).toEqual(['Left', 'Up', 'Down', 'Right'])
    expect(container.querySelector('.eink-dpad-tee__corner--left')).toBeNull()
  })

  it('换了摆法，点下去派发的方向不变', async () => {
    const { pad, onMove } = await mount('row')
    for (const button of pad.querySelectorAll('button')) fireEvent.click(button)
    expect(onMove.mock.calls.map((call) => call[0])).toEqual(['left', 'up', 'down', 'right'])
  })
})
