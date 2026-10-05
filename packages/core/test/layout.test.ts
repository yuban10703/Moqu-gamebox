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
  CRAMPED_LANDSCAPE_MAX_HEIGHT,
  CRAMPED_STRIP_PX,
  DEFAULT_LAYOUT,
  REFERENCE_VIEWPORTS,
  ABSOLUTE_MIN_CELL,
  BOARD_FRAME_PX,
  DPAD_KEY_GAP_PX,
  dpadTeeKeySize,
  SIDE_CONTROLS_WIDTH_PX,
  computeBoardLayout,
  computeRootLayout,
  isCrampedLandscape,
  isCrampedLayout,
  type FontScale,
  type Viewport,
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
 * 极矮横屏（并排布局）与自动步进减速判定。
 *
 * 实测背景：BOOX P6Plus 强制横屏 879×407。竖排时代顶栏 + 统计 + 控制区吃掉 300px 以上，
 * 棋盘区只剩 ~117px —— 12×12 的棋盘只能贴住 12px 的绝对下限、数独只有 13px（用户反馈"格子太小"）。
 * 本轮（2026-10-04）起这一档改为**并排**（棋盘在左、控制在右，见 styles.css 同一档媒体查询），
 * 于是这里同时守住三件事：
 *   1) 并排后棋盘区真的变高了（格子离开绝对下限）；
 *   2) 并排几何与 CSS 用同一套常量（列宽 / 断点 / 状态条高度），不许各改各的；
 *   3) 「棋盘不可用就减速」这条判定依然存在 —— 只是不再误伤已经并排、棋盘够大的 879×407。
 */
