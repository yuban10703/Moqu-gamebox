/**
 * 展示模型：把局面翻译成「与呈现技术无关」的棋盘与控件描述。
 *
 * kind 的用法（壳层已为这些 kind 备好 1-bit 样式：hidden 斜纹、mine 反白、flag 加粗符号）：
 *   hidden 未翻开 / flag 插旗 / number 已翻开且周围有雷 / empty 已翻开且周围无雷 / mine 输局后亮出的雷
 * 状态区分靠符号与底纹，不用灰阶。
 */
import type { BoardView, CellKind, CellView, ControlSpec, GameView, StatView } from '@eink/core'
import { cellCount, configFor, type BoardConfig } from './difficulty.js'
import { adjacentMineCount } from './generate.js'
import {
  gameStatus,
  remainingMines,
  totalCells,
  type MinesweeperState,
} from './rules.js'

// 只覆盖扫雷用到的 kind（CellKind 还包含其它玩法的通用 kind）
export const CELL_GLYPHS: Partial<Record<CellKind, string>> = {
  hidden: '',
  flag: '⚑',
  mine: '✳',
  empty: '',
  // number 的 glyph 是数字本身，由 cellGlyphAt 计算
  number: '',
}

/** 壳层无障碍标签用的 key（apps/web 的 cellLabelKey 约定为 `<namespace>.cell.<kind>`） */
export const CELL_LABEL_KEYS: Partial<Record<CellKind, string>> = {
  hidden: 'minesweeper.cell.hidden',
  flag: 'minesweeper.cell.flag',
  mine: 'minesweeper.cell.mine',
  empty: 'minesweeper.cell.empty',
  number: 'minesweeper.cell.number',
}

interface RenderContext {
  config: BoardConfig
  lost: boolean
  mineSet: ReadonlySet<number>
  revealed: ReadonlySet<number>
  flags: ReadonlySet<number>
}

function contextOf(state: MinesweeperState): RenderContext {
  return {
    config: configFor(state.difficulty),
    lost: gameStatus(state) === 'lost',
    mineSet: new Set(state.mines),
    revealed: new Set(state.revealed),
    flags: new Set(state.flags),
  }
}

function kindOf(context: RenderContext, index: number): CellKind {
  // 输局后把所有雷亮出来（包括已插旗的和没插旗的），让玩家一眼看清
  if (context.lost && context.mineSet.has(index)) return 'mine'
  if (context.revealed.has(index)) {
    return adjacentMineCount(context.mineSet, context.config, index) > 0 ? 'number' : 'empty'
  }
  return context.flags.has(index) ? 'flag' : 'hidden'
}

function glyphOf(context: RenderContext, index: number, kind: CellKind): string {
  if (kind === 'number') return String(adjacentMineCount(context.mineSet, context.config, index))
  return CELL_GLYPHS[kind] ?? ''
}

export function cellKindAt(state: MinesweeperState, index: number): CellKind {
  return kindOf(contextOf(state), index)
}

export function cellGlyphAt(state: MinesweeperState, index: number): string {
  const context = contextOf(state)
  const kind = kindOf(context, index)
  return glyphOf(context, index, kind)
}

export function buildBoard(state: MinesweeperState): BoardView {
  const context = contextOf(state)
  const cells: CellView[] = []
  for (let index = 0; index < cellCount(context.config); index++) {
    const kind = kindOf(context, index)
    cells.push({ index, kind, glyph: glyphOf(context, index, kind) })
  }
  return { kind: 'grid', cols: context.config.cols, rows: context.config.rows, cells }
}

export function buildControls(state: MinesweeperState): ControlSpec[] {
  const playing = gameStatus(state) === 'playing'
  return [
    {
      id: 'flag-mode',
      // 开关用两个 key 表达当前状态，避免出现 ⟦key⟧ 或猜谜式图标
      labelKey: state.flagMode
        ? 'minesweeper.control.flagMode.on'
        : 'minesweeper.control.flagMode.off',
      role: 'action',
      enabled: playing,
      emphasis: state.flagMode ? 'primary' : 'normal',
    },
    {
      id: 'restart',
      labelKey: 'shell.game.restart',
      role: 'action',
      enabled: true,
      emphasis: 'normal',
    },
  ]
}

export function buildView(state: MinesweeperState): GameView {
  const config = configFor(state.difficulty)
  const status = gameStatus(state)
  const stats: StatView[] = [
    // 剩余雷数 = 总雷数 − 旗数
    { labelKey: 'minesweeper.stat.mines', value: String(remainingMines(state)) },
    // 已翻开/总数
    { labelKey: 'minesweeper.stat.progress', value: `${state.revealed.length}/${totalCells(state)}` },
  ]
  const details: Array<{ key: string; params?: Record<string, string | number> }> = []
  if (status === 'won') {
    details.push({ key: 'minesweeper.result.revealed', params: { count: state.revealed.length } })
    details.push({ key: 'minesweeper.result.flags', params: { count: state.flags.length } })
  } else if (status === 'lost') {
    details.push({ key: 'minesweeper.result.mines', params: { count: config.mineCount } })
    details.push({ key: 'minesweeper.result.revealed', params: { count: state.revealed.length } })
  }
  return {
    board: buildBoard(state),
    stats,
    result:
      status === 'playing'
        ? null
        : {
            titleKey: status === 'won' ? 'minesweeper.won.title' : 'minesweeper.lost.title',
            details,
          },
    notice: null,
  }
}
