/**
 * 展示模型：把局面翻译成「与呈现技术无关」的棋盘/控制项描述。
 *
 * 墨水屏约束（1-bit 快刷）：数字方块只靠**数字本身**分辨，不用灰阶、不用动画；
 * 方块与空格的区分靠 kind（壳层画描边方块 vs 空白），不靠深浅。
 */
import type { BoardView, CellKind, CellView, ControlSpec, GameView, StatView } from '@eink/core'
import {
  ALL_DIRS,
  DIFFICULTY_IDS,
  applyMove,
  difficultyOf,
  statusOf,
  type Game2048State,
} from './rules.js'

/** 无障碍标签：只覆盖 2048 用到的 kind */
export const CELL_LABEL_KEYS: Partial<Record<CellKind, string>> = {
  empty: '2048.cell.empty',
  tile: '2048.cell.tile',
}

/** 注册表用：把 kind 映射到文案 key（壳层不硬编码玩法文案） */
export function cellLabelKey(kind: CellKind): string | undefined {
  return CELL_LABEL_KEYS[kind]
}

export function buildBoard(state: Game2048State): BoardView {
  const spec = difficultyOf(state.difficulty)
  const cells: CellView[] = state.board.map((value, index) =>
    value === 0
      ? { index, kind: 'empty' as const, glyph: '' }
      : { index, kind: 'tile' as const, glyph: String(value) },
  )
  return { kind: 'grid', cols: spec.size, rows: spec.size, cells }
}

export function buildStats(state: Game2048State): StatView[] {
  const spec = difficultyOf(state.difficulty)
  // 只放三项：竖屏墨水瓶统计栏能排成一行；最大方块本来就在棋盘上，不重复占位
  return [
    { labelKey: '2048.stat.score', value: String(state.score) },
    { labelKey: '2048.stat.moves', value: String(state.moves) },
    { labelKey: '2048.stat.target', value: String(spec.target) },
  ]
}

export function buildControls(state: Game2048State): ControlSpec[] {
  const spec = difficultyOf(state.difficulty)
  const controls: ControlSpec[] = ALL_DIRS.map((dir) => {
    const moved = applyMove(state.board, spec.size, dir).moved
    return {
      id: `move-${dir}`,
      labelKey: `2048.dir.${dir}`,
      role: 'dpad' as const,
      dir,
      // 方向盘始终可点：走不通时由会话给出明确文字提示，而不是静默无响应
      enabled: true,
      emphasis: 'normal' as const,
      tone: moved ? ('normal' as const) : ('muted' as const),
    }
  })
  controls.push({
    id: 'undo',
    labelKey: 'shell.game.undo',
    role: 'action',
    enabled: state.history.length > 0,
    emphasis: 'normal',
  })
  return controls
}

export function buildView(state: Game2048State): GameView {
  const status = statusOf(state)
  const details: Array<{ key: string; params?: Record<string, string | number> }> = []
  if (status !== 'playing') {
    // 壳层对带 params 的 detail 走 plural()，因此这两个 key 必须提供 __other
    details.push({ key: '2048.result.score', params: { count: state.score } })
    details.push({ key: '2048.result.moves', params: { count: state.moves } })
  }
  const result =
    status === 'won'
      ? { titleKey: '2048.won.title', details }
      : status === 'lost'
        ? { titleKey: '2048.lost.title', details }
        : null
  return {
    board: buildBoard(state),
    stats: buildStats(state),
    result,
    // 非法方向由会话用 illegalNoticeKey 统一提示，这里不自己造 notice
    notice: null,
  }
}

/** 注册表用：内容 id = 难度 id（2048 没有关卡概念） */
export function contentIdOf(state: Game2048State): string {
  return state.difficulty
}

/** 注册表用：进度按「已达成目标（赢过）的难度档」计数 */
export function progressFor(completed: readonly string[]): { done: number; total: number } {
  return {
    done: DIFFICULTY_IDS.filter((id) => completed.includes(id)).length,
    total: DIFFICULTY_IDS.length,
  }
}
