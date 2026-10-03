/**
 * 展示模型：把局面翻译成「与呈现技术无关」的棋盘与控制项描述。
 *
 * 1-bit 墨水屏约束：
 * - 每一格都是 `tile`，格内只放**符号**（KIND_GLYPHS）；种类靠形状区分，不用颜色、不用灰阶；
 * - 选中态用 `selected: true`：壳层会**整格反白**（黑底白字），这是本项目统一的选中呈现，
 *   也是黑白屏上唯一稳定的高亮手段（见 packages/ui/src/styles.css 的 data-selected）；
 * - 没有任何动画/过渡：消除与补充都已在规则层算完，这里只描述最终盘面；
 * - 状态提示一律用稳定文字（notice），不用闪烁或进度条。
 */
import type { BoardView, CellKind, CellView, ControlSpec, GameView, StatView } from '@eink/core'
import { cellCount, configFor, glyphForKind } from './board.js'
import { gameStatus, remainingMoves, targetScoreOf, type Match3State } from './rules.js'

/** 符号文字相对格子边长的字号系数：比缺省 0.66 略大，实心符号在小格子上也更清楚 */
export const TILE_TEXT_SCALE = 0.7

/** 壳层无障碍标签用的 key（apps/web 的约定：`<namespace>.cell.<kind>`） */
export const CELL_LABEL_KEYS: Partial<Record<CellKind, string>> = {
  tile: 'match3.cell.tile',
}

/** 注册表用：把 kind 映射到文案 key（壳层不硬编码玩法文案） */
export function cellLabelKey(kind: CellKind): string | undefined {
  return CELL_LABEL_KEYS[kind]
}

/** 消消乐没有别的格子语义：稳定局面里每一格都有棋子 */
export function cellKindAt(_state: Match3State, _index: number): CellKind {
  return 'tile'
}

export function cellGlyphAt(state: Match3State, index: number): string {
  return glyphForKind(state.board[index] ?? -1)
}

export function buildBoard(state: Match3State): BoardView {
  const config = configFor(state.difficulty)
  const cells: CellView[] = []
  for (let index = 0; index < cellCount(config); index++) {
    const cell: CellView = {
      index,
      kind: 'tile',
      glyph: glyphForKind(state.board[index]!),
      textScale: TILE_TEXT_SCALE,
    }
    if (state.selected === index) cell.selected = true
    cells.push(cell)
  }
  return { kind: 'grid', cols: config.cols, rows: config.rows, cells }
}

/**
 * 控制项：只有「撤销」。
 * 重开/菜单由壳层自己渲染（壳层认识这些固定 id），游戏不要重复声明。
 * 只要有撤销记录就可点（终局后也允许回退一步重看/重试）。
 */
export function buildControls(state: Match3State): ControlSpec[] {
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

/** 两项正好占满窄屏统计栏：分数（含目标分）与剩余步数 */
export function buildStats(state: Match3State): StatView[] {
  return [
    { labelKey: 'match3.stat.score', value: `${state.score}/${targetScoreOf(state)}` },
    { labelKey: 'match3.stat.moves', value: String(remainingMoves(state)) },
  ]
}

/**
 * 状态条提示（稳定文字，不用动画）。
 * 优先级：刚发生自动重排 > 已选中一格。
 * 自动重排是玩家没要求却改变了整盘的事件，必须在状态条上说清楚。
 */
function noticeFor(state: Match3State): { textKey: string } | null {
  if (state.moves > 0 && state.lastShuffle === state.moves) {
    return { textKey: 'match3.notice.shuffled' }
  }
  if (state.selected !== null) return { textKey: 'match3.notice.pick' }
  return null
}

export function buildView(state: Match3State): GameView {
  const status = gameStatus(state)
  return {
    board: buildBoard(state),
    stats: buildStats(state),
    result:
      status === 'playing'
        ? null
        : {
            titleKey: status === 'won' ? 'match3.won.title' : 'match3.lost.title',
            details: [
              { key: 'match3.result.score', params: { count: state.score } },
              { key: 'match3.result.moves', params: { count: state.moves } },
            ],
          },
    notice: noticeFor(state),
  }
}
