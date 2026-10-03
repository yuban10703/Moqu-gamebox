import { describe, expect, it } from 'vitest'
import { klotskiGame } from '../src/index.js'
import { PACK } from '../src/board.js'

/**
 * 自由选关：跳到指定关卡后 levelId 正确、且**仍然可以操作**
 * （只有 levelId 对但局面玩不动，等于坏掉 —— 这是实测踩过的坑）。
 */
describe('华容道 · 自由选关', () => {
  const difficulty = klotskiGame.difficulties[0]!.id

  it('每一关都能开局且都有合法动作', () => {
    const start = klotskiGame.create(1, difficulty)
    for (const level of PACK) {
      const jumped = klotskiGame.reduce(start, { type: 'startLevel', levelId: level.def.id } as never)
      expect(klotskiGame.contentId?.(jumped)).toBe(level.def.id)
      expect(klotskiGame.legal(jumped).length).toBeGreaterThan(0)
      expect(klotskiGame.view(jumped).board).toBeTruthy()
    }
  })

  it('未知关卡 id 保持原状，不抛错', () => {
    const start = klotskiGame.create(1, difficulty)
    expect(klotskiGame.reduce(start, { type: 'startLevel', levelId: 'no-such-level' } as never)).toEqual(start)
  })
})
