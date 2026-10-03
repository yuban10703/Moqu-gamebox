/**
 * 布局不变量测试。
 *
 * 这些断言是「没有真机也能守住设计红线」的关键：触摸目标不小于 48px、字号不小于 18px、
 * 棋盘不溢出可用区域、字号放大后仍然可用。
 * 各设备的具体手感仍需真机确认（F04），这里只保证不会被代码改坏。
 */
import { describe, expect, it } from 'vitest'
import {
  CRAMPED_BOARD_AREA_PX,
  DEFAULT_LAYOUT,
  REFERENCE_VIEWPORTS,
  ABSOLUTE_MIN_CELL,
  computeBoardLayout,
  computeRootLayout,
  isCrampedLayout,
  type FontScale,
} from '../src/layout.js'

const FONT_SCALES: FontScale[] = [1, 1.25, 1.5]
const BOARD_SHAPES: Array<[number, number]> = [
  [7, 7],
  [11, 9],
  [9, 11],
]

describe('根布局不变量', () => {
  for (const { name, viewport } of REFERENCE_VIEWPORTS) {
    for (const fontScale of FONT_SCALES) {
      it(`${name} / 字号 ${fontScale}：触摸目标与字号达标`, () => {
        const layout = computeRootLayout(viewport, { ...DEFAULT_LAYOUT, fontScale })
        expect(layout.buttonMin).toBeGreaterThanOrEqual(48)
        expect(layout.buttonHeight).toBeGreaterThanOrEqual(48)
        expect(layout.baseFont).toBeGreaterThanOrEqual(18)
        expect(Number.isInteger(layout.baseFont)).toBe(true)
        expect(Number.isInteger(layout.margin)).toBe(true)
        expect(layout.contentWidth).toBeLessThanOrEqual(viewport.width)
        expect(layout.boardArea.height).toBeGreaterThan(0)
      })
    }
  }

  it('字号放大只会增加按钮与顶部栏的高度，不会缩到红线以下', () => {
    const viewport = REFERENCE_VIEWPORTS[0]!.viewport
    const standard = computeRootLayout(viewport, { ...DEFAULT_LAYOUT, fontScale: 1 })
    const huge = computeRootLayout(viewport, { ...DEFAULT_LAYOUT, fontScale: 1.5 })
    expect(huge.baseFont).toBeGreaterThan(standard.baseFont)
    expect(huge.buttonHeight).toBeGreaterThanOrEqual(standard.buttonHeight)
    expect(huge.controlsHeight).toBeGreaterThanOrEqual(standard.controlsHeight)
  })

  it('整个纵向预算不会超过视口高度', () => {
    for (const { viewport } of REFERENCE_VIEWPORTS) {
      for (const fontScale of FONT_SCALES) {
        const layout = computeRootLayout(viewport, { ...DEFAULT_LAYOUT, fontScale })
        const total = layout.topBarHeight + layout.boardArea.height + layout.controlsHeight + layout.margin * 2
        expect(total).toBeLessThanOrEqual(viewport.height)
      }
    }
  })
})

