/**
 * 跳棋的 GameDef 实现 —— 游戏盒子唯一需要认识的东西。
 *
 * 接入要点：
 * - 玩家只派发 `select` / `move`：白方应手在**同一次 reduce 内**算完（见 rules 的 resolveOpponent），
 *   因此壳层不必驱动 AI，也不存在「等白方走棋」的中间态；
 * - 连跳由玩家继续点（state 里记 `pendingFrom`），壳层完全不需要感知；
 * - `undo` 撤销**一整回合**（玩家一步 + 白方应手，含连跳的全部步骤）：靠动作日志截断到回合起点再重放；
 * - 非法着法抛 IllegalActionError，壳层据此给出明确文字反馈；
 * - `decode` 从 `(seed, difficulty, log)` 重放并逐字段比对，坏数据一律拒绝。
 */
import type { GameDef } from '@eink/core'
import {
  BOARD_SIZE,
  CELLS,
  DIFFICULTY_IDS,
  GAME_ID,
  PIECES_PER_SIDE,
  difficultyOrThrow,
  type DifficultyId,
} from './board.js'
import {
  createState,
  decodeState,
  encodeState,
  gameStatus,
  legalActions,
  reduceCheckers,
  selectAction,
  type CheckersAction,
  type CheckersState,
} from './rules.js'
import { buildControls, buildView } from './view.js'

// 壳层需要的公开面（文案 + 视图构件 + 规则），壳层不感知内部拆分
export { checkersEn, checkersZh } from './i18n.js'
// 棋盘模型：起始局面固定，难度只影响白方强度
export {
  BLACK,
  BLACK_KING,
  BLACK_MAN,
  BOARD_SIZE,
  CELLS,
  DIFFICULTY_IDS,
  EMPTY,
  GAME_ID,
  KING_VALUE,
  MAN_VALUE,
  PIECES_PER_SIDE,
  PLAYABLE_INDEXES,
  WHITE,
  WHITE_KING,
  WHITE_MAN,
  applyMove,
  applyTurn,
  assertBoardShape,
  captureMovesFor,
  captureMovesFrom,
  colOf,
  countPieces,
  difficultyOrThrow,
  enumerateTurns,
  forwardDir,
  indexOf,
  initialBoard,
  isDifficultyId,
  isKing,
  isMan,
  isPlayable,
  legalMovesFor,
  normalizeSeed,
  onBoard,
  otherSide,
  pieceValue,
  promoteAt,
  promotedPiece,
  quietMovesFor,
  quietMovesFrom,
  rowOf,
  sideOf,
  turnCapturedValue,
  type DifficultyId,
  type Move,
  type Piece,
  type PieceCounts,
  type Side,
  type Turn,
} from './board.js'
export {
  BRANCH_LIMIT,
  ENUM_LIMIT,
  LOOKAHEAD_DEPTH,
  ROOT_LIMIT,
  chooseOpponentTurn,
  chooseTurn,
  evaluateBoard,
  maxCapturedValue,
  orderTurns,
} from './ai.js'
export {
  DRAW_PLIES,
  createState,
  decodeState,
  deriveState,
  deriveWithMeta,
  encodeState,
  gameStatus,
  legalActions,
  outcomeOf,
  reduceCheckers,
  selectAction,
  type CheckersAction,
  type CheckersState,
  type Step,
} from './rules.js'
export {
  CELL_LABEL_KEYS,
  PIECE_GLYPHS,
  PIECE_TEXT_SCALE,
  buildBoard,
  buildControls,
  buildStats,
  buildView,
  cellGlyphAt,
  cellKindAt,
  cellLabelKey,
} from './view.js'

export const CHECKERS_ID = GAME_ID
export const CHECKERS_RULES_VERSION = 1
export const CHECKERS_CONTENT_VERSION = 1

/** 三档难度只影响白方强度，规则完全相同 */
export const DIFFICULTY_SPECS = DIFFICULTY_IDS.map((id) => ({
  id,
  labelKey: `checkers.difficulty.${id}`,
}))

export function createCheckersState(seed: number, difficulty: DifficultyId): CheckersState {
  return createState(seed, difficulty)
}

export const checkersGame: GameDef<CheckersState, CheckersAction> = {
  id: GAME_ID,
  rulesVersion: CHECKERS_RULES_VERSION,
  contentVersion: CHECKERS_CONTENT_VERSION,
  i18nNamespace: 'checkers',
  illegalNoticeKey: 'checkers.illegal.notice',
  difficulties: DIFFICULTY_SPECS,

  create(seed: number, difficultyId: string): CheckersState {
    return createState(seed, difficultyOrThrow(difficultyId))
  },

  reduce(state: CheckersState, action: CheckersAction): CheckersState {
    return reduceCheckers(state, action)
  },

  legal(state: CheckersState): readonly CheckersAction[] {
    return legalActions(state)
  },

  selectAction(state: CheckersState, index: number): CheckersAction | null {
    return selectAction(state, index)
  },

  /**
   * 撤销/重开按钮的映射。壳层自己渲染这两个固定 id 的按钮并直接派发同名动作，
   * 这里再提供一次映射，是为了壳层改走 controlAction 时也不会失效。
   */
  controlAction(_state: CheckersState, controlId: string): CheckersAction | null {
    if (controlId === 'undo') return { type: 'undo' }
    if (controlId === 'restart') return { type: 'restart' }
    return null
  },

  /** 无关卡玩法：用难度作为内容 id，通关记录与「继续」定位都按难度归类 */
  contentId(state: CheckersState): string {
    return state.difficulty
  },

  /** 计步：最佳成绩用玩家的回合数（连跳算一步，白方应手不计） */
  movesOf(state: CheckersState): number {
    return state.moves
  },

  status(state: CheckersState) {
    return gameStatus(state)
  },

  view(state: CheckersState) {
    return buildView(state)
  },

  controls(state: CheckersState) {
    return buildControls(state)
  },

  encode(state: CheckersState): unknown {
    return encodeState(state)
  },

  decode(raw: unknown): CheckersState {
    return decodeState(raw)
  },
}

/** 棋盘常量（壳层/测试用，避免各处重复写字面量） */
export const CHECKERS_BOARD_SIZE = BOARD_SIZE
export const CHECKERS_CELLS = CELLS
export const CHECKERS_PIECES_PER_SIDE = PIECES_PER_SIDE
