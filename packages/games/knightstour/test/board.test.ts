/**
 * 棋盘模型测试：马步几何、起始格区域、起点选择的确定性、以及提示的推荐落点。
 */
import { describe, expect, it } from 'vitest'
import {
  BOARD_SIZE,
  CELLS,
  DIFFICULTY_IDS,
  KNIGHT_OFFSETS,
  colOf,
  difficultySpec,
  inRange,
  indexOf,
  insertVisited,
  isDifficultyId,
  isKnightMove,
  isTourComplete,
  knightMoves,
  pickStart,
  rowOf,
  startCandidates,
  warnsdorffNext,
} from '../src/index.js'

describe('棋盘与马步几何', () => {
  it('8×8 共 64 格，行列索引互逆', () => {
    expect(BOARD_SIZE).toBe(8)
    expect(CELLS).toBe(64)
    for (let index = 0; index < CELLS; index++) {
      expect(indexOf(rowOf(index), colOf(index))).toBe(index)
    }
    expect(inRange(-1)).toBe(false)
    expect(inRange(64)).toBe(false)
    expect(inRange(1.5)).toBe(false)
    expect(inRange(63)).toBe(true)
  })

  it('马步就是 (±1,±2)/(±2,±1) 八个方向，其余位移都不合法', () => {
    const from = indexOf(4, 4)
    const targets = knightMoves(from)
    expect(targets).toHaveLength(8)
    for (const to of targets) expect(isKnightMove(from, to)).toBe(true)
    // 八个方向都对得上
    const deltas = targets.map((to) => [rowOf(to) - 4, colOf(to) - 4])
    for (const [dr, dc] of deltas) {
      expect(KNIGHT_OFFSETS.some(([r, c]) => r === dr && c === dc)).toBe(true)
    }
    // 非马步
    for (const bad of [indexOf(4, 5), indexOf(5, 5), indexOf(6, 6), indexOf(4, 4), indexOf(3, 3)]) {
      expect(isKnightMove(from, bad), `${rowOf(bad)},${colOf(bad)}`).toBe(false)
    }
    // 越界
    expect(isKnightMove(from, -1)).toBe(false)
    expect(isKnightMove(from, 64)).toBe(false)
  })

  it('角落只有 2 个马步，边线（非角）有 3~4 个，中央有 8 个', () => {
    expect(knightMoves(indexOf(0, 0))).toHaveLength(2)
    expect(knightMoves(indexOf(0, 0)).sort((a, b) => a - b)).toEqual([
      indexOf(1, 2),
      indexOf(2, 1),
    ])
    expect(knightMoves(indexOf(0, 3))).toHaveLength(4)
    expect(knightMoves(indexOf(2, 1))).toHaveLength(6)
    expect(knightMoves(indexOf(3, 3))).toHaveLength(8)
    expect(knightMoves(indexOf(7, 7))).toHaveLength(2)
  })
})

describe('起始格区域与确定性', () => {
  it('三档难度：角 4 格 / 边 24 格 / 中央 4 格', () => {
    expect(difficultySpec('starter').region).toBe('corner')
    expect(difficultySpec('starter').hint).toBe(true)
    expect(difficultySpec('skilled').region).toBe('edge')
    expect(difficultySpec('skilled').hint).toBe(false)
    expect(difficultySpec('challenging').region).toBe('center')
    expect(difficultySpec('challenging').hint).toBe(false)

    expect(startCandidates('starter')).toEqual([
      indexOf(0, 0),
      indexOf(0, 7),
      indexOf(7, 0),
      indexOf(7, 7),
    ])
    expect(startCandidates('skilled')).toHaveLength(24)
    expect(startCandidates('challenging')).toEqual([
      indexOf(3, 3),
      indexOf(3, 4),
      indexOf(4, 3),
      indexOf(4, 4),
    ])
  })

  it('pickStart 只会在该难度的候选区域里，且同 seed 完全确定', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      const candidates = startCandidates(difficulty)
      for (let seed = 0; seed < 40; seed++) {
        const first = pickStart(seed, difficulty)
        expect(candidates).toContain(first)
        expect(pickStart(seed, difficulty)).toBe(first)
      }
      // 多组种子里会挑到不同的起点（不是恒定一格）
      const picked = new Set(Array.from({ length: 40 }, (_, seed) => pickStart(seed, difficulty)))
      expect(picked.size).toBeGreaterThan(1)
    }
  })

  it('负数 / 小数 / NaN 种子被归一化，与同值结果一致', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      expect(pickStart(-1, difficulty)).toBe(pickStart(0xffffffff, difficulty))
      expect(pickStart(1.9, difficulty)).toBe(pickStart(1, difficulty))
      expect(pickStart(Number.NaN, difficulty)).toBe(pickStart(0, difficulty))
    }
  })

  it('难度 id 校验与访问集合工具', () => {
    expect(isDifficultyId('starter')).toBe(true)
    expect(isDifficultyId('nope')).toBe(false)
    expect(isTourComplete(63)).toBe(false)
    expect(isTourComplete(64)).toBe(true)
    expect(insertVisited([3, 9], 5)).toEqual([3, 5, 9])
    expect(CELLS).toBe(64)
  })
})

describe('提示（Warnsdorff）', () => {
  it('推荐落点是合法马步，且后续选择最少', () => {
    const start = indexOf(0, 0)
    const visited = [start]
    const hint = warnsdorffNext(start, visited)
    expect(hint).not.toBeNull()
    expect(knightMoves(start)).toContain(hint!)
    // 从角落出发一步到 (1,2)/(2,1)，两者的后续选择数相同 → 取索引小的那个
    const degrees = knightMoves(start).map((to) =>
      knightMoves(to).filter((onward) => onward !== start).length,
    )
    const bestDegree = Math.min(...degrees)
    const expected = knightMoves(start).filter(
      (to) => knightMoves(to).filter((onward) => onward !== start).length === bestDegree,
    )[0]
    expect(hint).toBe(expected)
  })

  it('所有可走格都访问过时返回 null', () => {
    const start = indexOf(0, 0)
    const visited = Array.from({ length: CELLS }, (_, index) => index)
    expect(warnsdorffNext(start, visited)).toBeNull()
  })
})
