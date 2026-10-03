/**
 * 展示模型：把局面翻译成「与呈现技术无关」的 7×7 棋盘与控制项描述。
 *
 * 7×7 网格里：
 * - **非点位** `kind:'wall'`（壳层斜纹透出来，一眼看出不是落点）；
 * - **空点位** `kind:'empty'`（留白）；
 * - **黑子** `kind:'tile'` + `glyph:'●'` + `textScale 0.6`；**白子** `kind:'tile'` + `glyph:'○'` + `textScale 0.6`
 *   —— 用实心/空心字形区分双方，不靠灰阶；
 * - **选中**的子 `selected: true`；
 * - **可选（帮助玩家看清选项）**：当前合法落点用 `kind:'number'` + `glyph:'·'` + `textScale 0.45` 标出：
 *   ① 落子期 = 所有空点位；② 移动/飞子期已选中一颗子时 = 这一手能去的空点；
 *   ③ 正等吃子时 = 可吃的对方子标 `selected: true`（此时没有别的选中，语义不冲突）。
 *
 * 棋盘符号（●/○/·）都标了 i18n-exempt：它们是图形符号，不是界面文案。
 */
import type { BoardView, CellKind, CellView, ControlSpec, GameView, StatView } from '@eink/core'
import {
  BLACK,
  BOARD_SIZE,
  GRID_CELLS,
  POINT_COUNT,
  WHITE,
  boardCount,
  isInMill,
  otherPlayer,
  phaseOf,
  pointAtGrid,
  rawActions,
  type NinemensState,
} from './board.js'
import { gameStatus } from './rules.js'

/** 黑子实心、白子空心；可落点小点 */
export const BLACK_GLYPH = '●' // i18n-exempt
export const WHITE_GLYPH = '○' // i18n-exempt
export const STONE_TEXT_SCALE = 0.6
export const OPTION_GLYPH = '·' // i18n-exempt
export const OPTION_TEXT_SCALE = 0.45

/** 壳层无障碍标签用的 key（apps/web 的约定为 `<namespace>.cell.<kind>`） */
export const CELL_LABEL_KEYS: Partial<Record<CellKind, string>> = {
  wall: 'ninemens.cell.wall',
  empty: 'ninemens.cell.empty',
  tile: 'ninemens.cell.tile',
  number: 'ninemens.cell.number',
}

/** 注册表用：把 kind 映射到文案 key（壳层不硬编码玩法文案） */
export function cellLabelKey(kind: CellKind): string | undefined {
  return CELL_LABEL_KEYS[kind]
}

/**
 * 当前「值得高亮/可点」的点位集合：
 * - 待吃子：可吃的对方子（用 selected 高亮，因为此时没有别的选中）；
 * - 落子期：所有空点位（都是合法落点）；
 * - 移动期且已选中：选中那一步能到的空点。
 */
export interface Highlights {
  readonly options: ReadonlySet<number>
  readonly removable: ReadonlySet<number>
}

export function highlightsOf(state: NinemensState): Highlights {
  const options = new Set<number>()
  const removable = new Set<number>()
  if (gameStatus(state) !== 'playing') return { options, removable }
  if (state.turn !== BLACK) return { options, removable }
  if (state.pendingRemove > 0) {
    for (const action of rawActions(state)) {
      if (action.type === 'remove') removable.add(action.index)
    }
    return { options, removable }
  }
  if (phaseOf(state) === 'placing') {
    for (let point = 0; point < POINT_COUNT; point++) {
      if (state.points[point] === null) options.add(point)
    }
    return { options, removable }
  }
  if (state.selected !== null) {
    for (const action of rawActions(state)) {
      if (action.type === 'move' && action.from === state.selected) options.add(action.to)
    }
  }
  return { options, removable }
}

export function cellKindAt(state: NinemensState, gridIndex: number): CellKind {
  const point = pointAtGrid(gridIndex)
  if (point < 0) return 'wall'
  const owner = state.points[point]
  if (owner !== null) return 'tile'
  return highlightsOf(state).options.has(point) ? 'number' : 'empty'
}

export function cellGlyphAt(state: NinemensState, gridIndex: number): string {
  const point = pointAtGrid(gridIndex)
  if (point < 0) return ''
  const owner = state.points[point]
  if (owner === BLACK) return BLACK_GLYPH
  if (owner === WHITE) return WHITE_GLYPH
  return highlightsOf(state).options.has(point) ? OPTION_GLYPH : ''
}

export function buildBoard(state: NinemensState): BoardView {
  const highlights = highlightsOf(state)
  const cells: CellView[] = []
  for (let gridIndex = 0; gridIndex < GRID_CELLS; gridIndex++) {
    const point = pointAtGrid(gridIndex)
    if (point < 0) {
      cells.push({ index: gridIndex, kind: 'wall', glyph: '' })
      continue
    }
    const owner = state.points[point]
    const cell: CellView = { index: gridIndex, kind: 'empty', glyph: '' }
    if (owner === BLACK || owner === WHITE) {
      cell.kind = 'tile'
      cell.glyph = owner === BLACK ? BLACK_GLYPH : WHITE_GLYPH
      cell.textScale = STONE_TEXT_SCALE
      if (owner === BLACK && state.selected === point) cell.selected = true
      if (owner === WHITE && highlights.removable.has(point)) cell.selected = true
    } else if (highlights.options.has(point)) {
      cell.kind = 'number'
      cell.glyph = OPTION_GLYPH
      cell.textScale = OPTION_TEXT_SCALE
    }
    cells.push(cell)
  }
  // 刻意不设 groups：7×7 网格本身就是盘面，分组线会挡住连线关系
  return { kind: 'grid', cols: BOARD_SIZE, rows: BOARD_SIZE, cells }
}

/**
 * 控制项：只有撤销。
 * 棋盘点击是唯一的主要输入（selectAction 负责选中/落子/移动/吃子），
 * 重开/菜单由壳层自己渲染（壳层认识这些固定 id），游戏不重复声明。
 */
export function buildControls(state: NinemensState): ControlSpec[] {
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

export function buildStats(state: NinemensState): StatView[] {
  // 三项恒定输出：内容出现/消失不会让统计栏高度跳动
  return [
    { labelKey: 'ninemens.stat.black', value: String(boardCount(state, BLACK)) },
    { labelKey: 'ninemens.stat.white', value: String(boardCount(state, WHITE)) },
    { labelKey: 'ninemens.stat.hand', value: String(state.inHand[BLACK]) },
  ]
}

export function buildView(state: NinemensState): GameView {
  const status = gameStatus(state)
  const details: Array<{ key: string; params?: Record<string, string | number> }> = []
  if (status !== 'playing') {
    // 带 params 的明细由壳层走 plural()，因此这些 key 必须提供复数形式
    details.push({ key: 'ninemens.result.moves', params: { count: state.moves } })
    details.push({ key: 'ninemens.result.captured', params: { count: state.removed[WHITE] } })
  }
  return {
    board: buildBoard(state),
    stats: buildStats(state),
    result: status === 'playing' ? null : { titleKey: `ninemens.${status}.title`, details },
    // 没有需要壳层以稳定文字提示的状态：非法点击由壳层按 illegalNoticeKey 显示
    notice: null,
  }
}

/** 供测试/调试：某方是否还有子在三连里（吃子限制会用到） */
export function inMill(state: NinemensState, point: number, player = otherPlayer(state.turn)): boolean {
  return isInMill(state, point, player)
}
