/**
 * 扫雷的 GameDef 实现 —— 游戏盒子唯一需要认识的东西。
 *
 * 关键约束：
 * - 布雷随机性只来自 `create(seed, difficulty)` 里保存的 seed，且用 mulberry32（绝不用 Math.random），
 *   因此同 seed + 同操作序列双端得到同一局面；
 * - 地雷延迟到第一次翻开之后才放置，并排除首点及其 8 邻域（首点必安全）；
 * - `decode` 严格校验存档（含首点安全不变量），且只搬运已放好的雷，不会重新布雷。
 */
import type { GameDef } from '@eink/core'
import {
  DIFFICULTY_IDS,
  difficultyOrThrow,
  GAME_ID,
  type DifficultyId,
} from './difficulty.js'
import {
  createState,
  decodeState,
  encodeState,
  gameStatus,
  legalActions,
  reduceMinesweeper,
  selectAction,
  type MinesweeperAction,
  type MinesweeperState,
} from './rules.js'
import { buildControls, buildView } from './view.js'

// 壳层需要的公开面（文案 + 视图构件 + 规则），壳层不感知内部拆分
export { minesweeperEn, minesweeperZh } from './i18n.js'
export {
  cellCount,
  configFor,
  DIFFICULTIES,
  DIFFICULTY_IDS,
  difficultyOrThrow,
  GAME_ID,
  isDifficultyId,
  type BoardConfig,
  type DifficultyId,
} from './difficulty.js'
export {
  adjacentMineCount,
  coordsOf,
  expandChain,
  mulberry32,
  neighborhoodOf,
  neighborsOf,
  placeMines,
  type PlacementResult,
} from './generate.js'
export {
  createState,
  decodeState,
  encodeState,
  gameStatus,
  legalActions,
  reduceMinesweeper,
  remainingMines,
  selectAction,
  totalCells,
  type MinesweeperAction,
  type MinesweeperState,
  type MinesweeperUndoEntry,
} from './rules.js'
export {
  buildBoard,
  buildControls,
  buildView,
  CELL_GLYPHS,
  CELL_LABEL_KEYS,
  cellGlyphAt,
  cellKindAt,
} from './view.js'

export const MINESWEEPER_ID = GAME_ID
export const MINESWEEPER_RULES_VERSION = 1
export const MINESWEEPER_CONTENT_VERSION = 1

export function createMinesweeperState(seed: number, difficulty: DifficultyId): MinesweeperState {
  return createState(seed, difficulty)
}

export const minesweeperGame: GameDef<MinesweeperState, MinesweeperAction> = {
  id: GAME_ID,
  rulesVersion: MINESWEEPER_RULES_VERSION,
  contentVersion: MINESWEEPER_CONTENT_VERSION,
  i18nNamespace: 'minesweeper',
  illegalNoticeKey: 'minesweeper.illegal',
  difficulties: DIFFICULTY_IDS.map((id) => ({ id, labelKey: `minesweeper.difficulty.${id}` })),

  create(seed: number, difficultyId: string): MinesweeperState {
    // 种子归一化成 uint32：负数/小数/NaN 都不会破坏「同 seed 同结果」
    const normalized = Number.isFinite(seed) ? Math.trunc(seed) >>> 0 : 0
    return createState(normalized, difficultyOrThrow(difficultyId))
  },

  reduce(state: MinesweeperState, action: MinesweeperAction): MinesweeperState {
    return reduceMinesweeper(state, action)
  },

  legal(state: MinesweeperState): readonly MinesweeperAction[] {
    return legalActions(state)
  },

  selectAction(state: MinesweeperState, index: number): MinesweeperAction | null {
    return selectAction(state, index)
  },

  status(state: MinesweeperState) {
    return gameStatus(state)
  },

  view(state: MinesweeperState) {
    return buildView(state)
  },

  controls(state: MinesweeperState) {
    return buildControls(state)
  },

  /**
   * 「标记模式」开关、撤销与重开由游戏自己说明派发什么动作。
   * 壳层只把 role:'action' 的控件渲染成按钮并回调这里（它不该知道任何玩法）；
   * 撤销目前由壳层的固定按钮派发，这里也映射一次，壳层改走 controlAction 时不会失效。
   */
  controlAction(_state: MinesweeperState, controlId: string): MinesweeperAction | null {
    if (controlId === 'flag-mode') return { type: 'toggleFlagMode' }
    if (controlId === 'undo') return { type: 'undo' }
    if (controlId === 'restart') return { type: 'restart' }
    return null
  },

  /** 无关卡玩法：用难度作为内容 id，这样通关记录与「继续」定位都按难度归类 */
  contentId(state: MinesweeperState): string {
    return state.difficulty
  },

  encode(state: MinesweeperState): unknown {
    return encodeState(state)
  },

  decode(raw: unknown): MinesweeperState {
    return decodeState(raw)
  },
}
