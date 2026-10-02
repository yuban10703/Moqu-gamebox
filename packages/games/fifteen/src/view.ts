/**
 * 展示模型：把局面翻译成「与呈现技术无关」的棋盘与控制项描述。
 *
 * 1-bit 墨水屏约束：
 * - 数字块用 kind: 'tile' + 数字字形，字号系数 0.62（比默认略小，给粗边框留出空间）；
 * - 空白格用 kind: 'empty' + 空字形（壳层画成空格），不靠灰阶区分；
 * - 3×3/4×4/5×5 没有宫结构，不加分组线（`BoardView.groups` 保持 undefined）；
 * - 走不通的方向用 `tone: 'muted'` 呈现，但方向盘**始终可点**，由壳层按 illegalNoticeKey 给文字反馈。
 */
import type { BoardView, CellKind, CellView, ControlSpec, GameView, StatView } from '@eink/core'
import {
  DIRECTIONS,
  canSlide,
  configFor,
  placedCount,
  tileCount,
  type DifficultyId,
} from './board.js'
import { gameStatus, type FifteenState } from './rules.js'

/** 空白格不显示任何符号：靠「没有数字」本身表达空位 */
export const EMPTY_GLYPH = ''
/** 数字块字号系数：比默认 0.66 略小，两位数也放得下 */
export const TILE_TEXT_SCALE = 0.62

/** 壳层无障碍标签用的 key（apps/web 的约定为 `<namespace>.cell.<kind>`） */
export const CELL_LABEL_KEYS: Partial<Record<CellKind, string>> = {
  tile: 'fifteen.cell.tile',
  empty: 'fifteen.cell.empty',
}

/** 注册表用：把 kind 映射到文案 key（壳层不硬编码玩法文案） */
export function cellLabelKey(kind: CellKind): string | undefined {
  return CELL_LABEL_KEYS[kind]
}

export function cellKindAt(state: FifteenState, index: number): CellKind {
  return state.board[index] === 0 ? 'empty' : 'tile'
}

export function cellGlyphAt(state: FifteenState, index: number): string {
  const value = state.board[index]!
  return value === 0 ? EMPTY_GLYPH : String(value)
}

export function buildBoard(state: FifteenState): BoardView {
  const size = configFor(state.difficulty).size
  const cells: CellView[] = []
  for (let index = 0; index < state.board.length; index++) {
    const kind = cellKindAt(state, index)
    const cell: CellView = { index, kind, glyph: cellGlyphAt(state, index) }
    // 只有数字块声明字号；空白格保持默认
    if (kind === 'tile') cell.textScale = TILE_TEXT_SCALE
    cells.push(cell)
  }
  // 刻意不设 groups：滑块拼图没有宫结构，多一层粗线只会让画面更花
  return { kind: 'grid', cols: size, rows: size, cells }
}

/**
 * 控制项：四个方向盘方向 + 撤销。
 * 重开/菜单由壳层自己渲染（壳层认识这些固定 id），游戏不重复声明；
 * 撤销声明 id 为 `undo`，壳层拿它的 `enabled` 决定按钮是否可点。
 */
export function buildControls(state: FifteenState): ControlSpec[] {
  const size = configFor(state.difficulty).size
  const canUndo = state.history.length > 0
  const controls: ControlSpec[] = DIRECTIONS.map((dir) => {
    // 走不通的方向用 muted 呈现，但仍然可点（壳层按 illegalNoticeKey 给文字反馈）
    const movable = canSlide(state.board, size, dir)
    return {
      id: `move-${dir}`,
      labelKey: `fifteen.dir.${dir}`,
      role: 'dpad' as const,
      dir,
      // 方向盘按钮始终可点：走不通时给明确文字反馈，而不是静默无响应
      enabled: true,
      emphasis: 'normal' as const,
      tone: movable ? ('normal' as const) : ('muted' as const),
    }
  })
  controls.push({
    id: 'undo',
    labelKey: 'shell.game.undo',
    role: 'action',
    enabled: canUndo,
    emphasis: 'normal',
  })
  return controls
}

export function buildStats(state: FifteenState): StatView[] {
  const config = configFor(state.difficulty)
  return [
    { labelKey: 'fifteen.stat.moves', value: String(state.moves) },
    // 「已归位 n/总数」自己拼好：壳层对 labelKey 只做 t() 不传参
    {
      labelKey: 'fifteen.stat.placed',
      value: `${placedCount(state.board, config.size)}/${tileCount(config)}`,
    },
  ]
}

export function buildView(state: FifteenState): GameView {
  const status = gameStatus(state)
  const config = configFor(state.difficulty)
  const details: Array<{ key: string; params?: Record<string, string | number> }> = []
  if (status === 'won') {
    // 带 params 的明细由壳层走 plural()，因此这两个 key 必须提供复数形式
    details.push({ key: 'fifteen.result.moves', params: { count: state.moves } })
    details.push({
      key: 'fifteen.result.tiles',
      params: { count: placedCount(state.board, config.size) },
    })
  }
  return {
    board: buildBoard(state),
    stats: buildStats(state),
    result: status === 'won' ? { titleKey: 'fifteen.won.title', details } : null,
    // 没有需要壳层以稳定文字提示的状态：非法滑动由壳层按 illegalNoticeKey 显示
    notice: null,
  }
}

/** 难度 → 视图尺寸（壳层/测试用，避免各处重复查表） */
export function boardSizeOf(difficulty: DifficultyId): number {
  return configFor(difficulty).size
}