describe('极矮横屏（并排布局）与棋盘不可用判定', () => {
  const P6PLUS_LANDSCAPE: Viewport = { width: 879, height: 407, dpr: 2 }

  it('并排档的断点与 CSS 媒体查询一致（横屏 + 高度不超过 520px）', () => {
    expect(CRAMPED_LANDSCAPE_MAX_HEIGHT).toBe(520)
    expect(isCrampedLandscape(P6PLUS_LANDSCAPE)).toBe(true)
    // 竖屏再矮也不是这一档（媒体查询里 orientation: landscape 不成立）
    expect(isCrampedLandscape({ width: 407, height: 415, dpr: 2 })).toBe(false)
    // 正常横屏不在这一档
    expect(isCrampedLandscape({ width: 1248, height: 903, dpr: 1.5 })).toBe(false)
    /*
     * 这一档只按「横屏 + 矮」划界，与机型无关：1176×513 也在界内（CSS 同样并排）。
     * 但它并排后棋盘区有 ~370px，**不算**「棋盘不可用」，不会拖慢自动步进 —— 见下一个用例。
     */
    expect(isCrampedLandscape({ width: 1176, height: 513, dpr: 2 })).toBe(true)
  })

  it('并排后棋盘拿到整行高度：格子离开绝对下限（这是本轮修复的核心）', () => {
    const area = computeRootLayout(P6PLUS_LANDSCAPE, DEFAULT_LAYOUT, {
      showDpad: true,
      showStats: true,
    }).boardArea
    // 本模型算 257px（CSS 实测 270px）；改前 ~117px
    expect(area.height).toBeGreaterThanOrEqual(CRAMPED_BOARD_AREA_PX)
    // 宽度让给了右侧控制列（改前是整幅内容宽）
    const contentWidth = computeRootLayout(P6PLUS_LANDSCAPE, DEFAULT_LAYOUT).contentWidth
    expect(area.width).toBeLessThan(contentWidth)
    // 12×12（贪吃蛇）与 9×9（数独）都能完整放进可用区，且远高于 12px 下限
    const snake = computeBoardLayout(area, 12, 12)
    expect(snake.cell).toBeGreaterThanOrEqual(20)
    expect(snake.boardHeight).toBeLessThanOrEqual(area.height)
    const sudoku = computeBoardLayout(area, 9, 9)
    expect(sudoku.cell).toBeGreaterThanOrEqual(24)
    expect(sudoku.boardHeight).toBeLessThanOrEqual(area.height)
    // 10×18 的俄罗斯方块（最高的一档）也不再是 5px
    expect(computeBoardLayout(area, 10, 18).cell).toBeGreaterThanOrEqual(12)
  })

  it('并排几何与 CSS 同步：列宽 / 状态条高度都来自同一条约定', () => {
    const area = computeRootLayout(P6PLUS_LANDSCAPE, DEFAULT_LAYOUT, { showDpad: true, showStats: true })
    // 879 × 40vw = 351.6 > 300 → 取上限 300
    expect(area.contentWidth - area.boardArea.width).toBe(SIDE_CONTROLS_WIDTH_PX + area.gap)
    /*
     * 状态条横跨底部：它只从高度里扣掉自己 + 一份行距。
     * 方向盘/统计栏在这一档不再参与高度计算 —— 关掉方向盘，棋盘区高度**不变**。
     */
    const noControls = computeRootLayout(P6PLUS_LANDSCAPE, DEFAULT_LAYOUT, {
      showDpad: false,
      showStats: false,
    })
    expect(area.boardArea.height).toBe(noControls.boardArea.height)
    expect(area.boardArea.height).toBe(
      P6PLUS_LANDSCAPE.height -
        area.topBarHeight -
        area.margin * 2 -
        CRAMPED_STRIP_PX -
        area.gap,
    )
  })

  it('并排后 879×407 不再算「棋盘不可用」，但真正放不下的横屏仍然减速', () => {
    // 并排把棋盘救回来了：不再误伤自动步进（贪吃蛇三档统一 700ms）
    expect(isCrampedLayout(P6PLUS_LANDSCAPE, DEFAULT_LAYOUT, true)).toBe(false)
    expect(isCrampedLayout(P6PLUS_LANDSCAPE, DEFAULT_LAYOUT, false)).toBe(false)
    // 常用档位：不能误伤（否则会把正常的自动步进也拖慢）
    expect(isCrampedLayout({ width: 415, height: 847, dpr: 2 }, DEFAULT_LAYOUT, true)).toBe(false)
    expect(isCrampedLayout({ width: 1176, height: 513, dpr: 2 }, DEFAULT_LAYOUT, true)).toBe(false)
    expect(isCrampedLayout({ width: 1123, height: 1498, dpr: 1.25 }, DEFAULT_LAYOUT, true)).toBe(false)
    // 参考设备清单里除了极矮横屏都不该被判成"不可用"
    for (const device of REFERENCE_VIEWPORTS) {
      expect(isCrampedLayout(device.viewport, DEFAULT_LAYOUT, true), device.name).toBe(false)
    }
    // 真正不可用的横屏（例如带浏览器工具栏的 879×240）仍然落在判定内并减速
    const tiny: Viewport = { width: 879, height: 240, dpr: 2 }
    expect(isCrampedLandscape(tiny)).toBe(true)
    expect(isCrampedLayout(tiny, DEFAULT_LAYOUT, true)).toBe(true)
  })

  it('判定阈值本身仍是"棋盘不可用"的量级，且绝对下限只在真正放不下时才生效', () => {
    const tiny: Viewport = { width: 879, height: 240, dpr: 2 }
    const area = computeRootLayout(tiny, DEFAULT_LAYOUT, { showDpad: true, showStats: true }).boardArea
    expect(area.height).toBeLessThan(CRAMPED_BOARD_AREA_PX)
    // 12×12 棋盘在这个高度下只能贴住绝对下限并被裁切
    const board = computeBoardLayout(area, 12, 12)
    expect(board.cell).toBe(ABSOLUTE_MIN_CELL)
    expect(board.boardHeight).toBeGreaterThan(area.height)
  })
})

