/**
 * 海战棋的 GameDef 实现 —— 游戏盒子唯一需要认识的东西。
 *
 * 接入要点：
 * - 双方舰队都由 `create(seed, difficulty)` 按 `createRng(seed + 偏移)` 摆好（不重叠、不越界、互不接触含对角）；
 * - 玩家只派发 `fire`：重复打同一格 / 越界抛 IllegalActionError，壳层给出明确反馈；
 * - 命中继续射击（连打），未中换手，白方 AI 应手在**同一次 reduce 内**算完（含连打）；
 * - `undo` 撤回一整回合（玩家连打 + 白方应手），`restart` 回到同一布局；
 * - `decode` 从 `(seed, difficulty, log)` 复算双方布局与射击记录并逐字段比对，坏数据一律拒绝。
 */
import type { GameDef } from '@eink/core'
import {
  DIFFICULTY_IDS,
  GAME_ID,
  difficultyOrThrow,
  type BattleshipState,
  type DifficultyId,
} from './board.js'
import {
  createState,
  decodeState,
  encodeState,
  gameStatus,
  legalActions,
  reduceBattleship,
  selectAction,
  type BattleshipAction,
} from './rules.js'
import { buildControls, buildView } from './view.js'

// 壳层需要的公开面（文案 + 视图构件 + 规则），壳层不感知内部拆分
export { battleshipEn, battleshipZh } from './i18n.js'
// 棋盘模型：8×8、摆舰、射击转移
export {
  AI_SEED_OFFSET,
  BOARD_SIZE,
  CELLS,
  DIFFICULTY_IDS,
  ENEMY,
  ENEMY_FLEET_OFFSET,
  GAME_ID,
  PLAYER,
  SHIP_LENGTHS,
  applyShot,
  colOf,
  createBoardState,
  difficultyOrThrow,
  inRange,
  indexOf,
  isDifficultyId,
  isHit,
  neighbors8,
  normalizeSeed,
  onBoard,
  otherSide,
  placeFleet,
  remainingShipCells,
  rowOf,
  shipLengths,
  shipsTouch,
  sunkShips,
  untriedCells,
  type BattleshipState,
  type DifficultyId,
  type Fleet,
  type Ship,
  type Side,
} from './board.js'
// 白方策略
export {
  chooseShot,
  evaluatePosition,
  huntCells,
  lineExtensionCells,
  targetCells,
  unresolvedShips,
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
  reduceBattleship,
  selectAction,
  type BattleshipAction,
} from './rules.js'
export {
  CELL_LABEL_KEYS,
  HIT_GLYPH,
  HIT_TEXT_SCALE,
  MISS_GLYPH,
  MISS_TEXT_SCALE,
  buildBoard,
  buildControls,
  buildStats,
  buildView,
  cellGlyphAt,
  cellKindAt,
  cellLabelKey,
} from './view.js'

export const BATTLESHIP_ID = GAME_ID
export const BATTLESHIP_RULES_VERSION = 1
export const BATTLESHIP_CONTENT_VERSION = 1

/** 三档难度只改舰数/舰长（都是 8×8 海域），规则完全相同 */
export const DIFFICULTY_SPECS = DIFFICULTY_IDS.map((id) => ({
  id,
  labelKey: `battleship.difficulty.${id}`,
}))

export function createBattleshipState(seed: number, difficulty: DifficultyId): BattleshipState {
  return createState(seed, difficulty)
}

export const battleshipGame: GameDef<BattleshipState, BattleshipAction> = {
  id: GAME_ID,
  rulesVersion: BATTLESHIP_RULES_VERSION,
  contentVersion: BATTLESHIP_CONTENT_VERSION,
  i18nNamespace: 'battleship',
  illegalNoticeKey: 'battleship.illegal.notice',
  difficulties: DIFFICULTY_SPECS,

  create(seed: number, difficultyId: string): BattleshipState {
    return createState(seed, difficultyOrThrow(difficultyId))
  },

  reduce(state: BattleshipState, action: BattleshipAction): BattleshipState {
    return reduceBattleship(state, action)
  },

  legal(state: BattleshipState): readonly BattleshipAction[] {
    return legalActions(state)
  },

  selectAction(state: BattleshipState, index: number): BattleshipAction | null {
    return selectAction(state, index)
  },

  /**
   * 撤销/重开按钮的映射。壳层自己渲染这两个固定 id 的按钮并直接派发同名动作，
   * 这里再提供一次映射，是为了壳层改走 controlAction 时也不会失效。
   */
  controlAction(_state: BattleshipState, controlId: string): BattleshipAction | null {
    if (controlId === 'undo') return { type: 'undo' }
    if (controlId === 'restart') return { type: 'restart' }
    return null
  },

  /** 无关卡玩法：用难度作为内容 id，通关记录与「继续」定位都按难度归类 */
  contentId(state: BattleshipState): string {
    return state.difficulty
  },

  /** 计步：最佳成绩用玩家射击次数（白方应手不计） */
  movesOf(state: BattleshipState): number {
    return state.moves
  },

  status(state: BattleshipState) {
    return gameStatus(state)
  },

  view(state: BattleshipState) {
    return buildView(state)
  },

  controls(state: BattleshipState) {
    return buildControls(state)
  },

  encode(state: BattleshipState): unknown {
    return encodeState(state)
  },

  decode(raw: unknown): BattleshipState {
    return decodeState(raw)
  },
}
