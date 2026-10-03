/**
 * 华容道的 GameDef 实现 —— 游戏盒子唯一需要认识的东西。
 *
 * 接入要点：
 * - 关卡制：`contentId` 是关卡 id，`create(seed, difficulty)` 给出该难度第一关
 *   （布局固定，因此忽略 seed，也绝不用 Math.random）；
 * - 玩家只派发 `select` / `slide`：选中是界面状态（不计步、不进日志），
 *   滑动只走一格，目标格有块或越界就抛 IllegalActionError；
 * - `undo` 撤回一次滑动（不撤回选中），`restart` 回到本关初始摆法（壳层会无条件派发）；
 * - `decode` 从 `(levelId, log)` 重放并逐字段比对，块重叠/越界/数量不对/选中不存在都会被拒绝。
 *
 * 关卡选择与「下一关」由壳层按注册表渲染，本游戏不声明 dpad / next-level 控件。
 */
import type { GameDef } from '@eink/core'
import {
  DIFFICULTY_IDS,
  GAME_ID,
  PACK,
  difficultyOrThrow,
  firstLevelId,
  type DifficultyId,
  type KlotskiLevel,
} from './board.js'
import {
  createState,
  decodeState,
  encodeState,
  gameStatus,
  legalActions,
  reduceKlotski,
  selectAction,
  type KlotskiAction,
  type KlotskiState,
} from './rules.js'
import { buildControls, buildView } from './view.js'

// 壳层需要的公开面（文案 + 视图构件 + 规则 + 关卡包），壳层不感知内部拆分
export { klotskiEn, klotskiZh } from './i18n.js'
// 关卡包与查询（注册表用：levels / indexOfLevel / progressFor）
export {
  CAO_GOAL,
  CAO_ID,
  CELLS,
  COLS,
  DIFFICULTY_IDS,
  EXIT_CELLS,
  GAME_ID,
  LEVELS,
  PACK,
  ROWS,
  cellsOf,
  difficultyOrThrow,
  firstLevelId,
  indexOf,
  initialPositions,
  insideBoard,
  isDifficultyId,
  isLastLevel,
  isMoveDir,
  isSolved,
  levelById,
  levelOrThrow,
  levelsFor,
  nextLevelId,
  occupancy,
  ownerAt,
  packProgress,
  pieceById,
  replaySlides,
  rowOf,
  colOf,
  slidePositions,
  targetStart,
  type DifficultyId,
  type KlotskiLevel,
  type LevelDef,
  type LevelPiece,
  type Positions,
} from './board.js'
export {
  createState,
  createStateForDifficulty,
  decodeState,
  encodeState,
  gameStatus,
  legalActions,
  reduceKlotski,
  selectAction,
  type KlotskiAction,
  type KlotskiState,
} from './rules.js'
export {
  CELL_LABEL_KEYS,
  PIECE_TEXT_SCALE,
  buildBoard,
  buildControls,
  buildStats,
  buildView,
  cellGlyphAt,
  cellKindAt,
  cellLabelKey,
} from './view.js'

export const KLOTSKI_ID = GAME_ID
export const KLOTSKI_RULES_VERSION = 1
export const KLOTSKI_CONTENT_VERSION = 1

/** 三档难度只影响从哪一关开始（第一关不同），规则完全相同 */
export const DIFFICULTY_SPECS = DIFFICULTY_IDS.map((id) => ({
  id,
  labelKey: `klotski.difficulty.${id}`,
}))

export function createKlotskiState(difficulty: DifficultyId): KlotskiState {
  return createState(firstLevelId(difficulty))
}

export const klotskiGame: GameDef<KlotskiState, KlotskiAction> = {
  id: GAME_ID,
  rulesVersion: KLOTSKI_RULES_VERSION,
  contentVersion: KLOTSKI_CONTENT_VERSION,
  i18nNamespace: 'klotski',
  illegalNoticeKey: 'klotski.illegal.notice',
  difficulties: DIFFICULTY_SPECS,

  /** seed 只为满足契约签名：关卡布局固定，与 seed 无关 */
  create(_seed: number, difficultyId: string): KlotskiState {
    return createState(firstLevelId(difficultyOrThrow(difficultyId)))
  },

  reduce(state: KlotskiState, action: KlotskiAction): KlotskiState {
    return reduceKlotski(state, action)
  },

  legal(state: KlotskiState): readonly KlotskiAction[] {
    return legalActions(state)
  },

  selectAction(state: KlotskiState, index: number): KlotskiAction | null {
    return selectAction(state, index)
  },

  /**
   * 撤销/重开按钮的映射。壳层自己渲染这两个固定 id 的按钮并直接派发同名动作，
   * 这里再提供一次映射，是为了壳层改走 controlAction 时也不会失效。
   */
  controlAction(_state: KlotskiState, controlId: string): KlotskiAction | null {
    if (controlId === 'undo') return { type: 'undo' }
    if (controlId === 'restart') return { type: 'restart' }
    return null
  },

  /** 关卡制：用关卡 id 作为内容 id，通关记录与「继续」定位都按关卡归类 */
  contentId(state: KlotskiState): string {
    return state.levelId
  },

  /** 计步：本玩法的「最佳成绩」= 最少滑动次数，语义成立 */
  movesOf(state: KlotskiState): number {
    return state.moves
  },

  status(state: KlotskiState) {
    return gameStatus(state)
  },

  view(state: KlotskiState) {
    return buildView(state)
  },

  controls(state: KlotskiState) {
    return buildControls(state)
  },

  encode(state: KlotskiState): unknown {
    return encodeState(state)
  },

  decode(raw: unknown): KlotskiState {
    return decodeState(raw)
  },
}

/** 关卡包常量（注册表用），与 sokoban 的 PACK 同构 */
export const KLOTSKI_PACK: readonly KlotskiLevel[] = PACK
