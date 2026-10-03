/**
 * 关灯游戏的 GameDef 实现 —— 游戏盒子唯一需要认识的东西。
 *
 * 接入要点：
 * - 谜题只由 seed + 难度决定：从全灭局面用 core 的 createRng 随机做 N 次十字翻转打乱
 *   （构造性保证可解，不需要求解器），绝不使用 Math.random，因此同 seed 双端必然同谜题；
 * - 玩家操作只翻灯，绝不触发重新生成；非法操作抛 IllegalActionError，壳层给出明确文字反馈；
 * - `selectAction` 把点格子映射成 toggle（棋盘上每格都可点）；
 * - `decode` 用同 seed 复算初始谜题，并把 history 依次翻转复核存档局面可达，坏数据一律拒绝。
 */
import type { GameDef } from '@eink/core'
import {
  DIFFICULTIES,
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
  reduceLightsOut,
  selectAction,
  type LightsOutAction,
  type LightsOutState,
} from './rules.js'
import { buildControls, buildView } from './view.js'

// 壳层需要的公开面（文案 + 视图构件 + 规则），壳层不感知内部拆分
export { lightsoutEn, lightsoutZh } from './i18n.js'
// 棋盘模型：DIFFICULTIES 是「难度 → 尺寸/打乱步数」的配置表；难度清单见 DIFFICULTY_IDS
export {
  DIFFICULTIES,
  DIFFICULTY_IDS,
  GAME_ID,
  cellCount,
  colOf,
  configFor,
  createLights,
  crossIndexes,
  difficultyOrThrow,
  indexOf,
  isAllOff,
  isDifficultyId,
  litCount,
  normalizeSeed,
  replay,
  rowOf,
  scramblePlan,
  toggleCross,
  type BoardConfig,
  type DifficultyId,
  type Puzzle,
} from './board.js'
export {
  createState,
  decodeState,
  encodeState,
  gameStatus,
  legalActions,
  reduceLightsOut,
  remainingLights,
  selectAction,
  type LightsOutAction,
  type LightsOutState,
} from './rules.js'
export {
  CELL_LABEL_KEYS,
  LIT_GLYPH,
  LIT_TEXT_SCALE,
  buildBoard,
  buildControls,
  buildStats,
  buildView,
  cellGlyphAt,
  cellKindAt,
  cellLabelKey,
} from './view.js'

export const LIGHTSOUT_ID = GAME_ID
export const LIGHTSOUT_RULES_VERSION = 1
export const LIGHTSOUT_CONTENT_VERSION = 1

/** 三档难度只影响棋盘尺寸与打乱步数，规则完全相同 */
export const DIFFICULTY_SPECS = DIFFICULTY_IDS.map((id) => ({
  id,
  labelKey: `lightsout.difficulty.${id}`,
}))

export const LIGHTSOUT_BOARD_SIZES: Record<DifficultyId, number> = {
  starter: DIFFICULTIES.starter.size,
  skilled: DIFFICULTIES.skilled.size,
  challenging: DIFFICULTIES.challenging.size,
}

export function createLightsOutState(seed: number, difficulty: DifficultyId): LightsOutState {
  return createState(seed, difficulty)
}

export const lightsoutGame: GameDef<LightsOutState, LightsOutAction> = {
  id: GAME_ID,
  rulesVersion: LIGHTSOUT_RULES_VERSION,
  contentVersion: LIGHTSOUT_CONTENT_VERSION,
  i18nNamespace: 'lightsout',
  illegalNoticeKey: 'lightsout.illegal.notice',
  difficulties: DIFFICULTY_SPECS,

  create(seed: number, difficultyId: string): LightsOutState {
    return createState(seed, difficultyOrThrow(difficultyId))
  },

  reduce(state: LightsOutState, action: LightsOutAction): LightsOutState {
    return reduceLightsOut(state, action)
  },

  legal(state: LightsOutState): readonly LightsOutAction[] {
    return legalActions(state)
  },

  selectAction(state: LightsOutState, index: number): LightsOutAction | null {
    return selectAction(state, index)
  },

  /**
   * 撤销/重开按钮的映射。壳层自己渲染这两个固定 id 的按钮并直接派发同名动作，
   * 这里再提供一次映射，是为了壳层改走 controlAction 时也不会失效。
   */
  controlAction(_state: LightsOutState, controlId: string): LightsOutAction | null {
    if (controlId === 'undo') return { type: 'undo' }
    if (controlId === 'restart') return { type: 'restart' }
    return null
  },

  /** 无关卡玩法：用难度作为内容 id，通关记录与「继续」定位都按难度归类 */
  contentId(state: LightsOutState): string {
    return state.difficulty
  },

  /** 计步：本玩法的「最佳成绩」= 最少翻转次数，语义成立 */
  movesOf(state: LightsOutState): number {
    return state.moves
  },

  status(state: LightsOutState) {
    return gameStatus(state)
  },

  view(state: LightsOutState) {
    return buildView(state)
  },

  controls(state: LightsOutState) {
    return buildControls(state)
  },

  encode(state: LightsOutState): unknown {
    return encodeState(state)
  },

  decode(raw: unknown): LightsOutState {
    return decodeState(raw)
  },
}
