/**
 * 黑白棋的 GameDef 实现 —— 游戏盒子唯一需要认识的东西。
 *
 * 接入要点：
 * - 白方（对手）在 `reduce` 内自动应手：壳层只派发 `place`/`undo`/`restart`，
 *   不需要驱动任何 AI，也没有「等对方走棋」的中间态；
 * - 全部随机性来自 `create(seed, difficulty)` 保存的 seed（seed + 随机游标），
 *   绝不使用 Math.random，因此同 seed + 同玩家动作序列双端必然同局面；
 * - 非法落子抛 IllegalActionError，壳层据此给出明确文字反馈；
 * - `decode` 严格校验存档并复核规则不变量，坏数据一律拒绝。
 */
import type { GameDef } from '@eink/core'
import {
  DIFFICULTY_IDS,
  REVERSI_CONTENT_VERSION,
  REVERSI_ID,
  REVERSI_RULES_VERSION,
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
  reduceReversi,
  selectAction,
  type ReversiAction,
  type ReversiState,
} from './rules.js'
import { buildControls, buildView } from './view.js'

// 壳层需要的公开面（文案 + 视图构件 + 规则），壳层不感知内部拆分
export { reversiEn, reversiZh } from './i18n.js'
export {
  BLACK,
  BOARD_SIZE,
  CELLS,
  DIRECTIONS,
  EMPTY,
  WEIGHTS,
  WHITE,
  colOf,
  countDiscs,
  createInitialBoard,
  flipsFor,
  indexOf,
  isLegalMove,
  isTerminal,
  legalMovesFor,
  onBoard,
  otherSide,
  placeDisc,
  positionalWeight,
  rowOf,
  type Disc,
  type DiscCounts,
  type Placement,
  type Side,
} from './board.js'
export { chooseOpponentMove, evaluate, lookaheadDepth } from './ai.js'
export {
  DIFFICULTY_IDS,
  REVERSI_CONTENT_VERSION,
  REVERSI_ID,
  REVERSI_RULES_VERSION,
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
  reduceReversi,
  selectAction,
  type ReversiAction,
  type ReversiNotice,
  type ReversiSnapshot,
  type ReversiState,
} from './rules.js'
export {
  CELL_LABEL_KEYS,
  DISC_GLYPHS,
  HINT_GLYPH,
  HINT_TEXT_SCALE,
  buildBoard,
  buildControls,
  buildStats,
  buildView,
  cellGlyphAt,
  cellKindAt,
  cellLabelKey,
  outcomeOf,
} from './view.js'

/** 三档难度只影响白方强度，规则完全相同 */
export const DIFFICULTIES = DIFFICULTY_IDS.map((id) => ({
  id,
  labelKey: difficultyLabelKey(id),
}))

/** 注册表用：黑白棋没有关卡，内容是「难度档」，用它给「继续」定位 */
export const CONTENT_IDS: readonly string[] = DIFFICULTY_IDS

/** 注册表用：进度按「已通关难度 / 3」算 */
export function progressFor(completed: readonly string[]): { done: number; total: number } {
  return {
    done: DIFFICULTY_IDS.filter((id) => completed.includes(id)).length,
    total: DIFFICULTY_IDS.length,
  }
}

export function createReversiState(seed: number, difficulty: DifficultyId): ReversiState {
  return createState(seed, difficulty)
}

export const reversiGame: GameDef<ReversiState, ReversiAction> = {
  id: REVERSI_ID,
  rulesVersion: REVERSI_RULES_VERSION,
  contentVersion: REVERSI_CONTENT_VERSION,
  i18nNamespace: REVERSI_ID,
  illegalNoticeKey: 'reversi.illegal.notice',
  difficulties: DIFFICULTIES,

  create(seed: number, difficultyId: string): ReversiState {
    return createState(seed, difficultyOrThrow(difficultyId))
  },

  reduce(state: ReversiState, action: ReversiAction): ReversiState {
    return reduceReversi(state, action)
  },

  legal(state: ReversiState): readonly ReversiAction[] {
    return legalActions(state)
  },

  selectAction(state: ReversiState, index: number): ReversiAction | null {
    return selectAction(state, index)
  },

  /**
   * 除撤销外没有别的自定义按钮；重开由壳层直接派发，这里也接受一次以防壳层改走 controlAction。
   */
  controlAction(_state: ReversiState, controlId: string): ReversiAction | null {
    if (controlId === 'undo') return { type: 'undo' }
    if (controlId === 'restart') return { type: 'restart' }
    return null
  },

  /** 无关卡玩法：用难度作为内容 id，通关记录与「继续」定位都按难度归类 */
  contentId(state: ReversiState): string {
    return state.difficulty
  },

  /** 计步：最佳成绩用玩家的落子数（白方应手与自动过手都不算） */
  movesOf(state: ReversiState): number {
    return state.moves
  },

  status(state: ReversiState) {
    return gameStatus(state)
  },

  view(state: ReversiState) {
    return buildView(state)
  },

  controls(state: ReversiState) {
    return buildControls(state)
  },

  encode(state: ReversiState): unknown {
    return encodeState(state)
  },

  decode(raw: unknown): ReversiState {
    return decodeState(raw)
  },
}
