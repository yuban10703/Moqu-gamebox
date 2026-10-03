/**
 * 展示模型：把局面翻译成「与呈现技术无关」的棋盘与控制项描述。
 *
 * 1-bit 墨水屏约束（全部复用壳层已有的 kind，不新增契约）：
 * - 棋盘缺角（四个 2×2 角块）`kind:'wall'`：壳层容器的 45° 斜纹透出来，一眼看出不是孔位；
 * - 空孔 `kind:'empty'`：留白；
 * - 有棋子 `kind:'tile'` + `glyph:'●'` + `textScale 0.6`：实心圆；
 * - 被选中的棋子额外标 `selected: true`：壳层会加粗内描边（黑白屏靠线宽而不是颜色区分）。
 */
import type { BoardView, CellKind, CellView, ControlSpec, GameView, StatView } from '@eink/core'
import { BOARD_SIZE, countPegs, isHole } from './board.js'
import { gameStatus, type PegState } from './rules.js'

/** 棋子字形：实心圆（空孔留白，对比最强） */
export const PEG_GLYPH = '●'
export const PEG_TEXT_SCALE = 0.6

/** 壳层无障碍标签用的 key（apps/web 的约定为 `<namespace>.cell.<kind>`） */
export const CELL_LABEL_KEYS: Partial<Record<CellKind, string>> = {
  wall: 'pegsolitaire.cell.wall',
  empty: 'pegsolitaire.cell.empty',
  tile: 'pegsolitaire.cell.tile',
}

/** 注册表用：把 kind 映射到文案 key（壳层不硬编码玩法文案） */
export function cellLabelKey(kind: CellKind): string | undefined {
  return CELL_LABEL_KEYS[kind]
}

export function cellKindAt(state: PegState, index: number): CellKind {
  if (!isHole(index)) return 'wall'
  return state.pegs[index] ? 'tile' : 'empty'
}

export function cellGlyphAt(state: PegState, index: number): string {
  return cellKindAt(state, index) === 'tile' ? PEG_GLYPH : ''
}

export function buildBoard(state: PegState): BoardView {
  const cells: CellView[] = []
  for (let index = 0; index < BOARD_SIZE * BOARD_SIZE; index++) {
    const kind = cellKindAt(state, index)
    const cell: CellView = { index, kind, glyph: cellGlyphAt(state, index) }
    if (kind === 'tile') {
      cell.textScale = PEG_TEXT_SCALE
      // 选中态只置 true，不写 false：省得每个格子都多一个无意义字段
      if (state.selected === index) cell.selected = true
    }
    cells.push(cell)
  }
  // 刻意不设 groups：棋盘没有分组结构，多一层线只会更花
  return { kind: 'grid', cols: BOARD_SIZE, rows: BOARD_SIZE, cells }
}

/**
 * 控制项：只有撤销。
 * 棋盘点击是唯一的主要输入（selectAction 负责「选中 / 跳吃」两步交互），
 * 重开/菜单由壳层自己渲染（壳层认识这些固定 id），游戏不重复声明。
 */
export function buildControls(state: PegState): ControlSpec[] {
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

export function buildStats(state: PegState): StatView[] {
  const remaining = countPegs(state.pegs)
  return [
    { labelKey: 'pegsolitaire.stat.pegs', value: String(remaining) },
    { labelKey: 'pegsolitaire.stat.moves', value: String(state.moves) },
    // 每跳一次恰好少一枚棋子，所以「还需跳几次」= 剩余棋子 − 1，是精确值不是估计
    { labelKey: 'pegsolitaire.stat.remaining', value: String(remaining - 1) },
  ]
}

export function buildView(state: PegState): GameView {
  const status = gameStatus(state)
  const details: Array<{ key: string; params?: Record<string, string | number> }> = []
  if (status === 'won') {
    // 带 params 的明细由壳层走 plural()，因此这两个 key 必须提供复数形式
    details.push({ key: 'pegsolitaire.result.moves', params: { count: state.moves } })
    details.push({ key: 'pegsolitaire.result.pegs', params: { count: countPegs(state.pegs) } })
  }
  return {
    board: buildBoard(state),
    stats: buildStats(state),
    result: status === 'won' ? { titleKey: 'pegsolitaire.won.title', details } : null,
    // 没有需要壳层以稳定文字提示的状态：非法跳吃由壳层按 illegalNoticeKey 显示
    notice: null,
  }
}
