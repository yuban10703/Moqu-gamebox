/**
 * 展示模型：把局面翻译成「与呈现技术无关」的棋盘与控制项描述。
 *
 * 墨水屏 1-bit 的三种格面（不靠颜色、也不靠灰阶）：
 *   黑格 = 实心黑块、叉 = 交叉线、空格 = 留白。
 *
 * 线索**不画在格子里**，而是通过 BoardView 的 `rowClues` / `colClues` 交给壳层，
 * 画成棋盘**外侧**的两条线索带（左=行线索、上=列线索）——
 * 线索写进格子会把格子撑成一个字也放不下的小方块（10×10 时一行可能有 5 个数字），
 * 而数织的线索本来就该在棋盘外面（纸面数织就是这么印的）。
 */
import type { BoardView, CellKind, CellView, ControlSpec, GameView, StatView } from '@eink/core'
import { clueText, colCluesOf, colsOf, puzzlesFor, rowCluesOf, rowsOf } from './levels.js'
import {
  MARK_BLACK,
  MARK_CROSS,
  blackCount,
  gameStatus,
  hasMarks,
  puzzleOf,
  type NonogramState,
} from './engine.js'

/**
 * 叉的字形。
 *
 * 用 `flag`（契约里 flag 就是"玩家做的标记"，扫雷的旗子也走它）而不是 `CellView.wrong`：
 * wrong 的语义是"填错了"（合法但不对），而数织的叉是玩家主动记下的"这格是白的"，不是错误。
 * 字形用 ✕（U+2715，两条斜线的交叉），而不是旗子 ⚑ —— 数织的叉表示"排除"，
 * 画成旗子会和扫雷的语义撞车（这里没有"有雷"的意思）。
 */
export const CROSS_GLYPH = '✕'

/** 壳层无障碍标签用的 key（apps/web 的 cellLabelKey 约定为 `<namespace>.cell.<kind>`） */
export const CELL_LABEL_KEYS: Partial<Record<CellKind, string>> = {
  mine: 'nonogram.cell.mine',
  flag: 'nonogram.cell.flag',
  empty: 'nonogram.cell.empty',
}

export function cellKindAt(state: NonogramState, index: number): CellKind {
  const mark = state.marks[index]
  if (mark === MARK_BLACK) return 'mine' // 壳层里"实心黑格"的 kind（mine 有黑底、白字）
  if (mark === MARK_CROSS) return 'flag' // 玩家标记：白底 + 字形
  return 'empty'
}

export function cellGlyph(state: NonogramState, index: number): string {
  return state.marks[index] === MARK_CROSS ? CROSS_GLYPH : ''
}

/**
 * 棋盘 + 两条线索带。
 *
 * `rowClues` / `colClues` 是 BoardView 上的**可选**字段（其余 16 款玩法不传、也就完全不渲染线索带），
 * 每个元素是"这一行/这一列的一组数字文本"。全白的行写成 `['0']`（见 levels.clueText）。
 */
export function buildBoard(state: NonogramState): BoardView {
  const puzzle = puzzleOf(state)
  const cells: CellView[] = []
  for (let index = 0; index < colsOf(puzzle) * rowsOf(puzzle); index++) {
    const kind = cellKindAt(state, index)
    cells.push({ index, kind, glyph: cellGlyph(state, index) })
  }
  return {
    kind: 'grid',
    cols: colsOf(puzzle),
    rows: rowsOf(puzzle),
    cells,
    rowClues: rowCluesOf(puzzle).map((clue) => clueText(clue)),
    colClues: colCluesOf(puzzle).map((clue) => clueText(clue)),
  }
}

/**
 * 统计栏。
 *
 * 三项恒定输出：检查结果出现/消失都不会让统计栏高度跳动
 * （`.eink-stats--fixed` 按固定列数排，行数不随数值宽度变化）。
 */
export function buildStats(state: NonogramState): StatView[] {
  const total = puzzlesFor(state.difficulty).length
  return [
    { labelKey: 'nonogram.stat.puzzle', value: `${state.puzzleIndex + 1}/${total}` },
    { labelKey: 'nonogram.stat.black', value: String(blackCount(state)) },
    // 没检查过（或检查之后又动过标记）显示破折号：不留旧数字，也不假装"没问题"
    { labelKey: 'nonogram.stat.wrong', value: state.wrongLines === null ? '—' : String(state.wrongLines) },
  ]
}

/**
 * 控制项：清屏 + 检查。
 *
 * 没有「撤销」：数织的每一步都是可逆的三态循环（再点两下就转回来了），
 * 而且状态里只存"题号 + 标记位"，没有动作日志 —— 与其做一个只能回退一步的假撤销，
 * 不如让玩家直接点回来（壳层那边把撤销按钮隐藏掉，见 apps/web/src/library.ts 的登记）。
 */
export function buildControls(state: NonogramState): ControlSpec[] {
  const playing = gameStatus(state) === 'playing'
  return [
    {
      id: 'clear',
      labelKey: 'nonogram.action.clear',
      role: 'action',
      // 已经是白纸时禁用（点了不会发生任何事，干脆不给点）
      enabled: playing && hasMarks(state),
      emphasis: 'normal',
    },
    {
      id: 'check',
      labelKey: 'nonogram.action.check',
      role: 'action',
      enabled: playing,
      emphasis: 'normal',
    },
  ]
}

export function buildView(state: NonogramState): GameView {
  const status = gameStatus(state)
  const details: Array<{ key: string; params?: Record<string, string | number> }> = []
  if (status === 'won') {
    // 带 params 的明细由壳层走 plural()，因此中英都要提供 __one / __other（见 i18n.ts）
    details.push({ key: 'nonogram.result.moves', params: { count: state.moves } })
    details.push({ key: 'nonogram.result.puzzle', params: { count: state.puzzleIndex + 1 } })
  }
  return {
    board: buildBoard(state),
    stats: buildStats(state),
    result: status === 'won' ? { titleKey: 'nonogram.result.title', details } : null,
    /*
     * 检查之后给一句稳定文字：数量在统计栏的「不符行数」里。
     *
     * 为什么数量不放这儿：GameView.notice 只有文案 key、**没有插值参数**（见 core 的契约），
     * 与其硬塞一个数字进 key，不如让统计栏专门放它 —— 那一项的标签就叫「不符行数」，
     * 检查前后从 — 变成 N，玩家一眼能看到。
     * 0 条不需要提示 —— 那说明已经过关，界面直接换成结果面板。
     * 动过标记之后 wrongLines 归 null，提示随之消失。
     */
    notice: state.wrongLines === null || state.wrongLines === 0 ? null : { textKey: 'nonogram.notice.check' },
  }
}
