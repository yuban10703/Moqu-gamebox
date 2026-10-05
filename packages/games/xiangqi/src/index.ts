/**
 * 中国象棋的 GameDef 实现 —— 游戏盒子唯一需要认识的东西。
 *
 * 接入要点：
 * - 黑方（对手）在 `reduce` 内自动应手：壳层只派发 `select`/`move`/`undo`/`restart`，
 *   不需要驱动任何 AI，也没有「等对方走棋」的中间态；
 * - 全部随机性来自 `create(seed, difficulty)` 保存的 seed（seed + 随机游标），
 *   绝不使用 Math.random，因此同 seed + 同玩家动作序列双端必然同局面；
 * - 非法着法（含送将、将帅照面）抛 IllegalActionError，壳层据此给出明确文字反馈；
 * - `decode` 用回合日志重放整局并逐字段比对，坏数据一律拒绝；
 * - 回合制玩法，**不声明 tickMs**（零时间引用，规则层不读时钟）。
 */
import type { GameDef } from '@eink/core'
import {
  DIFFICULTY_IDS,
  XIANGQI_CONTENT_VERSION,
  XIANGQI_ID,
  XIANGQI_RULES_VERSION,
  difficultyLabelKey,
  difficultyOrThrow,
  type DifficultyId,
} from './meta.js'
import {
  createState,
  decodeState,
  encodeState,
  gameStatus,
  isDrawnByRepetition,
  legalActions,
  reduceXiangqi,
  selectAction,
  type XiangqiAction,
  type XiangqiState,
} from './rules.js'
import { BLACK } from './board.js'
import { buildControls, buildView } from './view.js'

// 壳层需要的公开面（文案 + 视图构件 + 规则），壳层不感知内部拆分
export { xiangqiEn, xiangqiZh } from './i18n.js'
export {
  ADVISOR,
  BLACK,
  CANNON,
  CELLS,
  CHARIOT,
  COLS,
  ELEPHANT,
  EMPTY,
  HORSE,
  KING,
  PAWN,
  RED,
  ROWS,
  applyMove,
  colOf,
  countPieces,
  createInitialBoard,
  findKing,
  generateMoves,
  generatePieceMoves,
  hasCrossedRiver,
  inPalace,
  indexOf,
  isAttacked,
  isIndex,
  isKingInCheck,
  isMoveCode,
  isPieceCode,
  legalMoves,
  legalMovesOn,
  makePiece,
  moveFrom,
  moveTo,
  onBoard,
  onOwnHalf,
  otherSide,
  packMove,
  rowOf,
  sameBoard,
  sideOf,
  typeOf,
  undoMove,
  type PieceType,
  type Side,
} from './board.js'
export {
  MATE_SCORE,
  PIECE_VALUE,
  challengingDepth,
  chooseMove,
  chooseOpponentMove,
  evaluate,
} from './ai.js'
export {
  DIFFICULTY_IDS,
  XIANGQI_CONTENT_VERSION,
  XIANGQI_ID,
  XIANGQI_RULES_VERSION,
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
  inCheck,
  isDrawnByRepetition,
  legalActions,
  normalizeSeed,
  occurrenceCount,
  reduceXiangqi,
  selectAction,
  type XiangqiAction,
  type XiangqiState,
  type XiangqiTurn,
} from './rules.js'
export {
  CELL_LABEL_KEYS,
  RIVER_GROUP_ROWS,
  buildBoard,
  buildControls,
  buildStats,
  buildView,
  cellGlyphAt,
  cellKindAt,
  cellLabelKey,
  pieceGlyph,
  resultTitleKey,
  selectedTargets,
} from './view.js'

/** 三档难度只影响黑方强度，规则完全相同 */
export const DIFFICULTIES = DIFFICULTY_IDS.map((id) => ({
  id,
  labelKey: difficultyLabelKey(id),
}))

/** 注册表用：象棋没有关卡，内容是「难度档」，用它给「继续」定位 */
export const CONTENT_IDS: readonly string[] = DIFFICULTY_IDS

/** 注册表用：进度按「已通关难度 / 3」算 */
export function progressFor(completed: readonly string[]): { done: number; total: number } {
  return {
    done: DIFFICULTY_IDS.filter((id) => completed.includes(id)).length,
    total: DIFFICULTY_IDS.length,
  }
}

