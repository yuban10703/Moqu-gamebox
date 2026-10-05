/**
 * 国际象棋的 GameDef 实现 —— 游戏盒子唯一需要认识的东西。
 *
 * 接入要点（与象棋/五子棋同一套）：
 * - 黑方（对手）的应手由壳层定时派发的**两拍 tick** 完成（第一拍亮出选中的棋子、
 *   第二拍落子），玩家只派发 move/select/undo/restart；
 * - 全部随机性来自 `create(seed, difficulty)` 保存的 seed（seed + 随机游标），
 *   绝不使用 Math.random，因此同 seed + 同玩家动作序列双端必然同局面；
 * - 非法落子抛 IllegalActionError，壳层据此给出明确文字反馈；
 * - `decode` 用回合日志重放盘面并逐格比对，坏数据一律拒绝。
 */
import type { GameDef } from '@eink/core'
import {
  CHESS_CONTENT_VERSION,
  CHESS_ID,
  CHESS_RULES_VERSION,
  DIFFICULTY_IDS,
  difficultyLabelKey,
  difficultyOrThrow,
  type DifficultyId,
} from './meta.js'
import {
  createState,
  decodeState,
  encodeState,
  gameStatus,
  legalActions,
  outcomeOf,
  reduceChess,
  selectAction,
  type ChessAction,
  type ChessState,
} from './rules.js'
import { buildControls, buildView } from './view.js'

// 壳层需要的公开面（文案 + 视图构件 + 规则），壳层不感知内部拆分
export { chessEn, chessZh } from './i18n.js'
export {
  BLACK,
  BOARD_SIZE,
  BISHOP,
  CASTLE_ALL,
  CASTLE_BK,
  CASTLE_BQ,
  CASTLE_WK,
  CASTLE_WQ,
  CELLS,
  EMPTY,
  KING,
  KNIGHT,
  PAWN,
  QUEEN,
  ROOK,
  WHITE,
  applyMoveOn,
  colOf,
  createInitialBoard,
  indexOf,
  isSquareAttacked,
  kingIndexOf,
  legalMovesOn,
  makePiece,
  moveFrom,
  moveTo,
  onBoard,
  packMove,
  pieceLetter,
  pseudoMoves,
  rowOf,
  sideOf,
  typeOf,
  undoMoveOn,
  type MutablePosition,
  type Piece,
  type Side,
  type UndoInfo,
} from './board.js'
export { chooseOpponentMove, evaluate, type AiPosition } from './ai.js'
export {
  CHESS_CONTENT_VERSION,
  CHESS_ID,
  CHESS_RULES_VERSION,
  DIFFICULTY_IDS,
  difficultyLabelKey,
  difficultyOrThrow,
  isDifficultyId,
  type DifficultyId,
} from './meta.js'
export {
  createState,
  decodeState,
  encodeState,
  gameStatus,
  isInCheck,
  isInsufficientMaterial,
  legalActions,
  normalizeSeed,
  outcomeOf,
  positionHash,
  reduceChess,
  selectAction,
  toAiPosition,
  type ChessAction,
  type ChessState,
  type ChessTurn,
  type Outcome,
} from './rules.js'
export {
  CELL_LABEL_KEYS,
  PIECE_GLYPHS,
  buildBoard,
  buildControls,
  buildStats,
  buildView,
  capturedGlyphs,
  cellLabelKey,
  resultTitleKey,
} from './view.js'

/** 「玩家落子 → AI 亮目标格」的间隔（第一拍） */
const REPLY_DELAY_MS = 450
/** 「AI 已亮目标格 → 真正落子」的间隔（第二拍，用户指定 500ms） */
const PICK_TO_MOVE_MS = 500

/** 三档难度只影响黑方强度，规则完全相同 */
export const DIFFICULTIES = DIFFICULTY_IDS.map((id) => ({
  id,
  labelKey: difficultyLabelKey(id),
}))

/** 注册表用：国际象棋没有关卡，内容是「难度档」，用它给「继续」定位 */
export const CONTENT_IDS: readonly string[] = DIFFICULTY_IDS

/** 注册表用：进度按「已通关难度 / 3」算 */
export function progressFor(completed: readonly string[]): { done: number; total: number } {
  return {
    done: DIFFICULTY_IDS.filter((id) => completed.includes(id)).length,
    total: DIFFICULTY_IDS.length,
  }
}

export function createChessState(seed: number, difficulty: DifficultyId): ChessState {
  return createState(seed, difficulty)
}

export const chessGame: GameDef<ChessState, ChessAction> = {
  id: CHESS_ID,
  rulesVersion: CHESS_RULES_VERSION,
  contentVersion: CHESS_CONTENT_VERSION,
  i18nNamespace: CHESS_ID,
  illegalNoticeKey: 'chess.illegal.notice',
  difficulties: DIFFICULTIES,

  create(seed: number, difficultyId: string): ChessState {
    return createState(seed, difficultyOrThrow(difficultyId))
  },

  reduce(state: ChessState, action: ChessAction): ChessState {
    return reduceChess(state, action)
  },

  legal(state: ChessState): readonly ChessAction[] {
    return legalActions(state)
  },

  selectAction(state: ChessState, index: number): ChessAction | null {
    return selectAction(state, index)
  },

  /**
   * 除撤销外没有别的自定义按钮；重开由壳层直接派发，这里也接受一次以防壳层改走 controlAction。
   */
  controlAction(_state: ChessState, controlId: string): ChessAction | null {
    if (controlId === 'undo') return { type: 'undo' }
    if (controlId === 'restart') return { type: 'restart' }
    return null
  },

  /** 无关卡玩法：用难度作为内容 id，通关记录与「继续」定位都按难度归类 */
  contentId(state: ChessState): string {
    return state.difficulty
  },

  /** 计步：最佳成绩用玩家的落子数（黑方应手不算） */
  movesOf(state: ChessState): number {
    return state.moves
  },

  /**
   * 真实结果：`status()` 把和棋并入 `won`（否则壳层不认为对局结束、结果面板不出来），
   * 但和棋不是通关 —— 壳层据此不写 completed / bestMoves（另一协作者引入的契约）。
   */
  outcomeOf(state: ChessState): 'won' | 'lost' | 'draw' {
    const outcome = outcomeOf(state)
    if (outcome === 'black') return 'lost'
    if (outcome === 'draw') return 'draw'
    return 'won'
  },

  status(state: ChessState) {
    return gameStatus(state)
  },

  view(state: ChessState) {
    return buildView(state)
  },

  controls(state: ChessState) {
    return buildControls(state)
  },

  encode(state: ChessState): unknown {
    return encodeState(state)
  },

  decode(raw: unknown): ChessState {
    return decodeState(raw)
  },

  /**
   * 两拍式应手：玩家落白后先等 450ms 才亮出 AI 选中的棋子，再隔 500ms 真正落黑子。
   * 只有「黑方待应手」的中间态才返回值，其余情况壳层不起表。
   */
  tickMs(state: ChessState, _difficulty: string): number | null {
    const last = state.history[state.history.length - 1]
    if (!last || last.black !== null) return null
    if (outcomeOf(state) !== null) return null // 白方这一手直接终局：没有应手
    return state.opponentPick === null ? REPLY_DELAY_MS : PICK_TO_MOVE_MS
  },

  /**
   * tick 是「对手应手」语义：等待应手期间玩家再点自己的棋子，不应把 AI 的思考一直往后推
   * （另一协作者引入的契约，象棋/五子棋同样声明）。
   */
  tickActor: 'opponent',
}
