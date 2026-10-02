/**
 * 展示模型：把局面翻译成「与呈现技术无关」的棋盘与控制项描述。
 *
 * 1-bit 墨水屏约束：
 * - 棋子只用**实心圆 ● / 空心圆 ○** 区分黑白，不靠灰阶；
 * - 可落点用一个小点 `·`（kind: 'number' + textScale 0.5）标出 ——
 *   kind 只是壳层的渲染分类（'number' 在壳层里是「带文字的格子」），语义由本文件定义；
 * - 棋盘不加分组线（8×8 没有宫结构，多一层线只会更花）。
 */
import type { BoardView, CellKind, CellView, ControlSpec, GameView, StatView } from '@eink/core'
import {
  BLACK,
  BOARD_SIZE,
  EMPTY,
  WHITE,
  countDiscs,
  legalMovesFor,
  type Side,
} from './board.js'
import { gameStatus, type ReversiState } from './rules.js'

/** 黑白棋子的字形：实心 vs 空心（形状区分，黑白屏上可辨） */
export const DISC_GLYPHS: Record<Side, string> = { [BLACK]: '●', [WHITE]: '○' }

/** 合法落点提示：一个小点，字号减半以免和棋子抢注意力 */
export const HINT_GLYPH = '·'
export const HINT_TEXT_SCALE = 0.5

/** 壳层无障碍标签用的 key（apps/web 的约定：`<namespace>.cell.<kind>`） */
export const CELL_LABEL_KEYS: Partial<Record<CellKind, string>> = {
  tile: 'reversi.cell.tile',
  number: 'reversi.cell.number',
  empty: 'reversi.cell.empty',
}

/** 注册表用：把 kind 映射到文案 key（壳层不硬编码玩法文案） */
export function cellLabelKey(kind: CellKind): string | undefined {
  return CELL_LABEL_KEYS[kind]
}

interface RenderContext {
  finished: boolean
  /** 玩家（黑方）当前可落子的空格：只有轮到玩家时才提示 */
  hints: ReadonlySet<number>
}

function contextOf(state: ReversiState): RenderContext {
  const finished = gameStatus(state) !== 'playing'
  return {
    finished,
    hints: new Set(finished ? [] : legalMovesFor(state.board, BLACK)),
  }
}

function kindOf(state: ReversiState, context: RenderContext, index: number): CellKind {
  if (state.board[index] !== EMPTY) return 'tile'
  return context.hints.has(index) ? 'number' : 'empty'
}

function glyphOf(state: ReversiState, context: RenderContext, index: number): string {
  const disc = state.board[index]!
  if (disc !== EMPTY) return DISC_GLYPHS[disc] ?? ''
  return context.hints.has(index) ? HINT_GLYPH : ''
}

export function cellKindAt(state: ReversiState, index: number): CellKind {
  return kindOf(state, contextOf(state), index)
}

export function cellGlyphAt(state: ReversiState, index: number): string {
  const context = contextOf(state)
  return glyphOf(state, context, index)
}

export function buildBoard(state: ReversiState): BoardView {
  const context = contextOf(state)
  const cells: CellView[] = []
  for (let index = 0; index < state.board.length; index++) {
    const kind = kindOf(state, context, index)
    const cell: CellView = { index, kind, glyph: glyphOf(state, context, index) }
    // 提示点比棋子小一号：黑白屏上没有颜色可用，字号差是唯一的层次手段
    if (kind === 'number') cell.textScale = HINT_TEXT_SCALE
    cells.push(cell)
  }
  return { kind: 'grid', cols: BOARD_SIZE, rows: BOARD_SIZE, cells }
}

/**
 * 控制项：只有「撤销」。
 * 重开/下一关/菜单由壳层自己渲染（壳层认识这些固定 id），游戏不要重复声明；
 * 撤销声明 id 为 `undo`，壳层拿它的 `enabled` 决定按钮是否可点。
 * 终局后仍允许撤销（可以退回关键一手重下），所以只按历史是否为空来禁用。
 */
export function buildControls(state: ReversiState): ControlSpec[] {
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

export function buildStats(state: ReversiState): StatView[] {
  const { black, white } = countDiscs(state.board)
  // 三项正好占满窄屏统计栏：双方子数与玩家的步数（总手数含白方，玩家看不懂，不放）
  return [
    { labelKey: 'reversi.stat.black', value: String(black) },
    { labelKey: 'reversi.stat.white', value: String(white) },
    { labelKey: 'reversi.stat.moves', value: String(state.moves) },
  ]
}

/** 真实结果：status() 把平局并进 won（见 rules.ts 的取舍说明），结果页文案要如实说 */
export function outcomeOf(state: ReversiState): 'won' | 'lost' | 'draw' {
  const { black, white } = countDiscs(state.board)
  if (black > white) return 'won'
  if (black < white) return 'lost'
  return 'draw'
}

export function buildView(state: ReversiState): GameView {
  const status = gameStatus(state)
  const { black, white } = countDiscs(state.board)
  const details: Array<{ key: string; params?: Record<string, string | number> }> = []
  if (status !== 'playing') {
    // 带 params 的明细由壳层走 plural()，因此这两个 key 必须提供 __other
    details.push({ key: 'reversi.result.black', params: { count: black } })
    details.push({ key: 'reversi.result.white', params: { count: white } })
  }
  return {
    board: buildBoard(state),
    stats: buildStats(state),
    result:
      status === 'playing' ? null : { titleKey: `reversi.${outcomeOf(state)}.title`, details },
    // 自动过手是规则层的产物（状态里带语义标记），这里翻译成 i18n key
    notice: state.notice ? { textKey: `reversi.notice.${state.notice}` } : null,
  }
}
