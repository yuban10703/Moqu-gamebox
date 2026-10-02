/**
 * 四子棋的 GameDef 实现 —— 游戏盒子唯一需要认识的东西。
 *
 * 接入要点：
 * - 白方（对手）在 `reduce` 内自动应手：壳层只派发 `drop`/`undo`/`restart`，
 *   不需要驱动任何 AI，也没有「等对方走棋」的中间态；
 * - 全部随机性来自 `create(seed, difficulty)` 保存的 seed（seed + 随机游标），
 *   绝不使用 Math.random，因此同 seed + 同玩家动作序列双端必然同局面；
 * - 非法落子（列已满/越界）抛 IllegalActionError，壳层据此给出明确文字反馈；
 * - `decode` 用回合日志重放盘面（含重力校验）并逐格比对，坏数据一律拒绝。
 */
import type { GameDef } from '@eink/core'
import {
  CONNECT4_CONTENT_VERSION,
  CONNECT4_ID,
  CONNECT4_RULES_VERSION,
  DIFFICULTY_IDS,
  difficultyLabelKey,
  difficultyOrThrow,
  type DifficultyId,
} from './ai.js'
import {
  createState,
  decodeState,
  encodeState,
  gameStatus,
  legalActions,
  reduceConnect4,
  selectAction,
  type Connect4Action,
  type Connect4State,
} from './rules.js'
import { buildControls, buildView } from './view.js'

// 壳层需要的公开面（文案 + 视图构件 + 规则），壳层不感知内部拆分
export { connect4En, connect4Zh } from './i18n.js'
export {
  BLACK,
  BOARD_COLS,
  BOARD_ROWS,
  CELLS,
  DIRECTIONS,
  EMPTY,
  WHITE,
  colOf,
  columnFull,
  countStones,
  createEmptyBoard,
  dropStone,
  findFour,
  indexOf,
  isColumn,
  isFull,
  isIndex,
  landingIndex,
  makesFour,
  onBoard,
  otherSide,
  rowOf,
  runLength,
  validColumns,
  type Side,
  type Stone,
  type StoneCounts,
} from './board.js'
export {
  CONNECT4_CONTENT_VERSION,
  CONNECT4_ID,
  CONNECT4_RULES_VERSION,
  DIFFICULTY_IDS,
  chooseOpponentMove,
  difficultyLabelKey,
  difficultyOrThrow,
  evaluate,
  isDifficultyId,
  lookaheadDepth,
  winningColumns,
  type DifficultyId,
} from './ai.js'
export {
  createState,
  decodeState,
  encodeState,
  gameStatus,
  legalActions,
  normalizeSeed,
  outcomeOf,
  reduceConnect4,
  selectAction,
  type Connect4Action,
  type Connect4State,
  type Connect4Turn,
  type Outcome,
} from './rules.js'
export {
  CELL_LABEL_KEYS,
  HINT_GLYPH,
  HINT_TEXT_SCALE,
  STONE_GLYPHS,
  buildBoard,
  buildControls,
  buildStats,
  buildView,
  cellGlyphAt,
  cellKindAt,
  cellLabelKey,
  droppableIndexes,
  resultTitleKey,
} from './view.js'

/** 三档难度只影响白方强度，规则完全相同 */
export const DIFFICULTIES = DIFFICULTY_IDS.map((id) => ({
  id,
  labelKey: difficultyLabelKey(id),
}))

/** 注册表用：四子棋没有关卡，内容是「难度档」，用它给「继续」定位 */
export const CONTENT_IDS: readonly string[] = DIFFICULTY_IDS

/** 注册表用：进度按「已通关难度 / 3」算 */
export function progressFor(completed: readonly string[]): { done: number; total: number } {
  return {
    done: DIFFICULTY_IDS.filter((id) => completed.includes(id)).length,
    total: DIFFICULTY_IDS.length,
  }
}

export function createConnect4State(seed: number, difficulty: DifficultyId): Connect4State {
  return createState(seed, difficulty)
}

export const connect4Game: GameDef<Connect4State, Connect4Action> = {
  id: CONNECT4_ID,
  rulesVersion: CONNECT4_RULES_VERSION,
  contentVersion: CONNECT4_CONTENT_VERSION,
  i18nNamespace: CONNECT4_ID,
  illegalNoticeKey: 'connect4.illegal.notice',
  difficulties: DIFFICULTIES,

  create(seed: number, difficultyId: string): Connect4State {
    return createState(seed, difficultyOrThrow(difficultyId))
  },

  reduce(state: Connect4State, action: Connect4Action): Connect4State {
    return reduceConnect4(state, action)
  },

  legal(state: Connect4State): readonly Connect4Action[] {
    return legalActions(state)
  },

  selectAction(state: Connect4State, index: number): Connect4Action | null {
    return selectAction(state, index)
  },

  /**
   * 除撤销外没有别的自定义按钮；重开由壳层直接派发，这里也接受一次以防壳层改走 controlAction。
   */
  controlAction(_state: Connect4State, controlId: string): Connect4Action | null {
    if (controlId === 'undo') return { type: 'undo' }
    if (controlId === 'restart') return { type: 'restart' }
    return null
  },

  /** 无关卡玩法：用难度作为内容 id，通关记录与「继续」定位都按难度归类 */
  contentId(state: Connect4State): string {
    return state.difficulty
  },

  /** 计步：最佳成绩用玩家的落子数（白方应手不算） */
  movesOf(state: Connect4State): number {
    return state.moves
  },

  status(state: Connect4State) {
    return gameStatus(state)
  },

  view(state: Connect4State) {
    return buildView(state)
  },

  controls(state: Connect4State) {
    return buildControls(state)
  },

  encode(state: Connect4State): unknown {
    return encodeState(state)
  },

  decode(raw: unknown): Connect4State {
    return decodeState(raw)
  },
}
