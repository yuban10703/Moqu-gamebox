/**
 * 展示模型：把局面翻译成「与呈现技术无关」的棋盘与控制项描述。
 *
 * 1-bit 墨水屏约束（开关两态天然适合黑白屏）：
 * - 亮灯 `kind:'tile'` + `glyph:'●'` + `textScale 0.62`：实心圆，一眼可辨；
 * - 灭灯 `kind:'empty'` + 空字形：留白，与实心圆形成最强对比；
 * - 不设 `BoardView.groups`：5×5 / 6×6 没有宫结构，多一层线只会更花；
 * - 不用灰阶、不加动画：翻转后的状态靠字形有无区分。
 */
import type { BoardView, CellKind, CellView, ControlSpec, GameView, StatView } from '@eink/core'
import { cellCount, configFor, litCount } from './board.js'
import { gameStatus, type LightsOutState } from './rules.js'

/** 亮灯字形：实心圆（灭灯留白，黑白屏上对比最强） */
export const LIT_GLYPH = '●'
export const LIT_TEXT_SCALE = 0.62

/** 壳层无障碍标签用的 key（apps/web 的约定为 `<namespace>.cell.<kind>`） */
export const CELL_LABEL_KEYS: Partial<Record<CellKind, string>> = {
  tile: 'lightsout.cell.tile',
  empty: 'lightsout.cell.empty',
}

/** 注册表用：把 kind 映射到文案 key（壳层不硬编码玩法文案） */
export function cellLabelKey(kind: CellKind): string | undefined {
  return CELL_LABEL_KEYS[kind]
}

export function cellKindAt(state: LightsOutState, index: number): CellKind {
  return state.lights[index] ? 'tile' : 'empty'
}

export function cellGlyphAt(state: LightsOutState, index: number): string {
  return state.lights[index] ? LIT_GLYPH : ''
}

export function buildBoard(state: LightsOutState): BoardView {
  const size = configFor(state.difficulty).size
  const cells: CellView[] = []
  for (let index = 0; index < state.lights.length; index++) {
    const lit = state.lights[index] === true
    const cell: CellView = {
      index,
      kind: lit ? 'tile' : 'empty',
      glyph: lit ? LIT_GLYPH : '',
    }
    // 只有亮灯声明字号；灭灯保持默认
    if (lit) cell.textScale = LIT_TEXT_SCALE
    cells.push(cell)
  }
  // 刻意不设 groups：关灯游戏的棋盘没有分组结构
  return { kind: 'grid', cols: size, rows: size, cells }
}

/**
 * 控制项：只有撤销。
 * 棋盘点击本身就是唯一的主要输入（selectAction 把点格子映射成 toggle），
 * 重开/菜单由壳层自己渲染（壳层认识这些固定 id），游戏不重复声明。
 */
export function buildControls(state: LightsOutState): ControlSpec[] {
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

export function buildStats(state: LightsOutState): StatView[] {
  const total = cellCount(configFor(state.difficulty))
  const off = total - litCount(state.lights)
  return [
    { labelKey: 'lightsout.stat.moves', value: String(state.moves) },
    // 「已熄灭 n」与「灯总数 N」分开两项：壳层对 labelKey 只做 t() 不传参，值自己拼
    { labelKey: 'lightsout.stat.off', value: String(off) },
    { labelKey: 'lightsout.stat.total', value: String(total) },
  ]
}

export function buildView(state: LightsOutState): GameView {
  const status = gameStatus(state)
  const total = cellCount(configFor(state.difficulty))
  const details: Array<{ key: string; params?: Record<string, string | number> }> = []
  if (status === 'won') {
    // 带 params 的明细由壳层走 plural()，因此这两个 key 必须提供复数形式
    details.push({ key: 'lightsout.result.moves', params: { count: state.moves } })
    details.push({ key: 'lightsout.result.lights', params: { count: total } })
  }
  return {
    board: buildBoard(state),
    stats: buildStats(state),
    result: status === 'won' ? { titleKey: 'lightsout.won.title', details } : null,
    // 没有需要壳层以稳定文字提示的状态：非法翻转由壳层按 illegalNoticeKey 显示
    notice: null,
  }
}
