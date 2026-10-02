/**
 * 展示模型：把局面翻译成「与呈现技术无关」的棋盘与控制项描述。
 * 状态之间的区别靠形状/符号（□ 箱子、◼ 箱在目标、○ 目标点、▲ 玩家），
 * 不依赖灰阶深浅，因此在 1-bit 黑白模式下也能分辨。
 */
import type { BoardView, CellKind, CellView, ControlSpec, GameView } from '@eink/core'
import { isGoal, isWall, ALL_DIRS, type ParsedLevel } from './level.js'
import { applyMove, derive, type Position, type SokobanState } from './rules.js'
import {
  isLastLevel,
  levelById,
  packProgress,
  PACK,
  type SokobanLevel,
} from './pack.js'

export const CELL_GLYPHS: Record<CellKind, string> = {
  floor: '',
  wall: '█',
  goal: '○',
  box: '□',
  boxOnGoal: '◼',
  player: '▲',
  playerOnGoal: '△',
}

export const CELL_LABEL_KEYS: Record<CellKind, string> = {
  floor: 'sokoban.cell.floor',
  wall: 'sokoban.cell.wall',
  goal: 'sokoban.cell.goal',
  box: 'sokoban.cell.box',
  boxOnGoal: 'sokoban.cell.boxOnGoal',
  player: 'sokoban.cell.player',
  playerOnGoal: 'sokoban.cell.playerOnGoal',
}

export function cellKindAt(level: ParsedLevel, position: Position, index: number): CellKind {
  if (isWall(level, index)) return 'wall'
  const hasBox = position.boxes.includes(index)
  const isPlayer = position.player === index
  const goal = isGoal(level, index)
  if (hasBox) return goal ? 'boxOnGoal' : 'box'
  if (isPlayer) return goal ? 'playerOnGoal' : 'player'
  return goal ? 'goal' : 'floor'
}

export function buildBoard(level: ParsedLevel, position: Position): BoardView {
  const cells: CellView[] = []
  for (let index = 0; index < level.cols * level.rows; index++) {
    const kind = cellKindAt(level, position, index)
    cells.push({ index, kind, glyph: CELL_GLYPHS[kind] })
  }
  return { kind: 'grid', cols: level.cols, rows: level.rows, cells }
}

export function buildControls(level: ParsedLevel, position: Position): ControlSpec[] {
  const open = new Set<string>()
  for (const dir of ALL_DIRS) {
    try {
      applyMove(level, position.player, position.boxes, dir)
      open.add(dir)
    } catch {
      // 走不通
    }
  }
  const controls: ControlSpec[] = ALL_DIRS.map((dir) => ({
    id: `move-${dir}`,
    labelKey: `sokoban.dir.${dir}`,
    role: 'dpad' as const,
    dir,
    enabled: true,
    emphasis: 'normal' as const,
    tone: open.has(dir) ? ('normal' as const) : ('muted' as const),
  }))
  controls.push({
    id: 'undo',
    labelKey: 'shell.game.undo',
    role: 'action',
    enabled: position.canUndo,
    emphasis: 'normal',
  })
  controls.push({
    id: 'restart',
    labelKey: 'shell.game.restart',
    role: 'action',
    enabled: position.moves > 0 || position.undos > 0,
    emphasis: 'normal',
  })
  if (position.solved) {
    controls.push({
      id: 'next-level',
      labelKey: 'shell.result.next',
      role: 'action',
      enabled: !isLastLevel(level.id),
      emphasis: 'primary',
    })
  }
  return controls
}

export interface ViewExtras {
  /** 本关最佳步数（来自持久化进度，不属于规则状态） */
  bestMoves?: number | undefined
  /** 提示文字 key（例如方向走不通） */
  noticeKey?: string | undefined
  /** 关卡进度（已完成关卡 id 列表） */
  completed?: readonly string[] | undefined
}

export function buildView(level: SokobanLevel, state: SokobanState, extras: ViewExtras = {}): GameView {
  const position = derive(level.parsed, state.log)
  const stats = [
    { labelKey: 'sokoban.stat.moves', value: String(position.moves) },
    { labelKey: 'sokoban.stat.pushes', value: String(position.pushes) },
    {
      labelKey: 'shell.common.level',
      value: `${level.index}/${PACK.length}`,
    },
  ]
  const details: Array<{ key: string; params?: Record<string, string | number> }> = []
  if (position.solved) {
    details.push({ key: 'sokoban.solved.moves', params: { count: position.moves } })
    details.push({ key: 'sokoban.solved.pushes', params: { count: position.pushes } })
    if (position.undos > 0) {
      details.push({ key: 'sokoban.solved.undos', params: { count: position.undos } })
    }
    if (extras.bestMoves !== undefined) {
      details.push({ key: 'sokoban.solved.best', params: { count: extras.bestMoves } })
    }
    if (isLastLevel(level.def.id)) {
      details.push({ key: 'sokoban.solved.last' })
    }
  }
  return {
    board: buildBoard(level.parsed, position),
    stats,
    result: position.solved ? { titleKey: 'sokoban.solved.title', details } : null,
    notice: extras.noticeKey ? { textKey: extras.noticeKey } : null,
  }
}

/** 进度摘要（游戏库与详情页用） */
export function progressSummary(completed: readonly string[]): {
  done: number
  total: number
  byDifficulty: Array<{ difficulty: string; done: number; total: number }>
} {
  const totals = packProgress(completed)
  const byDifficulty = (['starter', 'skilled', 'challenging'] as const).map((difficulty) => {
    const list = PACK.filter((level) => level.def.difficulty === difficulty)
    return {
      difficulty,
      done: list.filter((level) => completed.includes(level.def.id)).length,
      total: list.length,
    }
  })
  return { ...totals, byDifficulty }
}

export function levelOrThrow(levelId: string): SokobanLevel {
  const level = levelById(levelId)
  if (!level) {
    throw new Error(`unknown level ${levelId}`)
  }
  return level
}
