/**
 * 展示模型：把局面翻译成「与呈现技术无关」的棋盘与控制项描述。
 *
 * 1-bit 墨水屏约束（全部复用壳层已有的 kind）：
 * - 浅色格（不能放子）`kind:'wall'`：壳层容器的 45° 斜纹透出来，一眼看出不是棋盘；
 * - 深色空格 `kind:'empty'`：留白；
 * - 棋子 `kind:'tile'`：黑兵 ● / 黑王 ◉ / 白兵 ○ / 白王 ◎，`textScale 0.6`（实心/空心 + 圆点区分王）；
 * - 选中的棋子与「上一步」的起止格都标 `selected: true`（壳层加粗内描边）；冲突时只标选中。
 */
import type { BoardView, CellKind, CellView, ControlSpec, GameView, StatView } from '@eink/core'
import {
  BLACK_KING,
  BLACK_MAN,
  BOARD_SIZE,
  CELLS,
  EMPTY,
  WHITE_KING,
  WHITE_MAN,
  countPieces,
  isPlayable,
} from './board.js'
import { gameStatus, outcomeOf, type CheckersState } from './rules.js'

/** 棋子字形：黑实心 / 白空心；王多一个内点，形状可辨（不靠灰阶） */
export const PIECE_GLYPHS: Record<number, string> = {
  [BLACK_MAN]: '●',
  [BLACK_KING]: '◉',
  [WHITE_MAN]: '○',
  [WHITE_KING]: '◎',
}

export const PIECE_TEXT_SCALE = 0.6

/** 壳层无障碍标签用的 key（apps/web 的约定为 `<namespace>.cell.<kind>`） */
export const CELL_LABEL_KEYS: Partial<Record<CellKind, string>> = {
  wall: 'checkers.cell.wall',
  empty: 'checkers.cell.empty',
  tile: 'checkers.cell.tile',
}

/** 注册表用：把 kind 映射到文案 key（壳层不硬编码玩法文案） */
export function cellLabelKey(kind: CellKind): string | undefined {
  return CELL_LABEL_KEYS[kind]
}

export function cellKindAt(state: CheckersState, index: number): CellKind {
  if (!isPlayable(index)) return 'wall'
  return state.board[index] === EMPTY ? 'empty' : 'tile'
}

export function cellGlyphAt(state: CheckersState, index: number): string {
  const piece = state.board[index]!
  if (!isPlayable(index) || piece === EMPTY) return ''
  return PIECE_GLYPHS[piece] ?? ''
}

function isLastMoveIndex(state: CheckersState, index: number): boolean {
  const last = state.lastMove
  return last !== null && (last.from === index || last.to === index)
}

export function buildBoard(state: CheckersState): BoardView {
  const cells: CellView[] = []
  for (let index = 0; index < CELLS; index++) {
    const kind = cellKindAt(state, index)
    const cell: CellView = { index, kind, glyph: cellGlyphAt(state, index) }
    if (kind === 'tile') cell.textScale = PIECE_TEXT_SCALE
    // 选中的棋子优先；否则标出「上一步」的起止格，方便复盘
    if (kind === 'tile' && state.selected === index) cell.selected = true
    else if (isLastMoveIndex(state, index)) cell.selected = true
    cells.push(cell)
  }
  // 刻意不设 groups：8×8 棋盘没有分组结构，多一层线只会更花
  return { kind: 'grid', cols: BOARD_SIZE, rows: BOARD_SIZE, cells }
}

/**
 * 控制项：只有撤销。
 * 棋盘点击是唯一的主要输入（selectAction 负责「选中 → 落点」两步交互），
 * 重开/菜单由壳层自己渲染（壳层认识这些固定 id），游戏不重复声明。
 */
export function buildControls(state: CheckersState): ControlSpec[] {
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

export function buildStats(state: CheckersState): StatView[] {
  const { black, white } = countPieces(state.board)
  return [
    { labelKey: 'checkers.stat.black', value: String(black) },
    { labelKey: 'checkers.stat.white', value: String(white) },
    { labelKey: 'checkers.stat.moves', value: String(state.moves) },
  ]
}

export function buildView(state: CheckersState): GameView {
  const status = gameStatus(state)
  const { black, white } = countPieces(state.board)
  const details: Array<{ key: string; params?: Record<string, string | number> }> = []
  if (status !== 'playing') {
    // 带 params 的明细由壳层走 plural()，因此这些 key 必须提供复数形式
    details.push({ key: 'checkers.result.black', params: { count: black } })
    details.push({ key: 'checkers.result.white', params: { count: white } })
    details.push({ key: 'checkers.result.moves', params: { count: state.moves } })
  }
  return {
    board: buildBoard(state),
    stats: buildStats(state),
    result:
      status === 'playing' ? null : { titleKey: `checkers.${outcomeOf(state)}.title`, details },
    // 没有需要壳层以稳定文字提示的状态：非法着法由壳层按 illegalNoticeKey 显示
    notice: null,
  }
}
