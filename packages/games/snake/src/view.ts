/**
 * 展示模型：把局面翻译成「与呈现技术无关」的棋盘与控件描述。
 *
 * 1-bit 可读性（没有灰阶、没有动画，只能靠形状与反白）：
 *   蛇头 = 整格反白（kind 'mine'，壳层画成黑底）
 *   蛇身 = 占满格子的空心板条箱（kind 'box'，白底 + 外框 + 对角线）
 *   蛇尾 = 格子里一个实心小方块（kind 'tile' + '■'，用户要求：尾巴也要有自己的形状）
 *   食物 = 空心圆环（kind 'goal'）
 *   障碍 = 斜纹底（kind 'wall'，壳层用纹理而不是灰度）
 *   空格 = 纯白（kind 'empty'）
 *   撞死后的蛇头 = 白底 + 加粗「×」（kind 'flag'），与活着的黑格蛇头一眼可分
 * 这六种形状两两不同，且都不依赖深浅，因此单色墨水屏上也分得清。
 */
import type { BoardView, CellKind, CellView, ControlSpec, GameView, StatView } from '@eink/core'
import { ALL_DIRS, OPPOSITE_DIR, canUndo, directionOf, gameStatus, type SnakeState } from './rules.js'
import { DIFFICULTIES, DIFFICULTY_IDS, difficultySpec } from './meta.js'

/** 用到的 kind 的固定字形（蛇头/食物的字形由 buildBoard 计算） */
export const CELL_GLYPHS: Partial<Record<CellKind, string>> = {
  wall: '',
  empty: '',
  box: '',
  mine: '',
  goal: '',
  flag: '×',
  // 蛇尾：实心小方块（比整格反白的蛇头小一档，见 TAIL_SCALE）
  tile: '■',
}

/**
 * 壳层无障碍标签用的 key。约定固定为 `<namespace>.cell.<kind>`，
 * 因此注册表里直接写 `(kind) => `snake.cell.${kind}`` 即可，不需要额外映射表。
 * 本作借用的通用 kind：mine = 蛇头（整格反白）、box = 蛇身、tile = 蛇尾（实心小方块）、
 * goal = 食物、flag = 撞死后的蛇头，因此这几条标签说的是本作语义而不是 kind 的字面意思。
 */
export const CELL_LABEL_KEYS: Partial<Record<CellKind, string>> = {
  wall: 'snake.cell.wall',
  empty: 'snake.cell.empty',
  mine: 'snake.cell.mine',
  box: 'snake.cell.box',
  goal: 'snake.cell.goal',
  flag: 'snake.cell.flag',
  tile: 'snake.cell.tile',
}

/**
 * 蛇尾方块相对格子的字号比例。
 *
 * 0.8：比整格反白的蛇头弱一档，也不与占满格子的蛇身板条箱混淆 ——
 * 三者在一格里的观感是「满格黑 / 满格框 / 中间一个小方块」，1-bit 下层次清楚。
 */
const TAIL_SCALE = 0.8

/** 逐格判定：障碍 → 蛇头 → **蛇尾** → 蛇身 → 食物 → 空格（顺序即优先级，互不重叠） */
export function cellKindAt(state: SnakeState, index: number): CellKind {
  if (state.obstacles.includes(index)) return 'wall'
  if (index === state.body[0]) return state.dead ? 'flag' : 'mine'
  // 尾巴单独一种形状（用户要求）：初始长度 3，所以尾巴与蛇头不会重合
  if (state.body.length > 1 && index === state.body[state.body.length - 1]) return 'tile'
  if (state.body.includes(index)) return 'box'
  if (index === state.food) return 'goal'
  return 'empty'
}

export function cellGlyphAt(state: SnakeState, index: number): string {
  return CELL_GLYPHS[cellKindAt(state, index)] ?? ''
}

