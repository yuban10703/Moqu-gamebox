/**
 * 五子棋的 GameDef 实现 —— 游戏盒子唯一需要认识的东西。
 *
 * 接入要点：
 * - 白方（对手）在 `reduce` 内自动应手：壳层只派发 `place`/`undo`/`restart`，
 *   不需要驱动任何 AI，也没有「等对方走棋」的中间态；
 * - 全部随机性来自 `create(seed, difficulty)` 保存的 seed（seed + 随机游标），
 *   绝不使用 Math.random，因此同 seed + 同玩家动作序列双端必然同局面；
 * - 非法落子抛 IllegalActionError，壳层据此给出明确文字反馈；
 * - `decode` 用回合日志重放盘面并逐格比对，坏数据一律拒绝。
 */
import type { GameDef } from '@eink/core'
import {
  DIFFICULTY_IDS,
  GOMOKU_CONTENT_VERSION,
  GOMOKU_ID,
  GOMOKU_RULES_VERSION,
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
  reduceGomoku,
  selectAction,
  type GomokuAction,
  type GomokuState,
} from './rules.js'
import { buildControls, buildView } from './view.js'

/** 「玩家落子 → AI 亮目标格」的间隔（第一拍） */
const REPLY_DELAY_MS = 450
/** 「AI 已亮目标格 → 真正落子」的间隔（第二拍，用户指定 500ms） */
const PICK_TO_MOVE_MS = 500

// 壳层需要的公开面（文案 + 视图构件 + 规则），壳层不感知内部拆分
export { gomokuEn, gomokuZh } from './i18n.js'
export {
  BLACK,
  BOARD_SIZE,
  CELLS,
  DIRECTIONS,
  EMPTY,
  WHITE,
  colOf,
  countStones,
  createEmptyBoard,
  findFive,
  indexOf,
  isFull,
  makesFive,
  nearbyMoves,
  onBoard,
  otherSide,
  placeStone,
  rowOf,
  runLength,
  type Side,
  type Stone,
  type StoneCounts,
} from './board.js'
export { chooseOpponentMove, evaluate, immediateWins, lookaheadDepth } from './ai.js'
export {
  DIFFICULTY_IDS,
  GOMOKU_CONTENT_VERSION,
  GOMOKU_ID,
  GOMOKU_RULES_VERSION,
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
  legalActions,
  normalizeSeed,
  outcomeOf,
  reduceGomoku,
  selectAction,
  type GomokuAction,
  type GomokuState,
  type GomokuTurn,
  type Outcome,
} from './rules.js'
export {
  CELL_LABEL_KEYS,
  STONE_GLYPHS,
  buildBoard,
  buildControls,
  buildStats,
  buildView,
  cellGlyphAt,
  cellKindAt,
  cellLabelKey,
  resultTitleKey,
} from './view.js'

/** 三档难度只影响白方强度，规则完全相同 */
export const DIFFICULTIES = DIFFICULTY_IDS.map((id) => ({
  id,
  labelKey: difficultyLabelKey(id),
}))

/** 注册表用：五子棋没有关卡，内容是「难度档」，用它给「继续」定位 */
export const CONTENT_IDS: readonly string[] = DIFFICULTY_IDS

/** 注册表用：进度按「已通关难度 / 3」算 */
export function progressFor(completed: readonly string[]): { done: number; total: number } {
  return {
    done: DIFFICULTY_IDS.filter((id) => completed.includes(id)).length,
    total: DIFFICULTY_IDS.length,
  }
}

export function createGomokuState(seed: number, difficulty: DifficultyId): GomokuState {
  return createState(seed, difficulty)
}

export const gomokuGame: GameDef<GomokuState, GomokuAction> = {
  id: GOMOKU_ID,
  rulesVersion: GOMOKU_RULES_VERSION,
  contentVersion: GOMOKU_CONTENT_VERSION,
  i18nNamespace: GOMOKU_ID,
  illegalNoticeKey: 'gomoku.illegal.notice',
  difficulties: DIFFICULTIES,

  create(seed: number, difficultyId: string): GomokuState {
    return createState(seed, difficultyOrThrow(difficultyId))
  },

  reduce(state: GomokuState, action: GomokuAction): GomokuState {
    return reduceGomoku(state, action)
  },

  legal(state: GomokuState): readonly GomokuAction[] {
    return legalActions(state)
  },

  selectAction(state: GomokuState, index: number): GomokuAction | null {
    return selectAction(state, index)
  },

  /**
   * 两拍式应手：玩家落黑后先等 450ms 才亮出 AI 选中的目标格，再隔 500ms 真正落白子。
   * 只有「白方待应手」的中间态才返回值，其余情况壳层不起表。
   */
  tickMs(state: GomokuState): number | null {
    const last = state.history[state.history.length - 1]
    if (!last || last.white !== null) return null
    if (outcomeOf(state.board) !== null) return null // 黑方这一手直接终局：没有应手
    return state.opponentPick === null ? REPLY_DELAY_MS : PICK_TO_MOVE_MS
  },

  /**
   * 除撤销外没有别的自定义按钮；重开由壳层直接派发，这里也接受一次以防壳层改走 controlAction。
   */
  controlAction(_state: GomokuState, controlId: string): GomokuAction | null {
    if (controlId === 'undo') return { type: 'undo' }
    if (controlId === 'restart') return { type: 'restart' }
    return null
  },

  /** 无关卡玩法：用难度作为内容 id，通关记录与「继续」定位都按难度归类 */
  contentId(state: GomokuState): string {
    return state.difficulty
  },

  /** 计步：最佳成绩用玩家的落子数（白方应手不算） */
  movesOf(state: GomokuState): number {
    return state.moves
  },

  status(state: GomokuState) {
    return gameStatus(state)
  },

  view(state: GomokuState) {
    return buildView(state)
  },

  controls(state: GomokuState) {
    return buildControls(state)
  },

  encode(state: GomokuState): unknown {
    return encodeState(state)
  },

  decode(raw: unknown): GomokuState {
    return decodeState(raw)
  },
}
