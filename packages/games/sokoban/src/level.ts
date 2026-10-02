/**
 * 推箱子关卡：数据格式、解析与校验。
 *
 * 关卡文本使用推箱子通用字符：'#' 墙、' ' 地板、'.' 目标点、'$' 箱子、'*' 箱在目标、
 * '@' 玩家、'+' 玩家在目标。
 *
 * 内容来源要求（对应 A03）：本仓库的关卡全部是**自制**的 —— 由 `generate.ts` 从固定房间
 * 模板 + 固定种子反向生成（反向生成天然可解，前向解法就是反向序列的逆序），
 * 并由 `test/levels.test.ts` 用独立求解器逐关复核。因此不存在第三方题库授权问题。
 */

export type MoveDir = 'up' | 'down' | 'left' | 'right'
export type DifficultyId = 'starter' | 'skilled' | 'challenging'

export const DIFFICULTY_IDS: readonly DifficultyId[] = ['starter', 'skilled', 'challenging']

/** 网格单元标志位（静态部分） */
export const CELL_FLOOR = 0
export const CELL_WALL = 1
export const CELL_GOAL = 2

export interface ParsedLevel {
  id: string
  cols: number
  rows: number
  /** 静态网格，长度 cols*rows，取值为 CELL_* 的按位组合 */
  staticGrid: Uint8Array
  /** 起始玩家位置 */
  startPlayer: number
  /** 起始箱子位置（升序） */
  startBoxes: readonly number[]
  goalCount: number
}

export interface LevelDef {
  id: string
  difficulty: DifficultyId
  /** 行优先的行文本 */
  grid: string[]
  source: {
    kind: 'generated'
    roomId: string
    seed: number
    unpushSteps: number
  }
}

export class LevelFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LevelFormatError'
  }
}

export function parseLevel(def: LevelDef): ParsedLevel {
  const grid = def.grid
  if (grid.length === 0) throw new LevelFormatError(`${def.id}: empty grid`)
  const rows = grid.length
  const cols = Math.max(...grid.map((row) => row.length))
  const staticGrid = new Uint8Array(cols * rows)
  let startPlayer = -1
  const boxes: number[] = []
  let goalCount = 0

  for (let y = 0; y < rows; y++) {
    const row = grid[y]!
    if (row.length !== cols) {
      throw new LevelFormatError(`${def.id}: row ${y} has length ${row.length}, expected ${cols}`)
    }
    for (let x = 0; x < cols; x++) {
      const ch = row[x]!
      const index = y * cols + x
      switch (ch) {
        case '#':
          staticGrid[index] = CELL_WALL
          break
        case ' ':
          break
        case '.':
          staticGrid[index] = CELL_GOAL
          goalCount++
          break
        case '$':
          boxes.push(index)
          break
        case '*':
          staticGrid[index] = CELL_GOAL
          goalCount++
          boxes.push(index)
          break
        case '@':
          if (startPlayer >= 0) throw new LevelFormatError(`${def.id}: multiple players`)
          startPlayer = index
          break
        case '+':
          if (startPlayer >= 0) throw new LevelFormatError(`${def.id}: multiple players`)
          startPlayer = index
          staticGrid[index] = CELL_GOAL
          goalCount++
          break
        default:
          throw new LevelFormatError(`${def.id}: unknown char ${JSON.stringify(ch)} at ${x},${y}`)
      }
    }
  }

  if (startPlayer < 0) throw new LevelFormatError(`${def.id}: missing player`)
  if (boxes.length === 0) throw new LevelFormatError(`${def.id}: no boxes`)
  if (boxes.length !== goalCount) {
    throw new LevelFormatError(`${def.id}: ${boxes.length} boxes vs ${goalCount} goals`)
  }
  // 外圈必须是墙：避免玩家走到棋盘外
  for (let x = 0; x < cols; x++) {
    if (staticGrid[x] !== CELL_WALL || staticGrid[(rows - 1) * cols + x] !== CELL_WALL) {
      throw new LevelFormatError(`${def.id}: top/bottom border must be walls`)
    }
  }
  for (let y = 0; y < rows; y++) {
    if (staticGrid[y * cols] !== CELL_WALL || staticGrid[y * cols + cols - 1] !== CELL_WALL) {
      throw new LevelFormatError(`${def.id}: left/right border must be walls`)
    }
  }

  return {
    id: def.id,
    cols,
    rows,
    staticGrid,
    startPlayer,
    startBoxes: boxes.sort((a, b) => a - b),
    goalCount,
  }
}

export function isWall(level: ParsedLevel, index: number): boolean {
  return (level.staticGrid[index]! & CELL_WALL) !== 0
}

export function isGoal(level: ParsedLevel, index: number): boolean {
  return (level.staticGrid[index]! & CELL_GOAL) !== 0
}

export function dirDelta(dir: MoveDir, cols: number): number {
  switch (dir) {
    case 'up':
      return -cols
    case 'down':
      return cols
    case 'left':
      return -1
    case 'right':
      return 1
  }
}

export function oppositeDir(dir: MoveDir): MoveDir {
  switch (dir) {
    case 'up':
      return 'down'
    case 'down':
      return 'up'
    case 'left':
      return 'right'
    case 'right':
      return 'left'
  }
}

export const ALL_DIRS: readonly MoveDir[] = ['up', 'down', 'left', 'right']

/**
 * 反向生成用的房间模板：只允许 '#' 墙、' ' 地板、'.' 目标点（不含箱子与玩家）。
 * 全部自绘，不含任何第三方关卡数据。
 */
export const ROOM_TEMPLATES: ReadonlyArray<{ id: string; grid: string[] }> = [
  {
    id: 'nook',
    grid: [
      '#######',
      '#     #',
      '#  .  #',
      '#  #  #',
      '#  .  #',
      '#     #',
      '#######',
    ],
  },
  {
    id: 'twin',
    grid: [
      '########',
      '#      #',
      '# .  . #',
      '#      #',
      '# #  # #',
      '# .    #',
      '#      #',
      '########',
    ],
  },
  {
    id: 'pillars',
    grid: [
      '#########',
      '#       #',
      '#  . .  #',
      '#  ###  #',
      '#   .   #',
      '#  ###  #',
      '#   .   #',
      '#       #',
      '#########',
    ],
  },
  {
    id: 'island',
    grid: [
      '##########',
      '#        #',
      '#  .##.  #',
      '#   ##   #',
      '#  .##.  #',
      '#        #',
      '##########',
    ],
  },
  {
    id: 'pockets',
    grid: [
      '###########',
      '#         #',
      '#  .   .  #',
      '#         #',
      '#   ###   #',
      '#   .#.   #',
      '#   ###   #',
      '#  .   .  #',
      '###########',
    ],
  },
  {
    id: 'hall',
    grid: [
      '###########',
      '#         #',
      '#  .   .  #',
      '#         #',
      '#   ###   #',
      '#         #',
      '#   ###   #',
      '#  .   .  #',
      '###########',
    ],
  },
]

/** 生成用房间只允许静态字符（无箱子/玩家），这里做一次严格校验 */
export function assertRoomTemplate(grid: string[]): void {
  for (const row of grid) {
    for (const ch of row) {
      if (ch !== '#' && ch !== ' ' && ch !== '.') {
        throw new LevelFormatError(`room template contains dynamic char ${JSON.stringify(ch)}`)
      }
    }
  }
}
