/**
 * 俄罗斯方块的 GameDef 实现 —— 游戏盒子唯一需要认识的东西。
 *
 * 与推箱子 / 2048 一致的约定：
 * - `create` 的随机性只来自 seed（7-bag 出块序列由 seed + 游标复算，见 rules.ts）；
 * - `reduce` 是纯函数，走不通的动作抛 IllegalActionError，由会话给出明确文字反馈；
 * - 规则层不引用时间：**没有重力定时器**，只有 `{ type: 'tick' }` 这个动作，
 *   间隔由难度声明（见 DIFFICULTIES.tickMs），到点由壳层会话派发；
 * - `decode` 严格校验存档（缺 `history` 的老存档按空撤销栈处理，不判损坏）；
 * - `view` / `controls` 只产出黑白可读的展示模型，不含灰阶与动画。
 */
import { type GameDef, type GameStatus } from '@eink/core'
import {
  DIFFICULTIES,
  DIFFICULTY_IDS,
  GAME_TETRIS_ID,
  createState,
  decodeState,
  difficultyOf,
  encodeState,
  legalActions,
  reduceState,
  statusOf,
  type TetrisAction,
  type TetrisState,
} from './rules.js'
import { buildControls, buildView } from './view.js'

// 壳层需要的公开面：文案、展示构建器、注册表辅助
export { tetrisEn, tetrisZh } from './i18n.js'
export { buildBoard, buildControls, buildStats, buildView, CELL_LABEL_KEYS, cellLabelKey, contentIdOf } from './view.js'
export {
  ALL_DIRS,
  bagAt,
  canUndo,
  CELL_EMPTY,
  CELL_FILLED,
  cellIndex,
  createState,
  decodeState,
  DIFFICULTIES,
  DIFFICULTY_IDS,
  difficultyOf,
  emptyBoard,
  encodeState,
  fits,
  GAME_TETRIS_ID,
  garbageHole,
  isAutoEntry,
  isLegal,
  legalActions,
  levelOf,
  LINES_PER_LEVEL,
  LINE_SCORES,
  MAX_HISTORY_ENTRIES,
  MAX_LINE_CLEAR,
  nextPieceId,
  pieceAt,
  pieceCells,
  PIECES_PER_BAG,
  reduceState,
  ROTATE_KICKS,
  scoreForLines,
  spawnPiece,
  statusOf,
  undoTetris,
  type ActivePiece,
  type Cell,
  type DifficultyId,
  type DifficultyTetris,
  type EncodedHistoryEntry,
  type EncodedPiece,
  type EncodedState,
  type HistoryEntry,
  type TetrisAction,
  type TetrisState,
} from './rules.js'
export {
  ALL_PIECES,
  boxOf,
  cellsOf,
  isPieceId,
  isRotation,
  nextRotation,
  PIECE_SPECS,
  ROTATIONS,
  type PieceId,
  type Rotation,
} from './pieces.js'

export const GAME_TETRIS_RULES_VERSION = 1
/** 本玩法没有关卡 / 题库，内容版本恒为 1（难度档是规则的一部分，见 DIFFICULTIES） */
export const GAME_TETRIS_CONTENT_VERSION = 1

/** 注册表用：无关卡玩法用难度作为内容 id（「继续」定位与进度归类） */
export const CONTENT_IDS: readonly string[] = DIFFICULTY_IDS

/** 注册表用：内容在列表中的下标（找不到时回退到第一档） */
export function contentIndex(id: string): number {
  const index = (DIFFICULTY_IDS as readonly string[]).indexOf(id)
  return index >= 0 ? index : 0
}

export const tetrisGame: GameDef<TetrisState, TetrisAction> = {
  id: GAME_TETRIS_ID,
  rulesVersion: GAME_TETRIS_RULES_VERSION,
  contentVersion: GAME_TETRIS_CONTENT_VERSION,
  i18nNamespace: GAME_TETRIS_ID,
  illegalNoticeKey: 'tetris.blocked',
  difficulties: DIFFICULTIES.map((spec) => ({
    id: spec.id,
    labelKey: `tetris.difficulty.${spec.id}`,
  })),

  create(seed: number, difficultyId: string): TetrisState {
    return createState(seed, difficultyId)
  },

  reduce(state: TetrisState, action: TetrisAction): TetrisState {
    return reduceState(state, action)
  },

  legal(state: TetrisState): readonly TetrisAction[] {
    return legalActions(state)
  },

  /** 无关卡玩法：内容 id = 难度 id */
  contentId(state: TetrisState): string {
    return state.difficulty
  },

  /**
   * 自动下落的间隔：由难度声明（入门 1050ms / 熟练 800ms / 挑战 600ms，依据见 rules.ts）。
   * 已经堆到顶就返回 null（壳层据此停表，不留空转的定时器）。
   * 想更快就用「落」手动软降 —— 玩家操作即时生效，不受这个间隔限制。
   */
  tickMs(state: TetrisState): number | null {
    if (statusOf(state) !== 'playing') return null
    return difficultyOf(state.difficulty).tickMs
  },

  /** 计步口径 = 已固化的块数（结果面板与战绩里的「步数」） */
  movesOf(state: TetrisState): number {
    return state.pieces
  },

  /** 只会是 playing / lost：堆到顶部即失败，本玩法没有胜利条件 */
  status(state: TetrisState): GameStatus {
    return statusOf(state)
  },

  view(state: TetrisState) {
    return buildView(state)
  },

  controls(state: TetrisState) {
    return buildControls(state)
  },

  encode(state: TetrisState): unknown {
    return encodeState(state)
  },

  decode(raw: unknown): TetrisState {
    return decodeState(raw)
  },
}
