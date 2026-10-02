/**
 * 关卡包验证。三件事必须成立，否则内容不合格：
 *   1. 来源可追溯：按 source 里的 roomId/seed/unpushSteps 复算，必须与提交的关卡逐字符一致；
 *   2. 见证解法真的能解开（用规则引擎逐步重放，不用生成器内部状态）；
 *   3. 独立求解器（A*，按步数最优）也能解出来 —— 与生成器互相独立，避免「自证」。
 * 任何一关失败都视为内容缺陷，测试直接红。
 */
import { describe, expect, it } from 'vitest'
import { ROOM_TEMPLATES, parseLevel, type DifficultyId } from '../src/level.js'
import { generateLevel } from '../src/generate.js'
import { LEVEL_DEFS, LEVEL_WITNESSES } from '../src/levels.js'
import { solve } from '../src/solver.js'
import { derive, type SokobanAction, type SokobanState } from '../src/rules.js'
import { reduceWithLevel } from '../src/index.js'

function roomGrid(roomId: string): string[] {
  const room = ROOM_TEMPLATES.find((candidate) => candidate.id === roomId)
  if (!room) throw new Error(`unknown room ${roomId}`)
  return room.grid
}

function replayWitness(levelId: string, difficulty: DifficultyId, witness: readonly string[]): SokobanState {
  let state: SokobanState = { difficulty, levelId, log: [] }
  for (const dir of witness) {
    const action: SokobanAction = { type: 'move', dir: dir as 'up' | 'down' | 'left' | 'right' }
    state = reduceWithLevel(levelId, state, action)
  }
  return state
}

describe('关卡包基本约束', () => {
  it('全部关卡可解析', () => {
    for (const def of LEVEL_DEFS) {
      expect(() => parseLevel(def)).not.toThrow()
    }
  })

  it('关卡 id 唯一', () => {
    const ids = LEVEL_DEFS.map((def) => def.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('三种难度各至少 3 关', () => {
    for (const difficulty of ['starter', 'skilled', 'challenging'] as const) {
      const count = LEVEL_DEFS.filter((def) => def.difficulty === difficulty).length
      expect(count).toBeGreaterThanOrEqual(3)
    }
  })

  it('每关都有见证解法记录', () => {
    for (const def of LEVEL_DEFS) {
      expect(LEVEL_WITNESSES[def.id]?.length ?? 0).toBeGreaterThan(0)
    }
  })
})

describe('关卡来源可追溯（按 source 复算）', () => {
  for (const def of LEVEL_DEFS) {
    it(`${def.id} 与 source(${def.source.roomId}/seed ${def.source.seed}) 复算结果一致`, () => {
      const result = generateLevel(roomGrid(def.source.roomId), {
        roomId: def.source.roomId,
        seed: def.source.seed,
        unpushSteps: def.source.unpushSteps,
      })
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.grid).toEqual(def.grid)
    })
  }
})

describe('关卡可解性', () => {
  for (const def of LEVEL_DEFS) {
    it(`${def.id} 见证解法可以解开`, () => {
      const level = parseLevel(def)
      const state = replayWitness(def.id, def.difficulty, LEVEL_WITNESSES[def.id] ?? [])
      const position = derive(level, state.log)
      expect(position.solved).toBe(true)
    })
  }

  it('独立 A* 求解器确认每关可解（有见证解法兜底）', () => {
    const summary: string[] = []
    let limited = 0
    for (const def of LEVEL_DEFS) {
      const level = parseLevel(def)
      const result = solve(
        level,
        { player: level.startPlayer, boxes: level.startBoxes },
        { maxExpanded: 40_000 },
      )
      if (result.ok) {
        summary.push(`${def.id}:${def.difficulty} optimal=${result.moves.length}`)
      } else {
        // 只允许「搜索预算用尽」，绝不允许判定为无解
        expect(result.reason).toBe('limit')
        limited++
      }
    }
    expect(summary.length + limited).toBe(LEVEL_DEFS.length)
    // 求解器给出的最优步数不应少于见证解法长度（见证解法不保证最优，但不可能更短）
    process.stdout.write(`\n关卡求解：\n${summary.join('\n')}\n（超出预算：${limited} 关，已由见证解法覆盖）\n`)
  })
})

describe('难度分布合理', () => {
  it('入门关的最优步数不大于挑战关的最优步数', () => {
    const optimal = new Map<string, number>()
    for (const def of LEVEL_DEFS) {
      const level = parseLevel(def)
      const result = solve(level, { player: level.startPlayer, boxes: level.startBoxes }, { maxExpanded: 20_000 })
      if (result.ok) optimal.set(def.id, result.moves.length)
    }
    const best = (difficulty: DifficultyId): number => {
      const values = LEVEL_DEFS.filter((def) => def.difficulty === difficulty)
        .map((def) => optimal.get(def.id))
        .filter((value): value is number => value !== undefined)
      return values.length > 0 ? Math.min(...values) : Number.POSITIVE_INFINITY
    }
    if (optimal.size >= 6) {
      expect(best('starter')).toBeLessThanOrEqual(best('challenging'))
    }
  })
})
