/**
 * 贪吃蛇的 GameDef 实现 —— 游戏盒子唯一需要认识的东西。
 *
 * 与 2048 / 扫雷一致的约定：
 * - `create` 的随机性只来自 seed（seed + 随机游标，见 rules.ts），禁止 Math.random；
 * - `reduce` 是纯函数：非法动作（原地掉头、已结束还走、没有可撤销的步骤）抛 IllegalActionError，
 *   由会话用 illegalNoticeKey 给出明确文字反馈，而不是静默无响应；
 * - `decode` 严格校验存档，坏数据一律拒绝（F01「拒绝损坏或非法存档」）；
 * - `view` / `controls` 只产出黑白可读的展示模型，不含灰阶、不含动画、不含定时器。
 *
 * 自动前进：本作声明 `tickMs`（见 meta.ts 的取值依据），壳层到点派发 `{ type: 'tick' }`；
 * 规则层本身仍然零时间引用，`{ type: 'tick' }` 就是一次普普通通的动作。
 */
import type { GameDef, GameStatus } from '@eink/core'
import {
  DIFFICULTY_IDS,
  SNAKE_CONTENT_VERSION,
  SNAKE_ID,
  SNAKE_RULES_VERSION,
  difficultyOrThrow,
  difficultySpec,
  type DifficultyId,
} from './meta.js'
import {
  ALL_DIRS,
  createState,
  decodeState,
  encodeState,
  gameStatus,
  legalActions,
  reduceState,
  type SnakeAction,
  type SnakeState,
} from './rules.js'
import { buildControls, buildView } from './view.js'

// 壳层需要的公开面：文案、展示构件、规则（壳不感知游戏内部拆分）
export { snakeEn, snakeGlyph, snakeZh } from './i18n.js'
export {
  DIFFICULTIES,
  DIFFICULTY_IDS,
  SNAKE_CONTENT_VERSION,
  SNAKE_ID,
  SNAKE_RULES_VERSION,
  difficultyLabelKey,
  difficultyOrThrow,
  difficultySpec,
  isDifficultyId,
  type DifficultyId,
  type SnakeDifficulty,
} from './meta.js'
export {
  ALL_DIRS,
  DIR_DELTA,
  DRAWS_PER_FOOD,
  INITIAL_LENGTH,
  MAX_HISTORY_ENTRIES,
  NO_FOOD,
  OPPOSITE_DIR,
  canUndo,
  coordsOf,
  createState,
  decodeState,
  directionBetween,
  directionOf,
  encodeState,
  freeCellCount,
  gameStatus,
  indexOf,
  initialBody,
  isAutoEntry,
  isLegal,
  legalActions,
  placeFood,
  placeObstacles,
  reduceState,
  reservedCells,
  wrapCoord,
  type Coords,
  type EncodedSnakeDeath,
  type EncodedSnakeState,
  type EncodedSnakeStep,
  type EncodedSnakeTurn,
  type EncodedSnakeUndoEntry,
  type FoodPlacement,
  type ObstaclePlacement,
  type SnakeAction,
  type SnakeState,
  type SnakeUndoEntry,
} from './rules.js'
export {
  CELL_GLYPHS,
  CELL_LABEL_KEYS,
  buildBoard,
  buildControls,
  buildStats,
  buildView,
  cellGlyphAt,
  cellKindAt,
  contentIdOf,
  progressFor,
} from './view.js'

export function createSnakeState(seed: number, difficultyId: string): SnakeState {
  // 种子归一化成 uint32：负数/小数/NaN 都不会破坏「同 seed 同结果」
  const normalized = Number.isFinite(seed) ? Math.trunc(seed) >>> 0 : 0
  return createState(normalized, difficultyOrThrow(difficultyId))
}

export const snakeGame: GameDef<SnakeState, SnakeAction> = {
  id: SNAKE_ID,
  rulesVersion: SNAKE_RULES_VERSION,
  contentVersion: SNAKE_CONTENT_VERSION,
  i18nNamespace: SNAKE_ID,
  illegalNoticeKey: 'snake.blocked',
  difficulties: DIFFICULTY_IDS.map((id: DifficultyId) => ({
    id,
    labelKey: `snake.difficulty.${id}`,
  })),

  create(seed: number, difficultyId: string): SnakeState {
    return createSnakeState(seed, difficultyId)
  },

  reduce(state: SnakeState, action: SnakeAction): SnakeState {
    return reduceState(state, action)
  },

  legal(state: SnakeState): readonly SnakeAction[] {
    return legalActions(state)
  },

  status(state: SnakeState): GameStatus {
    return gameStatus(state)
  },

  /**
   * 方向键的动作名由游戏自己说明（壳层优先走 controlAction）：
   * 方向按钮 = **转向**（写入下一个 tick 生效的缓冲方向，不再是「按一次走一格」）；
   * 撤销 / 重开也映射一次，壳层改走 controlAction 时不会失效。
   */
  controlAction(_state: SnakeState, controlId: string): SnakeAction | null {
    if (controlId === 'undo') return { type: 'undo' }
    if (controlId === 'restart') return { type: 'restart' }
    const dir = ALL_DIRS.find((candidate) => controlId === `move-${candidate}`)
    return dir ? { type: 'turn', dir } : null
  },

  /**
   * 自动前进的间隔：由难度声明（入门 850ms / 熟练 680ms / 挑战 520ms，依据见 meta.ts）。
   * 已结束一律返回 null —— 壳层据此停表，不留一个空转的定时器。
   */
  tickMs(state: SnakeState): number | null {
    if (gameStatus(state) !== 'playing') return null
    return difficultySpec(state.difficulty).tickMs
  },

  /** 无关卡玩法：用难度作为内容 id，这样完成记录与「继续」定位都按难度归类 */
  contentId(state: SnakeState): string {
    return state.difficulty
  },

  /** 计步：结果面板/KPI 的「最佳成绩」用最少步数表示 */
  movesOf(state: SnakeState): number {
    return state.moves
  },

  view(state: SnakeState) {
    return buildView(state)
  },

  controls(state: SnakeState) {
    return buildControls(state)
  },

  encode(state: SnakeState): unknown {
    return encodeState(state)
  },

  decode(raw: unknown): SnakeState {
    return decodeState(raw)
  },
}
