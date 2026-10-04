/**
 * 布局纯函数。抽出成纯函数的目的：在没有浏览器、没有真机的环境里，
 * 依然可以用测试守住「触摸目标不小于 48px」「棋盘不溢出」「字号放大后仍可用」这些不变量。
 *
 * 注意：BOOX 的系统 density 常被改写，**不要假设 1 CSS px = 1 物理 px**，
 * 一切以运行时实测的 CSS 视口为准（诊断页会记录）。
 */

export type FontScale = 1 | 1.25 | 1.5

export interface Viewport {
  width: number
  height: number
  dpr: number
}

export interface LayoutConfig {
  fontScale: FontScale
  /** 最小触摸目标（对齐 Android 48dp 触控尺度） */
  minTouchTarget: number
  /** 棋盘格最小边长 */
  minCell: number
  margin: number
  gap: number
}

export const DEFAULT_LAYOUT: LayoutConfig = {
  fontScale: 1,
  minTouchTarget: 48,
  minCell: 24,
  margin: 16,
  gap: 12,
}

export interface RootLayout {
  baseFont: number
  buttonMin: number
  buttonHeight: number
  margin: number
  gap: number
  contentWidth: number
  topBarHeight: number
  /** 控制区（方向盘 + 操作按钮）占用的高度 */
  controlsHeight: number
  /** 留给棋盘的区域 */
  boardArea: { width: number; height: number }
}

export interface BoardLayout {
  cols: number
  rows: number
  cell: number
  boardWidth: number
  boardHeight: number
  /** 棋盘在区域内的居中偏移 */
  offsetX: number
  offsetY: number
}

/**
 * 极矮横屏（并排布局）的断点：**必须与 styles.css 的
 * `@media (orientation: landscape) and (max-height: 520px)` 完全一致**。
 * 一处是 CSS 的实际布局、一处是下面的可用区模型，脱节就会出现
 * 「CSS 已经并排、模型还按竖排算」这种判定错位。
 */
export const CRAMPED_LANDSCAPE_MAX_HEIGHT = 520

/**
 * 方向键摆法：
 * - `tee`（缺省）：键盘方向键式的倒 T —— 上排「撤销 · 上 · 重开」、下排「左 · 下 · 右」。
 *   十字方向盘的四个角与中心原本都空着，还要在下面另起一行放撤销 / 重开（竖屏共 4 行）；
 *   倒 T 只占 2 行，省下的高度先让棋盘长到宽度上限，余下的用来把键放大（墨水屏上更好按）。
 * - `row`：四键平铺一行（左 · 上 · 下 · 右），用于上 / 下不是空间方向的玩法（俄罗斯方块）。
 */
export type DpadLayout = 'tee' | 'row'

/** 方向键之间的间距（px），与 styles.css 的 .eink-dpad-tee / .eink-dpad--row 的 gap 一致 */
export const DPAD_KEY_GAP_PX = 8

/** 倒 T 方向键相对普通按钮的放大系数（省出来的高度有富余，给拇指更大的目标） */
export const DPAD_TEE_KEY_SCALE = 1.2

/** 倒 T 方向键的边长（px）：壳层渲染与布局模型共用这一个算法 */
export function dpadTeeKeySize(buttonHeight: number): number {
  return Math.round(buttonHeight * DPAD_TEE_KEY_SCALE)
}

/** 并排布局里右侧控制列的宽度上限（CSS 的 `--controls-column: min(300px, 40vw)`） */
export const SIDE_CONTROLS_WIDTH_PX = 300

/** 并排布局里右侧控制列的宽度比例（同上：40vw） */
export const SIDE_CONTROLS_WIDTH_RATIO = 0.4

/** 极矮横屏的状态条高度（CSS 的 `--strip-height: 28px`），并排时它横跨底部、不占棋盘高度 */
export const CRAMPED_STRIP_PX = 28

/** 这个视口是否落在「极矮横屏并排布局」档（与 CSS 媒体查询同一条件） */
export function isCrampedLandscape(viewport: Viewport): boolean {
  return viewport.width > viewport.height && viewport.height <= CRAMPED_LANDSCAPE_MAX_HEIGHT
}

function baseFontFor(width: number): number {
  if (width >= 1200) return 22
  if (width >= 800) return 20
  return 18
}

