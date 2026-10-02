/**
 * 记忆配对的 GameDef 实现 —— 游戏盒子唯一需要认识的东西。
 *
 * 接入要点：
 * - 玩家只派发 `flip` / `undo` / `restart`，壳层不需要认识任何玩法；
 * - 全部随机性来自 `create(seed, difficulty)`；洗牌用 `createRng(seed + 游标)`，
 *   绝不使用 Math.random，因此同 seed + 同动作序列双端必然同局面；
 * - 非法翻牌（越界/已翻开/已配对）抛 IllegalActionError，壳层据此给出明确文字反馈；
 * - `decode` 用 `(seed, 游标)` 重算牌面并逐格比对，再逐条重放翻牌日志，坏数据一律拒绝。
 */
import type { GameDef } from '@eink/core'
import {
  DIFFICULTY_IDS,
  MEMORY_CONTENT_VERSION,
  MEMORY_ID,
  MEMORY_RULES_VERSION,
  difficultyLabelKey,
  difficultyOrThrow,
  type DifficultyId,
} from './board.js'
import {
  createState,
  decodeState,
  encodeState,
  gameStatus,
  legalActions,
  reduceMemory,
  selectAction,
  type MemoryAction,
  type MemoryState,
} from './rules.js'
import { buildControls, buildView } from './view.js'

// 壳层需要的公开面（文案 + 视图构件 + 规则），壳层不感知内部拆分
export { memoryEn, memoryZh } from './i18n.js'
export {
  DIFFICULTIES,
  DIFFICULTY_IDS,
  MEMORY_CONTENT_VERSION,
  MEMORY_ID,
  MEMORY_RULES_VERSION,
  SYMBOLS,
  cellCount,
  configFor,
  deal,
  difficultyLabelKey,
  difficultyOrThrow,
  glyphForPair,
  isDifficultyId,
  normalizeSeed,
  pairCount,
  totalCellsOf,
  type BoardConfig,
  type DifficultyId,
} from './board.js'
export {
  createState,
  decodeState,
  encodeState,
  gameStatus,
  legalActions,
  reduceMemory,
  replayFlips,
  selectAction,
  snapshotOf,
  type MemoryAction,
  type MemorySnapshot,
  type MemoryState,
} from './rules.js'
export {
  CELL_LABEL_KEYS,
  TILE_TEXT_SCALE,
  buildBoard,
  buildControls,
  buildStats,
  buildView,
  cellGlyphAt,
  cellKindAt,
  cellLabelKey,
} from './view.js'

/** GameDef 需要的难度清单（`DIFFICULTIES` 是尺寸配置，两者名字刻意区分） */
export const DIFFICULTY_SPECS = DIFFICULTY_IDS.map((id) => ({
  id,
  labelKey: difficultyLabelKey(id),
}))

/** 注册表用：记忆配对没有关卡，内容是「难度档」，用它给「继续」定位 */
export const CONTENT_IDS: readonly string[] = DIFFICULTY_IDS

/** 注册表用：进度按「已通关难度 / 3」算 */
export function progressFor(completed: readonly string[]): { done: number; total: number } {
  return {
    done: DIFFICULTY_IDS.filter((id) => completed.includes(id)).length,
    total: DIFFICULTY_IDS.length,
  }
}

export function createMemoryState(seed: number, difficulty: DifficultyId): MemoryState {
  return createState(seed, difficulty)
}

export const memoryGame: GameDef<MemoryState, MemoryAction> = {
  id: MEMORY_ID,
  rulesVersion: MEMORY_RULES_VERSION,
  contentVersion: MEMORY_CONTENT_VERSION,
  i18nNamespace: MEMORY_ID,
  illegalNoticeKey: 'memory.illegal.notice',
  difficulties: DIFFICULTY_SPECS,

  create(seed: number, difficultyId: string): MemoryState {
    return createState(seed, difficultyOrThrow(difficultyId))
  },

  reduce(state: MemoryState, action: MemoryAction): MemoryState {
    return reduceMemory(state, action)
  },

  legal(state: MemoryState): readonly MemoryAction[] {
    return legalActions(state)
  },

  selectAction(state: MemoryState, index: number): MemoryAction | null {
    return selectAction(state, index)
  },

  /**
   * 除撤销外没有别的自定义按钮；重开由壳层直接派发，这里也接受一次以防壳层改走 controlAction。
   */
  controlAction(_state: MemoryState, controlId: string): MemoryAction | null {
    if (controlId === 'undo') return { type: 'undo' }
    if (controlId === 'restart') return { type: 'restart' }
    return null
  },

  /** 无关卡玩法：用难度作为内容 id，通关记录与「继续」定位都按难度归类 */
  contentId(state: MemoryState): string {
    return state.difficulty
  },

  /** 计步：一次尝试（翻两张）算一步，最佳成绩按它算 */
  movesOf(state: MemoryState): number {
    return Math.floor(state.flips.length / 2)
  },

  status(state: MemoryState) {
    return gameStatus(state)
  },

  view(state: MemoryState) {
    return buildView(state)
  },

  controls(state: MemoryState) {
    return buildControls(state)
  },

  encode(state: MemoryState): unknown {
    return encodeState(state)
  },

  decode(raw: unknown): MemoryState {
    return decodeState(raw)
  },
}
