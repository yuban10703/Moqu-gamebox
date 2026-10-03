/**
 * 棋盘模型测试：舰队自动摆放的合法性（多组种子 × 三档 × 双方）与几何工具。
 *
 * 摆舰合法性的校验由 helpers.fleetProblems **独立实现**（自己算行列/连续性/重叠/接触），
 * 不复用 src 的 shipsTouch / neighbors8，避免同源错误。
 */
import { describe, expect, it } from 'vitest'
import {
  CELLS,
  DIFFICULTY_IDS,
  ENEMY,
  PLAYER,
  SHIP_LENGTHS,
  colOf,
  createState,
  inRange,
  indexOf,
  neighbors8,
  normalizeSeed,
  placeFleet,
  remainingShipCells,
  rowOf,
  shipLengths,
  shipsTouch,
  sunkShips,
} from '../src/index.js'
import { SIZE, cellAt, fleetProblems, fresh } from './helpers.js'

describe('舰队自动摆放', () => {
  it('多组种子 × 三档 × 双方：舰数/舰长/直线连续/不重叠/全在盘内/互不接触（含对角）', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      for (let seed = 0; seed < 12; seed++) {
        for (const side of [PLAYER, ENEMY] as const) {
          const fleet = placeFleet(seed, difficulty, side)
          const problems = fleetProblems(fleet, difficulty)
          expect(problems, `${difficulty} seed ${seed} ${side}: ${problems.join('; ')}`).toEqual([])
          expect(fleet.ships.map((ship) => ship.length)).toEqual([...SHIP_LENGTHS[difficulty]])
          // 掩码与格数
          expect(fleet.cells).toHaveLength(
            SHIP_LENGTHS[difficulty].reduce((sum, length) => sum + length, 0),
          )
          expect(fleet.mask.filter(Boolean)).toHaveLength(fleet.cells.length)
        }
      }
    }
  })

  it('同 seed 同难度必然同布局；不同种子会给出不同布局', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      for (const side of [PLAYER, ENEMY] as const) {
        const first = placeFleet(20240607, difficulty, side)
        const second = placeFleet(20240607, difficulty, side)
        expect(first.ships.map((ship) => `${ship.start}${ship.horizontal ? 'h' : 'v'}`)).toEqual(
          second.ships.map((ship) => `${ship.start}${ship.horizontal ? 'h' : 'v'}`),
        )
        const layouts = new Set(
          Array.from({ length: 12 }, (_, seed) =>
            placeFleet(seed, difficulty, side)
              .ships.map((ship) => `${ship.start}${ship.horizontal ? 'h' : 'v'}`)
              .join('|'),
          ),
        )
        expect(layouts.size).toBeGreaterThan(1)
      }
    }
  })

  it('双方舰队互相独立（两条随机流），但各自都合法', () => {
    for (let seed = 0; seed < 8; seed++) {
      const mine = placeFleet(seed, 'challenging', PLAYER)
      const foe = placeFleet(seed, 'challenging', ENEMY)
      expect(fleetProblems(mine, 'challenging')).toEqual([])
      expect(fleetProblems(foe, 'challenging')).toEqual([])
      // 两条流错开：同 seed 下两边布局不应完全相同
      const key = (fleet: typeof mine) =>
        fleet.ships.map((ship) => `${ship.start}${ship.horizontal ? 'h' : 'v'}`).join('|')
      expect(key(mine)).not.toBe(key(foe))
    }
  })

  it('种子归一化：负数/小数/NaN 与同值结果一致', () => {
    expect(normalizeSeed(-1)).toBe(0xffffffff)
    expect(normalizeSeed(1.9)).toBe(1)
    expect(normalizeSeed(Number.NaN)).toBe(0)
    for (const difficulty of DIFFICULTY_IDS) {
      const key = (seed: number) =>
        JSON.stringify(placeFleet(seed, difficulty, PLAYER).ships.map((ship) => [ship.start, ship.horizontal]))
      expect(key(-1)).toBe(key(0xffffffff))
      expect(key(1.9)).toBe(key(1))
      expect(key(Number.NaN)).toBe(key(0))
      expect(shipLengths(difficulty)).toBe(SHIP_LENGTHS[difficulty])
    }
  })

  it('舰只不接触：把两艘舰挪到相邻格就应当被判为接触', () => {
    const fleet = placeFleet(1, 'starter', PLAYER)
    const first = fleet.ships[0]!
    const second = fleet.ships[1]!
    expect(shipsTouch(first, second)).toBe(false)
    // 手工造一艘贴着第一艘的舰（模仿它的形状，整体平移一格）
    const shifted = {
      ...second,
      cells: second.cells.map((cell) => {
        const row = rowOf(cell)
        const col = colOf(cell)
        return first.horizontal
          ? cellAt(row + 1, col)
          : cellAt(row, col + 1)
      }),
    }
    // 只有确实贴上了才算接触（避免平移后仍在远处导致断言无意义）
    const touches = shipsTouch(first, shifted)
    const adjacent = first.cells.some((cell) => {
      const row = rowOf(cell)
      const col = colOf(cell)
      return shifted.cells.some((other) => {
        const otherRow = rowOf(other)
        const otherCol = colOf(other)
        return Math.abs(row - otherRow) <= 1 && Math.abs(col - otherCol) <= 1
      })
    })
    expect(touches).toBe(adjacent)
  })

  it('几何工具：行列换算、越界判定与八邻域', () => {
    expect(CELLS).toBe(64)
    for (let index = 0; index < CELLS; index++) {
      expect(indexOf(rowOf(index), colOf(index))).toBe(index)
    }
    expect(inRange(-1)).toBe(false)
    expect(inRange(64)).toBe(false)
    expect(inRange(1.5)).toBe(false)
    expect(inRange(63)).toBe(true)
    expect(neighbors8(cellAt(0, 0))).toHaveLength(3)
    expect(neighbors8(cellAt(0, 3))).toHaveLength(5)
    expect(neighbors8(cellAt(3, 3))).toHaveLength(8)
    expect(SIZE).toBe(8)
  })
})

describe('起始局面与剩余舰格', () => {
  it('起始：双方舰队摆好、0 步、没有射击记录、玩家先手', () => {
    const state = fresh(7, 'skilled')
    expect(state.turn).toBe(PLAYER)
    expect(state.moves).toBe(0)
    expect(state.log).toHaveLength(0)
    expect(state.playerShots.some(Boolean)).toBe(false)
    expect(state.enemyShots.some(Boolean)).toBe(false)
    expect(fleetProblems(state.playerFleet, 'skilled')).toEqual([])
    expect(fleetProblems(state.enemyFleet, 'skilled')).toEqual([])
    expect(remainingShipCells(state, PLAYER)).toBe(
      SHIP_LENGTHS.skilled.reduce((sum, length) => sum + length, 0),
    )
    expect(remainingShipCells(state, ENEMY)).toBe(remainingShipCells(state, PLAYER))
    expect(sunkShips(state, ENEMY)).toBe(0)
  })

  it('createState 的布局与 placeFleet 一致', () => {
    const state = createState(42, 'challenging')
    expect(state.playerFleet.ships.map((ship) => [ship.start, ship.horizontal])).toEqual(
      placeFleet(42, 'challenging', PLAYER).ships.map((ship) => [ship.start, ship.horizontal]),
    )
    expect(state.enemyFleet.ships.map((ship) => [ship.start, ship.horizontal])).toEqual(
      placeFleet(42, 'challenging', ENEMY).ships.map((ship) => [ship.start, ship.horizontal]),
    )
  })
})
