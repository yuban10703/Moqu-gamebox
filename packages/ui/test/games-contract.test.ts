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
import { gomokuGame } from '@eink/gomoku'
import { lightsoutGame } from '@eink/lightsout'
import { klotskiGame } from '@eink/klotski'
import { match3Game } from '@eink/match3'
import { memoryGame } from '@eink/memory'
import { minesweeperGame } from '@eink/minesweeper'
import { snakeGame } from '@eink/snake'
import { sokobanGame } from '@eink/sokoban'
import { sudokuGame } from '@eink/sudoku'
import { tetrisGame } from '@eink/tetris'
import {
  BOARD_FRAME_PX,
  DEFAULT_LAYOUT,
  MIN_TICK_MS,
  createRng,
  type GameDef,
  type LayoutConfig,
} from '@eink/core'

/* eslint-disable @typescript-eslint/no-explicit-any */
const GAMES: Array<GameDef<any, any>> = [
  sokobanGame as GameDef<any, any>,
  sudokuGame as GameDef<any, any>,
  minesweeperGame as GameDef<any, any>,
  game2048 as GameDef<any, any>,
  fifteenGame as GameDef<any, any>,
  gomokuGame as GameDef<any, any>,
  memoryGame as GameDef<any, any>,
  lightsoutGame as GameDef<any, any>,
  klotskiGame as GameDef<any, any>,
  snakeGame as GameDef<any, any>,
  tetrisGame as GameDef<any, any>,
  match3Game as GameDef<any, any>,
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

  /*
   * 可玩性下限：任何游戏在**最小设备**上都必须还能玩。
   *
   * 由来：这一项此前靠人肉在真机上量（九款游戏一张表，记在 docs/handover.md）。
   * 但新游戏随时可能引入更密的网格（例如 19×19），一旦低于 24px 下限就不可点，
   * 而那时往往已经写完代码才发现。这里把它变成提交即拦的门槛。
   *
   * 参照两台真机的实测可用区：P6Plus 竖屏（439×847）与 Note X2 横屏（1248×903）。
   */
  it('每款游戏的棋盘在常用视口下都放得进可用区（守住"可玩"的下限）', () => {
    const config: LayoutConfig = { ...DEFAULT_LAYOUT }
    /*
     * 注意判据：**不能**断言 computeBoardLayout 返回的 cell >= minCell ——
     * 它内部本来就把格子钳在 minCell 上，那样断言恒真、等于没测（初版就犯了这个错 ✗）。
     * 真正有意义的是：按 minCell 算出来的棋盘**能不能放得进可用区**。
     * 放不下就意味着格子会被压到下限以下或被裁切 —— 即"这个网格在这台设备上不可玩"。
     *
     * 只覆盖两种**常用**视口：竖屏与正常横屏。
     * 极矮横屏（P6Plus 强制横屏 879×407，棋盘区仅剩 ~216px）是已记录的已知限制，
     * 不在本断言范围内（见 docs/handover.md）。
     */
    const areas = [
      { name: 'P6Plus 竖屏', width: 415, height: 420 },
      { name: 'Note X2 横屏', width: 1176, height: 513 },
    ]
    for (const game of GAMES) {
      /*
       * 只对「靠点格子操作」的玩法要求格子达到触摸下限。
       * 方向盘驱动的玩法（迷宫、数字华容道、推箱子…）不靠点格子，格子小一些仍然可玩 ——
       * 例如 21×21 迷宫在 415px 宽下只有 19px 格子，但它用方向盘玩，实测无障碍。
       */
      const dpadDriven = game
        .controls(game.create(1, game.difficulties[0]!.id))
        .some((control) => control.role === 'dpad')
      if (dpadDriven) continue
      for (const difficulty of game.difficulties.map((item) => item.id)) {
        const view = game.view(game.create(1, difficulty))
        if (!view.board) continue
        const { cols, rows } = view.board
        const needed = {
          width: cols * config.minCell + BOARD_FRAME_PX * 2,
          height: rows * config.minCell + BOARD_FRAME_PX * 2,
        }
        for (const area of areas) {
          expect(
            needed.width <= area.width && needed.height <= area.height,
            `${game.id}/${difficulty}（${cols}×${rows}）在 ${area.name}（可用 ${area.width}×${area.height}）上放不下：` +
              `按 ${config.minCell}px 下限需要 ${needed.width}×${needed.height} —— 该网格在这台设备上不可玩`,
          ).toBe(true)
        }
      }
    }
  })
})

/**
 * 自动步进（tick）的跨游戏契约。
 *
 * 用户要求：**只有贪吃蛇与俄罗斯方块**自动前进/下落，其余 10 款行为完全不变。
 * 这条约束放在这里守：它是"每加一款游戏都可能被破坏、而单测很难发现"的那类约定。
 */
describe('自动步进的声明（tickMs）', () => {
  it('只有贪吃蛇与俄罗斯方块声明 tickMs，其余玩法一个定时器都不起', () => {
    const withTick = GAMES.filter((game) => typeof game.tickMs === 'function')
      .map((game) => game.id)
      .sort()
    expect(withTick).toEqual(['snake', 'tetris'])
  })

  it('声明出来的间隔都不低于 MIN_TICK_MS，且是"同状态同结果"的纯函数', () => {
    for (const game of GAMES) {
      if (!game.tickMs) continue
      for (const difficulty of game.difficulties.map((item) => item.id)) {
        const state = game.create(4242, difficulty)
        const first = game.tickMs(state, difficulty)
        // 尚未结束的局面必须给出一个可用的间隔
        expect(first, `${game.id}/${difficulty}`).not.toBeNull()
        expect(first!, `${game.id}/${difficulty}`).toBeGreaterThanOrEqual(MIN_TICK_MS)
        // 纯函数：同一状态重复问、以及从存档读回来之后问，答案必须一致
        expect(game.tickMs(state, difficulty)).toBe(first)
        expect(game.tickMs(game.decode(game.encode(state)), difficulty)).toBe(first)
      }
    }
  })

  it('tick 是合法的规则动作：任何 tickMs 非空的状态都接受它并能存能读', () => {
    for (const game of GAMES) {
      if (!game.tickMs) continue
      for (const difficulty of game.difficulties.map((item) => item.id)) {
        let state = game.create(4242, difficulty)
        for (let step = 0; step < 40; step++) {
          if (game.tickMs(state, difficulty) === null) break
          expect(() => game.reduce(state, { type: 'tick' } as never)).not.toThrow()
          state = game.reduce(state, { type: 'tick' } as never)
          // 每一步都要能原样存档往返（自动步进也必须落在存档里）
          expect(() => game.decode(game.encode(state))).not.toThrow()
          expect(game.decode(game.encode(state))).toEqual(state)
        }
      }
    }
  })
})
