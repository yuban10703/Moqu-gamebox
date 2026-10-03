/**
 * 孔明棋的 GameDef 实现 —— 游戏盒子唯一需要认识的东西。
 *
 * 接入要点：
 * - 起始布局是三种固定的经典布局，**没有任何随机性**（不用 seed、绝不用 Math.random），
 *   因此 `create(seed, difficulty)` 对同一个难度永远给出同一局面；
 * - 交互是「两步选择」：`selectAction` 负责把点格子翻译成 select / jump，
 *   壳层因此不需要知道任何玩法细节；
 * - 非法操作抛 IllegalActionError，壳层据此给出明确文字反馈；
 * - `decode` 从固定起始布局按 history 逐条重放并比对棋子表，坏数据一律拒绝。
 */
import type { GameDef } from '@eink/core'
import {
  BOARD_SIZE,
  DIFFICULTIES,
  DIFFICULTY_IDS,
  GAME_ID,
  HOLE_INDEXES,
  difficultyOrThrow,
  type DifficultyId,
} from './board.js'
import {
  createState,
  decodeState,
  encodeState,
  gameStatus,
  legalActions,
  reducePegSolitaire,
  selectAction,
  type PegAction,
  type PegState,
} from './rules.js'
import { buildControls, buildView } from './view.js'

// 壳层需要的公开面（文案 + 视图构件 + 规则），壳层不感知内部拆分
export { pegsolitaireEn, pegsolitaireZh } from './i18n.js'
// 棋盘模型：DIFFICULTIES 是「难度 → 起始空孔」的配置表；难度清单见 DIFFICULTY_IDS
export {
  BOARD_SIZE,
  CENTER,
  DIFFICULTIES,
  DIFFICULTY_IDS,
  GAME_ID,
  HOLE_INDEXES,
  applyJump,
  colOf,
  configFor,
  countPegs,
  difficultyOrThrow,
  indexOf,
  initialPegs,
  isDifficultyId,
  isHole,
  isLegalJump,
  jumpTargets,
  jumpedIndex,
  legalJumps,
  rowOf,
  type BoardConfig,
  type DifficultyId,
  type Jump,
} from './board.js'
export {
  createState,
  decodeState,
  encodeState,
  gameStatus,
  legalActions,
  reducePegSolitaire,
  remainingPegs,
  selectAction,
  type PegAction,
  type PegState,
} from './rules.js'
export {
  CELL_LABEL_KEYS,
  PEG_GLYPH,
  PEG_TEXT_SCALE,
  buildBoard,
  buildControls,
  buildStats,
  buildView,
  cellGlyphAt,
  cellKindAt,
  cellLabelKey,
} from './view.js'

export const PEGSOLITAIRE_ID = GAME_ID
export const PEGSOLITAIRE_RULES_VERSION = 1
export const PEGSOLITAIRE_CONTENT_VERSION = 1

/** 三档难度 = 三种固定起始布局，规则完全相同 */
export const DIFFICULTY_SPECS = DIFFICULTY_IDS.map((id) => ({
  id,
  labelKey: `pegsolitaire.difficulty.${id}`,
}))

export const PEGSOLITAIRE_EMPTY_HOLES: Record<DifficultyId, readonly number[]> = {
  starter: DIFFICULTIES.starter.emptyHoles,
  skilled: DIFFICULTIES.skilled.emptyHoles,
  challenging: DIFFICULTIES.challenging.emptyHoles,
}

export function createPegSolitaireState(difficulty: DifficultyId): PegState {
  return createState(difficulty)
}

export const pegsolitaireGame: GameDef<PegState, PegAction> = {
  id: GAME_ID,
  rulesVersion: PEGSOLITAIRE_RULES_VERSION,
  contentVersion: PEGSOLITAIRE_CONTENT_VERSION,
  i18nNamespace: 'pegsolitaire',
  illegalNoticeKey: 'pegsolitaire.illegal.notice',
  difficulties: DIFFICULTY_SPECS,

  /** seed 只为满足契约签名：本玩法的起始布局固定，与 seed 无关 */
  create(_seed: number, difficultyId: string): PegState {
    return createState(difficultyOrThrow(difficultyId))
  },

  reduce(state: PegState, action: PegAction): PegState {
    return reducePegSolitaire(state, action)
  },

  legal(state: PegState): readonly PegAction[] {
    return legalActions(state)
  },

  selectAction(state: PegState, index: number): PegAction | null {
    return selectAction(state, index)
  },

  /**
   * 撤销/重开按钮的映射。壳层自己渲染这两个固定 id 的按钮并直接派发同名动作，
   * 这里再提供一次映射，是为了壳层改走 controlAction 时也不会失效。
   */
  controlAction(_state: PegState, controlId: string): PegAction | null {
    if (controlId === 'undo') return { type: 'undo' }
    if (controlId === 'restart') return { type: 'restart' }
    return null
  },

  /** 无关卡玩法：用难度作为内容 id，通关记录与「继续」定位都按难度归类 */
  contentId(state: PegState): string {
    return state.difficulty
  },

  /** 计步：本玩法的「最佳成绩」= 最少跳吃次数，语义成立 */
  movesOf(state: PegState): number {
    return state.moves
  },

  status(state: PegState) {
    return gameStatus(state)
  },

  view(state: PegState) {
    return buildView(state)
  },

  controls(state: PegState) {
    return buildControls(state)
  },

  encode(state: PegState): unknown {
    return encodeState(state)
  },

  decode(raw: unknown): PegState {
    return decodeState(raw)
  },
}

/** 棋盘尺寸常量（壳层/测试用，避免各处重复写字面量） */
export const PEGSOLITAIRE_BOARD_SIZE = BOARD_SIZE
/** 33 个孔位的数量（视图/测试的参考值） */
export const PEGSOLITAIRE_HOLE_COUNT = HOLE_INDEXES.length
