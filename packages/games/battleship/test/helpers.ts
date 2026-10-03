/**
 * 测试夹具与**独立实现**的摆舰合法性校验。
 *
 * 校验器自己算行列、连续性、重叠与「互不接触（含对角）」，不复用 src 的 shipsTouch/neighbors8，
 * 这样即使 src 的几何写错也能被抓出来。
 */
import { createRng } from '@eink/core'
import {
  CELLS,
  SHIP_LENGTHS,
  createState,
  type BattleshipState,
  type DifficultyId,
  type Fleet,
} from '../src/index.js'

export const SIZE = 8

export function fresh(seed = 20240607, difficulty: DifficultyId = 'starter'): BattleshipState {
  return createState(seed, difficulty)
}

export function cellAt(row: number, col: number): number {
  return row * SIZE + col
}

export function rowOfTest(index: number): number {
  return Math.floor(index / SIZE)
}

export function colOfTest(index: number): number {
  return index % SIZE
}

/**
 * 校验一支舰队（返回问题列表，空 = 合法）：
 * 舰数 / 各舰长 / 每舰格数 / 直线且连续 / 全在盘内 / 不重叠 / **任意两艘不接触（含对角）** / 掩码一致。
 */
export function fleetProblems(fleet: Fleet, difficulty: DifficultyId): string[] {
  const lengths = SHIP_LENGTHS[difficulty]
  const problems: string[] = []
  if (fleet.ships.length !== lengths.length) {
    problems.push(`ship count ${fleet.ships.length} != ${lengths.length}`)
  }
  const owner = new Map<number, number>()
  fleet.ships.forEach((ship, position) => {
    if (ship.length !== lengths[position]) {
      problems.push(`ship ${position} length ${ship.length} != ${lengths[position]}`)
    }
    if (ship.cells.length !== ship.length) {
      problems.push(`ship ${position} has ${ship.cells.length} cells for length ${ship.length}`)
    }
    const sorted = [...ship.cells].sort((a, b) => a - b)
    const rows = new Set(sorted.map(rowOfTest))
    const cols = new Set(sorted.map(colOfTest))
    if (ship.horizontal ? rows.size !== 1 : cols.size !== 1) {
      problems.push(`ship ${position} is not straight`)
    }
    const step = ship.horizontal ? 1 : SIZE
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i]! - sorted[i - 1]! !== step) problems.push(`ship ${position} is not contiguous`)
    }
    for (const cell of ship.cells) {
      if (!Number.isInteger(cell) || cell < 0 || cell >= CELLS) {
        problems.push(`ship ${position} cell ${cell} out of board`)
        continue
      }
      if (owner.has(cell)) problems.push(`cell ${cell} used by ships ${owner.get(cell)} and ${position}`)
      owner.set(cell, position)
    }
  })
  // 互不接触（含对角）：任意两舰的格子行列差都不能同时 ≤ 1
  for (let a = 0; a < fleet.ships.length; a++) {
    for (let b = a + 1; b < fleet.ships.length; b++) {
      for (const cellA of fleet.ships[a]!.cells) {
        for (const cellB of fleet.ships[b]!.cells) {
          const deltaRow = Math.abs(rowOfTest(cellA) - rowOfTest(cellB))
          const deltaCol = Math.abs(colOfTest(cellA) - colOfTest(cellB))
          if (deltaRow <= 1 && deltaCol <= 1) {
            problems.push(`ships ${a} and ${b} touch at ${cellA}/${cellB}`)
          }
        }
      }
    }
  }
  const maskCount = fleet.mask.filter(Boolean).length
  if (maskCount !== fleet.cells.length) {
    problems.push(`mask has ${maskCount} cells but cells list has ${fleet.cells.length}`)
  }
  const expectedTotal = lengths.reduce((sum, length) => sum + length, 0)
  if (fleet.cells.length !== expectedTotal) {
    problems.push(`total ship cells ${fleet.cells.length} != ${expectedTotal}`)
  }
  for (let index = 0; index < CELLS; index++) {
    const inList = fleet.cells.includes(index)
    if (inList !== fleet.mask[index]) problems.push(`mask/list disagree at ${index}`)
  }
  return problems
}

/** 敌方舰格（玩家需要全部打中才能赢） */
export function enemyShipCells(state: BattleshipState): number[] {
  return [...state.enemyFleet.cells].sort((a, b) => a - b)
}

/** 玩家海域里**不是**舰的格（用来故意打空，让白方获得回合） */
export function enemyWaterCells(state: BattleshipState): number[] {
  const ship = new Set(state.enemyFleet.cells)
  const out: number[] = []
  for (let index = 0; index < CELLS; index++) if (!ship.has(index)) out.push(index)
  return out
}

/**
 * 把一局打完：
 * - `mode: 'win'` 玩家专打敌舰格（每次命中就继续，白方几乎没有回合）；
 * - `mode: 'lose'` 玩家专打敌舰以外的格（一直打空，把回合让给白方 AI，直到我方被击沉）。
 */
export function playToEnd(
  seed: number,
  difficulty: DifficultyId,
  mode: 'win' | 'lose',
  fire: (state: BattleshipState, index: number) => BattleshipState,
): BattleshipState {
  let state = fresh(seed, difficulty)
  const order = mode === 'win' ? enemyShipCells(state) : enemyWaterCells(state)
  const rng = createRng(seed)
  let guard = 0
  for (;;) {
    // 终局判据：敌方舰格全被打中（胜）或我方舰格全被打中（负）
    const enemyLeft = state.enemyFleet.cells.filter((cell) => !state.playerShots[cell]).length
    const mineLeft = state.playerFleet.cells.filter((cell) => !state.enemyShots[cell]).length
    if (enemyLeft === 0 || mineLeft === 0) break
    if (guard++ > 4000) throw new Error('game did not finish')
    const untried = order.filter((cell) => !state.playerShots[cell])
    // win 模式按舰格顺序打；lose 模式随机挑一个空格打（保持确定性）
    const target = mode === 'win' ? untried[0]! : untried[rng.int(untried.length)]!
    state = fire(state, target)
  }
  return state
}