export function computeRootLayout(
  viewport: Viewport,
  config: LayoutConfig = DEFAULT_LAYOUT,
  options: {
    showDpad?: boolean
    showStats?: boolean
    /** 底部需要额外预留的高度（例如过关面板）：从棋盘区里扣掉，避免为了看结果去滚动 */
    extraBottom?: number
    /** 方向键摆法（与 ui 注册表的 dpadLayout 同义，见 DpadLayout）；缺省 tee */
    dpadLayout?: DpadLayout
  } = {},
): RootLayout {
  const showDpad = options.showDpad ?? true
  const showStats = options.showStats ?? true
  const extraBottom = Math.max(0, Math.round(options.extraBottom ?? 0))
  const margin = Math.max(config.margin, Math.round(viewport.width * 0.015))
  const gap = Math.max(config.gap, Math.round(margin * 0.75))
  const baseFont = Math.round(baseFontFor(viewport.width) * config.fontScale)
  const buttonHeight = Math.max(config.minTouchTarget, Math.round(baseFont * 2.2))
  const buttonMin = Math.max(config.minTouchTarget, buttonHeight)
  const contentWidth = Math.max(1, Math.round(viewport.width - margin * 2))
  const topBarHeight = buttonHeight + gap
  /*
   * 极矮横屏走**并排**几何：棋盘在左列、控制区在右列（见 styles.css 同一档媒体查询）。
   *
   * 竖排时代棋盘高度要扣掉方向盘 + 操作按钮 + 统计栏（879×407@1.5× 下超过 300px），
   * 棋盘区只剩 ~70px、格子贴住 12px 绝对下限。并排后方向盘与状态条都不再按高度扣减：
   * 棋盘拿到「视口高 − 顶栏 − 状态条 − 外边距」，只把右侧控制列的宽度让出去。
   * 这一档 CSS 会把统计栏隐藏，所以这里也不再扣 statsHeight（否则模型比现实小一大截）。
   */
  const sideBySide = isCrampedLandscape(viewport)
  const statsHeight = sideBySide ? 0 : showStats ? Math.round(baseFont * 2.6) : 0
  /*
   * 控制区高度（统计栏另算；上下各留一份区块间距）：
   * - 不显示方向键：只剩「撤销 / 重开」一行；
   * - 倒 T（tee）：两行放大的键，撤销 / 重开已收进上排两侧，不再单独占一行；
   * - 平铺（row）：方向键一行 + 撤销 / 重开一行。
   */
  const teeKey = dpadTeeKeySize(buttonHeight)
  const controlsBody = !showDpad
    ? buttonHeight
    : options.dpadLayout === 'row'
      ? buttonHeight * 2 + gap
      : teeKey * 2 + DPAD_KEY_GAP_PX
  const controlsHeight = controlsBody + gap * 2 + statsHeight
  const controlsWidth = sideBySide
    ? Math.min(SIDE_CONTROLS_WIDTH_PX, Math.round(viewport.width * SIDE_CONTROLS_WIDTH_RATIO))
    : 0
  const boardArea = sideBySide
    ? {
        width: Math.max(1, Math.round(contentWidth - controlsWidth - gap)),
        height: Math.max(
          1,
          Math.round(
            viewport.height - topBarHeight - extraBottom - margin * 2 - CRAMPED_STRIP_PX - gap,
          ),
        ),
      }
    : {
        width: contentWidth,
        height: Math.max(
          1,
          Math.round(viewport.height - topBarHeight - controlsHeight - extraBottom - margin * 2),
        ),
      }
  return {
    baseFont,
    buttonMin,
    buttonHeight,
    margin,
    gap,
    contentWidth,
    topBarHeight,
    controlsHeight,
    boardArea,
  }
}

/**
 * 棋盘外框宽度（px）。**单一来源**：布局计算与 CSS 都用它 ——
 * 两处若不一致，棋盘就会比可用区大出一圈而被 overflow:hidden 裁掉上下边框。
 */
export const BOARD_FRAME_PX = 5

/**
 * 格子的绝对下限（px）。低于它游戏就没法玩了 —— 即使是方向盘驱动的密集网格。
 * 见 computeBoardLayout 里的两级下限说明。
 */
export const ABSOLUTE_MIN_CELL = 12