export function createXiangqiState(seed: number, difficulty: DifficultyId): XiangqiState {
  return createState(seed, difficulty)
}

/** AI 落子前的延迟（毫秒）：450ms 略高于壳层下限 400ms，也贴近墨屏整屏刷新时间 */
const REPLY_DELAY_MS = 450

/** 「AI 已选中」到「真正落子」之间的间隔（用户指定 500ms） */
const PICK_TO_MOVE_MS = 500

export const xiangqiGame: GameDef<XiangqiState, XiangqiAction> = {
  id: XIANGQI_ID,
  rulesVersion: XIANGQI_RULES_VERSION,
  contentVersion: XIANGQI_CONTENT_VERSION,
  i18nNamespace: XIANGQI_ID,
  illegalNoticeKey: 'xiangqi.illegal.notice',
  difficulties: DIFFICULTIES,

  create(seed: number, difficultyId: string): XiangqiState {
    return createState(seed, difficultyOrThrow(difficultyId))
  },

  reduce(state: XiangqiState, action: XiangqiAction): XiangqiState {
    return reduceXiangqi(state, action)
  },

  legal(state: XiangqiState): readonly XiangqiAction[] {
    return legalActions(state)
  },

  selectAction(state: XiangqiState, index: number): XiangqiAction | null {
    return selectAction(state, index)
  },

  /**
   * 除撤销外没有别的自定义按钮；重开由壳层直接派发，这里也接受一次以防壳层改走 controlAction。
   */
  controlAction(_state: XiangqiState, controlId: string): XiangqiAction | null {
    if (controlId === 'undo') return { type: 'undo' }
    if (controlId === 'restart') return { type: 'restart' }
    return null
  },

  /** 无关卡玩法：用难度作为内容 id，通关记录与「继续」定位都按难度归类 */
  contentId(state: XiangqiState): string {
    return state.difficulty
  },

  /**
   * AI 落子前的延迟（用户要求「AI 选中棋子后加个小延迟再落子」）。
   *
   * 为什么用 tickMs 而不是 setTimeout：规则层禁止时间引用（有源码扫描测试守着），
   * 本项目里"延时"一律由壳层的会话计时器驱动 —— 下限 400ms 是壳层约定，
   * 而墨水屏整屏刷新约 500ms，所以取 450ms：玩家看清自己那一手，再看到黑方落子。
   * 壳层在玩家每次有效输入后重置计时，因此这个延迟只发生在"红方刚走完"之后。
   * 只在对局进行中、且轮到黑方时才返回数字，其余情况返回 null（不该步进）。
   */
  tickMs(state: XiangqiState): number | null {
    if (gameStatus(state) !== 'playing' || state.sideToMove !== BLACK) return null
    // 两拍：先"选中"（450ms 后玩家能看到 AI 挑了哪枚子），再隔 500ms 才落子
    return state.opponentPick === null ? REPLY_DELAY_MS : PICK_TO_MOVE_MS
  },

  /*
   * 这两拍走的是**对手**的应手：等待期间玩家再点自己的棋子不该把黑方的思考一直往后推
   * （实测连点 3.6 秒，黑方一步不走）。壳层只在「刚刚轮到黑方」的那一次重置计时。
   */
  tickActor: 'opponent',

  /**
   * 真实结果：`status()` 把「三次重复局面判和」并入 `won`（否则壳层不认为对局结束、
   * 结果面板不出来），但和棋不是通关 —— 壳层据此不写 completed / bestMoves。
   */
  outcomeOf(state: XiangqiState): 'won' | 'lost' | 'draw' {
    if (isDrawnByRepetition(state)) return 'draw'
    return gameStatus(state) === 'won' ? 'won' : 'lost'
  },

  /** 计步：最佳成绩用玩家的落子数（黑方应手不算） */
  movesOf(state: XiangqiState): number {
    return state.moves
  },

  status(state: XiangqiState) {
    return gameStatus(state)
  },

  view(state: XiangqiState) {
    return buildView(state)
  },

  controls(state: XiangqiState) {
    return buildControls(state)
  },

  encode(state: XiangqiState): unknown {
    return encodeState(state)
  },

  decode(raw: unknown): XiangqiState {
    return decodeState(raw)
  },
}
