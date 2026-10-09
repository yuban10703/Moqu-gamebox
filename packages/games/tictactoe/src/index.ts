/**
 * 井字棋的 GameDef 实现 —— 游戏盒子唯一需要认识的东西。
 *
 * 接入要点（与五子棋/黑白棋同一套）：
 * - 对手（○）的应手**由壳层按 tickMs 分两拍派发** `{ type: 'tick' }`：
 *   第一拍亮出它选中的格子（棋盘一格不动），第二拍才落子（规则层零时间引用）；
 * - 全部随机性来自 `create(seed, difficulty)` 保存的种子（seed + 已落手数作游标），
 *   绝不使用 Math.random，因此同 seed + 同玩家动作序列双端必然同局面；
 * - 非法落子抛 IllegalActionError，壳层据此给出明确文字反馈；
 * - `decode` 用落子日志重放盘面并复核两个过程中的标记，坏数据一律拒绝。
 */
import type { GameDef } from '@eink/core'
import { OPPONENT_LEVELS } from './ai.js'
import { SECOND } from './board.js'
import {
  DIFFICULTY_IDS,
  TICTACTOE_CONTENT_VERSION,
  TICTACTOE_ID,
  TICTACTOE_RULES_VERSION,
  createState,
  decodeState,
  difficultyLabelKey,
  difficultyOrThrow,
  encodeState,
  gameStatus,
  legalActions,
  movesOf,
  opponentLevel,
  outcomeOf as stateOutcome,
  reduceState,
  selectAction,
  turnOf,
  type DifficultyId,
  type Outcome,
  type TictactoeAction,
  type TictactoeState,
} from './engine.js'
import { buildControls, buildView } from './view.js'

/** 「玩家落子 → 对手亮出目标格」的间隔（第一拍） */
const REPLY_DELAY_MS = 450
/** 「对手已亮目标格 → 真正落子」的间隔（第二拍，用户指定 500ms） */
const PICK_TO_MOVE_MS = 500

// 壳层需要的公开面（文案 + 视图构件 + 规则），壳层不感知内部拆分
export { tictactoeEn, tictactoeZh } from './i18n.js'
export {
  CELLS,
  CENTER,
  CORNERS,
  EMPTY,
  FIRST,
  LINES,
  SECOND,
  SIZE,
  colOf,
  countMarks,
  createEmptyBoard,
  emptyCells,
  indexOf,
  isFull,
  isIndex,
  lineOf,
  otherSide,
  placeMark,
  rowOf,
  winningMoves,
  winnerOf,
  type Mark,
  type MarkCounts,
  type Side,
} from './board.js'
export { OPPONENT_LEVELS, bestMove, chooseOpponentMove, type OpponentLevel } from './ai.js'
export {
  DIFFICULTY_IDS,
  TICTACTOE_CONTENT_VERSION,
  TICTACTOE_ID,
  TICTACTOE_RULES_VERSION,
  boardOf,
  createState,
  decodeState,
  difficultyLabelKey,
  difficultyOrThrow,
  encodeState,
  gameStatus,
  isDifficultyId,
  legalActions,
  movesOf,
  normalizeSeed,
  opponentLevel,
  outcomeOf,
  reduceState,
  replayLog,
  selectAction,
  sideAt,
  turnOf,
  winningLineOf,
  type DifficultyId,
  type Outcome,
  type TictactoeAction,
  type TictactoeState,
} from './engine.js'
export {
  CELL_LABEL_KEYS,
  HINT_GLYPH,
  HINT_TEXT_SCALE,
  MARK_GLYPHS,
  SIDE_FRAME,
  buildBoard,
  buildControls,
  buildStats,
  buildView,
  cellGlyphAt,
  cellKindAt,
  cellLabelKey,
  resultTitleKey,
  turnNoticeKey,
} from './view.js'

/** 三档难度只影响对手强度，规则完全相同；第四档是双人同屏 */
export const DIFFICULTIES = DIFFICULTY_IDS.map((id) => ({
  id,
  labelKey: difficultyLabelKey(id),
}))

/** 注册表用：井字棋没有关卡，内容是「难度档」，用它给「继续」定位 */
export const CONTENT_IDS: readonly string[] = DIFFICULTY_IDS

