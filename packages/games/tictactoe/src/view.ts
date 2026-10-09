/**
 * 展示模型：把局面翻译成「与呈现技术无关」的棋盘与控制项描述。
 *
 * 1-bit 墨水屏约束（每一条都在真机上踩过或由既有玩法验证过）：
 * - 双方只用**两个不同的字形**区分：先手 ✕、后手 ○ —— 形状不同才不依赖灰阶；
 * - 最后一手加**内框**（方号 0 = 单线框、1 = 双线框，复用象棋/五子棋那套约定）：
 *   3×3 格子小、✕ 与 ○ 又都是细笔画，不标出来很难看出刚才是谁下在哪 —— 双人同屏时这一步尤其重要；
 * - 对手两拍式应手的第一拍：目标格（还是空格）先亮出同款双线框，第二拍 ○ 才落进来；
 * - 赢的三格用既有的 `disc: 'dark'`（象棋那套圆片）**反白**：1-bit 上最醒目的就是反色。
 *   结束时结果面板只占屏幕下方一格，盘面本身必须看得出是哪条线赢了；
 * - 提示格是一个小点 `·`（照黑白棋的提示写法：kind 'number' + textScale 0.5）。
 *   空格不铺满提示点 —— 3×3 的任意空格都能落子，逐个画点等于整盘都是点；
 * - 棋盘不加分组线（3×3 本身就是一组，多一层线只会更花）。
 */
import type { BoardView, CellKind, CellView, ControlSpec, GameView, StatView } from '@eink/core'
import { CELLS, EMPTY, FIRST, SECOND, SIZE, countMarks, type Side } from './board.js'
import {
  boardOf,
  movesOf,
  opponentLevel,
  outcomeOf,
  turnOf,
  winningLineOf,
  type Outcome,
  type TictactoeState,
} from './engine.js'

/** 双方的棋子字形：✕ vs ○（形状区分，黑白屏上可辨，与五子棋的 ●/○ 同一族写法） */
export const MARK_GLYPHS: Record<Side, string> = { [FIRST]: '✕', [SECOND]: '○' }

/** 提示格：一个小点，字号减半以免和棋子抢注意力 */
export const HINT_GLYPH = '·'
export const HINT_TEXT_SCALE = 0.5

/** 1-bit 上靠**线数**区分双方的内框（0 = 单线、1 = 双线），与象棋的 lastTo 约定一致 */
export const SIDE_FRAME: Record<Side, 0 | 1> = { [FIRST]: 0, [SECOND]: 1 }

/** 壳层无障碍标签用的 key（apps/web 的约定：`<namespace>.cell.<kind>`） */
export const CELL_LABEL_KEYS: Partial<Record<CellKind, string>> = {
  tile: 'tictactoe.cell.tile',
  number: 'tictactoe.cell.hint',
  empty: 'tictactoe.cell.empty',
}

/** 注册表用：把 kind 映射到文案 key（壳层不硬编码玩法文案） */
export function cellLabelKey(kind: CellKind): string | undefined {
  return CELL_LABEL_KEYS[kind]
}

export function cellKindAt(state: TictactoeState, index: number): CellKind {
  const board = boardOf(state)
  if (board[index] !== EMPTY) return 'tile'
  return state.hint === index ? 'number' : 'empty'
}

export function cellGlyphAt(state: TictactoeState, index: number): string {
  const mark = boardOf(state)[index]
  if (mark !== EMPTY) return MARK_GLYPHS[mark] ?? ''
  return state.hint === index ? HINT_GLYPH : ''
}

export function buildBoard(state: TictactoeState): BoardView {
  const board = boardOf(state)
  const line = winningLineOf(state)
  const lastIndex = state.log.length > 0 ? state.log[state.log.length - 1]! : null
  const cells: CellView[] = []
  for (let index = 0; index < CELLS; index++) {
    const mark = board[index]!
    const hinted = state.hint === index
    const kind: CellKind = mark !== EMPTY ? 'tile' : hinted ? 'number' : 'empty'
    const cell: CellView = {
      index,
      kind,
      glyph: mark !== EMPTY ? (MARK_GLYPHS[mark] ?? '') : hinted ? HINT_GLYPH : '',
    }
    if (kind === 'number') cell.textScale = HINT_TEXT_SCALE
    // 最后一手：单线框（先手）/ 双线框（后手），棋子本体不动
    if (index === lastIndex && mark !== EMPTY) cell.lastTo = SIDE_FRAME[mark]
    // 对手两拍式应手的第一拍：把目标格先亮出来（空格 + 同款双线框），第二拍 ○ 落进来
    if (state.opponentPick === index) cell.lastTo = SIDE_FRAME[SECOND]
    // 赢的三格反白：黑圆片 + 白字，一条线一眼可见（不依赖灰阶/颜色）
    if (line !== null && line.includes(index)) cell.disc = 'dark'
    cells.push(cell)
  }
  return { kind: 'grid', cols: SIZE, rows: SIZE, cells }
}

