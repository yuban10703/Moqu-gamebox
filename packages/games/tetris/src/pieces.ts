/**
 * 七种标准方块与旋转：纯数据 + 纯函数，无随机、无平台依赖。
 *
 * 旋转用「方框内旋转」实现：每种方块有一个方框（I 用 4×4、O 用 2×2、其余 3×3），
 * 顺时针 90° 就是方框内的 (row, col) → (col, box-1-row)。
 * 这样 7 种形状只需要写**一份出生朝向**，四种朝向由同一段代码推出来 ——
 * 手写 4 份朝向时漏改一角是这类玩法的经典缺陷。
 *
 * 注意：这不是 SRS。本项目只需要「形状本身不同」，不需要 SRS 的踢墙表；
 * 贴墙旋转的可玩性由 rules 里的左右微调兜住（见 ROTATE_KICKS）。
 */

export type PieceId = 'I' | 'J' | 'L' | 'O' | 'S' | 'T' | 'Z'

/** 固定顺序：出块序列、legal/controls 的输出顺序都依赖它，改动等于改规则 */
export const ALL_PIECES: readonly PieceId[] = ['I', 'J', 'L', 'O', 'S', 'T', 'Z']

export type Rotation = 0 | 1 | 2 | 3

export const ROTATIONS: readonly Rotation[] = [0, 1, 2, 3]

/** 方框内坐标（行, 列），行 0 在方框顶部 */
export type CellOffset = readonly [row: number, col: number]

interface PieceSpec {
  /** 旋转方框的边长 */
  readonly box: number
  /** 出生朝向占用的 4 个格子（方框内坐标） */
  readonly spawn: readonly CellOffset[]
}

/**
 * 出生朝向（与经典俄罗斯方块一致：I 横在最上一排、其余平铺在前两排）。
 * I 放在 4×4 方框的第 1 行而不是第 0 行：这样它的水平/垂直朝向都跨在方框中心两侧，
 * 贴左右墙时不会因为「转了以后整体偏出去」而必然失败。
 */
export const PIECE_SPECS: Readonly<Record<PieceId, PieceSpec>> = {
  I: { box: 4, spawn: [[1, 0], [1, 1], [1, 2], [1, 3]] },
  J: { box: 3, spawn: [[0, 0], [1, 0], [1, 1], [1, 2]] },
  L: { box: 3, spawn: [[0, 2], [1, 0], [1, 1], [1, 2]] },
  O: { box: 2, spawn: [[0, 0], [0, 1], [1, 0], [1, 1]] },
  S: { box: 3, spawn: [[0, 1], [0, 2], [1, 0], [1, 1]] },
  T: { box: 3, spawn: [[0, 1], [1, 0], [1, 1], [1, 2]] },
  Z: { box: 3, spawn: [[0, 0], [0, 1], [1, 1], [1, 2]] },
}

export function isPieceId(value: unknown): value is PieceId {
  return typeof value === 'string' && (ALL_PIECES as readonly string[]).includes(value)
}

export function isRotation(value: unknown): value is Rotation {
  return value === 0 || value === 1 || value === 2 || value === 3
}

/** 方框边长：出生居中和存档校验都用它 */
export function boxOf(id: PieceId): number {
  return PIECE_SPECS[id].box
}

function rotateClockwise(cells: readonly CellOffset[], box: number): CellOffset[] {
  return cells.map(([row, col]) => [col, box - 1 - row] as CellOffset)
}

/**
 * 指定朝向下 4 个格子的方框内坐标（按行、列排序，输出稳定 —— 测试与 encode 依赖它）。
 * 不做缓存：每次最多 3 次旋转、4 个格子，纯函数比缓存更好推理。
 */
export function cellsOf(id: PieceId, rot: Rotation): CellOffset[] {
  let cells: readonly CellOffset[] = PIECE_SPECS[id].spawn
  const box = PIECE_SPECS[id].box
  for (let step = 0; step < rot; step++) cells = rotateClockwise(cells, box)
  return [...cells].sort((a, b) => a[0] - b[0] || a[1] - b[1])
}

/** 下一个朝向（0→1→2→3→0） */
export function nextRotation(rot: Rotation): Rotation {
  return ((rot + 1) % 4) as Rotation
}