/**
 * 注册表用：进度按「赢过的三档难度 / 3」算。
 * 双人同屏**不计入进度** —— 那里没有「你」，无论谁赢都算不上玩家通关（与恶魔轮盘赌同一口径）。
 */
export function progressFor(completed: readonly string[]): { done: number; total: number } {
  return {
    done: OPPONENT_LEVELS.filter((id) => completed.includes(id)).length,
    total: OPPONENT_LEVELS.length,
  }
}

export function createTictactoeState(seed: number, difficulty: DifficultyId): TictactoeState {
  return createState(seed, difficulty)
}

export const tictactoeGame: GameDef<TictactoeState, TictactoeAction> = {
  id: TICTACTOE_ID,
  rulesVersion: TICTACTOE_RULES_VERSION,
  contentVersion: TICTACTOE_CONTENT_VERSION,
  i18nNamespace: TICTACTOE_ID,
  illegalNoticeKey: 'tictactoe.illegal.notice',
  difficulties: DIFFICULTIES,

  create(seed: number, difficultyId: string): TictactoeState {
    return createState(seed, difficultyOrThrow(difficultyId))
  },

  reduce(state: TictactoeState, action: TictactoeAction): TictactoeState {
    return reduceState(state, action)
  },

  legal(state: TictactoeState): readonly TictactoeAction[] {
    return legalActions(state)
  },

  selectAction(state: TictactoeState, index: number): TictactoeAction | null {
    return selectAction(state, index)
  },

  /**
   * 两拍式应手：玩家落子后先等 450ms 才亮出对手选中的格子，再隔 500ms 真正落子。
   * 只有「等对手应手」的中间态才返回值；双人同屏没有电脑，一律返回 null（一个定时器都不起）。
   */
  tickMs(state: TictactoeState): number | null {
    if (opponentLevel(state.difficulty) === null) return null
    if (turnOf(state) !== SECOND) return null
    if (stateOutcome(state) !== null) return null // 玩家这一手直接终局：没有应手
    return state.opponentPick === null ? REPLY_DELAY_MS : PICK_TO_MOVE_MS
  },

  /*
   * 这两拍走的是**对手**的应手：等待期间玩家再点棋盘不该把对手的思考一直往后推
   * （实测连点 3.6 秒，电脑一步不走）。壳层只在「刚刚轮到对手」的那一次重置计时。
   */
  tickActor: 'opponent',

  /**
   * 真实结果（对局存在和局，必须如实上报）：
   * `status()` 把和局并入 `won`（否则壳层不认为对局结束、结果面板不出来），
   * 但和局不是通关 —— 壳层据此不写 completed / bestMoves，历史记录只记「未获胜」。
   *
   * 双人同屏没有「你」这个视角：无论谁赢都不算玩家通关，一律按 `draw` 上报
   * （只留一条历史记录，标题由 view 如实写「玩家一获胜 / 玩家二获胜 / 和局」）。
   */
  outcomeOf(state: TictactoeState): 'won' | 'lost' | 'draw' {
    if (opponentLevel(state.difficulty) === null) return 'draw'
    const outcome: Outcome | null = stateOutcome(state)
    if (outcome === 'second') return 'lost'
    if (outcome === 'draw') return 'draw'
    return 'won'
  },

  /** 「提示」是游戏自己的按钮（壳层不认识它），必须由游戏说明点下去派发什么动作 */
  controlAction(_state: TictactoeState, controlId: string): TictactoeAction | null {
    if (controlId === 'hint') return { type: 'hint' }
    if (controlId === 'undo') return { type: 'undo' }
    if (controlId === 'restart') return { type: 'restart' }
    return null
  },

  /** 无关卡玩法：用难度作为内容 id，通关记录与「继续」定位都按难度归类 */
  contentId(state: TictactoeState): string {
    return state.difficulty
  },

  /** 计步：本局总手数（最少手数 = 最快取胜，「该难度最少 N 手」按它记） */
  movesOf(state: TictactoeState): number {
    return movesOf(state)
  },

  status(state: TictactoeState) {
    return gameStatus(state)
  },

  view(state: TictactoeState) {
    return buildView(state)
  },

  controls(state: TictactoeState) {
    return buildControls(state)
  },

  encode(state: TictactoeState): unknown {
    return encodeState(state)
  },

  decode(raw: unknown): TictactoeState {
    return decodeState(raw)
  },
}
