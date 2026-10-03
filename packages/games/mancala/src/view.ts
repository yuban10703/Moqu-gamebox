/**
 * 展示模型：把局面翻译成「与呈现技术无关」的棋盘与控制项描述。
 *
 * 棋盘是 **2 行 × 7 列**（与 board.ts 的布局一致，不设 groups）：
 *
 *        列0      列1   列2   列3   列4   列5   列6
 *  行0  白仓[0]  白坑1  白坑2  白坑3  白坑4  白坑5  白坑6     ← 白方（对手）
 *  行1  黑坑7    黑坑8  黑坑9  黑坑10 黑坑11 黑坑12 黑仓[13]  ← 黑方（玩家）
 *
 * 1-bit 墨水屏约束（全部复用壳层已有的 kind）：
 * - **空坑** `kind:'floor'` + `glyph:'·'` + `textScale 0.5`（和迷宫「走过的路」同一手法）；
 * - **有石子的坑** `kind:'tile'` + `glyph:String(数量)` + `textScale 0.62`；
 * - **仓** `kind:'number'` + `glyph:String(数量)` + `textScale 0.55`
 *   —— 仓与坑用不同 kind 区分，黑白屏上靠边框/字形区分得开；
 * - 数字可能是两位数甚至三位数（吃子后仓里会很多），因此按位数逐级缩小字号，避免糊在一起：
 *   坑 1 位 0.62 / 2 位 0.5 / 3 位 0.42；仓 0.55 / 0.45 / 0.38。
 */
import type { BoardView, CellKind, CellView, ControlSpec, GameView, StatView } from '@eink/core'
import {
  BLACK,
  COLS,
  ROWS,
  WHITE,
  isStore,
  storeCount,
  type MancalaState,
} from './board.js'
import { gameStatus, outcomeOf } from './rules.js'

/** 空坑的小点（棋盘符号，不是界面文案） */
export const EMPTY_PIT_GLYPH = '·' // i18n-exempt
export const EMPTY_PIT_TEXT_SCALE = 0.5
/** 坑内有石子时的数字字号（1/2/3 位） */
export const PIT_TEXT_SCALES = [0.62, 0.5, 0.42] as const
/** 仓的数字字号（1/2/3 位） */
export const STORE_TEXT_SCALES = [0.55, 0.45, 0.38] as const

export function textScaleFor(count: number, side: 'pit' | 'store'): number {
  const scales = side === 'pit' ? PIT_TEXT_SCALES : STORE_TEXT_SCALES
  const digits = String(count).length
  return scales[Math.min(digits, scales.length) - 1]!
}

/** 壳层无障碍标签用的 key（apps/web 的约定为 `<namespace>.cell.<kind>`） */
export const CELL_LABEL_KEYS: Partial<Record<CellKind, string>> = {
  floor: 'mancala.cell.floor',
  tile: 'mancala.cell.tile',
  number: 'mancala.cell.number',
}

/** 注册表用：把 kind 映射到文案 key（壳层不硬编码玩法文案） */
export function cellLabelKey(kind: CellKind): string | undefined {
  return CELL_LABEL_KEYS[kind]
}

export function cellKindAt(state: MancalaState, index: number): CellKind {
  if (isStore(index)) return 'number'
  return (state.cells[index] ?? 0) === 0 ? 'floor' : 'tile'
}

export function cellGlyphAt(state: MancalaState, index: number): string {
  const count = state.cells[index] ?? 0
  if (isStore(index)) return String(count)
  return count === 0 ? EMPTY_PIT_GLYPH : String(count)
}

export function buildBoard(state: MancalaState): BoardView {
  const cells: CellView[] = []
  for (let index = 0; index < COLS * ROWS; index++) {
    const count = state.cells[index] ?? 0
    const store = isStore(index)
    const kind: CellKind = store ? 'number' : count === 0 ? 'floor' : 'tile'
    const glyph = store ? String(count) : count === 0 ? EMPTY_PIT_GLYPH : String(count)
    cells.push({
      index,
      kind,
      glyph,
      // 空坑的小点用固定字号 0.5；有石子按位数缩字号；仓另有自己的一档
      textScale: store
        ? textScaleFor(count, 'store')
        : count === 0
          ? EMPTY_PIT_TEXT_SCALE
          : textScaleFor(count, 'pit'),
    })
  }
  // 刻意不设 groups：2 行网格本身就是布局，分组线会挡住仓与坑的区分
  return { kind: 'grid', cols: COLS, rows: ROWS, cells }
}

/**
 * 控制项：只有撤销。
 * 棋盘点击是唯一的主要输入（selectAction 把「点自己的坑」映射成播种），
 * 重开/菜单由壳层自己渲染（壳层认识这些固定 id），游戏不重复声明。
 */
export function buildControls(state: MancalaState): ControlSpec[] {
  return [
    {
      id: 'undo',
      labelKey: 'shell.game.undo',
      role: 'action',
      enabled: state.log.length > 0,
      emphasis: 'normal',
    },
  ]
}

export function buildStats(state: MancalaState): StatView[] {
  // 三项恒定输出：内容出现/消失不会让统计栏高度跳动
  return [
    { labelKey: 'mancala.stat.black', value: String(storeCount(state.cells, BLACK)) },
    { labelKey: 'mancala.stat.white', value: String(storeCount(state.cells, WHITE)) },
    { labelKey: 'mancala.stat.moves', value: String(state.moves) },
  ]
}

export function buildView(state: MancalaState): GameView {
  const status = gameStatus(state)
  const details: Array<{ key: string; params?: Record<string, string | number> }> = []
  if (status !== 'playing') {
    // 带 params 的明细由壳层走 plural()，因此这些 key 必须提供复数形式
    details.push({ key: 'mancala.result.black', params: { count: storeCount(state.cells, BLACK) } })
    details.push({ key: 'mancala.result.white', params: { count: storeCount(state.cells, WHITE) } })
  }
  return {
    board: buildBoard(state),
    stats: buildStats(state),
    result:
      status === 'playing'
        ? null
        : { titleKey: `mancala.${outcomeOf(state)}.title`, details },
    // 没有需要壳层以稳定文字提示的状态：非法点击由壳层按 illegalNoticeKey 显示
    notice: null,
  }
}
