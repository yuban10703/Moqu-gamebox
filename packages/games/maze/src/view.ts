/**
 * 展示模型：把局面翻译成「与呈现技术无关」的棋盘与控制项描述。
 *
 * 1-bit 墨水屏约束（全部复用壳层已有的 kind，不新增契约）：
 * - 墙 `kind:'wall'`：壳层在棋盘容器上画的 45° 斜纹会透出来；
 * - 通路 `kind:'floor'`：空白，与斜纹形成黑白对比；
 * - 玩家 `kind:'player'`：人形剪影；出口 `kind:'goal'`：圆环；
 * - 走过的格子用 `kind:'floor'` + `glyph:'·'` + `textScale 0.5` 标出（纯字形，不用灰阶）。
 *
 * 注意：当前壳层只为 TEXT_KINDS（tile/given/number/flag/mine）渲染 glyph，
 * `floor` 上的轨迹点要等壳层把 `floor` 纳入可渲染文字的种类后才会显现 —— 规则层的
 * `visited` 已经备好，这一条只影响呈现，见报告。
 */
import type { BoardView, CellKind, CellView, ControlSpec, GameView, StatView } from '@eink/core'
import {
  DIRECTIONS,
  canWalk,
  configFor,
  floorIndexes,
  goalIndex,
  isWall,
} from './board.js'
import { gameStatus, type MazeState } from './rules.js'

/** 轨迹点：走过的通路格用小点标出，字号减半以免和结构抢注意力 */
export const TRAIL_GLYPH = '·'
export const TRAIL_TEXT_SCALE = 0.5

/** 壳层无障碍标签用的 key（apps/web 的约定为 `<namespace>.cell.<kind>`） */
export const CELL_LABEL_KEYS: Partial<Record<CellKind, string>> = {
  wall: 'maze.cell.wall',
  floor: 'maze.cell.floor',
  player: 'maze.cell.player',
  goal: 'maze.cell.goal',
}

/** 注册表用：把 kind 映射到文案 key（壳层不硬编码玩法文案） */
export function cellLabelKey(kind: CellKind): string | undefined {
  return CELL_LABEL_KEYS[kind]
}

/**
 * 格子语义优先级：玩家 > 墙 > 出口 > 通路。
 * 玩家站在出口时显示玩家（否则人形会被圆环盖掉，看不出自己在哪）；出口本身用 kind 表达。
 */
export function cellKindAt(state: MazeState, index: number): CellKind {
  if (index === state.player) return 'player'
  if (isWall(state.walls, index)) return 'wall'
  if (index === goalIndex(configFor(state.difficulty))) return 'goal'
  return 'floor'
}

export function cellGlyphAt(state: MazeState, index: number): string {
  const kind = cellKindAt(state, index)
  // 只有「走过的通路」带字形：墙/玩家/出口都靠壳层的图形表达
  if (kind !== 'floor') return ''
  return state.visited.includes(index) ? TRAIL_GLYPH : ''
}

export function buildBoard(state: MazeState): BoardView {
  const size = configFor(state.difficulty).size
  const visited = new Set(state.visited)
  const cells: CellView[] = []
  for (let index = 0; index < state.walls.length; index++) {
    const kind = cellKindAt(state, index)
    const glyph = kind === 'floor' && visited.has(index) ? TRAIL_GLYPH : ''
    const cell: CellView = { index, kind, glyph }
    // 轨迹点比结构元素小一号：黑白屏上没有颜色可用，字号差是唯一的层次手段
    if (glyph !== '') cell.textScale = TRAIL_TEXT_SCALE
    cells.push(cell)
  }
  // 刻意不设 groups：迷宫没有宫结构，多一层粗线只会让结构更花
  return { kind: 'grid', cols: size, rows: size, cells }
}

/**
 * 控制项：四个方向盘方向 + 撤销。
 * 重开/菜单由壳层自己渲染（壳层认识这些固定 id），游戏不重复声明；
 * 撤销声明 id 为 `undo`，壳层拿它的 `enabled` 决定按钮是否可点。
 */
export function buildControls(state: MazeState): ControlSpec[] {
  const size = configFor(state.difficulty).size
  const controls: ControlSpec[] = DIRECTIONS.map((dir) => {
    const open = canWalk(state.walls, size, state.player, dir)
    return {
      id: `move-${dir}`,
      labelKey: `maze.dir.${dir}`,
      role: 'dpad' as const,
      dir,
      // 方向盘按钮始终可点：撞墙时由壳层给明确文字反馈，而不是静默无响应
      enabled: true,
      emphasis: 'normal' as const,
      tone: open ? ('normal' as const) : ('muted' as const),
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

export function buildStats(state: MazeState): StatView[] {
  const total = floorIndexes(state.walls).length
  return [
    { labelKey: 'maze.stat.moves', value: String(state.moves) },
    // 「已探索 n/总数」自己拼好：壳层对 labelKey 只做 t() 不传参
    { labelKey: 'maze.stat.explored', value: `${state.visited.length}/${total}` },
  ]
}

export function buildView(state: MazeState): GameView {
  const status = gameStatus(state)
  const details: Array<{ key: string; params?: Record<string, string | number> }> = []
  if (status === 'won') {
    // 带 params 的明细由壳层走 plural()，因此这两个 key 必须提供复数形式
    details.push({ key: 'maze.result.moves', params: { count: state.moves } })
    details.push({ key: 'maze.result.explored', params: { count: state.visited.length } })
  }
  return {
    board: buildBoard(state),
    stats: buildStats(state),
    result: status === 'won' ? { titleKey: 'maze.won.title', details } : null,
    // 没有需要壳层以稳定文字提示的状态：非法移动由壳层按 illegalNoticeKey 显示
    notice: null,
  }
}
