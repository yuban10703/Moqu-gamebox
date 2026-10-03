/**
 * 展示模型：把局面翻译成「与呈现技术无关」的棋盘 / 统计 / 控制项描述。
 *
 * 墨水屏约束（1-bit 快刷）：
 * - 方块一律**实心黑格**，形状本身就是区别，不用灰阶、不用动画、不用颜色；
 * - 唯一需要额外区分的是「还听指挥的当前块」和「已经堆死的方块」—— 两者都是黑的，
 *   所以当前块借用壳层既有的「黑底 + 白色叉纹」格子（boxOnGoal），靠**纹理**而不是灰度区分；
 * - 控制项只有四个方向盘按钮 + 撤销；没有「自动下落开关」这类控件 ——
 *   自动下落是玩法本身的节奏（间隔由难度声明），不是玩家要按的按钮，随时可用顶栏「暂停」停表。
 *
 * 关于「下一块」：规则层用 `nextPieceId(state)` 把它作为纯函数暴露出来（测试与将来可能的预览
 * 都能用），但界面上**不展示**，这是量过之后的选择：
 *   - 统计栏在竖屏固定三列（分数/消行/等级），加第四项会挤成两行，吃掉约 36px 棋盘高度，
 *     18 行的井会从 22.8px 掉到 20.5px（低于 22px 的可读线）；
 *   - 塞进棋盘就得占掉井口旁的几列，玩家会分不清「哪里是井壁」—— 这是俄罗斯方块最不该含糊的事。
 * 自动下落的最慢一档 1050ms/格给了玩家看清当前块的时间，因此这一项信息的收益仍不值上述代价。
 */
import type { BoardView, CellKind, CellView, ControlSpec, GameView, StatView } from '@eink/core'
import {
  ALL_DIRS,
  canUndo,
  cellIndex,
  difficultyOf,
  isLegal,
  levelOf,
  pieceCells,
  statusOf,
  type TetrisState,
} from './rules.js'

/**
 * 格子语义：
 * - empty      空格（白底 + 格子线）
 * - mine       已固定的方块：壳层唯一的纯黑实心格子
 * - boxOnGoal  当前方块：黑底 + 白色叉纹
 * 只覆盖本玩法用到的 kind（CellKind 还包含其它玩法的通用 kind）。
 */
export const CELL_LABEL_KEYS: Partial<Record<CellKind, string>> = {
  empty: 'tetris.cell.empty',
  mine: 'tetris.cell.mine',
  boxOnGoal: 'tetris.cell.boxOnGoal',
}

/** 注册表用：把 kind 映射到文案 key（壳层不硬编码玩法文案） */
export function cellLabelKey(kind: CellKind): string | undefined {
  return CELL_LABEL_KEYS[kind]
}

export function buildBoard(state: TetrisState): BoardView {
  const spec = difficultyOf(state.difficulty)
  const active = new Set<number>()
  for (const cell of pieceCells(state.piece)) {
    if (cell.row < 0 || cell.row >= spec.rows) continue
    if (cell.col < 0 || cell.col >= spec.cols) continue
    active.add(cellIndex(spec.cols, cell.row, cell.col))
  }
  const cells: CellView[] = state.board.map((value, index) => {
    if (active.has(index)) return { index, kind: 'boxOnGoal' as const, glyph: '' }
    return value === 0
      ? { index, kind: 'empty' as const, glyph: '' }
      : { index, kind: 'mine' as const, glyph: '' }
  })
  return { kind: 'grid', cols: spec.cols, rows: spec.rows, cells }
}

/** 统计栏只放三项：竖屏 439×847 下固定三列刚好一行，多一项就会挤出第二行、把棋盘压小 */
export function buildStats(state: TetrisState): StatView[] {
  return [
    { labelKey: 'tetris.stat.score', value: String(state.score) },
    { labelKey: 'tetris.stat.lines', value: String(state.lines) },
    { labelKey: 'tetris.stat.level', value: String(levelOf(state.lines)) },
  ]
}

export function buildControls(state: TetrisState): ControlSpec[] {
  const controls: ControlSpec[] = ALL_DIRS.map((dir) => ({
    id: `move-${dir}`,
    labelKey: `tetris.dir.${dir}`,
    role: 'dpad' as const,
    dir,
    // 方向盘始终可点：走不通时由会话给出明确文字提示，而不是静默无响应
    enabled: true,
    emphasis: 'normal' as const,
    tone: isLegal(state, { type: 'move', dir }) ? ('normal' as const) : ('muted' as const),
  }))
  controls.push({
    id: 'undo',
    labelKey: 'shell.game.undo',
    role: 'action',
    // 壳层据此决定撤销按钮是否可点；输掉之后结果面板也靠它给出撤销入口
    enabled: canUndo(state),
    emphasis: 'normal',
  })
  return controls
}

export function buildView(state: TetrisState): GameView {
  const status = statusOf(state)
  // 本玩法没有胜利条件（status 只会是 playing / lost），因此结果页只有失败一种。
  // 不编造「消满 N 行算赢」的目标：编出来的目标会进完成度统计，玩家却无从判断它是否成立。
  const details =
    status === 'lost'
      ? [
          { key: 'tetris.result.score', params: { count: state.score } },
          { key: 'tetris.result.lines', params: { count: state.lines } },
          { key: 'tetris.result.pieces', params: { count: state.pieces } },
        ]
      : []
  return {
    board: buildBoard(state),
    stats: buildStats(state),
    result: status === 'lost' ? { titleKey: 'tetris.lost.title', details } : null,
    // 走不通由会话用 illegalNoticeKey 统一提示，这里不自己造 notice
    notice: null,
  }
}

/** 注册表用：无关卡玩法用难度作为内容 id */
export function contentIdOf(state: TetrisState): string {
  return state.difficulty
}
