/**
 * 迷宫的 GameDef 实现 —— 游戏盒子唯一需要认识的东西。
 *
 * 接入要点：
 * - 迷宫完全由 seed + 难度决定（core 的 createRng，递归回溯生成完美迷宫），
 *   绝不使用 Math.random，因此同 seed 双端必然同迷宫；
 * - 撞墙抛 IllegalActionError，壳层据此给出明确文字反馈；
 * - `selectAction` 把点格子映射成「朝那个方向走一格」（相邻且非墙才可点）；
 * - `decode` 用同 seed 复算迷宫逐格比对，并校验路径可重放、visited 与推导一致，坏数据一律拒绝。
 */
import type { GameDef } from '@eink/core'
import {
  DIFFICULTIES,
  DIFFICULTY_IDS,
  GAME_ID,
  difficultyOrThrow,
  type DifficultyId,
} from './board.js'
import {
  createState,
  decodeState,
  encodeState,
  gameStatus,
  legalActions,
  reduceMaze,
  selectAction,
  type MazeAction,
  type MazeState,
} from './rules.js'
import { buildControls, buildView } from './view.js'

// 壳层需要的公开面（文案 + 视图构件 + 规则），壳层不感知内部拆分
export { mazeEn, mazeZh } from './i18n.js'
// 棋盘模型：DIFFICULTIES 是「难度 → 尺寸」的配置表；难度清单见 DIFFICULTY_IDS
export {
  DIFFICULTIES,
  DIFFICULTY_IDS,
  DIRECTIONS,
  GAME_ID,
  canWalk,
  cellCount,
  colOf,
  configFor,
  createWalls,
  difficultyOrThrow,
  floorIndexes,
  goalIndex,
  indexOf,
  isDifficultyId,
  isMoveDir,
  isWall,
  moveDirBetween,
  normalizeSeed,
  orthogonalNeighbors,
  rowOf,
  startIndex,
  targetOf,
  type BoardConfig,
  type DifficultyId,
} from './board.js'
export {
  createState,
  decodeState,
  encodeState,
  gameStatus,
  legalActions,
  reduceMaze,
  selectAction,
  visitedFrom,
  type MazeAction,
  type MazeSnapshot,
  type MazeState,
} from './rules.js'
export {
  CELL_LABEL_KEYS,
  TRAIL_GLYPH,
  TRAIL_TEXT_SCALE,
  buildBoard,
  buildControls,
  buildStats,
  buildView,
  cellGlyphAt,
  cellKindAt,
  cellLabelKey,
} from './view.js'

export const MAZE_ID = GAME_ID
export const MAZE_RULES_VERSION = 1
export const MAZE_CONTENT_VERSION = 1

/** 三档难度只影响迷宫尺寸，规则完全相同 */
export const DIFFICULTY_SPECS = DIFFICULTY_IDS.map((id) => ({
  id,
  labelKey: `maze.difficulty.${id}`,
}))

export const MAZE_BOARD_SIZES: Record<DifficultyId, number> = {
  starter: DIFFICULTIES.starter.size,
  skilled: DIFFICULTIES.skilled.size,
  challenging: DIFFICULTIES.challenging.size,
}

export function createMazeState(seed: number, difficulty: DifficultyId): MazeState {
  return createState(seed, difficulty)
}

export const mazeGame: GameDef<MazeState, MazeAction> = {
  id: GAME_ID,
  rulesVersion: MAZE_RULES_VERSION,
  contentVersion: MAZE_CONTENT_VERSION,
  i18nNamespace: 'maze',
  illegalNoticeKey: 'maze.illegal.notice',
  difficulties: DIFFICULTY_SPECS,

  create(seed: number, difficultyId: string): MazeState {
    return createState(seed, difficultyOrThrow(difficultyId))
  },

  reduce(state: MazeState, action: MazeAction): MazeState {
    return reduceMaze(state, action)
  },

  legal(state: MazeState): readonly MazeAction[] {
    return legalActions(state)
  },

  selectAction(state: MazeState, index: number): MazeAction | null {
    return selectAction(state, index)
  },

  /**
   * 撤销/重开按钮的映射。壳层自己渲染这两个固定 id 的按钮并直接派发同名动作，
   * 这里再提供一次映射，是为了壳层改走 controlAction 时也不会失效。
   */
  controlAction(_state: MazeState, controlId: string): MazeAction | null {
    if (controlId === 'undo') return { type: 'undo' }
    if (controlId === 'restart') return { type: 'restart' }
    return null
  },

  /** 无关卡玩法：用难度作为内容 id，通关记录与「继续」定位都按难度归类 */
  contentId(state: MazeState): string {
    return state.difficulty
  },

  /** 计步：本玩法的「最佳成绩」= 最少步数，语义成立 */
  movesOf(state: MazeState): number {
    return state.moves
  },

  status(state: MazeState) {
    return gameStatus(state)
  },

  view(state: MazeState) {
    return buildView(state)
  },

  controls(state: MazeState) {
    return buildControls(state)
  },

  encode(state: MazeState): unknown {
    return encodeState(state)
  },

  decode(raw: unknown): MazeState {
    return decodeState(raw)
  },
}
