/**
 * 布局不变量测试。
 *
 * 这些断言是「没有真机也能守住设计红线」的关键：触摸目标不小于 48px、字号不小于 18px、
 * 棋盘不溢出可用区域、字号放大后仍然可用。
 * 各设备的具体手感仍需真机确认（F04），这里只保证不会被代码改坏。
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LAYOUT,
  REFERENCE_VIEWPORTS,
  computeBoardLayout,
  computeRootLayout,
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

  it('极矮可用区：格子仍不得低于 minCell（防坍缩到不可玩）', () => {
    const area = { width: 860, height: 200 }
    for (const [cols, rows] of [[15, 15], [16, 16], [9, 9]] as const) {
      const board = computeBoardLayout(area, cols, rows)
      expect(board.cell).toBeGreaterThanOrEqual(DEFAULT_LAYOUT.minCell)
    }
  })

  it('极窄视口下不会算出负数或零尺寸', () => {
    const layout = computeRootLayout({ width: 320, height: 480, dpr: 2 })
    const board = computeBoardLayout(layout.boardArea, 11, 9)
    // minCell 是硬下限：宁可棋盘超出被裁一点，也不能把格子压到不可用（真机曾坍缩到 1px）
    expect(board.cell).toBeGreaterThanOrEqual(DEFAULT_LAYOUT.minCell)
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
