/**
 * 展示模型：把局面翻译成「与呈现技术无关」的棋盘与控制项描述。
 *
 * 1-bit 墨水屏约束：
 * - 棋子只用**实心圆 ● / 空心圆 ○** 区分黑白，不靠灰阶；
 * - 最后一手用 `selected: true` 加重描边（黑白屏上靠线宽区分，不用颜色、不加动画）；
 * - **列提示**：四子棋只有「列」有意义，因此在每个可落子的列的最下方空格上画一个
 *   `kind: 'number'` + `glyph: '·'` + `textScale: 0.5` 的小点 —— 落点在哪一列就提示在哪一列，
 *   比在棋盘外画箭头更省地方，也不会把棋子格弄花（棋子格仍是 tile）；
 * - 棋盘不加分组线（7×6 没有宫结构，多一层线只会更花）。
 */
import type { BoardView, CellKind, CellView, ControlSpec, GameView, StatView } from '@eink/core'
import {
  BLACK,
  BOARD_COLS,
  BOARD_ROWS,
  CELLS,
  EMPTY,
  WHITE,
  countStones,
  landingIndex,
  validColumns,
  type Side,
} from './board.js'
import { outcomeOf, type Connect4State, type Outcome } from './rules.js'

/** 棋子的字形：实心 vs 空心（形状区分，黑白屏上可辨） */
export const STONE_GLYPHS: Record<Side, string> = { [BLACK]: '●', [WHITE]: '○' }

/** 壳层无障碍标签用的 key（apps/web 的约定：`<namespace>.cell.<kind>`） */
export const CELL_LABEL_KEYS: Partial<Record<CellKind, string>> = {
  tile: 'connect4.cell.tile',
  empty: 'connect4.cell.empty',
  number: 'connect4.cell.number',
}

/** 列提示用的字形：一个小点，尺寸靠 textScale 压到半格 */
export const HINT_GLYPH = '·'
export const HINT_TEXT_SCALE = 0.5

/** 注册表用：把 kind 映射到文案 key（壳层不硬编码玩法文案） */
export function cellLabelKey(kind: CellKind): string | undefined {
  return CELL_LABEL_KEYS[kind]
}

/** 当前可落子的列 → 提示格索引（升序）。对局结束后不再提示 */
export function droppableIndexes(state: Connect4State): number[] {
  if (outcomeOf(state.board) !== null) return []
  const indexes: number[] = []
  for (const column of validColumns(state.board)) {
    const index = landingIndex(state.board, column)
    if (index !== null) indexes.push(index)
  }
  return indexes
}

export function cellKindAt(state: Connect4State, index: number): CellKind {
  if (state.board[index] !== EMPTY) return 'tile'
  return droppableIndexes(state).includes(index) ? 'number' : 'empty'
}

export function cellGlyphAt(state: Connect4State, index: number): string {
  const stone = state.board[index]
  if (stone !== EMPTY) return STONE_GLYPHS[stone] ?? ''
  return cellKindAt(state, index) === 'number' ? HINT_GLYPH : ''
}

export function buildBoard(state: Connect4State): BoardView {
  const hints = new Set(droppableIndexes(state))
  const cells: CellView[] = []
  for (let index = 0; index < CELLS; index++) {
    const stone = state.board[index]
    let cell: CellView
    if (stone !== EMPTY) {
      cell = { index, kind: 'tile', glyph: STONE_GLYPHS[stone] ?? '' }
    } else if (hints.has(index)) {
      // 提示点必须比棋子小：它是「这里可以落」，不是「这里有一颗子」
      cell = { index, kind: 'number', glyph: HINT_GLYPH, textScale: HINT_TEXT_SCALE }
    } else {
      cell = { index, kind: 'empty', glyph: '' }
    }
    // 最后一手高亮：黑白屏上没有颜色可用，加重描边是唯一稳定的层次手段
    if (index === state.lastMove) cell.selected = true
    cells.push(cell)
  }
  return { kind: 'grid', cols: BOARD_COLS, rows: BOARD_ROWS, cells }
}

/**
 * 控制项：只有「撤销」。
 * 重开/菜单由壳层自己渲染（壳层认识这些固定 id），游戏不要重复声明；
 * 撤销声明 id 为 `undo`，壳层拿它的 `enabled` 决定按钮是否可点。
 * 终局后仍允许撤销（可以退回关键一手重下），所以只按历史是否为空来禁用。
 */
export function buildControls(state: Connect4State): ControlSpec[] {
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

export function buildStats(state: Connect4State): StatView[] {
  const { black, white } = countStones(state.board)
  // 三项正好占满窄屏统计栏：双方子数与玩家的步数（白方应手不计入步数）
  return [
    { labelKey: 'connect4.stat.black', value: String(black) },
    { labelKey: 'connect4.stat.white', value: String(white) },
    { labelKey: 'connect4.stat.moves', value: String(state.moves) },
  ]
}

/** 真实结果标题 key：status() 把平局并进 won，结果页文案要如实说（见 rules.ts 的取舍说明） */
export function resultTitleKey(outcome: Outcome): string {
  if (outcome === 'white') return 'connect4.lost.title'
  if (outcome === 'draw') return 'connect4.draw.title'
  return 'connect4.won.title'
}

export function buildView(state: Connect4State): GameView {
  const outcome = outcomeOf(state.board)
  const details: Array<{ key: string; params?: Record<string, string | number> }> = []
  if (outcome !== null) {
    // 带 params 的明细由壳层走 plural()，因此这个 key 必须提供 __other（中文只提供 __other）
    details.push({ key: 'connect4.result.moves', params: { count: state.moves } })
    // 平局必须如实说明「棋盘下满但无人成四」，否则玩家会以为自己赢了
    if (outcome === 'draw') details.push({ key: 'connect4.result.draw' })
  }
  return {
    board: buildBoard(state),
    stats: buildStats(state),
    result: outcome === null ? null : { titleKey: resultTitleKey(outcome), details },
    // 白方永远在 reduce 内应手，没有「过手」这种中间态，因此不产生提示
    notice: null,
  }
}
