/**
 * 推箱子的 GameDef 实现 —— 游戏盒子唯一需要认识的东西。
 *
 * 重要约束：
 * - 规则层没有随机性，因此 `create` 忽略 seed（内容固定的关卡包）；参数保留是为了满足统一契约。
 * - `status` 用「当前局面是否已解」判定；过关后由会话决定进入下一关。
 * - `decode` 严格校验存档内容，非法存档会被明确拒绝（对应 F01「拒绝损坏或非法存档」）。
 */
import { IllegalActionError, type GameDef, type GameStatus } from '@eink/core'
import { DIFFICULTY_IDS, type DifficultyId } from './level.js'
import { buildControls, buildView, levelOrThrow } from './view.js'
import {
  derive,
  legal,
  reduceOnLevel,
  type SokobanAction,
  type SokobanState,
} from './rules.js'
import { firstLevelId, nextLevelId, PACK } from './pack.js'

// 壳层需要的公开面：文案、关卡包、进度摘要（壳不感知游戏内部实现）
export { sokobanEn, sokobanZh } from './i18n.js'
export {
  PACK,
  firstLevelId,
  isLastLevel,
  levelById,
  levelsFor,
  nextLevelId,
  packProgress,
  type SokobanLevel,
} from './pack.js'
export { buildControls, buildView, cellKindAt, progressSummary } from './view.js'
export {
  ALL_DIRS,
  parseLevel,
  ROOM_TEMPLATES,
  DIFFICULTY_IDS,
  CELL_FLOOR,
  CELL_GOAL,
  CELL_WALL,
  dirDelta,
  isGoal,
  isWall,
  oppositeDir,
  type DifficultyId,
  type LevelDef,
  type ParsedLevel,
} from './level.js'
export {
  applyMove,
  derive,
  isLegal,
  legal,
  reduceOnLevel,
  type Position,
  type SokobanAction,
  type SokobanState,
} from './rules.js'
export { generateLevel, type GenerateOptions, type GeneratedLevelResult } from './generate.js'
/** 关卡内容与生成时的见证解法（见证解法只用于校验与测试，不作为游戏内提示功能） */
export { LEVEL_DEFS, LEVEL_WITNESSES } from './levels.js'

export const SOKOBAN_ID = 'sokoban'
export const SOKOBAN_RULES_VERSION = 1
export const SOKOBAN_CONTENT_VERSION = 1

function asDifficulty(value: string): DifficultyId {
  if ((DIFFICULTY_IDS as readonly string[]).includes(value)) return value as DifficultyId
  throw new IllegalActionError(SOKOBAN_ID, `unknown difficulty ${value}`)
}

export function createSokobanState(difficulty: DifficultyId): SokobanState {
  return { difficulty, levelId: firstLevelId(difficulty), log: [] }
}

export function reduceWithLevel(
  levelId: string,
  state: SokobanState,
  action: SokobanAction,
): SokobanState {
  const level = levelOrThrow(levelId)
  return reduceOnLevel(level.parsed, state, action, nextLevelId(levelId))
}

export const sokobanGame: GameDef<SokobanState, SokobanAction> = {
  id: SOKOBAN_ID,
  rulesVersion: SOKOBAN_RULES_VERSION,
  contentVersion: SOKOBAN_CONTENT_VERSION,
  i18nNamespace: 'sokoban',
  illegalNoticeKey: 'sokoban.blocked',
  difficulties: DIFFICULTY_IDS.map((id) => ({ id, labelKey: `sokoban.difficulty.${id}` })),

  create(_seed: number, difficultyId: string): SokobanState {
    return createSokobanState(asDifficulty(difficultyId))
  },

  reduce(state: SokobanState, action: SokobanAction): SokobanState {
    return reduceWithLevel(state.levelId, state, action)
  },

  legal(state: SokobanState): readonly SokobanAction[] {
    const level = levelOrThrow(state.levelId)
    return legal(level.parsed, derive(level.parsed, state.log))
  },

  status(state: SokobanState): GameStatus {
    const level = levelOrThrow(state.levelId)
    return derive(level.parsed, state.log).solved ? 'won' : 'playing'
  },

  view(state: SokobanState) {
    return buildView(levelOrThrow(state.levelId), state)
  },

  controls(state: SokobanState) {
    const level = levelOrThrow(state.levelId)
    return buildControls(level.parsed, derive(level.parsed, state.log))
  },

  encode(state: SokobanState): unknown {
    return { difficulty: state.difficulty, levelId: state.levelId, log: state.log }
  },

  decode(raw: unknown): SokobanState {
    if (!raw || typeof raw !== 'object') throw new IllegalActionError(SOKOBAN_ID, 'bad state')
    const value = raw as Partial<SokobanState>
    if (typeof value.levelId !== 'string' || typeof value.difficulty !== 'string') {
      throw new IllegalActionError(SOKOBAN_ID, 'bad state fields')
    }
    if (!Array.isArray(value.log)) throw new IllegalActionError(SOKOBAN_ID, 'bad log')
    const difficulty = asDifficulty(value.difficulty)
    if (!PACK.some((level) => level.def.id === value.levelId)) {
      throw new IllegalActionError(SOKOBAN_ID, `unknown level ${value.levelId}`)
    }
    const log = value.log as SokobanAction[]
    for (const action of log) {
      if (!action || typeof action !== 'object' || typeof action.type !== 'string') {
        throw new IllegalActionError(SOKOBAN_ID, 'bad action in log')
      }
    }
    const state: SokobanState = { difficulty, levelId: value.levelId, log }
    // 立刻重放一次：非法或损坏的日志在这里就会暴露
    derive(levelOrThrow(state.levelId).parsed, state.log)
    return state
  },
}
