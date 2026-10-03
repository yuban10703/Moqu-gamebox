/**
 * 展示模型：把局面翻译成「与呈现技术无关」的棋盘与控制项描述。
 *
 * 1-bit 墨水屏约束（全部复用壳层已有的 kind）：
 * - 未访问格 `kind:'floor'` + 空字形；
 * - 已访问格 `kind:'floor'` + `glyph:'·'` + `textScale 0.5`（与迷宫同一手法：走过的路留痕）；
 * - 马所在格 `kind:'player'`；
 * - 合法的下一跳 `kind:'number'` + `glyph:'·'` + `textScale 0.45`（看清有哪些选择）；
 *   开启提示时，推荐落点改用 `★`（`textScale 0.5`）—— 形状不同，黑白屏上一眼可辨；
 * - 起始格 `kind:'goal'`（壳层画圆环），方便玩家回顾出发点。
 *
 * 棋盘字形（`·`、`★`）都是纯符号，不是界面文案，因此无需走 i18n。
 */
import type { BoardView, CellKind, CellView, ControlSpec, GameView, StatView } from '@eink/core'
import {
  BOARD_SIZE,
  CELLS,
  colOf,
  difficultySpec,
  rowOf,
  warnsdorffNext,
} from './board.js'
import { gameStatus, legalTargets, type KnightState } from './rules.js'

/** 走过的路：小点（棋盘符号，不是界面文案） */
export const VISITED_GLYPH = '·' // i18n-exempt
export const VISITED_TEXT_SCALE = 0.5
/** 合法落点：更小的点，和「走过的路」区分开（同一字形、不同字号） */
export const OPTION_TEXT_SCALE = 0.45
/** 提示推荐的落点：五角星（棋盘符号，不是界面文案） */
export const HINT_GLYPH = '★' // i18n-exempt
export const HINT_TEXT_SCALE = 0.5

/** 壳层无障碍标签用的 key（apps/web 的约定为 `<namespace>.cell.<kind>`） */
export const CELL_LABEL_KEYS: Partial<Record<CellKind, string>> = {
  floor: 'knightstour.cell.floor',
  player: 'knightstour.cell.player',
  goal: 'knightstour.cell.goal',
  number: 'knightstour.cell.number',
}

/** 注册表用：把 kind 映射到文案 key（壳层不硬编码玩法文案） */
export function cellLabelKey(kind: CellKind): string | undefined {
  return CELL_LABEL_KEYS[kind]
}

interface RenderContext {
  readonly visited: ReadonlySet<number>
  readonly legal: ReadonlySet<number>
  readonly hint: number | null
}

function contextOf(state: KnightState): RenderContext {
  return {
    visited: new Set(state.visited),
    legal: new Set(legalTargets(state)),
    // 提示只在开启且对局进行中时给出一条确定的推荐落点
    hint: state.hintOn && gameStatus(state) === 'playing'
      ? warnsdorffNext(state.current, state.visited)
      : null,
  }
}

export function cellKindAt(state: KnightState, index: number): CellKind {
  const context = contextOf(state)
  if (index === state.current) return 'player'
  if (index === state.start) return 'goal'
  if (context.hint === index || context.legal.has(index)) return 'number'
  return 'floor'
}

export function cellGlyphAt(state: KnightState, index: number): string {
  const context = contextOf(state)
  if (index === state.current || index === state.start) return ''
  if (context.hint === index) return HINT_GLYPH
  if (context.legal.has(index)) return VISITED_GLYPH
  return context.visited.has(index) ? VISITED_GLYPH : ''
}

export function buildBoard(state: KnightState): BoardView {
  const context = contextOf(state)
  const cells: CellView[] = []
  for (let index = 0; index < CELLS; index++) {
    const cell: CellView = { index, kind: 'floor', glyph: '' }
    if (index === state.current) {
      cell.kind = 'player'
    } else if (index === state.start) {
      cell.kind = 'goal'
    } else if (context.hint === index) {
      cell.kind = 'number'
      cell.glyph = HINT_GLYPH
      cell.textScale = HINT_TEXT_SCALE
    } else if (context.legal.has(index)) {
      cell.kind = 'number'
      cell.glyph = VISITED_GLYPH
      cell.textScale = OPTION_TEXT_SCALE
    } else if (context.visited.has(index)) {
      cell.kind = 'floor'
      cell.glyph = VISITED_GLYPH
      cell.textScale = VISITED_TEXT_SCALE
    }
    cells.push(cell)
  }
  // 刻意不设 groups：8×8 棋盘没有分组结构
  return { kind: 'grid', cols: BOARD_SIZE, rows: BOARD_SIZE, cells }
}

/**
 * 控制项：撤销 +（入门难度）提示开关。
 * 棋盘点击是唯一的主要输入（selectAction 把点格子映射成马步），
 * 重开/菜单由壳层自己渲染（壳层认识这些固定 id），游戏不重复声明。
 */
export function buildControls(state: KnightState): ControlSpec[] {
  const playing = gameStatus(state) === 'playing'
  const controls: ControlSpec[] = [
    {
      id: 'undo',
      labelKey: 'shell.game.undo',
      role: 'action',
      enabled: state.log.length > 0,
      emphasis: 'normal',
    },
  ]
  if (difficultySpec(state.difficulty).hint) {
    controls.push({
      id: 'hint',
      // 开关用两个 key 表达当前状态，避免壳层出现 ⟦key⟧ 或猜谜式图标
      labelKey: state.hintOn ? 'knightstour.control.hint.on' : 'knightstour.control.hint.off',
      role: 'action',
      enabled: playing,
      emphasis: state.hintOn ? 'primary' : 'normal',
    })
  }
  return controls
}

export function buildStats(state: KnightState): StatView[] {
  // 三项恒定输出：内容出现/消失不会让统计栏高度跳动
  return [
    { labelKey: 'knightstour.stat.moves', value: String(state.moves) },
    { labelKey: 'knightstour.stat.visited', value: `${state.visited.length}/${CELLS}` },
    {
      labelKey: 'knightstour.stat.start',
      value: `${rowOf(state.start) + 1},${colOf(state.start) + 1}`,
    },
  ]
}

export function buildView(state: KnightState): GameView {
  const status = gameStatus(state)
  const details: Array<{ key: string; params?: Record<string, string | number> }> = []
  if (status === 'won') {
    // 带 params 的明细由壳层走 plural()，因此这两个 key 必须提供复数形式
    details.push({ key: 'knightstour.result.moves', params: { count: state.moves } })
    details.push({ key: 'knightstour.result.visited', params: { count: state.visited.length } })
  }
  return {
    board: buildBoard(state),
    stats: buildStats(state),
    result: status === 'won' ? { titleKey: 'knightstour.won.title', details } : null,
    // 提示开启时给一条稳定文字；非法落点由壳层按 illegalNoticeKey 显示
    notice: state.hintOn && status === 'playing' ? { textKey: 'knightstour.notice.hint' } : null,
  }
}
