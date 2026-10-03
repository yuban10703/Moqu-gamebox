/**
 * 展示模型：把局面翻译成「与呈现技术无关」的棋盘与控制项描述。
 *
 * 1-bit 墨水屏约束（全部复用壳层已有的 kind）：
 * - 点（奇行奇列）`kind:'wall'`：壳层斜纹透出来，一眼看出是交叉点而不是可点的边；
 * - 方格（偶行偶列）：未占领 `kind:'empty'`；被占领 `kind:'tile'` + 黑 `■` / 白 `□`；
 * - 边：未画 `kind:'floor'`（留白）；黑方画过 `tile` + `-`（横边）/ `|`（竖边）；
 *   白方画过 `tile` + `=`（横边）/ `‖`（竖边）—— 用**不同字形**区分双方，不靠灰阶。
 *
 * 棋盘字号：边是细长符号，用 0.7；方格用 0.55，两者都不与相邻格子糊在一起。
 */
import type { BoardView, CellKind, CellView, ControlSpec, GameView, StatView } from '@eink/core'
import {
  BLACK,
  configFor,
  countScores,
  isBox,
  isDot,
  isEdge,
  isHorizontalEdge,
  openEdges,
  type DotsBoxesState,
} from './board.js'
import { gameStatus, outcomeOf } from './rules.js'

/** 方格字形：黑实心方块 / 白空心方块（形状区分，不用灰阶） */
export const BOX_GLYPHS = {
  black: '■', // i18n-exempt
  white: '□', // i18n-exempt
} as const

/** 边字形：黑方用实线，白方用双线；横竖各一种 */
export const EDGE_GLYPHS = {
  black: { horizontal: '-', vertical: '|' }, // i18n-exempt
  white: { horizontal: '=', vertical: '‖' }, // i18n-exempt
} as const

export const BOX_TEXT_SCALE = 0.55
export const EDGE_TEXT_SCALE = 0.7

/** 壳层无障碍标签用的 key（apps/web 的约定为 `<namespace>.cell.<kind>`） */
export const CELL_LABEL_KEYS: Partial<Record<CellKind, string>> = {
  wall: 'dotsboxes.cell.wall',
  empty: 'dotsboxes.cell.empty',
  floor: 'dotsboxes.cell.floor',
  tile: 'dotsboxes.cell.tile',
}

/** 注册表用：把 kind 映射到文案 key（壳层不硬编码玩法文案） */
export function cellLabelKey(kind: CellKind): string | undefined {
  return CELL_LABEL_KEYS[kind]
}

export function cellKindAt(state: DotsBoxesState, index: number): CellKind {
  const config = configFor(state.difficulty)
  if (isDot(index, config)) return 'wall'
  if (isBox(index, config)) return state.owners[index] === null ? 'empty' : 'tile'
  // 边：没画是 floor，画过就是 tile
  return state.edges[index] === null ? 'floor' : 'tile'
}

export function cellGlyphAt(state: DotsBoxesState, index: number): string {
  const config = configFor(state.difficulty)
  if (isBox(index, config)) {
    const owner = state.owners[index]
    return owner === null ? '' : owner === BLACK ? BOX_GLYPHS.black : BOX_GLYPHS.white
  }
  if (!isEdge(index, config)) return ''
  const owner = state.edges[index]
  if (owner === null) return ''
  const horizontal = isHorizontalEdge(index, config)
  return owner === BLACK
    ? horizontal
      ? EDGE_GLYPHS.black.horizontal
      : EDGE_GLYPHS.black.vertical
    : horizontal
      ? EDGE_GLYPHS.white.horizontal
      : EDGE_GLYPHS.white.vertical
}

export function buildBoard(state: DotsBoxesState): BoardView {
  const config = configFor(state.difficulty)
  const cells: CellView[] = []
  for (let index = 0; index < config.cells; index++) {
    const kind = cellKindAt(state, index)
    const glyph = cellGlyphAt(state, index)
    const cell: CellView = { index, kind, glyph }
    if (glyph !== '') {
      cell.textScale = isBox(index, config) ? BOX_TEXT_SCALE : EDGE_TEXT_SCALE
    }
    cells.push(cell)
  }
  // 刻意不设 groups：点格棋棋盘没有分组结构
  return { kind: 'grid', cols: config.gridSize, rows: config.gridSize, cells }
}

/**
 * 控制项：只有撤销。
 * 棋盘点击是唯一的主要输入（selectAction 把「点边」映射成画线），
 * 重开/菜单由壳层自己渲染（壳层认识这些固定 id），游戏不重复声明。
 */
export function buildControls(state: DotsBoxesState): ControlSpec[] {
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

export function buildStats(state: DotsBoxesState): StatView[] {
  const { black, white } = countScores(state.owners)
  // 三项恒定输出：内容出现/消失不会让统计栏高度跳动
  return [
    { labelKey: 'dotsboxes.stat.black', value: String(black) },
    { labelKey: 'dotsboxes.stat.white', value: String(white) },
    { labelKey: 'dotsboxes.stat.remaining', value: String(openEdges(state).length) },
  ]
}

export function buildView(state: DotsBoxesState): GameView {
  const status = gameStatus(state)
  const { black, white } = countScores(state.owners)
  const details: Array<{ key: string; params?: Record<string, string | number> }> = []
  if (status !== 'playing') {
    // 带 params 的明细由壳层走 plural()，因此这些 key 必须提供复数形式
    details.push({ key: 'dotsboxes.result.black', params: { count: black } })
    details.push({ key: 'dotsboxes.result.white', params: { count: white } })
  }
  return {
    board: buildBoard(state),
    stats: buildStats(state),
    result:
      status === 'playing' ? null : { titleKey: `dotsboxes.${outcomeOf(state)}.title`, details },
    // 没有需要壳层以稳定文字提示的状态：非法点击由壳层按 illegalNoticeKey 显示
    notice: null,
  }
}
