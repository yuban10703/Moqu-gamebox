/**
 * 推箱子规则层：纯函数、无副作用、无平台依赖。
 *
 * 状态 = (难度, 当前关卡, 动作日志)。局面由 `derive` 从日志重放得出，
 * 因此「撤销」「重开」也建模为动作，存档只需保存日志即可完整还原（含撤销历史）。
 * 日志里出现非法动作时 `derive` 直接抛错 —— 损坏或非法的存档会被上层明确拒绝，
 * 而不是静默地算出一个奇怪的局面。
 */
import { IllegalActionError } from '@eink/core'
import {
  ALL_DIRS,
  dirDelta,
  isGoal,
  isWall,
  type DifficultyId,
  type MoveDir,
  type ParsedLevel,
} from './level.js'

export type SokobanAction =
  | { type: 'move'; dir: MoveDir }
  | { type: 'undo' }
  | { type: 'restart' }
  | { type: 'nextLevel' }
  /** 自由选关：直接跳到指定关卡（详情页点关卡用） */
  | { type: 'startLevel'; levelId: string }

export interface SokobanState {
  difficulty: DifficultyId
  levelId: string
  log: SokobanAction[]
}

export interface Position {
  player: number
  boxes: readonly number[]
  /** 有效移动次数（被墙/箱子挡住的输入不会进入日志） */
  moves: number
  pushes: number
  undos: number
  restarts: number
  solved: boolean
  canUndo: boolean
}

const GAME_ID = 'sokoban'

interface Snapshot {
  player: number
  boxes: number[]
  moves: number
  pushes: number
}

export function derive(level: ParsedLevel, log: readonly SokobanAction[]): Position {
  let player = level.startPlayer
  let boxes = [...level.startBoxes]
  const stack: Snapshot[] = []
  let moves = 0
  let pushes = 0
  let undos = 0
  let restarts = 0

  for (const action of log) {
    switch (action.type) {
      case 'move': {
        const applied = applyMove(level, player, boxes, action.dir)
        stack.push({ player, boxes, moves, pushes })
        player = applied.player
        boxes = applied.boxes
        moves++
        if (applied.pushed) pushes++
        break
      }
      case 'undo': {
        const previous = stack.pop()
        if (!previous) throw new IllegalActionError(GAME_ID, 'nothing to undo')
        // 撤销要把计数一并回退，否则「步数」会显示成含已撤销动作的总次数
        player = previous.player
        boxes = previous.boxes
        moves = previous.moves
        pushes = previous.pushes
        undos++
        break
      }
      case 'restart': {
        // 重开 = 本关重新尝试：步数/推箱次数归零，但撤销与重开次数作为本局统计继续累计
        player = level.startPlayer
        boxes = [...level.startBoxes]
        stack.length = 0
        moves = 0
        pushes = 0
        restarts++
        break
      }
      case 'nextLevel': {
        throw new IllegalActionError(GAME_ID, 'nextLevel must be handled by the session, not replayed')
      }
    }
  }

  return {
    player,
    boxes,
    moves,
    pushes,
    undos,
    restarts,
    solved: boxes.every((cell) => isGoal(level, cell)),
    canUndo: stack.length > 0,
  }
}

interface AppliedMove {
  player: number
  boxes: number[]
  pushed: boolean
}

export function applyMove(
  level: ParsedLevel,
  player: number,
  boxes: readonly number[],
  dir: MoveDir,
): AppliedMove {
  const delta = dirDelta(dir, level.cols)
  const target = player + delta
  if (isWall(level, target)) throw new IllegalActionError(GAME_ID, `wall blocks ${dir}`)
  const boxAt = boxes.indexOf(target)
  if (boxAt < 0) {
    return { player: target, boxes: [...boxes], pushed: false }
  }
  const beyond = target + delta
  if (isWall(level, beyond)) throw new IllegalActionError(GAME_ID, `box blocked by wall (${dir})`)
  if (boxes.includes(beyond)) throw new IllegalActionError(GAME_ID, `box blocked by box (${dir})`)
  const next = [...boxes]
  next[boxAt] = beyond
  next.sort((a, b) => a - b)
  return { player: target, boxes: next, pushed: true }
}

/** 当前局面下允许的动作（用于禁用按钮与日志校验） */
export function legal(level: ParsedLevel, position: Position): SokobanAction[] {
  const out: SokobanAction[] = []
  for (const dir of ALL_DIRS) {
    try {
      applyMove(level, position.player, position.boxes, dir)
      out.push({ type: 'move', dir })
    } catch {
      // 该方向不可走/不可推，不作为可选动作
    }
  }
  if (position.canUndo) out.push({ type: 'undo' })
  if (position.moves > 0 || position.undos > 0 || position.restarts > 0) out.push({ type: 'restart' })
  if (position.solved) out.push({ type: 'nextLevel' })
  return out
}

export function isLegal(level: ParsedLevel, position: Position, action: SokobanAction): boolean {
  if (action.type === 'move') {
    try {
      applyMove(level, position.player, position.boxes, action.dir)
      return true
    } catch {
      return false
    }
  }
  if (action.type === 'undo') return position.canUndo
  if (action.type === 'restart') return true
  return position.solved
}

/**
 * 针对指定关卡执行一次动作（不查关卡包，因此测试与工具可以直接传入自定义关卡）。
 * `nextLevelId` 为 null 表示没有下一关，此时 nextLevel 属于非法动作。
 */
export function reduceOnLevel(
  level: ParsedLevel,
  state: SokobanState,
  action: SokobanAction,
  nextLevelId: string | null,
): SokobanState {
  const position = derive(level, state.log)

  if (action.type === 'nextLevel') {
    if (!position.solved) throw new IllegalActionError(GAME_ID, 'level not solved')
    if (!nextLevelId) throw new IllegalActionError(GAME_ID, 'no next level')
    return { difficulty: state.difficulty, levelId: nextLevelId, log: [] }
  }

  if (!isLegal(level, position, action)) {
    throw new IllegalActionError(GAME_ID, `illegal ${action.type}`)
  }
  return { ...state, log: [...state.log, action] }
}
