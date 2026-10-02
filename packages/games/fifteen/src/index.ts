/**
 * 数字华容道的 GameDef 实现 —— 游戏盒子唯一需要认识的东西。
 *
 * 接入要点：
 * - 打乱只用 `create(seed, difficulty)` 里的 seed（core 的 createRng），绝不使用 Math.random，
 *   且一律「从已还原局面出发做 N 次随机合法滑动」，因此同 seed 双端必然同局面、且局面必然可解；
 * - 非法滑动抛 IllegalActionError，壳层据此给出明确文字反馈；
 * - `selectAction` 把点格子映射成 tap（只有与空白相邻的数字块可点，其余返回 null）；
 * - `decode` 严格校验存档并在 `moves === 0` 时复算初始局面，坏数据一律拒绝。
 */
import type { GameDef, MoveDir } from '@eink/core'
import {
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
  reduceFifteen,
  selectAction,
  type FifteenAction,
  type FifteenState,
} from './rules.js'
import { buildControls, buildView } from './view.js'

// 壳层需要的公开面（文案 + 视图构件 + 规则），壳层不感知内部拆分
export { fifteenEn, fifteenZh } from './i18n.js'
// 棋盘模型：DIFFICULTIES 是「难度 → 尺寸/打乱步数」的配置表；难度清单见 DIFFICULTY_IDS
export {
  DIFFICULTIES,
  DIFFICULTY_IDS,
  DIRECTIONS,
  GAME_ID,
  canSlide,
  cellCount,
  colOf,
  configFor,
  createSolvedBoard,
  difficultyOrThrow,
  indexOf,
  inversions,
  isDifficultyId,
  isMoveDir,
  isSolvable,
  isSolved,
  normalizeSeed,
  opposite,
  placedCount,
  rowOf,
  scrambleBoard,
  slide,
  slideTile,
  targetOf,
  tileCount,
  type BoardConfig,
  type DifficultyId,
  type ScrambleResult,
} from './board.js'
export {
  createState,
  decodeState,
  encodeState,
  gameStatus,
  legalActions,
  reduceFifteen,
  selectAction,
  type FifteenAction,
  type FifteenSnapshot,
  type FifteenState,
} from './rules.js'
export {
  CELL_LABEL_KEYS,
  EMPTY_GLYPH,
  TILE_TEXT_SCALE,
  boardSizeOf,
  buildBoard,
  buildControls,
  buildStats,
  buildView,
  cellGlyphAt,
  cellKindAt,
  cellLabelKey,
} from './view.js'

export const FIFTEEN_ID = GAME_ID
export const FIFTEEN_RULES_VERSION = 1
export const FIFTEEN_CONTENT_VERSION = 1

/** 三档难度只影响棋盘尺寸与打乱步数，规则完全相同。注册表用 `fifteenGame.difficulties` 即可，这里是给需要难度清单的调用方留的口子 */
export const DIFFICULTY_SPECS = DIFFICULTY_IDS.map((id) => ({
  id,
  labelKey: `fifteen.difficulty.${id}`,
}))

export function createFifteenState(seed: number, difficulty: DifficultyId): FifteenState {
  return createState(seed, difficulty)
}

export const fifteenGame: GameDef<FifteenState, FifteenAction> = {
  id: GAME_ID,
  rulesVersion: FIFTEEN_RULES_VERSION,
  contentVersion: FIFTEEN_CONTENT_VERSION,
  i18nNamespace: 'fifteen',
  illegalNoticeKey: 'fifteen.illegal.notice',
  difficulties: DIFFICULTY_SPECS,

  create(seed: number, difficultyId: string): FifteenState {
    return createState(seed, difficultyOrThrow(difficultyId))
  },

  reduce(state: FifteenState, action: FifteenAction): FifteenState {
    return reduceFifteen(state, action)
  },

  legal(state: FifteenState): readonly FifteenAction[] {
    return legalActions(state)
  },

  selectAction(state: FifteenState, index: number): FifteenAction | null {
    return selectAction(state, index)
  },

  /**
   * 撤销/重开按钮的映射。壳层自己渲染这两个固定 id 的按钮并直接派发同名动作，
   * 这里再提供一次映射，是为了壳层改走 controlAction 时也不会失效。
   */
  controlAction(_state: FifteenState, controlId: string): FifteenAction | null {
    if (controlId === 'undo') return { type: 'undo' }
    if (controlId === 'restart') return { type: 'restart' }
    // 方向键映射成本玩法的规范动作名 slide（壳层派发的控件 id 是 `move-<dir>`）
    const match = /^move-(up|down|left|right)$/.exec(controlId)
    if (match) return { type: 'slide', dir: match[1] as MoveDir }
    return null
  },

  /** 无关卡玩法：用难度作为内容 id，通关记录与「继续」定位都按难度归类 */
  contentId(state: FifteenState): string {
    return state.difficulty
  },

  /** 计步：本玩法的「最佳成绩」= 最少步数，语义成立 */
  movesOf(state: FifteenState): number {
    return state.moves
  },

  status(state: FifteenState) {
    return gameStatus(state)
  },

  view(state: FifteenState) {
    return buildView(state)
  },

  controls(state: FifteenState) {
    return buildControls(state)
  },

  encode(state: FifteenState): unknown {
    return encodeState(state)
  },

  decode(raw: unknown): FifteenState {
    return decodeState(raw)
  },
}
