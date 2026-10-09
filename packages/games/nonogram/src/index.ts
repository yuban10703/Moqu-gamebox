/**
 * 数织的 GameDef 实现 —— 游戏盒子唯一需要认识的东西。
 *
 * 与其它玩法一致：状态不可变、`reduce` 纯函数、非法动作抛 `IllegalActionError`、
 * `encode`/`decode` 严格往返。
 * 数织自己的两条约定：
 * 1. **没有随机、没有 AI、没有自动步进**：题号就是"种子"，`create(seed, difficulty)`
 *    用 seed 在题库里取一道题（同一 seed 双端同题）；重开由壳层换新 seed，于是换一道新题。
 * 2. 存档极小：只存「难度 + 题号 + 每格标记 + 上次检查结果 + 步数」，位图是代码常量，不进存档。
 */
import { type GameDef, type GameStatus } from '@eink/core'
import {
  DIFFICULTY_IDS,
  NONOGRAM_ID,
  PUZZLES,
  difficultyLabelKey,
  difficultyOrThrow,
} from './levels.js'
import {
  createState,
  decodeState,
  encodeState,
  gameStatus,
  legalActions,
  puzzleOf,
  reduceNonogram,
  selectAction,
  type NonogramAction,
  type NonogramState,
} from './engine.js'
import { buildControls, buildView } from './view.js'

// 壳层需要的公开面（文案 + 视图构件 + 规则），壳层不感知内部拆分
export { nonogramEn, nonogramZh } from './i18n.js'
export {
  DIFFICULTY_IDS,
  NONOGRAM_ID,
  PUZZLES,
  PUZZLES_BY_DIFFICULTY,
  blackTotal,
  cellCountOf,
  clueOf,
  clueText,
  colCluesOf,
  colLine,
  colsOf,
  countSolutions,
  difficultyLabelKey,
  difficultyOrThrow,
  isDifficultyId,
  maxClueLength,
  puzzleAt,
  puzzleById,
  puzzleIndexFor,
  puzzlesFor,
  rowCluesOf,
  rowLine,
  rowsOf,
  solutionBits,
  type DifficultyId,
  type PuzzleDef,
} from './levels.js'
export {
  MARK_BLACK,
  MARK_CROSS,
  MARK_CYCLE,
  MARK_EMPTY,
  blackCount,
  colMatches,
  createState,
  decodeState,
  encodeState,
  gameStatus,
  hasMarks,
  isSolved,
  legalActions,
  nextMark,
  puzzleOf,
  reduceNonogram,
  rowMatches,
  selectAction,
  totalCells,
  wrongColCount,
  wrongLineCount,
  wrongRowCount,
  type CellMark,
  type NonogramAction,
  type NonogramState,
} from './engine.js'
export { CELL_LABEL_KEYS, CROSS_GLYPH, buildBoard, buildControls, buildStats, buildView, cellGlyph, cellKindAt } from './view.js'

export const NONOGRAM_RULES_VERSION = 1
export const NONOGRAM_CONTENT_VERSION = 1

/**
 * 通关进度（详情页与首页的「继续」卡片用）。
 *
 * 按**题号**计：16 道题各自算一项，全部解出即 100%。
 * （按难度计会让"入门 6 道只解出 1 道"显示成"已完成"，进度条失去意义。）
 */
export function progressFor(completed: readonly string[]): { done: number; total: number } {
  const done = PUZZLES.filter((puzzle) => completed.includes(puzzle.id)).length
  return { done, total: PUZZLES.length }
}

export const nonogramGame: GameDef<NonogramState, NonogramAction> = {
  id: NONOGRAM_ID,
  rulesVersion: NONOGRAM_RULES_VERSION,
  contentVersion: NONOGRAM_CONTENT_VERSION,
  i18nNamespace: NONOGRAM_ID,
  illegalNoticeKey: 'nonogram.illegal',
  difficulties: DIFFICULTY_IDS.map((id) => ({ id, labelKey: difficultyLabelKey(id) })),

  create(seed: number, difficultyId: string): NonogramState {
    return createState(seed, difficultyOrThrow(difficultyId))
  },

  reduce(state: NonogramState, action: NonogramAction): NonogramState {
    return reduceNonogram(state, action)
  },

  legal(state: NonogramState): readonly NonogramAction[] {
    return legalActions(state)
  },

  selectAction(state: NonogramState, index: number): NonogramAction | null {
    return selectAction(state, index)
  },

  status(state: NonogramState): GameStatus {
    return gameStatus(state)
  },

  view(state: NonogramState) {
    return buildView(state)
  },

  controls(state: NonogramState) {
    return buildControls(state)
  },

  /**
   * 「清屏」「检查」由游戏自己说明派发什么动作。
   * 壳层只把 role:'action' 的控件渲染成按钮并回调这里（它不该知道任何玩法）；
   * restart 也映射一次 —— 壳层的重开在有关卡列表时才走 `{type:'restart'}`，
   * 这里备着，壳层改动时不会失效。
   */
  controlAction(_state: NonogramState, controlId: string): NonogramAction | null {
    if (controlId === 'clear') return { type: 'clearMarks' }
    if (controlId === 'check') return { type: 'check' }
    if (controlId === 'restart') return { type: 'restart' }
    return null
  },

  /** 内容 id = 题号（如 'skilled-3'）：通关进度与最佳步数都按题记 */
  contentId(state: NonogramState): string {
    return puzzleOf(state).id
  },

  /** 步数：涂黑 / 打叉的次数（清屏与检查不计步，见 engine.ts） */
  movesOf(state: NonogramState): number {
    return state.moves
  },

  encode(state: NonogramState): unknown {
    return encodeState(state)
  },

  decode(raw: unknown): NonogramState {
    return decodeState(raw)
  },
}
