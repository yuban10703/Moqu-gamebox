/**
 * 测试夹具与**独立实现**的线性代数求解器。
 *
 * 「必定可解」不能只靠「打乱方式自证」：这里用 GF(2) 高斯消元独立判断
 * 「是否存在一组十字翻转能把当前亮灯图案打成全灭」。关灯游戏并不是所有局面都有解
 * （5×5 的方程矩阵秩为 23 < 25），所以这个独立判据是有区分度的。
 */
import { configFor, createState, type DifficultyId, type LightsOutState } from '../src/index.js'

/** 真实初始谜题（由 seed + 难度确定性生成） */
export function fresh(seed = 20240607, difficulty: DifficultyId = 'starter'): LightsOutState {
  return createState(seed, difficulty)
}

/** 由棋盘长度反推难度（5×5 默认 starter；6×6 是 challenging） */
export function difficultyOfLights(lights: readonly boolean[]): DifficultyId {
  return lights.length === 36 ? 'challenging' : 'starter'
}

/** 直接构造一个指定亮灯图案的状态（跳过打乱与 decode 的严格校验，专门断言翻转语义） */
export function fixtureState(
  lights: readonly boolean[],
  overrides: Partial<LightsOutState> = {},
): LightsOutState {
  const difficulty = overrides.difficulty ?? difficultyOfLights(lights)
  return {
    difficulty,
    seed: 1,
    rngCursor: 0,
    lights: [...lights],
    moves: 0,
    history: [],
    ...overrides,
  }
}

/** 全灭（已解）图案的便捷构造 */
export function allOff(size: number): boolean[] {
  return new Array<boolean>(size * size).fill(false)
}

/** 独立实现的十字邻域（不复用 src，避免求解器与规则同源） */
function crossOf(index: number, size: number): number[] {
  const out = [index]
  const row = Math.floor(index / size)
  const col = index % size
  if (row > 0) out.push(index - size)
  if (row < size - 1) out.push(index + size)
  if (col > 0) out.push(index - 1)
  if (col < size - 1) out.push(index + 1)
  return out
}

/**
 * GF(2) 高斯消元：求一组 toggle 变量 x 使 A·x = b（b = 亮灯向量）。
 * 返回需要翻转的格子索引（自由变量取 0）；无解返回 null。
 *
 * 方程 i（格子 i）的系数：变量 j 的翻转会作用于格子 i ⇔ j 在 i 的十字邻域里。
 */
export function solveLightsOut(lights: readonly boolean[], size: number): number[] | null {
  const total = size * size
  const rows: number[][] = []
  for (let cell = 0; cell < total; cell++) {
    const row = new Array<number>(total + 1).fill(0)
    for (const target of crossOf(cell, size)) row[target] = 1
    row[total] = lights[cell] ? 1 : 0
    rows.push(row)
  }
  let pivot = 0
  const pivotRowOfColumn = new Array<number>(total).fill(-1)
  for (let col = 0; col < total && pivot < total; col++) {
    let selected = -1
    for (let row = pivot; row < total; row++) {
      if (rows[row]![col] === 1) {
        selected = row
        break
      }
    }
    if (selected === -1) continue
    const swap = rows[pivot]!
    rows[pivot] = rows[selected]!
    rows[selected] = swap
    pivotRowOfColumn[col] = pivot
    for (let row = 0; row < total; row++) {
      if (row === pivot || rows[row]![col] === 0) continue
      for (let c = col; c <= total; c++) rows[row]![c] ^= rows[pivot]![c]
    }
    pivot += 1
  }
  // 剩下全 0 的行若右端为 1 ⇒ 矛盾，无解
  for (let row = pivot; row < total; row++) {
    if (rows[row]![total] === 1) return null
  }
  const solution: number[] = []
  for (let col = 0; col < total; col++) {
    const row = pivotRowOfColumn[col]!
    if (row >= 0 && rows[row]![total] === 1) solution.push(col)
  }
  return solution
}

/** 该难度的棋盘尺寸（断言里反复用） */
export function sizeOf(difficulty: DifficultyId): number {
  return configFor(difficulty).size
}
