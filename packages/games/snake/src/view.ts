/**
 * 展示模型：把局面翻译成「与呈现技术无关」的棋盘与控件描述。
 *
 * 1-bit 可读性（没有灰阶、没有动画，只能靠形状与反白）：
 *   蛇头 = 黑色子弹形剪影 + 两只白眼睛，**朝向前进方向**（kind 'head' + facing）
 *   蛇身 = 与头尾同宽的黑色实心管，每节朝前后两节伸出、拐弯外角是圆的（kind 'segment' + links）
 *   蛇尾 = 黑色收尖的楔形，**尖端指向远离身体的方向**（kind 'tail' + facing）
 *   食物 = 空心圆环（kind 'goal'）
 *   障碍 = 斜纹底（kind 'wall'，壳层用纹理而不是灰度）
 *   空格 = 纯白（kind 'empty'）
 *   撞死后的蛇头 = 白底 + 加粗「×」（kind 'flag'），与活着的黑格蛇头一眼可分
 * 这六种形状两两不同，且都不依赖深浅，因此单色墨水屏上也分得清。
 *
 * 头与尾原先是「整格涂黑」与「格中一个 ■」、身体是推箱子的空心板条箱：看不出朝向，也不像蛇
 * （用户要求改得美观、身体风格统一）。现在头 / 身 / 尾是同一根宽 18/24 的黑管：
 * 头的平直后端、尾的宽底、身体伸向相邻节的那一段在格边对齐，整条蛇连成一根。
 */
import type { BoardView, CellKind, CellView, ControlSpec, GameView, StatView } from '@eink/core'
import type { MoveDir } from '@eink/core'
import {
  ALL_DIRS,
  OPPOSITE_DIR,
  canUndo,
  directionBetween,
  directionOf,
  gameStatus,
  type SnakeState,
} from './rules.js'
import { DIFFICULTIES, DIFFICULTY_IDS, difficultySpec } from './meta.js'

/** 用到的 kind 的固定字形（头 / 尾 / 身体 / 食物都由壳层画图形，不用文字） */
export const CELL_GLYPHS: Partial<Record<CellKind, string>> = {
  wall: '',
  empty: '',
  segment: '',
  head: '',
  tail: '',
  goal: '',
  flag: '×',
}

/**
 * 壳层无障碍标签用的 key。约定固定为 `<namespace>.cell.<kind>`，
 * 因此注册表里直接写 `(kind) => `snake.cell.${kind}`` 即可，不需要额外映射表。
 * 本作借用的通用 kind：goal = 食物、flag = 撞死后的蛇头，
 * 因此这两条标签说的是本作语义而不是 kind 的字面意思（head / segment / tail 则正好同义）。
 */
export const CELL_LABEL_KEYS: Partial<Record<CellKind, string>> = {
  wall: 'snake.cell.wall',
  empty: 'snake.cell.empty',
  head: 'snake.cell.head',
  tail: 'snake.cell.tail',
  segment: 'snake.cell.segment',
  goal: 'snake.cell.goal',
  flag: 'snake.cell.flag',
}

/** 逐格判定：障碍 → 蛇头 → **蛇尾** → 蛇身 → 食物 → 空格（顺序即优先级，互不重叠） */
export function cellKindAt(state: SnakeState, index: number): CellKind {
  if (state.obstacles.includes(index)) return 'wall'
  if (index === state.body[0]) return state.dead ? 'flag' : 'head'
  // 尾巴单独一种形状（用户要求）：初始长度 3，所以尾巴与蛇头不会重合
  if (state.body.length > 1 && index === state.body[state.body.length - 1]) return 'tail'
  if (state.body.includes(index)) return 'segment'
  if (index === state.food) return 'goal'
  return 'empty'
}

export function cellGlyphAt(state: SnakeState, index: number): string {
  return CELL_GLYPHS[cellKindAt(state, index)] ?? ''
}

/**
 * 头 / 尾的朝向：头 = 前进方向（脖子 → 头）；尾 = 远离身体的方向（倒数第二节 → 尾）。
 * 入门档可穿墙，directionBetween 已按环绕计算，跨边的那一节同样朝向正确。
 */
export function facingAt(state: SnakeState, kind: CellKind): MoveDir | undefined {
  if (state.body.length < 2) return undefined
  if (kind === 'head') return directionOf(state)
  if (kind === 'tail') {
    const size = difficultySpec(state.difficulty).size
    return directionBetween(size, state.body[state.body.length - 2]!, state.body[state.body.length - 1]!)
  }
  return undefined
}

/**
 * 身体第 position 节（不含头尾）连向哪两个方向：朝前一节、朝后一节。
 * 同样按环绕计算 —— 入门档穿墙的那一节会伸向棋盘边缘，在另一侧接上。
 */
export function linksAt(state: SnakeState, position: number): MoveDir[] {
  const size = difficultySpec(state.difficulty).size
  const cell = state.body[position]!
  return [
    directionBetween(size, cell, state.body[position - 1]!),
    directionBetween(size, cell, state.body[position + 1]!),
  ]
}

export function buildBoard(state: SnakeState): BoardView {
  const spec = difficultySpec(state.difficulty)
  const positionOf = new Map(state.body.map((cell, position) => [cell, position]))
  const cells: CellView[] = []
  for (let index = 0; index < spec.size * spec.size; index++) {
    const kind = cellKindAt(state, index)
    const facing = facingAt(state, kind)
    const links = kind === 'segment' ? linksAt(state, positionOf.get(index)!) : undefined
    cells.push({
      index,
      kind,
      glyph: CELL_GLYPHS[kind] ?? '',
      ...(facing ? { facing } : {}),
      ...(links ? { links } : {}),
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