describe('棋盘布局不变量', () => {
  for (const { name, viewport } of REFERENCE_VIEWPORTS) {
    for (const fontScale of FONT_SCALES) {
      for (const [cols, rows] of BOARD_SHAPES) {
        it(`${name} / 字号 ${fontScale} / ${cols}x${rows}：棋盘完整落在可用区域内`, () => {
          const root = computeRootLayout(viewport, { ...DEFAULT_LAYOUT, fontScale })
          const board = computeBoardLayout(root.boardArea, cols, rows, { ...DEFAULT_LAYOUT, fontScale })
          expect(board.cell).toBeGreaterThanOrEqual(DEFAULT_LAYOUT.minCell)
          expect(Number.isInteger(board.cell)).toBe(true)
          expect(board.boardWidth).toBeLessThanOrEqual(root.boardArea.width)
          expect(board.boardHeight).toBeLessThanOrEqual(root.boardArea.height)
          expect(board.offsetX).toBeGreaterThanOrEqual(0)
          expect(board.offsetY).toBeGreaterThanOrEqual(0)
        })
      }
    }
  }

  it('主基线设备（10.3 吋）在最大字号下，11x9 棋盘仍有舒适格子', () => {
    const viewport = REFERENCE_VIEWPORTS[0]!.viewport
    const root = computeRootLayout(viewport, { ...DEFAULT_LAYOUT, fontScale: 1.5 })
    const board = computeBoardLayout(root.boardArea, 11, 9, { ...DEFAULT_LAYOUT, fontScale: 1.5 })
    // 44px 是「舒适」下限；真机按 F04 复核后再调整这个门槛
    expect(board.cell).toBeGreaterThanOrEqual(44)
  })

  it('为底部面板预留高度时，棋盘区会被扣掉相应空间', () => {
    const viewport = REFERENCE_VIEWPORTS[0]!.viewport
    const withoutPanel = computeRootLayout(viewport, DEFAULT_LAYOUT)
    const withPanel = computeRootLayout(viewport, DEFAULT_LAYOUT, { extraBottom: 240 })
    expect(withoutPanel.boardArea.height - withPanel.boardArea.height).toBe(240)
    // 扣掉之后棋盘依然完整可用，且格子不会小于下限
    const board = computeBoardLayout(withPanel.boardArea, 7, 7, DEFAULT_LAYOUT)
    expect(board.cell).toBeGreaterThanOrEqual(DEFAULT_LAYOUT.minCell)
    expect(board.boardHeight).toBeLessThanOrEqual(withPanel.boardArea.height)
  })

  it('密集网格可以低于期望值，但不得低于绝对下限（两级下限）', () => {
    const area = { width: 860, height: 200 }
    for (const [cols, rows] of [[21, 21], [16, 16], [9, 9]] as const) {
      const board = computeBoardLayout(area, cols, rows)
      expect(board.cell).toBeGreaterThanOrEqual(ABSOLUTE_MIN_CELL)
    }
    // 放得下时必须用期望值
    const roomy = computeBoardLayout({ width: 800, height: 800 }, 9, 9)
    expect(roomy.cell).toBeGreaterThanOrEqual(DEFAULT_LAYOUT.minCell)
  })

  it('极窄视口下不会算出负数或零尺寸', () => {
    const layout = computeRootLayout({ width: 320, height: 480, dpr: 2 })
    const board = computeBoardLayout(layout.boardArea, 11, 9)
    // 允许低于期望值 minCell（密集网格放不下），但不得低于绝对下限（真机曾坍缩到 1px）
    expect(board.cell).toBeGreaterThanOrEqual(ABSOLUTE_MIN_CELL)
    expect(board.boardWidth).toBeGreaterThan(0)
  })

  it('棋盘含外框也必须放得进可用区（否则上下或左右边框会被 overflow:hidden 裁掉）', () => {
    // 真机实测的游戏页棋盘区尺寸（P6Plus 竖屏 / Note X2 横屏）
    const areas = [
      { width: 403, height: 420 },
      { width: 1100, height: 600 },
    ]
    const shapes: Array<[number, number]> = [
      [4, 4],
      [9, 9],
      [12, 12],
      [16, 16],
      [11, 9],
    ]
    for (const area of areas) {
      for (const [cols, rows] of shapes) {
        const board = computeBoardLayout(area, cols, rows)
        expect(board.boardWidth).toBeLessThanOrEqual(area.width)
        expect(board.boardHeight).toBeLessThanOrEqual(area.height)
      }
    }
  })

  it('外框宽度计入棋盘总尺寸：同样的可用区，外框越粗格子越小', () => {
    const area = { width: 403, height: 403 }
    const thin = computeBoardLayout(area, 9, 9, DEFAULT_LAYOUT, 1)
    const thick = computeBoardLayout(area, 9, 9, DEFAULT_LAYOUT, 5)
    expect(thick.cell).toBeLessThan(thin.cell)
    expect(thick.boardWidth).toBe(thick.cell * 9 + 10)
    expect(thick.boardWidth).toBeLessThanOrEqual(area.width)
  })
})

/**
 * 极矮横屏判定（自动步进据此减速，见 packages/ui/src/session.ts）。
 *
 * 实测背景：BOOX P6Plus 强制横屏 879×407，顶栏 + 统计 + 控制区吃掉 300px 以上，
 * 棋盘区只剩 ~70px —— 12×12 的棋盘只能贴住 12px 的绝对下限。这个档位下自动步进
 * 会加剧不可用，因此需要一条**不依赖 DOM**的判定：它必须能被纯函数测试守住。
 */
describe('极矮横屏（棋盘不可用）判定', () => {
  it('实测的 P6Plus 强制横屏落在判定内，常用竖屏与正常横屏落在判定外', () => {
    expect(isCrampedLayout({ width: 879, height: 407, dpr: 2 }, DEFAULT_LAYOUT, true)).toBe(true)
    // 常用档位：不能误伤（否则会把正常的自动步进也拖慢）
    expect(isCrampedLayout({ width: 415, height: 847, dpr: 2 }, DEFAULT_LAYOUT, true)).toBe(false)
    expect(isCrampedLayout({ width: 1176, height: 513, dpr: 2 }, DEFAULT_LAYOUT, true)).toBe(false)
    expect(isCrampedLayout({ width: 1123, height: 1498, dpr: 1.25 }, DEFAULT_LAYOUT, true)).toBe(false)
    // 参考设备清单里除了极矮横屏都不该被判成"不可用"
    for (const device of REFERENCE_VIEWPORTS) {
      expect(isCrampedLayout(device.viewport, DEFAULT_LAYOUT, true), device.name).toBe(false)
    }
  })

  it('判定的确是"棋盘区高度 < 阈值"，且阈值本身就是不可用的量级', () => {
    const viewport = { width: 879, height: 407, dpr: 2 }
    const area = computeRootLayout(viewport, DEFAULT_LAYOUT, { showDpad: true, showStats: true }).boardArea
    expect(area.height).toBeLessThan(CRAMPED_BOARD_AREA_PX)
    // 12×12 棋盘在这个高度下只能贴住绝对下限并被裁切
    const board = computeBoardLayout(area, 12, 12)
    expect(board.cell).toBe(ABSOLUTE_MIN_CELL)
    expect(board.boardHeight).toBeGreaterThan(area.height)
    // 关掉方向盘（玩家把控制区让出来）后不再算"极矮"
    expect(isCrampedLayout(viewport, DEFAULT_LAYOUT, false)).toBe(false)
  })
})
