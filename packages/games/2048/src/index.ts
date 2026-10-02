/**
 * 2048 的 GameDef 实现 —— 游戏盒子唯一需要认识的东西。
 *
 * 与推箱子一致的约定：
 * - `create` 的随机性只来自 seed（seed + 随机游标，见 rules.ts）；
 * - `reduce` 是纯函数，无变化的移动抛 IllegalActionError，由会话给出明确文字反馈；
 * - `decode` 严格校验存档，坏数据一律拒绝（F01「拒绝损坏或非法存档」）；
 * - `view` / `controls` 只产出黑白可读的展示模型，不含灰阶与动画。
 */
import { type GameDef, type GameStatus } from '@eink/core'
import {
  DIFFICULTIES,
  DIFFICULTY_IDS,
  GAME_2048_ID,
  createState,
  decodeState,
  encodeState,
  legalActions,
  reduceState,
  statusOf,
  type Game2048Action,
  type Game2048State,
} from './rules.js'
import { buildControls, buildView } from './view.js'

// 壳层需要的公开面：文案、展示构建器、注册表辅助
export { game2048En, game2048Zh } from './i18n.js'
export {
  buildBoard,
  buildControls,
  buildStats,
  buildView,
  cellLabelKey,
  CELL_LABEL_KEYS,
  contentIdOf,
  progressFor,
} from './view.js'
export {
  ALL_DIRS,
  applyMove,
  canMove,
  createState,
  decodeState,
  DIFFICULTIES,
  DIFFICULTY_IDS,
  difficultyOf,
  DRAWS_PER_SPAWN,
  emptyBoard,
  encodeState,
  GAME_2048_ID,
  isLegal,
  isTileValue,
  legalActions,
  lineCellIndex,
  maxTile,
  reduceState,
  slideLine,
  spawnTile,
  SPAWN_FOUR_RATE,
  statusOf,
  type Difficulty2048,
  type DifficultyId,
  type EncodedSnapshot,
  type EncodedState,
  type Game2048Action,
  type Game2048State,
  type MoveOutcome,
  type SlideOutcome,
  type Snapshot,
  type SpawnOutcome,
} from './rules.js'

export const GAME_2048_RULES_VERSION = 1
export const GAME_2048_CONTENT_VERSION = 1

/** 注册表用：2048 没有关卡，内容是「难度档」，用它给「继续」定位 */
export const CONTENT_IDS: readonly string[] = DIFFICULTY_IDS

/** 注册表用：内容在列表中的下标（找不到时回退到第一档） */
export function contentIndex(id: string): number {
  const index = (DIFFICULTY_IDS as readonly string[]).indexOf(id)
  return index >= 0 ? index : 0
}

export const game2048: GameDef<Game2048State, Game2048Action> = {
  id: GAME_2048_ID,
  rulesVersion: GAME_2048_RULES_VERSION,
  contentVersion: GAME_2048_CONTENT_VERSION,
  i18nNamespace: GAME_2048_ID,
  illegalNoticeKey: '2048.blocked',
  difficulties: DIFFICULTIES.map((spec) => ({
    id: spec.id,
    labelKey: `2048.difficulty.${spec.id}`,
  })),

  create(seed: number, difficultyId: string): Game2048State {
    return createState(seed, difficultyId)
  },

  reduce(state: Game2048State, action: Game2048Action): Game2048State {
    return reduceState(state, action)
  },

  legal(state: Game2048State): readonly Game2048Action[] {
    return legalActions(state)
  },

  /** 内容 id = 难度 id：2048 没有关卡，过关进度与「最佳」按难度记录 */
  contentId(state: Game2048State): string {
    return state.difficulty
  },

  /** 计步：结果面板/KPI 的「最佳成绩」用最少步数表示 */
  movesOf(state: Game2048State): number {
    return state.moves
  },

  status(state: Game2048State): GameStatus {
    return statusOf(state)
  },

  view(state: Game2048State) {
    return buildView(state)
  },

  controls(state: Game2048State) {
    return buildControls(state)
  },

  encode(state: Game2048State): unknown {
    return encodeState(state)
  },

  decode(raw: unknown): Game2048State {
    return decodeState(raw)
  },
}
