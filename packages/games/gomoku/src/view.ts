/**
 * 展示模型：把局面翻译成「与呈现技术无关」的棋盘与控制项描述。
 *
 * 1-bit 墨水屏约束：
 * - 棋子只用**实心圆 ● / 空心圆 ○** 区分黑白，不靠灰阶；
 * - **玩家的（黑方）最后一手**不反白：保持「加粗 + 放大一档」（kind 'given'，壳层里是白底 + 800 字重）——
 *   反白会把棋子本体一起翻过来：AI 的白子（空心圈）在黑底上看着像黑块（用户报过）；
 * - **AI（白方）的最后一手**改用**内框描边**（data-last-to='1' 双线框，复用象棋那套约定），
 *   棋子本体不动 —— 用户指定「AI 的末手格加内框、玩家方面不用改动」；
 * - AI 两拍式应手的第一拍：目标格（还是空格）先亮出同款双线框，第二拍白子才落进来；
 * - 空格就是空格（`kind: 'empty'`、glyph 空字符串）—— 五子棋任意空格都能落子，
 *   逐个画「可落点小点」等于整盘都带点，只会把棋盘弄花，因此不设提示点；
 * - 棋盘不加分组线（15×15 没有宫结构，多一层线只会更花）。
 */
import type { BoardView, CellKind, CellView, ControlSpec, GameView, StatView } from '@eink/core'
import { BLACK, BOARD_SIZE, CELLS, EMPTY, WHITE, countStones, type Side } from './board.js'
import { outcomeOf, type GomokuState, type Outcome } from './rules.js'

/** 五子棋子的字形：实心 vs 空心（形状区分，黑白屏上可辨） */
export const STONE_GLYPHS: Record<Side, string> = { [BLACK]: '●', [WHITE]: '○' }

/** 壳层无障碍标签用的 key（apps/web 的约定：`<namespace>.cell.<kind>`） */
export const CELL_LABEL_KEYS: Partial<Record<CellKind, string>> = {
  tile: 'gomoku.cell.tile',
  // 最后一手借 'given'（壳层语义：白底 + 加粗文字）而不是 selected（整格反白）
  given: 'gomoku.cell.given',
  empty: 'gomoku.cell.empty',
}

/**
 * 玩家（黑方）最后一手的字号放大比例。
 *
 * 为什么用「加粗 + 放大」而不是反白整格：反白会把棋子本体也翻过来 ——
 * 玩家（● 实心）与 AI（○ 空心）在选中格上互换观感，用户报过「AI 下的棋变成黑的」。
 * 只改线宽与大小，实心仍是实心、空心仍是空心，1-bit 下也分得清。
 * AI（白方）的末手不走这里，改用内框描边（见 buildBoard）。
 */
const LAST_MOVE_SCALE = 1.15

/** 注册表用：把 kind 映射到文案 key（壳层不硬编码玩法文案） */
export function cellLabelKey(kind: CellKind): string | undefined {
  return CELL_LABEL_KEYS[kind]
}

/**
 * 格子种类：空格 / 普通棋子 / **最后一手**（借 'given'：壳层里是白底 + 加粗文字）。
 * 只在这里判定一次 —— buildBoard 与无障碍标签都走它，避免两处逻辑漂移
 * （本轮就踩过：只改了 buildBoard，cellKindAt 仍返回 'tile'，测试立刻抓到）。
 */
export function cellKindAt(state: GomokuState, index: number): CellKind {
  if (state.board[index] === EMPTY) return 'empty'
  // 只有玩家的（黑方）末手借 'given'（白底 + 加粗放大）；AI（白方）末手改走内框描边
  return index === state.lastMove && state.board[index] === BLACK ? 'given' : 'tile'
}

export function cellGlyphAt(state: GomokuState, index: number): string {
  const stone = state.board[index]
  if (stone === EMPTY) return ''
  return STONE_GLYPHS[stone] ?? ''
}

export function buildBoard(state: GomokuState): BoardView {
  const cells: CellView[] = []
  for (let index = 0; index < CELLS; index++) {
    const stone = state.board[index]
    const kind = cellKindAt(state, index)
    const cell: CellView = {
      index,
      kind,
      glyph: stone === EMPTY ? '' : (STONE_GLYPHS[stone] ?? ''),
      // 玩家的最后一手：同色放大一档（加粗由 given 完成，不反白 —— 反白会翻转棋子本体观感）
      ...(kind === 'given' ? { textScale: LAST_MOVE_SCALE } : {}),
      // AI（白方）的最后一手：内框描边（双线框），棋子本体不动
      ...(index === state.lastMove && stone === WHITE ? { lastTo: 1 as const } : {}),
    }
    // AI 两拍式应手的第一拍：把目标格先亮出来（空格 + 同款双线框），第二拍白子落进来
    if (state.opponentPick !== null && state.opponentPick === index) cell.lastTo = 1
    cells.push(cell)
  }
  return { kind: 'grid', cols: BOARD_SIZE, rows: BOARD_SIZE, cells }
}

/**
 * 控制项：只有「撤销」。
 * 重开/菜单由壳层自己渲染（壳层认识这些固定 id），游戏不要重复声明；
 * 撤销声明 id 为 `undo`，壳层拿它的 `enabled` 决定按钮是否可点。
 * 终局后仍允许撤销（可以退回关键一手重下），所以只按历史是否为空来禁用。
 */
export function buildControls(state: GomokuState): ControlSpec[] {
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

export function buildStats(state: GomokuState): StatView[] {
  const { black, white } = countStones(state.board)
  // 三项正好占满窄屏统计栏：双方子数与玩家的步数（白方应手不计入步数）
  return [
    { labelKey: 'gomoku.stat.black', value: String(black) },
    { labelKey: 'gomoku.stat.white', value: String(white) },
    { labelKey: 'gomoku.stat.moves', value: String(state.moves) },
  ]
}

/** 真实结果标题 key：status() 把平局并进 won，结果页文案要如实说（见 rules.ts 的取舍说明） */
export function resultTitleKey(outcome: Outcome): string {
  if (outcome === 'white') return 'gomoku.lost.title'
  if (outcome === 'draw') return 'gomoku.draw.title'
  return 'gomoku.won.title'
}

export function buildView(state: GomokuState): GameView {
  const outcome = outcomeOf(state.board)
  const details: Array<{ key: string; params?: Record<string, string | number> }> = []
  if (outcome !== null) {
    // 带 params 的明细由壳层走 plural()，因此这个 key 必须提供 __other（中文只提供 __other）
    details.push({ key: 'gomoku.result.moves', params: { count: state.moves } })
    // 平局必须如实说明「盘满但无人成五」，否则玩家会以为自己赢了
    if (outcome === 'draw') details.push({ key: 'gomoku.result.draw' })
  }
  return {
    board: buildBoard(state),
    stats: buildStats(state),
    result: outcome === null ? null : { titleKey: resultTitleKey(outcome), details },
    // 白方永远在 reduce 内应手，没有「过手」这种中间态，因此不产生提示
    notice: null,
  }
}