export function buildBoard(state: SnakeState): BoardView {
  const spec = difficultySpec(state.difficulty)
  const cells: CellView[] = []
  for (let index = 0; index < spec.size * spec.size; index++) {
    const kind = cellKindAt(state, index)
    cells.push({
      index,
      kind,
      glyph: CELL_GLYPHS[kind] ?? '',
      ...(kind === 'tile' ? { textScale: TAIL_SCALE } : {}),
    })
  }
  return { kind: 'grid', cols: spec.size, rows: spec.size, cells }
}

export function buildStats(state: SnakeState): StatView[] {
  // 只放三项：竖屏墨水瓶统计栏能排成一行
  return [
    { labelKey: 'snake.stat.score', value: String(state.score) },
    { labelKey: 'snake.stat.length', value: String(state.body.length) },
    { labelKey: 'snake.stat.moves', value: String(state.moves) },
  ]
}

export function buildControls(state: SnakeState): ControlSpec[] {
  const playing = gameStatus(state) === 'playing'
  // 只有「原地掉头」这一个方向会被拒绝：把它画成 muted，玩家点之前就能看出来
  const blocked = playing ? OPPOSITE_DIR[directionOf(state)] : null
  const controls: ControlSpec[] = ALL_DIRS.map((dir) => ({
    id: `move-${dir}`,
    labelKey: `snake.dir.${dir}`,
    role: 'dpad' as const,
    dir,
    // 方向盘始终可点：走不通时由会话给出明确文字提示，而不是静默无响应
    enabled: true,
    emphasis: 'normal' as const,
    tone: dir === blocked ? ('muted' as const) : ('normal' as const),
  }))
  controls.push({
    id: 'undo',
    labelKey: 'shell.game.undo',
    role: 'action',
    /*
     * 有**玩家操作**可撤销才可点 —— 包括撞死之后：撞上的那一步正是玩家最想撤回的，
     * 壳层的结果面板据此给出「撤销」按钮，把局面退回撞上之前。
     * 自动前进（tick）不算玩家操作：只有它还亮着的话，撤销只会退掉「玩家没做过的事」。
     */
    enabled: canUndo(state),
    emphasis: 'normal',
  })
  controls.push({
    id: 'restart',
    labelKey: 'shell.game.restart',
    role: 'action',
    enabled: state.moves > 0 || state.history.length > 0,
    emphasis: 'normal',
  })
  return controls
}

export function buildView(state: SnakeState): GameView {
  const status = gameStatus(state)
  const details: Array<{ key: string; params?: Record<string, string | number> }> = []
  if (status !== 'playing') {
    details.push({ key: 'snake.result.score', params: { count: state.score } })
    details.push({ key: 'snake.result.length', params: { count: state.body.length } })
    details.push({ key: 'snake.result.moves', params: { count: state.moves } })
  }
  const result =
    status === 'won'
      ? { titleKey: 'snake.won.title', details }
      : status === 'lost'
        ? { titleKey: 'snake.lost.title', details }
        : null
  return {
    board: buildBoard(state),
    stats: buildStats(state),
    result,
    /*
     * 玩法自己**不再产生**任何提示文字。
     *
     * 上一版这里会给"已缓冲的转向"亮一行「下一格向上」——因为那时转向要等下一个 tick
     * 才改变棋盘，中间几百毫秒没有任何反馈、看起来像吞输入。现在按下方向键**当帧就走一格**，
     * 棋盘本身就是反馈，多一行文字只会是噪音。
     * 唯一还需要文字的场合是"这一步走不通"（原地掉头 / 本局已结束）：那是壳层按
     * illegalNoticeKey 统一提示的，不经过这里。
     */
    notice: null,
  }
}

/** 注册表用：内容 id = 难度 id（本作没有关卡概念） */
export function contentIdOf(state: SnakeState): string {
  return state.difficulty
}

/** 注册表用：进度按「有过完成记录的难度档」计数 */
export function progressFor(completed: readonly string[]): { done: number; total: number } {
  return {
    done: DIFFICULTY_IDS.filter((id) => completed.includes(id)).length,
    total: DIFFICULTIES.length,
  }
}
