/**
 * 消消乐的 GameDef 实现 —— 游戏盒子唯一需要认识的东西。
 *
 * 接入要点：
 * - 玩家只派发 `select` / `swap` / `undo` / `restart`（点格子由 selectAction 翻译），
 *   壳层不需要认识任何玩法；
 * - 全部随机性来自 `create(seed, difficulty)`：初始棋盘与每次补充新棋子都用
 *   `createRng(seed + 游标)`，绝不使用 Math.random，因此同 seed + 同动作序列双端必然同局面；
 * - 换不出三连的交换抛 IllegalActionError（壳层据此给出 `illegalNoticeKey` 的文字提示），
 *   状态保持不变、不扣步数；
 * - `decode` 严格校验存档：盘面必须稳定且有解，撤销栈必须能逐条回退到初始棋盘。
 */
import type { GameDef } from '@eink/core'
import {
  DIFFICULTY_IDS,
  MATCH3_CONTENT_VERSION,
  MATCH3_ID,
  MATCH3_RULES_VERSION,
  difficultyLabelKey,
  difficultyOrThrow,
  type DifficultyId,
} from './meta.js'
import {
  createState,
  decodeState,
  encodeState,
  gameStatus,
  legalActions,
  reduceMatch3,
  selectAction,
  type Match3Action,
  type Match3State,
} from './rules.js'
import { buildControls, buildView } from './view.js'

// 壳层需要的公开面（文案 + 视图构件 + 规则），壳层不感知内部拆分
export { match3En, match3Zh } from './i18n.js'
export {
  DIFFICULTY_IDS,
  MATCH3_CONTENT_VERSION,
  MATCH3_ID,
  MATCH3_RULES_VERSION,
  difficultyLabelKey,
  difficultyOrThrow,
  isDifficultyId,
  type DifficultyId,
} from './meta.js'
export {
  DIFFICULTIES,
  EMPTY,
  KIND_GLYPHS,
  MAX_BOARD_ATTEMPTS,
  MIN_MATCH,
  applyGravity,
  areAdjacent,
  buildBoard,
  cellCount,
  colOf,
  configFor,
  createStableBoard,
  fillEmpties,
  findGroups,
  findLegalSwaps,
  forbiddenKinds,
  glyphForKind,
  groupScore,
  hasLegalSwap,
  indexOf,
  isIndex,
  isProductiveSwap,
  lineRuns,
  normalizeSeed,
  rowOf,
  swapCells,
  totalCellsOf,
  type BoardConfig,
} from './board.js'
export {
  MAX_CASCADE_ROUNDS,
  createState,
  decodeState,
  encodeState,
  gameStatus,
  legalActions,
  pieceCount,
  reduceMatch3,
  remainingMoves,
  selectAction,
  targetScoreOf,
  type Match3Action,
  type Match3State,
  type MoveRecord,
} from './rules.js'
export {
  CELL_LABEL_KEYS,
  TILE_TEXT_SCALE,
  buildBoard as buildBoardView,
  buildControls,
  buildStats,
  buildView,
  cellGlyphAt,
  cellKindAt,
  cellLabelKey,
} from './view.js'

/** GameDef 需要的难度清单（`DIFFICULTIES` 是尺寸/目标配置，两者名字刻意区分） */
export const DIFFICULTY_SPECS = DIFFICULTY_IDS.map((id) => ({
  id,
  labelKey: difficultyLabelKey(id),
}))

/** 注册表用：消消乐没有关卡，内容是「难度档」，用它给「继续」定位 */
export const CONTENT_IDS: readonly string[] = DIFFICULTY_IDS

/** 注册表用：进度按「已通关难度 / 3」算 */
export function progressFor(completed: readonly string[]): { done: number; total: number } {
  return {
    done: DIFFICULTY_IDS.filter((id) => completed.includes(id)).length,
    total: DIFFICULTY_IDS.length,
  }
}

export function createMatch3State(seed: number, difficulty: DifficultyId): Match3State {
  return createState(seed, difficulty)
}

export const match3Game: GameDef<Match3State, Match3Action> = {
  id: MATCH3_ID,
  rulesVersion: MATCH3_RULES_VERSION,
  contentVersion: MATCH3_CONTENT_VERSION,
  i18nNamespace: MATCH3_ID,
  illegalNoticeKey: 'match3.illegal.notice',
  difficulties: DIFFICULTY_SPECS,

  create(seed: number, difficultyId: string): Match3State {
    return createState(seed, difficultyOrThrow(difficultyId))
  },

  reduce(state: Match3State, action: Match3Action): Match3State {
    return reduceMatch3(state, action)
  },

  legal(state: Match3State): readonly Match3Action[] {
    return legalActions(state)
  },

  selectAction(state: Match3State, index: number): Match3Action | null {
    return selectAction(state, index)
  },

  /** 除撤销外没有别的自定义按钮；重开由壳层直接派发，这里也接受一次以防壳层改走 controlAction */
  controlAction(_state: Match3State, controlId: string): Match3Action | null {
    if (controlId === 'undo') return { type: 'undo' }
    if (controlId === 'restart') return { type: 'restart' }
    return null
  },

  /** 无关卡玩法：用难度作为内容 id，通关记录与「继续」定位都按难度归类 */
  contentId(state: Match3State): string {
    return state.difficulty
  },

  /** 计步：一次成功交换算一步。目标分固定时，「最少步数过关」就是该难度的最佳成绩 */
  movesOf(state: Match3State): number {
    return state.moves
  },

  status(state: Match3State) {
    return gameStatus(state)
  },

  view(state: Match3State) {
    return buildView(state)
  },

  controls(state: Match3State) {
    return buildControls(state)
  },

  encode(state: Match3State): unknown {
    return encodeState(state)
  },

  decode(raw: unknown): Match3State {
    return decodeState(raw)
  },
}
