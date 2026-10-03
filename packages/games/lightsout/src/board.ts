/**
 * 关灯游戏的棋盘模型：十字翻转、确定性打乱与**构造性可解**。
 *
 * 为什么打乱要「从全灭局面随机翻转」：
 * 十字翻转是**对合运算**（翻两次等于没翻），所以「把打乱步骤原样再翻一遍」必然回到全灭 ——
 * 这给出了一条现成的解，不需要任何求解器就能保证每道谜题都可解。
 * 反过来，如果直接随机生成亮灯图案，大约只有 1/4 的局面有解，玩家会碰到死局。
 *
 * 随机性全部来自 core 的 createRng(seed)，绝不使用 Math.random：
 * 同 seed + 同难度必然得到同一道谜题。
 */
import { IllegalActionError, createRng } from '@eink/core'

export const GAME_ID = 'lightsout'

export const DIFFICULTY_IDS = ['starter', 'skilled', 'challenging'] as const

export type DifficultyId = (typeof DIFFICULTY_IDS)[number]

export interface BoardConfig {
  readonly size: number
  /** 打乱用的随机翻转次数：次数越多，谜题通常离全灭越远 */
  readonly scrambleSteps: number
}

export const DIFFICULTIES: Record<DifficultyId, BoardConfig> = {
  // 5×5 两档只差打乱程度：熟练档翻得更多，解法通常更长
  starter: { size: 5, scrambleSteps: 6 },
  skilled: { size: 5, scrambleSteps: 12 },
  challenging: { size: 6, scrambleSteps: 20 },
}

export function isDifficultyId(value: string): value is DifficultyId {
  return (DIFFICULTY_IDS as readonly string[]).includes(value)
}

export function difficultyOrThrow(value: string): DifficultyId {
  if (!isDifficultyId(value)) throw new IllegalActionError(GAME_ID, `unknown difficulty ${value}`)
  return value
}

export function configFor(difficulty: DifficultyId): BoardConfig {
  return DIFFICULTIES[difficulty]
}

export function cellCount(config: BoardConfig): number {
  return config.size * config.size
}

/** 种子归一化成 uint32：负数/小数/NaN 都不会破坏「同 seed 同谜题」 */
export function normalizeSeed(seed: number): number {
  return Number.isFinite(seed) ? Math.trunc(seed) >>> 0 : 0
}

export function rowOf(index: number, size: number): number {
  return Math.floor(index / size)
}

export function colOf(index: number, size: number): number {
  return index % size
}

export function indexOf(row: number, col: number, size: number): number {
  return row * size + col
}

/**
 * 十字影响的格子：自身 + 上下左右（越界丢弃），顺序固定为 [自身, 上, 下, 左, 右]。
 * 角落 3 格、边 4 格、内部 5 格 —— 这正是「角/边翻转范围更小」的规则来源。
 */
export function crossIndexes(index: number, size: number): number[] {
  const out: number[] = [index]
  const row = rowOf(index, size)
  const col = colOf(index, size)
  if (row > 0) out.push(index - size)
  if (row < size - 1) out.push(index + size)
  if (col > 0) out.push(index - 1)
  if (col < size - 1) out.push(index + 1)
  return out
}

/** 翻转 index 及其十字邻域的灯；返回新数组，不改原数组 */
export function toggleCross(lights: readonly boolean[], size: number, index: number): boolean[] {
  const next = lights.slice()
  for (const target of crossIndexes(index, size)) next[target] = !next[target]
  return next
}

export function isAllOff(lights: readonly boolean[]): boolean {
  return lights.every((lit) => !lit)
}

export function litCount(lights: readonly boolean[]): number {
  let count = 0
  for (const lit of lights) if (lit) count += 1
  return count
}

export interface Puzzle {
  /** 打乱后的亮灯图案（true = 亮） */
  readonly lights: boolean[]
  /** 打乱实际翻转的格子序列（按顺序）；按同样的序列再翻一遍即可回到全灭 */
  readonly toggles: readonly number[]
  /** 打乱消耗的随机数个数（含「打乱回全灭后退回重打」的次数），存档据此复核初始谜题 */
  readonly cursor: number
}

/** 重打上限：随机翻转走回全灭的概率极低，留一点余量即可，超出说明实现有问题 */
const MAX_SCRAMBLE_ATTEMPTS = 16
/** 重打时换一条随机流的盐：让第 k 次尝试彼此独立，同时保持完全确定性 */
const RETRY_SALT = 0x9e3779b9

/**
 * 从全灭局面出发做 scrambleSteps 次随机十字翻转。
 *
 * - 随机源只用 core 的 createRng（绝不用 Math.random）；
 * - 每一步排除上一步的格子：翻同一个格子两次等于没翻，白白浪费一步；
 * - 打乱后若恰好还是全灭局面，**退回重打**（换一条随机流），
 *   因此调用方拿到的谜题保证可解、且保证不是一上来就已经解开的局面。
 */
export function scramblePlan(config: BoardConfig, seed: number): Puzzle {
  const { size, scrambleSteps } = config
  const total = cellCount(config)
  for (let attempt = 0; attempt < MAX_SCRAMBLE_ATTEMPTS; attempt++) {
    const rng = createRng(normalizeSeed(seed) + attempt * RETRY_SALT)
    let lights = new Array<boolean>(total).fill(false)
    const toggles: number[] = []
    let previous = -1
    for (let step = 0; step < scrambleSteps; step++) {
      const candidates: number[] = []
      for (let index = 0; index < total; index++) {
        // 1×1 棋盘没有「别的格子」可选，只能允许重复
        if (index !== previous || total === 1) candidates.push(index)
      }
      const picked = candidates[rng.int(candidates.length)]!
      lights = toggleCross(lights, size, picked)
      toggles.push(picked)
      previous = picked
    }
    if (!isAllOff(lights)) {
      return { lights, toggles, cursor: scrambleSteps * (attempt + 1) }
    }
  }
  // 固定随机流下连续多次都翻回全灭：明确报错而不是返回一道已解开的谜题
  throw new IllegalActionError(GAME_ID, 'scramble failed to leave the solved position')
}

/** 初始亮灯图案（只关心图案时的便捷入口） */
export function createLights(config: BoardConfig, seed: number): boolean[] {
  return scramblePlan(config, seed).lights
}

/** 依次翻转给定的格子；用于 decode 复核存档与测试里的「逆序回放」 */
export function replay(
  lights: readonly boolean[],
  size: number,
  toggles: readonly number[],
): boolean[] {
  let current = lights.slice()
  for (const index of toggles) current = toggleCross(current, size, index)
  return current
}
