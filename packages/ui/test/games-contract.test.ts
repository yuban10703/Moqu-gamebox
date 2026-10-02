/**
 * 跨全部游戏的契约属性测试。
 *
 * 由来：数独曾经把「玩家填入必须等于解」当作存档校验条件，于是玩家填错一个数字后
 * 存档就再也加载不出来（界面报「存档已损坏」）。这是**一类**缺陷：
 * decode 拒绝了游戏自己产生的合法状态。
 *
 * 这里用完全通用的方式守住：对每款游戏随机走若干合法动作，
 * 每一步之后 encode → decode 都必须成功且往返一致。
 */
import { describe, expect, it } from 'vitest'
import { game2048 } from '@eink/2048'
import { fifteenGame } from '@eink/fifteen'
import { minesweeperGame } from '@eink/minesweeper'
import { reversiGame } from '@eink/reversi'
import { sokobanGame } from '@eink/sokoban'
import { sudokuGame } from '@eink/sudoku'
import { createRng, type GameDef } from '@eink/core'

/* eslint-disable @typescript-eslint/no-explicit-any */
const GAMES: Array<GameDef<any, any>> = [
  sokobanGame as GameDef<any, any>,
  sudokuGame as GameDef<any, any>,
  minesweeperGame as GameDef<any, any>,
  game2048 as GameDef<any, any>,
  reversiGame as GameDef<any, any>,
  fifteenGame as GameDef<any, any>,
]

describe('所有游戏的存档契约', () => {
  for (const game of GAMES) {
    it(`${game.id}：随机合法动作之后，状态始终能存档往返`, () => {
      for (const difficulty of game.difficulties.map((item) => item.id)) {
        const rng = createRng(20261003)
        const pick = (): number => rng.next()
        let state = game.create(12345, difficulty)
        // 初始状态本身也必须能往返
        expect(() => game.decode(game.encode(state))).not.toThrow()

        for (let step = 0; step < 60; step++) {
          const actions = game.legal(state)
          if (actions.length === 0) break
          const action = actions[Math.floor(pick() * actions.length)]!
          try {
            state = game.reduce(state, action)
          } catch {
            // 规则层拒绝某些动作是正常的（例如某些玩法 legal 只给方向），换一步继续
            continue
          }
          // 关键断言：游戏自己走出来的状态，必须能被自己的 decode 接受
          const raw = game.encode(state)
          let decoded: unknown
          expect(() => {
            decoded = game.decode(raw)
          }, `${game.id}/${difficulty} 第 ${step} 步后 decode 失败：${JSON.stringify(raw).slice(0, 120)}`).not.toThrow()
          // 往返一致（再编码一次应完全相同）
          expect(JSON.stringify(game.encode(decoded))).toBe(JSON.stringify(raw))
        }
      }
    })
  }
})
