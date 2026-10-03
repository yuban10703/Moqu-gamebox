/**
 * 骑士巡游的 GameDef 实现 —— 游戏盒子唯一需要认识的东西。
 *
 * 接入要点：
 * - 起点由 `create(seed, difficulty)` 用 core 的 createRng 选出（绝不使用 Math.random），
 *   同 seed + 同难度必然同起点；
 * - 玩家只派发 `move`：非法落点（非马步 / 已访问 / 越界）抛 IllegalActionError，壳层给出明确反馈；
 * - `undo` 退回一步、`restart` 回到起点（壳层会无条件派发）；
 *   `hint` 只是显示开关（只有入门难度提供）：不改棋局、不计步、不进日志；
 * - `decode` 从 `(seed, difficulty, log)` 重放并逐字段比对，坏数据一律拒绝。
 */
import type { GameDef } from '@eink/core'
import {
  BOARD_SIZE,
  CELLS,
  DIFFICULTY_IDS,
  GAME_ID,
  difficultyOrThrow,
  type DifficultyId,
} from './board.js'
import {
  createState,
  decodeState,
  encodeState,
  gameStatus,
  legalActions,
  reduceKnight,
  selectAction,
  type KnightAction,
  type KnightState,
} from './rules.js'
import { buildControls, buildView } from './view.js'

// 壳层需要的公开面（文案 + 视图构件 + 规则），壳层不感知内部拆分
export { knightstourEn, knightstourZh } from './i18n.js'
// 棋盘模型：难度只决定「起始格区域 + 是否有提示」，棋盘都是 8×8
export {
  BOARD_SIZE,
  CELLS,
  DIFFICULTIES,
  DIFFICULTY_IDS,
  GAME_ID,
  KNIGHT_OFFSETS,
  colOf,
  difficultyOrThrow,
  difficultySpec,
  inRange,
  indexOf,
  insertVisited,
  isDifficultyId,
  isKnightMove,
  isTourComplete,
  knightMoves,
  normalizeSeed,
  onBoard,
  pickStart,
  rowOf,
  startCandidates,
  warnsdorffNext,
  type DifficultyId,
  type DifficultySpec,
  type StartRegion,
} from './board.js'
export {
  createState,
  decodeState,
  deriveTour,
  encodeState,
  gameStatus,
  legalActions,
  legalTargets,
  reduceKnight,
  selectAction,
  type KnightAction,
  type KnightState,
  type TourState,
} from './rules.js'
export {
  CELL_LABEL_KEYS,
  HINT_GLYPH,
  HINT_TEXT_SCALE,
  OPTION_TEXT_SCALE,
  VISITED_GLYPH,
  VISITED_TEXT_SCALE,
  buildBoard,
  buildControls,
  buildStats,
  buildView,
  cellGlyphAt,
  cellKindAt,
  cellLabelKey,
} from './view.js'

export const KNIGHTSTOUR_ID = GAME_ID
export const KNIGHTSTOUR_RULES_VERSION = 1
export const KNIGHTSTOUR_CONTENT_VERSION = 1

/** 三档难度：棋盘相同，只有起始格区域与「是否有提示」不同 */
export const DIFFICULTY_SPECS = DIFFICULTY_IDS.map((id) => ({
  id,
  labelKey: `knightstour.difficulty.${id}`,
}))

export function createKnightState(seed: number, difficulty: DifficultyId): KnightState {
  return createState(seed, difficulty)
}

export const knightstourGame: GameDef<KnightState, KnightAction> = {
  id: GAME_ID,
  rulesVersion: KNIGHTSTOUR_RULES_VERSION,
  contentVersion: KNIGHTSTOUR_CONTENT_VERSION,
  i18nNamespace: 'knightstour',
  illegalNoticeKey: 'knightstour.illegal.notice',
  difficulties: DIFFICULTY_SPECS,

  create(seed: number, difficultyId: string): KnightState {
    return createState(seed, difficultyOrThrow(difficultyId))
  },

  reduce(state: KnightState, action: KnightAction): KnightState {
    return reduceKnight(state, action)
  },

  legal(state: KnightState): readonly KnightAction[] {
    return legalActions(state)
  },

  selectAction(state: KnightState, index: number): KnightAction | null {
    return selectAction(state, index)
  },

  /**
   * 撤销 / 重开 / 提示按钮的映射。壳层自己渲染 undo/restart 这两个固定 id 的按钮，
   * 提示按钮（id: hint）则由壳层按 controls 渲染并回调这里。
   */
  controlAction(_state: KnightState, controlId: string): KnightAction | null {
    if (controlId === 'undo') return { type: 'undo' }
    if (controlId === 'restart') return { type: 'restart' }
    if (controlId === 'hint') return { type: 'hint' }
    return null
  },

  /** 无关卡玩法：用难度作为内容 id，通关记录与「继续」定位都按难度归类 */
  contentId(state: KnightState): string {
    return state.difficulty
  },

  /** 计步：最佳成绩用走过的步数（走满 64 格固定是 63 步，越少越好只对未完成局有意义） */
  movesOf(state: KnightState): number {
    return state.moves
  },

  status(state: KnightState) {
    return gameStatus(state)
  },

  view(state: KnightState) {
    return buildView(state)
  },

  controls(state: KnightState) {
    return buildControls(state)
  },

  encode(state: KnightState): unknown {
    return encodeState(state)
  },

  decode(raw: unknown): KnightState {
    return decodeState(raw)
  },
}

/** 棋盘常量（壳层/测试用，避免各处重复写字面量） */
export const KNIGHTSTOUR_BOARD_SIZE = BOARD_SIZE
export const KNIGHTSTOUR_CELLS = CELLS