/*
 * 方向键摆法（core 的 DpadLayout，ui 注册表的 dpadLayout）：
 * 倒 T（缺省）把撤销 / 重开收进上排两侧，只占两行；平铺（俄罗斯方块）方向键一行 + 操作一行。
 * 两种都必须比旧的「十字方向盘 + 下面另起一行操作」矮，省下的高度回到棋盘区。
 */
describe('方向键摆法（dpadLayout）', () => {
  const P6PLUS_PORTRAIT: Viewport = { width: 439, height: 847, dpr: 1.875 }

  it('倒 T 与平铺的控制区都比旧十字口径（3 行按钮 + 4 份间距）矮，差额全部归棋盘区', () => {
    for (const fontScale of FONT_SCALES) {
      const config = { ...DEFAULT_LAYOUT, fontScale }
      const tee = computeRootLayout(P6PLUS_PORTRAIT, config, { showDpad: true })
      const row = computeRootLayout(P6PLUS_PORTRAIT, config, { showDpad: true, dpadLayout: 'row' })
      const stats = Math.round(tee.baseFont * 2.6)
      const legacyCross = tee.buttonHeight * 3 + tee.gap * 4 + stats
      expect(tee.controlsHeight).toBe(dpadTeeKeySize(tee.buttonHeight) * 2 + DPAD_KEY_GAP_PX + tee.gap * 2 + stats)
      expect(tee.controlsHeight).toBeLessThan(legacyCross)
      expect(row.controlsHeight).toBeLessThan(legacyCross)
      // 控制区少多少，棋盘区就多多少（其余预算不变）
      expect(row.boardArea.height - tee.boardArea.height).toBe(tee.controlsHeight - row.controlsHeight)
    }
  })

  it('倒 T 的键比普通按钮大（省出来的高度有一部分给了拇指），且不低于触摸下限', () => {
    for (const fontScale of FONT_SCALES) {
      const { buttonHeight } = computeRootLayout(P6PLUS_PORTRAIT, { ...DEFAULT_LAYOUT, fontScale })
      expect(dpadTeeKeySize(buttonHeight)).toBeGreaterThan(buttonHeight)
      expect(dpadTeeKeySize(buttonHeight)).toBeGreaterThanOrEqual(DEFAULT_LAYOUT.minTouchTarget)
    }
  })

  it('竖屏标准字号：倒 T 下方形棋盘（2048 4×4 / 贪吃蛇 12×12）被宽度而不是高度卡住', () => {
    const area = computeRootLayout(P6PLUS_PORTRAIT, DEFAULT_LAYOUT, { showDpad: true }).boardArea
    for (const n of [4, 12]) {
      const board = computeBoardLayout(area, n, n)
      expect(board.cell).toBe(Math.floor((area.width - 2 * BOARD_FRAME_PX) / n))
    }
  })

  it('不传 dpadLayout 就是倒 T；关掉方向键时摆法无关紧要', () => {
    const viewport = REFERENCE_VIEWPORTS[0]!.viewport
    expect(computeRootLayout(viewport, DEFAULT_LAYOUT, { showDpad: true })).toEqual(
      computeRootLayout(viewport, DEFAULT_LAYOUT, { showDpad: true, dpadLayout: 'tee' }),
    )
    expect(computeRootLayout(viewport, DEFAULT_LAYOUT, { showDpad: false, dpadLayout: 'row' })).toEqual(
      computeRootLayout(viewport, DEFAULT_LAYOUT, { showDpad: false }),
    )
  })

  it('极矮横屏并排档：方向键在右侧列，摆法不影响棋盘区高度', () => {
    const landscape: Viewport = { width: 879, height: 407, dpr: 2 }
    expect(computeRootLayout(landscape, DEFAULT_LAYOUT, { dpadLayout: 'row' }).boardArea).toEqual(
      computeRootLayout(landscape, DEFAULT_LAYOUT).boardArea,
    )
  })
})