/**
 * 控制项：「撤销」与「提示」。
 * 重开/菜单由壳层自己渲染（壳层认识这些固定 id），游戏不要重复声明；
 * 撤销声明 id 为 `undo`，壳层拿它的 `enabled` 决定按钮是否可点，文案也由壳层提供（shell.game.undo）。
 * 终局后仍允许撤销（可以退回关键一手重下），所以只按日志是否为空来禁用。
 */
export function buildControls(state: TictactoeState): ControlSpec[] {
  const playing = outcomeOf(state) === null
  const humanTurn = playing && (opponentLevel(state.difficulty) === null || turnOf(state) === FIRST)
  return [
    {
      id: 'undo',
      labelKey: 'shell.game.undo',
      role: 'action',
      enabled: state.log.length > 0,
      emphasis: 'normal',
    },
    {
      id: 'hint',
      labelKey: 'tictactoe.action.hint',
      role: 'action',
      enabled: humanTurn,
      emphasis: 'normal',
    },
  ]
}

export function buildStats(state: TictactoeState): StatView[] {
  const counts = countMarks(boardOf(state))
  const hotseat = opponentLevel(state.difficulty) === null
  // 三项正好占满窄屏统计栏：两方的子数与本局总手数（最少手数就是「最快取胜」的成绩口径）
  return [
    { labelKey: hotseat ? 'tictactoe.stat.p1' : 'tictactoe.stat.you', value: String(counts.first) },
    { labelKey: hotseat ? 'tictactoe.stat.p2' : 'tictactoe.stat.computer', value: String(counts.second) },
    { labelKey: 'tictactoe.stat.moves', value: String(movesOf(state)) },
  ]
}

/**
 * 状态条上的固定文字：轮到谁。
 * 双人同屏特别需要它 —— 壳层不知道「现在该谁点」，两个人只能从静态文字上读出来。
 */
export function turnNoticeKey(state: TictactoeState): string {
  const hotseat = opponentLevel(state.difficulty) === null
  if (hotseat) return turnOf(state) === FIRST ? 'tictactoe.turn.p1' : 'tictactoe.turn.p2'
  return turnOf(state) === FIRST ? 'tictactoe.turn.you' : 'tictactoe.turn.computer'
}

/** 结果标题 key：对电脑用「你赢了 / 你输了」；双人同屏没有「你」，写清是哪一位赢的 */
export function resultTitleKey(state: TictactoeState, outcome: Outcome): string {
  const hotseat = opponentLevel(state.difficulty) === null
  if (hotseat) {
    if (outcome === 'first') return 'tictactoe.won.p1'
    if (outcome === 'second') return 'tictactoe.won.p2'
    return 'tictactoe.draw.title'
  }
  if (outcome === 'second') return 'tictactoe.lost.title'
  if (outcome === 'draw') return 'tictactoe.draw.title'
  return 'tictactoe.won.title'
}

export function buildView(state: TictactoeState): GameView {
  const outcome = outcomeOf(state)
  const details: Array<{ key: string; params?: Record<string, string | number> }> = []
  if (outcome !== null) {
    // 带 params 的明细由壳层走 plural()，因此这个 key 必须提供 __other（中文只提供 __other）
    details.push({ key: 'tictactoe.result.moves', params: { count: movesOf(state) } })
    // 和局必须如实说明「九格下满、谁都没连成线」，否则玩家会以为自己赢了
    if (outcome === 'draw') details.push({ key: 'tictactoe.result.draw' })
  }
  return {
    board: buildBoard(state),
    stats: buildStats(state),
    result: outcome === null ? null : { titleKey: resultTitleKey(state, outcome), details },
    // 对局中一直写着「轮到谁」：墨水屏没有动画与配色，回合信息只能靠稳定的文字
    notice: outcome === null ? { textKey: turnNoticeKey(state) } : null,
  }
}
