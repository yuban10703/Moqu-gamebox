/**
 * 点格棋的 GameDef 实现 —— 游戏盒子唯一需要认识的东西。
 *
 * 接入要点：
 * - 棋盘是 (2R+1)×(2R+1) 的格子网格：点=墙、方格、边=可画的格（详见 board.ts 的编码说明）；
 * - 玩家只派发 `claim`：非边格 / 已画过的边抛 IllegalActionError，壳层给出明确反馈；
 * - 画完占不到格就换手，占到格当前玩家**连走**；
 * - 白方应手在**同一次 reduce 内**算完（含连走），壳层不需要驱动 AI；
 * - `undo` 撤回一整回合（玩家的连走 + 白方应手），`restart` 回到空棋盘；
 * - `decode` 从 `(seed, difficulty, log)` 重放并逐字段比对，坏数据一律拒绝。
 */
import type { GameDef } from '@eink/core'
import {
  DIFFICULTY_IDS,
  GAME_ID,
  difficultyOrThrow,
  type DifficultyId,
  type DotsBoxesState,
} from './board.js'
import {
  createState,
  decodeState,
  encodeState,
  gameStatus,
  legalActions,
  reduceDotsBoxes,
  selectAction,
  type DotsBoxesAction,
} from './rules.js'
import { buildControls, buildView } from './view.js'

// 壳层需要的公开面（文案 + 视图构件 + 规则），壳层不感知内部拆分
export { dotsboxesEn, dotsboxesZh } from './i18n.js'
// 棋盘编码与几何：点/方格/边的判定、边的相邻方格、纯局面转移
export {
  BLACK,
  DIFFICULTIES,
  DIFFICULTY_IDS,
  GAME_ID,
  WHITE,
  applyClaim,
  boxIndexAt,
  boxIndexes,
  boxesCompletedBy,
  boxesOfEdge,
  colOf,
  configFor,
  countScores,
  difficultyOrThrow,
  edgeIndexes,
  edgesOfBox,
  emptyState,
  inRange,
  indexOf,
  isBoardFull,
  isBox,
  isDifficultyId,
  isDot,
  isEdge,
  isHorizontalEdge,
  normalizeSeed,
  openEdges,
  otherSide,
  remainingEdges,
  rowOf,
  threesAfterClaim,
  type BoardConfig,
  type DifficultyId,
  type DotsBoxesState,
  type Scores,
  type Side,
} from './board.js'
// 白方策略
export {
  AI_BRANCH_LIMIT,
  bestImmediateGain,
  chooseEdge,
  evaluatePosition,
  immediateGain,
} from './ai.js'
export {
  createState,
  decodeState,
  deriveState,
  deriveWithMeta,
  encodeState,
  gameStatus,
  legalActions,
  outcomeOf,
  reduceDotsBoxes,
  selectAction,
  type DotsBoxesAction,
} from './rules.js'
export {
  BOX_GLYPHS,
  BOX_TEXT_SCALE,
  CELL_LABEL_KEYS,
  EDGE_GLYPHS,
  EDGE_TEXT_SCALE,
  buildBoard,
  buildControls,
  buildStats,
  buildView,
  cellGlyphAt,
  cellKindAt,
  cellLabelKey,
} from './view.js'

export const DOTBOXES_ID = GAME_ID
export const DOTBOXES_RULES_VERSION = 1
export const DOTBOXES_CONTENT_VERSION = 1

/** 三档难度只改棋盘尺寸（3×3 / 4×4 / 5×5），规则完全相同 */
export const DIFFICULTY_SPECS = DIFFICULTY_IDS.map((id) => ({
  id,
  labelKey: `dotsboxes.difficulty.${id}`,
}))

export function createDotsBoxesState(seed: number, difficulty: DifficultyId): DotsBoxesState {
  return createState(seed, difficulty)
}

export const dotsboxesGame: GameDef<DotsBoxesState, DotsBoxesAction> = {
  id: GAME_ID,
  rulesVersion: DOTBOXES_RULES_VERSION,
  contentVersion: DOTBOXES_CONTENT_VERSION,
  i18nNamespace: 'dotsboxes',
  illegalNoticeKey: 'dotsboxes.illegal.notice',
  difficulties: DIFFICULTY_SPECS,

  create(seed: number, difficultyId: string): DotsBoxesState {
    return createState(seed, difficultyOrThrow(difficultyId))
  },

  reduce(state: DotsBoxesState, action: DotsBoxesAction): DotsBoxesState {
    return reduceDotsBoxes(state, action)
  },

  legal(state: DotsBoxesState): readonly DotsBoxesAction[] {
    return legalActions(state)
  },

  selectAction(state: DotsBoxesState, index: number): DotsBoxesAction | null {
    return selectAction(state, index)
  },

  /**
   * 撤销/重开按钮的映射。壳层自己渲染这两个固定 id 的按钮并直接派发同名动作，
   * 这里再提供一次映射，是为了壳层改走 controlAction 时也不会失效。
   */
  controlAction(_state: DotsBoxesState, controlId: string): DotsBoxesAction | null {
    if (controlId === 'undo') return { type: 'undo' }
    if (controlId === 'restart') return { type: 'restart' }
    return null
  },

  /** 无关卡玩法：用难度作为内容 id，通关记录与「继续」定位都按难度归类 */
  contentId(state: DotsBoxesState): string {
    return state.difficulty
  },

  /** 计步：最佳成绩用玩家画线数（白方应手不计） */
  movesOf(state: DotsBoxesState): number {
    return state.moves
  },

  status(state: DotsBoxesState) {
    return gameStatus(state)
  },

  view(state: DotsBoxesState) {
    return buildView(state)
  },

  controls(state: DotsBoxesState) {
    return buildControls(state)
  },

  encode(state: DotsBoxesState): unknown {
    return encodeState(state)
  },

  decode(raw: unknown): DotsBoxesState {
    return decodeState(raw)
  },
}
