/**
 * 展示模型：把局面翻译成「与呈现技术无关」的棋盘与控制项描述。
 *
 * 1-bit 墨水屏约束（与象棋/五子棋同一套约定）：
 * - 棋子字形：**两方同用一组字母 K Q R B N P**（ASCII 安全），靠**圆片底色**区分 ——
 *   白方 disc='light'（白底黑字 + 双边框）、黑方 disc='dark'（黑底白字 + 粗边框）；
 * - 最后一手位置标记：起点圆点（白方 ○ 空心 / 黑方 ● 实心）+ 终点内框（白方单框 / 黑方双框），
 *   双方各自的末手都标（黑方覆盖白方）；
 * - AI 两拍式应手的第一拍：那枚黑子显示为选中态（壳层的四角角标），第二拍才落子；
 * - 吃子架：棋盘上下两行缩小版圆片（上=白方战果、下=黑方战果），从左边起排。
 */
import type { BoardView, CellKind, CellView, ControlSpec, GameView, StatView } from '@eink/core'
import {
  BLACK,
  CELLS,
  EMPTY,
  WHITE,
  kingIndexOf,
  legalMovesOn,
  moveFrom,
  moveTo,
  packMove,
  sideOf,
  typeOf,
  type MutablePosition,
  type Piece,
  type Side,
} from './board.js'
import { outcomeOf, type ChessState, type Outcome } from './rules.js'

/** 兵种字形：两方同字（白=圆片浅底、黑=圆片深底来区分），行尾豁免 i18n 扫描 */
export const PIECE_GLYPHS: Record<number, string> = {
  1: 'K', // i18n-exempt
  2: 'Q', // i18n-exempt
  3: 'R', // i18n-exempt
  4: 'B', // i18n-exempt
  5: 'N', // i18n-exempt
  6: 'P', // i18n-exempt
}

/** 开局各兵种数量（按 type 下标：1 王 2 后 3 车 4 象 5 马 6 兵） */
const INITIAL_COUNTS: readonly number[] = [0, 1, 1, 2, 2, 2, 8]

/** 壳层无障碍标签用的 key（apps/web 的约定：`<namespace>.cell.<kind>`） */
export const CELL_LABEL_KEYS: Partial<Record<CellKind, string>> = {
  tile: 'chess.cell.tile',
  goal: 'chess.cell.goal',
  empty: 'chess.cell.empty',
}

export function cellLabelKey(kind: CellKind): string | undefined {
  return CELL_LABEL_KEYS[kind]
}

/** 被吃掉的子（初始数量 − 盘上数量，按 后/车/象/马/兵 排列），用于棋盘外侧吃子架 */
export function capturedGlyphs(state: ChessState, side: Side): string {
  const counts = [...INITIAL_COUNTS]
  for (const piece of state.board) {
    // 只数对方仍在盘上的子：初始数量 − 盘上数量 = 我方吃掉的
    if (piece === EMPTY || sideOf(piece) === side) continue
    counts[typeOf(piece)]--
  }
  let out = ''
  for (const type of [2, 3, 4, 5, 6]) {
    const n = counts[type]
    if (n > 0) out += PIECE_GLYPHS[type]!.repeat(n)
  }
  return out
}

/** 选中棋子的合法落点集合（供 goal 标记） */
function targetsOf(state: ChessState, from: number): Set<number> {
  const pos: MutablePosition = {
    board: state.board.slice(),
    sideToMove: WHITE,
    castling: state.castling,
    epSquare: state.epSquare,
  }
  const targets = new Set<number>()
  for (const move of legalMovesOn(pos)) {
    if (moveFrom(move) === from) targets.add(moveTo(move))
  }
  return targets
}

export function buildBoard(state: ChessState): BoardView {
  const cells: CellView[] = []
  const targets = state.selected !== null ? targetsOf(state, state.selected) : new Set<number>()

  // 双方各自的最后一手（回合日志的最后一回合；同一格时黑方覆盖白方）
  const lastFrom = new Map<number, 0 | 1>()
  const lastTo = new Map<number, 0 | 1>()
  const lastTurn = state.history[state.history.length - 1]
  if (lastTurn) {
    if (lastTurn.white !== null) {
      lastFrom.set(moveFrom(lastTurn.white), 0)
      lastTo.set(moveTo(lastTurn.white), 0)
    }
    if (lastTurn.black !== null) {
      lastFrom.set(moveFrom(lastTurn.black), 1)
      lastTo.set(moveTo(lastTurn.black), 1)
    }
  }

  // AI 两拍式应手的第一拍：把选中的那枚黑子标为选中态
  const pickFrom = state.opponentPick !== null ? moveFrom(state.opponentPick) : null

  for (let index = 0; index < CELLS; index++) {
    const piece = state.board[index] as Piece
    const cell: CellView = piece === EMPTY
      ? { index, kind: targets.has(index) ? 'goal' : 'empty', glyph: '' }
      : {
          index,
          kind: 'tile',
          glyph: PIECE_GLYPHS[typeOf(piece)] ?? '',
          disc: sideOf(piece) === WHITE ? 'light' : 'dark',
          ...(index === state.selected || index === pickFrom ? { selected: true } : {}),
        }
    const from = lastFrom.get(index)
    if (from !== undefined) cell.lastFrom = from
    const to = lastTo.get(index)
    if (to !== undefined) cell.lastTo = to
    cells.push(cell)
  }
  return { kind: 'grid', cols: 8, rows: 8, cells }
}

/** 控制项：只有「撤销」。重开/菜单由壳层自己渲染，游戏不要重复声明。 */
export function buildControls(state: ChessState): ControlSpec[] {
  return [
    {
      id: 'undo',
      labelKey: 'shell.game.undo',
      role: 'action',
      enabled: state.history.length > 0,
      emphasis: 'normal',
    },
  ]
}

export function buildStats(state: ChessState): StatView[] {
  let white = 0
  let black = 0
  for (const piece of state.board) {
    if (piece === EMPTY) continue
    if (sideOf(piece) === WHITE) white++
    else black++
  }
  return [
    { labelKey: 'chess.stat.white', value: String(white) },
    { labelKey: 'chess.stat.black', value: String(black) },
    { labelKey: 'chess.stat.moves', value: String(state.moves) },
  ]
}

/** 真实结果标题 key：status() 把平局并进 won，结果页文案要如实说 */
export function resultTitleKey(outcome: Outcome): string {
  if (outcome === 'black') return 'chess.lost.title'
  if (outcome === 'draw') return 'chess.draw.title'
  return 'chess.won.title'
}

export function buildView(state: ChessState): GameView {
  const outcome = outcomeOf(state)
  const details: Array<{ key: string; params?: Record<string, string | number> }> = []
  if (outcome !== null) {
    details.push({ key: 'chess.result.moves', params: { count: state.moves } })
    if (outcome === 'draw') details.push({ key: 'chess.result.draw' })
  }
  return {
    board: buildBoard(state),
    stats: buildStats(state),
    result: outcome === null ? null : { titleKey: resultTitleKey(outcome), details },
    notice: null,
    captured: {
      top: capturedGlyphs(state, WHITE),
      bottom: capturedGlyphs(state, BLACK),
    },
  }
}

export { kingIndexOf, packMove }
