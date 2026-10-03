import { describe, expect, it } from 'vitest'
import { sokobanGame } from '../src/index.js'
import { PACK } from '../src/pack.js'

/**
 * 自由选关（详情页点关卡）：壳层派发 `startLevel`，游戏把状态切到那一关。
 * 最关键的一条：**跳关后必须仍然可以操作** —— 只有 levelId 对、但局面不可玩，等于坏掉。
 */
describe('推箱子 · 自由选关', () => {
  const difficulty = sokobanGame.difficulties[0]!.id

  it('跳到指定关卡后 levelId 正确、日志清空、且仍有合法动作', () => {
    const start = sokobanGame.create(1, difficulty)
    const target = PACK[4]!.def.id
    const jumped = sokobanGame.reduce(start, { type: 'startLevel', levelId: target } as never)
    expect(jumped.levelId).toBe(target)
    expect(jumped.log).toHaveLength(0)
    expect(sokobanGame.legal(jumped).length).toBeGreaterThan(0)
    expect(sokobanGame.status(jumped)).toBe('playing')
  })

  it('每一关都能开局且都有合法动作', () => {
    const start = sokobanGame.create(1, difficulty)
    for (const level of PACK) {
      const jumped = sokobanGame.reduce(start, { type: 'startLevel', levelId: level.def.id } as never)
      expect(jumped.levelId).toBe(level.def.id)
      expect(sokobanGame.legal(jumped).length).toBeGreaterThan(0)
      expect(sokobanGame.view(jumped).board).toBeTruthy()
    }
  })

  it('未知关卡 id 保持原状，不抛错', () => {
    const start = sokobanGame.create(1, difficulty)
    expect(sokobanGame.reduce(start, { type: 'startLevel', levelId: 'no-such-level' } as never)).toEqual(start)
  })
})
