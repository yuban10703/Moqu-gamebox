/**
 * 直棋（Nine Men's Morris）的 GameDef 实现 —— 游戏盒子唯一需要认识的东西。
 *
 * 接入要点：
 * - 盘面：7×7 网格里的 24 个点位（三个同心方框的角 + 边中点），连接线 32 条邻接边；
 * - 三阶段：落子期（各 9 子）→ 移动期（沿连线走一格）→ 飞子期（只剩 3 子时可飞任意空点）；
 * - 成三即吃子：`pendingRemove` 记「还要吃几个」，吃满才换手；
 * - 玩家只派发 place/move/remove/select：非法（占位已满、跨线移动、乱吃三连子…）抛 IllegalActionError；
 * - 白方应手在**同一次 reduce 内**算完（含成三吃子）；
 * - `undo` 撤回一整回合（落子/移动 + 成三吃子 + 白方应手），`restart` 回到空盘；
 * - `decode` 从 `(seed, difficulty, log)` 复算并逐字段比对，坏数据一律拒绝；
 * - 不变量（测试与 decode 都会验）：对每一方「在场 + 被吃 + 手上 = 9」。
 */
import type { GameDef } from '@eink/core'
import {
  DIFFICULTY_IDS,
  GAME_ID,
  difficultyOrThrow,
  type DifficultyId,
  type NinemensState,
} from './board.js'
import {
  createState,
  decodeState,
  encodeState,
  gameStatus,
  legalActions,
  reduceNinemens,
  selectAction,
  type NinemensAction,
} from './rules.js'
import { buildControls, buildView } from './view.js'

// 壳层需要的公开面（文案 + 视图构件 + 规则），壳层不感知内部拆分
export { ninemensEn, ninemensZh } from './i18n.js'
// 棋盘几何与纯局面转移
export {
  ADJACENCY_EDGES,
  ADJACENT,
  BLACK,
  BOARD_SIZE,
  DIFFICULTY_IDS,
  GAME_ID,
  GRID_CELLS,
  MILL_LINES,
  POINTS,
  POINTS_PER_RING,
  POINT_AT_GRID,
  POINT_COUNT,
  RADIAL_EDGES,
  RADIAL_LINES,
  RING_COUNT,
  RING_EDGES,
  STONES_PER_SIDE,
  WHITE,
  applyAction,
  areAdjacent,
  boardCount,
  colOf,
  createBoardState,
  degreeOf,
  difficultyOrThrow,
  emptyPoints,
  gridIndexOf,
  inRange,
  isDifficultyId,
  isInMill,
  isPointAtGrid,
  isTerminal,
  millsAt,
  normalizeSeed,
  otherPlayer,
  phaseOf,
  pointAtGrid,
  pointsOf,
  rawActions,
  removablePoints,
  rowOf,
  stonesLeft,
  stuckPlayer,
  type DifficultyId,
  type LoggedAction,
  type NinemensState,
  type Phase,
  type Player,
  type PointInfo,
} from './board.js'
// 白方策略
export {
  BRANCH_LIMIT,
  KEY_POINTS,
  NODE_BUDGET,
  SEARCH_DEPTH,
  bestImmediateMills,
  chooseAction,
  completeMills,
  evaluate,
  evaluatePosition,
  lineThreats,
  search,
} from './ai.js'
export {
  createState,
  decodeState,
  deriveState,
  deriveWithMeta,
  encodeState,
  gameStatus,
  isOver,
  legalActions,
  reduceNinemens,
  selectAction,
  type NinemensAction,
} from './rules.js'
export {
  BLACK_GLYPH,
  CELL_LABEL_KEYS,
  OPTION_GLYPH,
  OPTION_TEXT_SCALE,
  STONE_TEXT_SCALE,
  WHITE_GLYPH,
  buildBoard,
  buildControls,
  buildStats,
  buildView,
  cellGlyphAt,
  cellKindAt,
  cellLabelKey,
  highlightsOf,
  type Highlights,
} from './view.js'

export const NINEMENS_ID = GAME_ID
export const NINEMENS_RULES_VERSION = 1
export const NINEMENS_CONTENT_VERSION = 1

/** 三档难度只改白方 AI 强弱（规则与盘面完全相同） */
export const DIFFICULTY_SPECS = DIFFICULTY_IDS.map((id) => ({
  id,
  labelKey: `ninemens.difficulty.${id}`,
}))

export function createNinemensState(seed: number, difficulty: DifficultyId): NinemensState {
  return createState(seed, difficulty)
}

export const ninemensGame: GameDef<NinemensState, NinemensAction> = {
  id: GAME_ID,
  rulesVersion: NINEMENS_RULES_VERSION,
  contentVersion: NINEMENS_CONTENT_VERSION,
  i18nNamespace: 'ninemens',
  illegalNoticeKey: 'ninemens.illegal.notice',
  difficulties: DIFFICULTY_SPECS,

  create(seed: number, difficultyId: string): NinemensState {
    return createState(seed, difficultyOrThrow(difficultyId))
  },

  reduce(state: NinemensState, action: NinemensAction): NinemensState {
    return reduceNinemens(state, action)
  },

  legal(state: NinemensState): readonly NinemensAction[] {
    return legalActions(state)
  },

  selectAction(state: NinemensState, index: number): NinemensAction | null {
    return selectAction(state, index)
  },

  /**
   * 撤销/重开按钮的映射。壳层自己渲染这两个固定 id 的按钮并直接派发同名动作，
   * 这里再提供一次映射，是为了壳层改走 controlAction 时也不会失效。
   */
  controlAction(_state: NinemensState, controlId: string): NinemensAction | null {
    if (controlId === 'undo') return { type: 'undo' }
    if (controlId === 'restart') return { type: 'restart' }
    return null
  },

  /** 无关卡玩法：用难度作为内容 id，通关记录与「继续」定位都按难度归类 */
  contentId(state: NinemensState): string {
    return state.difficulty
  },

  /** 计步：最佳成绩用玩家动作数（place/move/remove；select 不算） */
  movesOf(state: NinemensState): number {
    return state.moves
  },

  status(state: NinemensState) {
    return gameStatus(state)
  },

  view(state: NinemensState) {
    return buildView(state)
  },

  controls(state: NinemensState) {
    return buildControls(state)
  },

  encode(state: NinemensState): unknown {
    return encodeState(state)
  },

  decode(raw: unknown): NinemensState {
    return decodeState(raw)
  },
}
