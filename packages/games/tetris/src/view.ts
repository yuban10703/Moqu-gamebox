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
  type DifficultyTetris,
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
  /*
   * 消行定格那一拍（state.clearing）：当前块**已经并进棋盘**了，这里不能再按"当前块"画一遍
   * —— 否则刚落地的那一块会被画成「黑底白叉」的活动块，玩家会以为它还能动。
   */
  const clearing = state.clearing !== null
  if (!clearing) {
    for (const cell of pieceCells(state.piece)) {
      if (cell.row < 0 || cell.row >= spec.rows) continue
      if (cell.col < 0 || cell.col >= spec.cols) continue
      active.add(cellIndex(spec.cols, cell.row, cell.col))
    }
  }
  /*
   * 定格三拍（见 PendingClear.phase）：
   *   ① `flash` —— 要被消掉的这几行**整行变白**（黑格翻成白格），还没有字；
   *   ② `label` —— 白带**保持白**，上面出黑字（左「消行」右分数）；
   *   ③ 下一个 tick 才真正消掉：白带连字一起消失，上面的方块落下来。
   * 反色一直保持到出字那一拍：白底黑字才读得清（反色收回成黑带就成了白字，
   * 那是上一版的样子，用户要的是"第一拍白色、第二拍黑字"）。
   */
  const flashing = new Set<number>()
  if (state.clearing) {
    for (const row of state.clearing.rows) {
      for (let col = 0; col < spec.cols; col++) flashing.add(cellIndex(spec.cols, row, col))
    }
  }
  const band = state.clearing?.phase === 'label' ? clearBandCells(state, spec) : new Map<number, BandText>()
  const cells: CellView[] = state.board.map((value, index) => {
    const text = band.get(index)
    if (text) {
      return {
        index,
        kind: 'mine' as const,
        // 文案类文字此刻还没有最终值（要走字典）：壳层翻译后填进来，见 CellView.glyphKey
        glyph: text.glyph ?? '',
        // 白带上出黑字：flash 让这一格是白底黑字，banner 让文字压过相邻格（不被盖掉）
        flash: true,
        banner: true,
        ...(text.glyphKey ? { glyphKey: text.glyphKey } : {}),
      }
    }
    if (flashing.has(index)) return { index, kind: 'mine' as const, glyph: '', flash: true }
    if (active.has(index)) return { index, kind: 'boxOnGoal' as const, glyph: '' }
    return value === 0
      ? { index, kind: 'empty' as const, glyph: '' }
      : { index, kind: 'mine' as const, glyph: '' }
  })
  return { kind: 'grid', cols: spec.cols, rows: spec.rows, cells }
}

/** 定格那一拍写在黑带上的字（左「消行」、右分数） */
interface BandText {
  /** 文案 key（「消行」中英不同，必须走字典）；壳层翻译后才进 glyph */
  glyphKey?: string
  /** 数字/符号类文字（分数是语言无关的，直接用字面量） */
  glyph?: string
}

/**
 * 消行定格那一拍的黑带文字：**左边「消行」、右边这一下拿到的分**。
 *
 * 为什么写在格子里而不是做覆盖层：契约里刻意没有绝对定位覆盖层
 * （历史上真机错位过一次，见 core/types.ts 里 BoardView 的注释）；格子文字是现成机制，
 * 而满行整行都是黑格、格线也是黑的 —— 相邻格子的文字连起来天然就是一条黑带上的白字。
 * 文字允许溢出到相邻黑格（styles.css 的 .eink-board__text 是 nowrap），
 * 所以一个格子就能承载一个完整的词，不需要按字拆开（拆开就没法翻译了）。
 *
 * 多行同时消掉时只在**黑带中间那一行**写字：每行都写会变成四条重复的标语。
 */
function clearBandCells(state: TetrisState, spec: DifficultyTetris): Map<number, BandText> {
  const out = new Map<number, BandText>()
  const pending = state.clearing
  if (!pending || pending.rows.length === 0) return out
  const row = pending.rows[Math.floor((pending.rows.length - 1) / 2)]!
  // 左：文案（走 i18n key，源码里不写中文 —— tools/scripts/check-i18n.mjs 会拦）；
  // 右：分数（数字与加号，语言无关，直接用 glyph）
  // 第 2 列而不是第 1 列：文案居中在这格上，要给自己留出半宽的余量（中英长度差一倍）
  out.set(cellIndex(spec.cols, row, 2), { glyphKey: 'tetris.fx.clear' })
  out.set(cellIndex(spec.cols, row, Math.max(3, spec.cols - 3)), { glyph: `+${pending.points}` })
  return out
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