export function computeBoardLayout(
  area: { width: number; height: number },
  cols: number,
  rows: number,
  config: LayoutConfig = DEFAULT_LAYOUT,
  /**
   * 棋盘外框宽度（单边）。必须在算格子前**先从可用区里扣掉两侧外框**，
   * 否则 boardWidth/boardHeight 会比可用区多出 2×frame，上下（或左右）被裁掉。
   */
  frame: number = BOARD_FRAME_PX,
  /**
   * 安全余量（px）：从可用区里再扣掉这么多高度。
   *
   * 保留该参数（测试与将来可能的档位适配会用到），但**不再从界面传入**：
   * 它同样以「让格子变小」换取不裁切，在极矮横屏下会加剧坍缩。
   */
  safety: number = 0,
): BoardLayout {
  const safeCols = Math.max(1, Math.floor(cols))
  const safeRows = Math.max(1, Math.floor(rows))
  const safeFrame = Math.max(0, frame)
  const innerWidth = Math.max(1, area.width - safeFrame * 2)
  const innerHeight = Math.max(1, area.height - safeFrame * 2 - Math.max(0, safety))
  const fit = Math.min(innerWidth / safeCols, innerHeight / safeRows)
  /**
   * 两级下限（第 36 轮定稿，两次事故换来的）：
   *
   * - `config.minCell`（24px）是**期望值**：只要放得下就取它，保证点格子的玩法好点；
   * - `ABSOLUTE_MIN_CELL`（12px）是**绝对下限**：可用区不够时允许缩到这，但绝不能更小。
   *
   * 为什么不再把 24px 当硬钳位：密集网格在手机上放不下 24px，
   * 硬钳位会让棋盘溢出被裁（21×21 迷宫在 415px 宽下只需 19px，却被顶成 24px 而裁掉上下边）。
   * 为什么又必须有绝对下限：真机极矮横屏下棋盘区几乎为 0，曾经一路缩到 **1px**（完全不可玩 ✗✗）——
   * 那次是"没有下限"造成的，而不是"有下限"造成的。
   */
  // 期望值优先；放不下时才退让，但永不越过绝对下限
  const cell = fit >= config.minCell ? Math.floor(fit) : Math.max(ABSOLUTE_MIN_CELL, Math.floor(fit))
  const boardWidth = cell * safeCols + safeFrame * 2
  const boardHeight = cell * safeRows + safeFrame * 2
  return {
    cols: safeCols,
    rows: safeRows,
    cell,
    boardWidth,
    boardHeight,
    offsetX: Math.max(0, Math.round((area.width - boardWidth) / 2)),
    offsetY: Math.max(0, Math.round((area.height - boardHeight) / 2)),
  }
}

/** 目标设备视口的参考值（真机实测前的设计基线；真机实测后回填 A01） */
export const REFERENCE_VIEWPORTS: ReadonlyArray<{ name: string; viewport: Viewport }> = [
  { name: 'BOOX Note Air 10.3\" portrait (design baseline)', viewport: { width: 1123, height: 1498, dpr: 1.25 } },
  { name: 'BOOX Note Air 10.3\" landscape', viewport: { width: 1498, height: 1123, dpr: 1.25 } },
  { name: 'BOOX Poke 6\" portrait', viewport: { width: 718, height: 970, dpr: 1.5 } },
  { name: 'BOOX Nova 7.8\" portrait', viewport: { width: 938, height: 1250, dpr: 1.5 } },
  { name: 'BOOX Max 13.3\" portrait', viewport: { width: 1100, height: 1467, dpr: 1.5 } },
]

/**
 * 「极矮横屏、棋盘已经不可用」的判定阈值（棋盘区高度，CSS px）。
 *
 * 由来（真机实测）：BOOX P6Plus 强制横屏是 879×407，竖排时代顶栏 + 统计栏 + 控制区吃掉 300px 以上，
 * 留给棋盘区的高度会掉到 ~70px —— 12×12 的棋盘只能贴住 ABSOLUTE_MIN_CELL（12px）并被裁切。
 * 这个档位下自动步进（贪吃蛇自动前进 / 俄罗斯方块自动下落）会加剧不可用：
 * 玩家还没看清就已经走了一格。
 *
 * **本轮（2026-10-04）起这一档改为并排布局**（棋盘在左、控制在右，见 computeRootLayout 的 sideBySide）：
 * 879×407@1.5× 的棋盘区从 ~117px 回到 **270px**（本模型算 257px，略保守），
 * 实测格子数独 13 → **28px**、贪吃蛇 8 → **21px** ——
 * 于是它**不再**落在本判定内，自动步进恢复为各游戏自己的间隔（用户明确要求贪吃蛇统一 500ms）。
 * 阈值本身保留：真正放不下棋盘的横屏窗口（例如 879×240 这种带浏览器工具栏的横屏）
 * 依然会被判成极矮并减速 —— 判定的是「棋盘还能不能看清」，不是某个机型。
 *
 * 判定只用于**放慢自动步进**（见 packages/ui/src/session.ts 的 tickSlowdown），
 * 不改变任何游戏规则，也不改变布局本身。
 */
export const CRAMPED_BOARD_AREA_PX = 160

/** 当前视口是否落在「棋盘已经不可用」的极矮横屏档 */
export function isCrampedLayout(
  viewport: Viewport,
  config: LayoutConfig = DEFAULT_LAYOUT,
  showDpad = true,
  dpadLayout: DpadLayout = 'tee',
): boolean {
  return (
    computeRootLayout(viewport, config, { showDpad, showStats: true, dpadLayout }).boardArea.height <
    CRAMPED_BOARD_AREA_PX
  )
}
