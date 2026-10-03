/**
 * 播棋（Kalah）的 GameDef 实现 —— 游戏盒子唯一需要认识的东西。
 *
 * 接入要点：
 * - 布局：2 行 × 7 列 = 14 格；行 0 是白方（仓在列 0 = 索引 0，坑 1..6 从右往左播），
 *   行 1 是黑方玩家（坑 7..12 从左往右播，仓在列 6 = 索引 13）；沿逆时针 RING 前进、跳过对手的仓；
 * - 玩家只派发 `sow`：选空坑 / 对手的坑 / 仓 / 越界 / 终局后行动都抛 IllegalActionError；
 * - 最后一颗落自己仓 → 连走；落自己空坑且对面非空 → 吃子；
 * - 一方 6 坑全空 → 结算（双方坑内石子收回各自仓）→ 比仓判胜负/平局（平局并入 won，结果页用 draw 标题）；
 * - 白方应手在**同一次 reduce 内**算完（含连走）；
 * - `undo` 撤回一整回合（玩家连走 + 白方应手），`restart` 回到初始摆法；
 * - `decode` 从 `(seed, difficulty, log)` 复算 14 格并逐字段比对，坏数据一律拒绝。
 */
import type { GameDef } from '@eink/core'
import {
  DIFFICULTY_IDS,
  GAME_ID,
  difficultyOrThrow,
  type DifficultyId,
  type MancalaState,
} from './board.js'
import {
  createState,
  decodeState,
  encodeState,
  gameStatus,
  legalActions,
  reduceMancala,
  selectAction,
  type MancalaAction,
} from './rules.js'
import { buildControls, buildView } from './view.js'

// 壳层需要的公开面（文案 + 视图构件 + 规则），壳层不感知内部拆分
export { mancalaEn, mancalaZh } from './i18n.js'
// 棋盘几何与纯局面转移（含 RING 与方向判据）
export {
  BLACK,
  BLACK_STORE,
  CELLS,
  COLS,
  DIFFICULTY_IDS,
  GAME_ID,
  INITIAL_STONES,
  PITS_PER_SIDE,
  RING,
  ROWS,
  WHITE,
  WHITE_STORE,
  applySow,
  colOf,
  createBoardState,
  difficultyOrThrow,
  inRange,
  indexOf,
  initialCells,
  isDifficultyId,
  isFinished,
  isPit,
  isStore,
  legalPits,
  nextCell,
  normalizeSeed,
  oppositePit,
  otherSide,
  pitIndexes,
  pitStones,
  ringPosition,
  rowOf,
  settle,
  sowOnce,
  storeCount,
  storeOf,
  totalStones,
  type DifficultyId,
  type MancalaState,
  type Side,
  type SowResult,
} from './board.js'
// 白方策略
export {
  BRANCH_LIMIT,
  NODE_BUDGET,
  SEARCH_DEPTH,
  choosePit,
  evaluate,
  evaluatePosition,
  greedyScore,
  greedyScores,
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
  reduceMancala,
  selectAction,
  type MancalaAction,
} from './rules.js'
export {
  CELL_LABEL_KEYS,
  EMPTY_PIT_GLYPH,
  EMPTY_PIT_TEXT_SCALE,
  PIT_TEXT_SCALES,
  STORE_TEXT_SCALES,
  buildBoard,
  buildControls,
  buildStats,
  buildView,
  cellGlyphAt,
  cellKindAt,
  cellLabelKey,
  textScaleFor,
} from './view.js'

export const MANCALA_ID = GAME_ID
export const MANCALA_RULES_VERSION = 1
export const MANCALA_CONTENT_VERSION = 1

/** 三档难度：初始摆法相同（每坑 4 颗），区别只在白方 AI 强弱 */
export const DIFFICULTY_SPECS = DIFFICULTY_IDS.map((id) => ({
  id,
  labelKey: `mancala.difficulty.${id}`,
}))

export function createMancalaState(seed: number, difficulty: DifficultyId): MancalaState {
  return createState(seed, difficulty)
}

export const mancalaGame: GameDef<MancalaState, MancalaAction> = {
  id: GAME_ID,
  rulesVersion: MANCALA_RULES_VERSION,
  contentVersion: MANCALA_CONTENT_VERSION,
  i18nNamespace: 'mancala',
  illegalNoticeKey: 'mancala.illegal.notice',
  difficulties: DIFFICULTY_SPECS,

  create(seed: number, difficultyId: string): MancalaState {
    return createState(seed, difficultyOrThrow(difficultyId))
  },

  reduce(state: MancalaState, action: MancalaAction): MancalaState {
    return reduceMancala(state, action)
  },

  legal(state: MancalaState): readonly MancalaAction[] {
    return legalActions(state)
  },

  selectAction(state: MancalaState, index: number): MancalaAction | null {
    return selectAction(state, index)
  },

  /**
   * 撤销/重开按钮的映射。壳层自己渲染这两个固定 id 的按钮并直接派发同名动作，
   * 这里再提供一次映射，是为了壳层改走 controlAction 时也不会失效。
   */
  controlAction(_state: MancalaState, controlId: string): MancalaAction | null {
    if (controlId === 'undo') return { type: 'undo' }
    if (controlId === 'restart') return { type: 'restart' }
    return null
  },

  /** 无关卡玩法：用难度作为内容 id，通关记录与「继续」定位都按难度归类 */
  contentId(state: MancalaState): string {
    return state.difficulty
  },

  /** 计步：最佳成绩用玩家播种次数（白方应手不计） */
  movesOf(state: MancalaState): number {
    return state.moves
  },

  status(state: MancalaState) {
    return gameStatus(state)
  },

  view(state: MancalaState) {
    return buildView(state)
  },

  controls(state: MancalaState) {
    return buildControls(state)
  },

  encode(state: MancalaState): unknown {
    return encodeState(state)
  },

  decode(raw: unknown): MancalaState {
    return decodeState(raw)
  },
}
