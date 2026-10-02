/**
 * 关卡生成器：从「已解」状态出发做随机**反向拉动**（un-push），得到天然可解的关卡。
 *
 * 原理：一次反向拉动是「正向推箱子」的逆操作。
 *   反向：玩家在 P，箱子在 P+d → 新状态：玩家在 P-d，箱子在 P。
 *   正向：玩家在 P-d，箱子在 P，按方向 d 推 → 玩家到 P，箱子到 P+d。
 * 因此把反向序列倒序读出，就是一份**合法的正向解法**（每一步都无需额外走动）。
 *
 * 生成是确定性的：同一个 (roomId, seed, unpushSteps) 任何时候都产出同一关卡与同一份解法见证，
 * 这使得 `test/levels.test.ts` 可以独立复算并复核已提交关卡的来源（对应 A03 可追溯要求）。
 */
import { createRng } from '@eink/core'
import {
  ALL_DIRS,
  CELL_GOAL,
  CELL_WALL,
  assertRoomTemplate,
  dirDelta,
  isGoal,
  isWall,
  oppositeDir,
  type LevelDef,
  type MoveDir,
  type ParsedLevel,
} from './level.js'

export interface GenerateOptions {
  roomId: string
  seed: number
  unpushSteps: number
}

export type GeneratedLevelResult =
  | { ok: true; grid: string[]; witness: MoveDir[] }
  | { ok: false; reason: string }

function parseRoom(grid: string[]): ParsedLevel {
  assertRoomTemplate(grid)
  const rows = grid.length
  const cols = grid[0]!.length
  const staticGrid = new Uint8Array(cols * rows)
  const goals: number[] = []
  for (let y = 0; y < rows; y++) {
    const row = grid[y]!
    for (let x = 0; x < cols; x++) {
      const index = y * cols + x
      if (row[x] === '#') staticGrid[index] = CELL_WALL
      else if (row[x] === '.') {
        staticGrid[index] = CELL_GOAL
        goals.push(index)
      }
    }
  }
  return {
    id: 'room',
    cols,
    rows,
    staticGrid,
    startPlayer: -1,
    startBoxes: goals,
    goalCount: goals.length,
  }
}

export function generateLevel(roomGrid: string[], options: GenerateOptions): GeneratedLevelResult {
  const room = parseRoom(roomGrid)
  const rng = createRng(options.seed)
  const goals = room.startBoxes as readonly number[]

  if (goals.length === 0) return { ok: false, reason: 'room has no goals' }

  // 起点 = 已解状态：所有箱子都在目标点上，玩家站在任意空地板格。
  // 反向生成过程中玩家可以自由走动（走路是可逆动作），只在需要时做一次「反向拉动」，
  // 这样即使房间很窄也能连续制造难度，而不是走两步就卡死。
  const freeCells: number[] = []
  for (let i = 0; i < room.staticGrid.length; i++) {
    if (!isWall(room, i) && !goals.includes(i)) freeCells.push(i)
  }
  if (freeCells.length === 0) return { ok: false, reason: 'no free cell for player' }

  const maxAttempts = 12
  let lastReason = 'no valid walk'

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const boxes = new Set<number>(goals)
    let player = rng.pick(freeCells)
    /** 反向过程的每一步「玩家移动方向」；把顺序倒放并把方向取反即为正向解法 */
    const reverseMoves: MoveDir[] = []
    let failed = false

    for (let step = 0; step < options.unpushSteps; step++) {
      const candidates: Array<{ box: number; dir: MoveDir; stand: number; land: number }> = []
      for (const box of boxes) {
        for (const dir of ALL_DIRS) {
          const delta = dirDelta(dir, room.cols)
          const stand = box - delta // 拉动时玩家站的位置
          const land = box - delta * 2 // 拉动后玩家落到/箱子移到 stand
          if (!inBounds(room, stand) || isWall(room, stand)) continue
          if (boxes.has(stand)) continue
          if (!inBounds(room, land) || isWall(room, land)) continue
          if (boxes.has(land)) continue
          const walk = walkPath(room, player, stand, boxes)
          if (!walk) continue
          candidates.push({ box, dir, stand, land })
        }
      }
      if (candidates.length === 0) {
        failed = true
        lastReason = `no un-push available at step ${step}`
        break
      }
      const choice = rng.pick(candidates)
      const walk = walkPath(room, player, choice.stand, boxes)!
      reverseMoves.push(...walk)
      // 反向拉动：玩家从 stand 移动到 land（即 -dir 方向），箱子从 box 移到 stand
      reverseMoves.push(oppositeDir(choice.dir))
      boxes.delete(choice.box)
      boxes.add(choice.stand)
      player = choice.land
    }
    if (failed) continue
    if ([...boxes].every((cell) => isGoal(room, cell))) {
      lastReason = 'generated state is already solved'
      continue
    }

    const grid: string[] = []
    for (let y = 0; y < room.rows; y++) {
      let row = ''
      for (let x = 0; x < room.cols; x++) {
        const index = y * room.cols + x
        if (isWall(room, index)) row += '#'
        else if (boxes.has(index)) row += isGoal(room, index) ? '*' : '$'
        else if (index === player) row += isGoal(room, index) ? '+' : '@'
        else row += isGoal(room, index) ? '.' : ' '
      }
      grid.push(row)
    }

    const witness = reverseMoves.map(oppositeDir).reverse()
    return { ok: true, grid, witness }
  }

  return { ok: false, reason: lastReason }
}

function inBounds(room: ParsedLevel, index: number): boolean {
  return index >= 0 && index < room.staticGrid.length
}

/** 避开墙与箱子的最短路（BFS）；玩家在反向生成中自由走动 */
function walkPath(
  room: ParsedLevel,
  from: number,
  to: number,
  boxes: ReadonlySet<number>,
): MoveDir[] | null {
  if (from === to) return []
  const previous = new Map<number, { cell: number; dir: MoveDir }>()
  const queue: number[] = [from]
  const seen = new Set<number>([from])
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head]!
    for (const dir of ALL_DIRS) {
      const next = cell + dirDelta(dir, room.cols)
      if (!inBounds(room, next) || isWall(room, next)) continue
      if (boxes.has(next)) continue
      if (seen.has(next)) continue
      seen.add(next)
      previous.set(next, { cell, dir })
      if (next === to) {
        const path: MoveDir[] = []
        let cursor = to
        while (cursor !== from) {
          const step = previous.get(cursor)!
          path.push(step.dir)
          cursor = step.cell
        }
        return path.reverse()
      }
      queue.push(next)
    }
  }
  return null
}

/** 关卡包条目：给定候选种子，命中第一个能生成成功的种子 */
export interface PackSpec {
  id: string
  roomId: string
  difficulty: LevelDef['difficulty']
  unpushSteps: number
  seeds: number[]
}

export function buildLevel(
  spec: PackSpec,
  roomGrid: string[],
): { def: LevelDef; witness: MoveDir[] } {
  const failures: string[] = []
  for (const seed of spec.seeds) {
    const result = generateLevel(roomGrid, {
      roomId: spec.roomId,
      seed,
      unpushSteps: spec.unpushSteps,
    })
    if (result.ok) {
      return {
        def: {
          id: spec.id,
          difficulty: spec.difficulty,
          grid: result.grid,
          source: {
            kind: 'generated',
            roomId: spec.roomId,
            seed,
            unpushSteps: spec.unpushSteps,
          },
        },
        witness: result.witness,
      }
    }
    failures.push(`${seed}:${result.reason}`)
  }
  throw new Error(`cannot build level ${spec.id} (${failures.join(', ')})`)
}
