/**
 * GameDef 外壳集成测试：元信息 / view / controls / tickMs / 存档往返 / 同种子同结果 / 双人同屏。
 *
 * 重点：
 *   - 1-bit 呈现约定（✕ 与 ○ 两个字形、末手内框、赢线反白、提示小点、不加分组线）；
 *   - 两拍式应手的间隔 450 / 500，且 tickActor 声明为 'opponent'；
 *   - 属性测试：随机走若干合法动作后 encode→decode 必须往返一致
 *     （项目曾因「decode 拒绝游戏自己产生的状态」出过事故，这条用例是第一道闸门）。
 */
import { describe, expect, it } from 'vitest'
import { createRng } from '@eink/core'
import {
  CELLS,
  DIFFICULTY_IDS,
  EMPTY,
  FIRST,
  HINT_GLYPH,
  HINT_TEXT_SCALE,
  SECOND,
  boardOf,
  cellLabelKey,
  createState,
  decodeState,
  emptyCells,
  encodeState,
  legalActions,
  movesOf,
  outcomeOf,
  reduceState,
  selectAction,
  tictactoeGame,
  turnOf,
  type TictactoeState,
} from '../src/index.js'
import { ascii, at, settle, stateOf } from './helpers.js'

/** 一局真实的和局（九格下满、双方都没连成线） */
const DRAW_LOG = [0, 1, 2, 4, 3, 5, 8, 6, 7] as const
/** 先手连成第一行的终局 */
const FIRST_WINS = [0, 3, 1, 4, 2] as const
/** 后手连成第二行的终局 */
const SECOND_WINS = [0, 3, 1, 4, 8, 5] as const

function play(state: TictactoeState, index: number): TictactoeState {
  return reduceState(state, { type: 'place', index })
}

describe('元信息', () => {
  it('id / 版本 / i18n 命名空间 / 非法提示', () => {
    expect(tictactoeGame.id).toBe('tictactoe')
    expect(tictactoeGame.i18nNamespace).toBe('tictactoe')
    expect(tictactoeGame.illegalNoticeKey).toBe('tictactoe.illegal.notice')
    expect(tictactoeGame.rulesVersion).toBeGreaterThanOrEqual(1)
    expect(tictactoeGame.contentVersion).toBeGreaterThanOrEqual(1)
  })

  it('四档难度：三档对手强度 + 双人同屏', () => {
    expect(tictactoeGame.difficulties.map((item) => item.id)).toEqual([
      'starter',
      'skilled',
      'challenging',
      'hotseat',
    ])
    for (const difficulty of tictactoeGame.difficulties) {
      expect(difficulty.labelKey).toBe(`tictactoe.difficulty.${difficulty.id}`)
    }
  })

  it('create 拒绝未知难度；同难度同种子给出同一开局', () => {
    expect(() => tictactoeGame.create(1, 'nightmare')).toThrow()
    expect(encodeState(tictactoeGame.create(7, 'starter'))).toEqual(
      encodeState(tictactoeGame.create(7, 'starter')),
    )
  })
})

describe('view / 1-bit 呈现', () => {
  it('3×3 九格、行优先索引，且没有分组线', () => {
    const view = tictactoeGame.view(tictactoeGame.create(1, 'starter'))
    expect(view.board).not.toBeNull()
    expect(view.board!.kind).toBe('grid')
    expect(view.board!.cols).toBe(3)
    expect(view.board!.rows).toBe(3)
    expect(view.board!.cells).toHaveLength(CELLS)
    view.board!.cells.forEach((cell, index) => expect(cell.index).toBe(index))
    // 3×3 本身就是一组：多一层分组线只会更花
    expect(view.board!.groups).toBeUndefined()
  })

  it('空格是 empty、棋子是 tile；只用 ✕ 与 ○ 两个字形（不靠灰阶）', () => {
    const state = settle(play(tictactoeGame.create(11, 'starter'), 4))
    const cells = tictactoeGame.view(state).board!.cells
    expect(cells[4]!.kind).toBe('tile')
    expect(cells[4]!.glyph).toBe('✕')
    const reply = state.log[1]!
    expect(cells[reply]!.kind).toBe('tile')
    expect(cells[reply]!.glyph).toBe('○')
    const glyphs = new Set(cells.map((cell) => cell.glyph))
    expect([...glyphs].sort()).toEqual(['', '○', '✕'])
    for (const cell of cells) {
      if (cell.kind === 'empty') expect(cell.glyph).toBe('')
      // 棋子不用字号区分大小（大小不一看起来像「这颗子有问题」）
      expect(cell.textScale).toBeUndefined()
      expect(cell.selected).toBeUndefined()
    }
  })

  it('最后一手带内框：先手单线（0）、后手双线（1）', () => {
    const afterFirst = play(tictactoeGame.create(11, 'starter'), 4)
    const firstCells = tictactoeGame.view(afterFirst).board!.cells
    expect(firstCells[4]!.lastTo).toBe(0)
    expect(firstCells.filter((cell) => cell.lastTo !== undefined)).toHaveLength(1)

    const afterReply = settle(afterFirst)
    const secondCells = tictactoeGame.view(afterReply).board!.cells
    const reply = afterReply.log[1]!
    expect(secondCells[reply]!.lastTo).toBe(1)
    expect(secondCells[4]!.lastTo).toBeUndefined()
  })

  it('两拍应手第一拍：目标格（还是空格）先亮出双线框，第二拍才落子', () => {
    const picked = reduceState(play(tictactoeGame.create(2026, 'starter'), 0), { type: 'tick' })
    const cells = tictactoeGame.view(picked).board!.cells
    const target = picked.opponentPick!
    expect(cells[target]!.kind).toBe('empty')
    expect(cells[target]!.glyph).toBe('')
    expect(cells[target]!.lastTo).toBe(1)
    // 棋盘一格没动：`○` 还没有出现
    expect(cells.every((cell) => cell.glyph !== '○')).toBe(true)

    const placed = reduceState(picked, { type: 'tick' })
    expect(tictactoeGame.view(placed).board!.cells[target]!.glyph).toBe('○')
  })

  it('提示格是一个小点（kind number + textScale 0.5），并带无障碍标签 key', () => {
    const hinted = reduceState(tictactoeGame.create(5, 'starter'), { type: 'hint' })
    const cells = tictactoeGame.view(hinted).board!.cells
    const cell = cells[hinted.hint!]!
    expect(cell.kind).toBe('number')
    expect(cell.glyph).toBe(HINT_GLYPH)
    expect(cell.textScale).toBe(HINT_TEXT_SCALE)
    expect(cellLabelKey('number')).toBe('tictactoe.cell.hint')
    expect(cellLabelKey('tile')).toBe('tictactoe.cell.tile')
    expect(cellLabelKey('empty')).toBe('tictactoe.cell.empty')
    expect(cellLabelKey('wall')).toBeUndefined()
  })

  it('赢的三格反白（disc dark），其余格子不反白', () => {
    const won = stateOf([...FIRST_WINS])
    const cells = tictactoeGame.view(won).board!.cells
    const flipped = cells.filter((cell) => cell.disc !== undefined).map((cell) => cell.index)
    expect(flipped).toEqual([0, 1, 2])
    for (const index of flipped) expect(cells[index]!.disc).toBe('dark')
    // 还没结束时一格都不反白
    expect(tictactoeGame.view(stateOf([0, 3, 1])).board!.cells.every((cell) => cell.disc === undefined)).toBe(true)
  })

  it('stats 三项：两方子数 + 本局手数；同屏换用玩家一/玩家二', () => {
    const state = settle(play(tictactoeGame.create(3, 'starter'), 0))
    expect(tictactoeGame.view(state).stats).toEqual([
      { labelKey: 'tictactoe.stat.you', value: '1' },
      { labelKey: 'tictactoe.stat.computer', value: '1' },
      { labelKey: 'tictactoe.stat.moves', value: '2' },
    ])
    expect(tictactoeGame.view(stateOf([0])).stats.map((stat) => stat.labelKey)).toEqual([
      'tictactoe.stat.p1',
      'tictactoe.stat.p2',
      'tictactoe.stat.moves',
    ])
  })

  it('notice：对局中一直说明轮到谁，终局后不再提示', () => {
    expect(tictactoeGame.view(tictactoeGame.create(1, 'starter')).notice).toEqual({
      textKey: 'tictactoe.turn.you',
    })
    const waiting = play(tictactoeGame.create(1, 'starter'), 0)
    expect(tictactoeGame.view(waiting).notice).toEqual({ textKey: 'tictactoe.turn.computer' })
    expect(tictactoeGame.view(stateOf([0])).notice).toEqual({ textKey: 'tictactoe.turn.p2' })
    expect(tictactoeGame.view(stateOf([0, 1])).notice).toEqual({ textKey: 'tictactoe.turn.p1' })
    expect(tictactoeGame.view(stateOf([...FIRST_WINS])).notice).toBeNull()
  })

  it('结果页：赢 / 输 / 和局三套标题与明细', () => {
    const won = tictactoeGame.view(stateOf([...FIRST_WINS], { difficulty: 'starter' })).result!
    expect(won.titleKey).toBe('tictactoe.won.title')
    expect(won.details).toEqual([{ key: 'tictactoe.result.moves', params: { count: 5 } }])

    const lost = tictactoeGame.view(stateOf([...SECOND_WINS], { difficulty: 'starter' })).result!
    expect(lost.titleKey).toBe('tictactoe.lost.title')

    const draw = tictactoeGame.view(stateOf([...DRAW_LOG], { difficulty: 'skilled' })).result!
    expect(draw.titleKey).toBe('tictactoe.draw.title')
    expect(draw.details).toEqual([
      { key: 'tictactoe.result.moves', params: { count: 9 } },
      { key: 'tictactoe.result.draw' },
    ])
    // 进行中没有结果
    expect(tictactoeGame.view(tictactoeGame.create(1, 'starter')).result).toBeNull()
  })
})

describe('controls', () => {
  it('撤销按日志启用；提示只在轮到自己时才可点', () => {
    const fresh = tictactoeGame.controls(tictactoeGame.create(1, 'starter'))
    expect(fresh.map((control) => control.id)).toEqual(['undo', 'hint'])
    expect(fresh[0]!.enabled).toBe(false)
    expect(fresh[1]!.enabled).toBe(true)

    // 等电脑应手：提示不可点（现在不该玩家走），撤销可点
    const waiting = tictactoeGame.controls(play(tictactoeGame.create(1, 'starter'), 0))
    expect(waiting[0]!.enabled).toBe(true)
    expect(waiting[1]!.enabled).toBe(false)

    // 终局：提示不可点，撤销仍可点（可以退回关键一手重下）
    const over = tictactoeGame.controls(stateOf([...FIRST_WINS], { difficulty: 'starter' }))
    expect(over[1]!.enabled).toBe(false)
    expect(over[0]!.enabled).toBe(true)
    // 同屏：轮到谁谁就能要提示
    expect(tictactoeGame.controls(stateOf([0]))[1]!.enabled).toBe(true)
  })

  it('controlAction 把按钮映射成动作，未知 id 返回 null', () => {
    const state = tictactoeGame.create(1, 'starter')
    expect(tictactoeGame.controlAction!(state, 'hint')).toEqual({ type: 'hint' })
    expect(tictactoeGame.controlAction!(state, 'undo')).toEqual({ type: 'undo' })
    expect(tictactoeGame.controlAction!(state, 'restart')).toEqual({ type: 'restart' })
    expect(tictactoeGame.controlAction!(state, 'nope')).toBeNull()
  })
})

describe('自动步进（tickMs）', () => {
  it('对局中轮到对手：亮格前 450、亮格后 500；其余情况一律 null', () => {
    const fresh = tictactoeGame.create(1, 'starter')
    expect(tictactoeGame.tickMs!(fresh, 'starter')).toBeNull() // 还没轮到对手

    const waiting = play(fresh, 0)
    expect(tictactoeGame.tickMs!(waiting, 'starter')).toBe(450)
    const picked = reduceState(waiting, { type: 'tick' })
    expect(tictactoeGame.tickMs!(picked, 'starter')).toBe(500)
    expect(tictactoeGame.tickMs!(settle(waiting), 'starter')).toBeNull() // 应手已落

    // 对手已经连成线（终局）：没有应手可拍
    expect(tictactoeGame.tickMs!(stateOf([...SECOND_WINS], { difficulty: 'starter' }), 'starter')).toBeNull()
    // 双人同屏没有电脑：一个定时器都不起
    for (const state of [createState(1, 'hotseat'), stateOf([0]), stateOf([...DRAW_LOG])]) {
      expect(tictactoeGame.tickMs!(state, 'hotseat')).toBeNull()
    }
    expect(tictactoeGame.tickActor).toBe('opponent')
    // 纯函数：同一状态重复问、以及从存档读回来之后问，答案必须一致
    expect(tictactoeGame.tickMs!(waiting, 'starter')).toBe(450)
    expect(tictactoeGame.tickMs!(tictactoeGame.decode(tictactoeGame.encode(waiting)), 'starter')).toBe(450)
  })

  it('壳层视角的一回合：点格子 → 450 亮格 → 500 落子 → 计时停表', () => {
    let state = tictactoeGame.create(20261010, 'starter')
    const move = tictactoeGame.selectAction!(state, 4)
    expect(move).toEqual({ type: 'place', index: 4 })
    state = tictactoeGame.reduce(state, move!)

    expect(tictactoeGame.tickMs!(state, 'starter')).toBe(450)
    const picked = tictactoeGame.reduce(state, { type: 'tick' })
    // 第一拍棋盘一格不动，只亮出目标格
    expect(picked.log).toEqual(state.log)
    expect(picked.opponentPick).not.toBeNull()
    expect(tictactoeGame.tickMs!(picked, 'starter')).toBe(500)

    state = tictactoeGame.reduce(picked, { type: 'tick' })
    expect(state.log).toHaveLength(2)
    expect(tictactoeGame.tickMs!(state, 'starter')).toBeNull()
    // 回到玩家：又能点格子了
    expect(tictactoeGame.legal(state).some((action) => action.type === 'place')).toBe(true)
  })

  it('壳层视角的一整局：一路按合法动作走到终局，结果面板一定拿得到标题', () => {
    const rng = createRng(20261012)
    let state = tictactoeGame.create(20261012, 'challenging')
    for (let step = 0; step < 60 && tictactoeGame.status(state) === 'playing'; step++) {
      if (tictactoeGame.tickMs!(state, 'challenging') !== null) {
        state = tictactoeGame.reduce(state, { type: 'tick' })
        continue
      }
      // 玩家这边一律走壳层的点击路径：点某一格 → selectAction → reduce
      const cells = emptyCells(boardOf(state))
      const action = tictactoeGame.selectAction!(state, cells[rng.int(cells.length)]!)
      expect(action).not.toBeNull()
      state = tictactoeGame.reduce(state, action!)
    }
    expect(tictactoeGame.status(state)).not.toBe('playing')
    expect(tictactoeGame.view(state).result?.titleKey).toBeTruthy()
  })
})

describe('同种子同结果', () => {
  /** 同一串玩家落点走完（每一步都把对手的应手走完） */
  function playWithSeed(seed: number, indexes: readonly number[]): TictactoeState {
    let state = createState(seed, 'starter')
    for (const index of indexes) state = settle(play(state, index))
    return state
  }

  it('同种子 + 同玩家动作序列 → 完全一致的存档（含对手的每一手）', () => {
    // 只走两手玩家的棋：再多就可能已经分出胜负（终局后不再接受落子）
    const moves = [0, 8]
    const first = playWithSeed(20261010, moves)
    const second = playWithSeed(20261010, moves)
    expect(JSON.stringify(encodeState(second))).toBe(JSON.stringify(encodeState(first)))
    expect(first.log).toHaveLength(4)
  })

  it('不同种子会让对手走出不同的应手（种子真的用上了）', () => {
    const replies = new Set<number>()
    for (let seed = 0; seed < 30; seed++) {
      const state = settle(play(createState(seed, 'starter'), 0))
      replies.add(state.log[1]!)
    }
    expect(replies.size).toBeGreaterThan(1)
  })
})

describe('存档往返（属性测试）', () => {
  it('四档难度各随机走 60 步合法动作，每一步 encode→decode 都往返一致', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      const rng = createRng(20261011)
      let state = createState(20261011, difficulty)
      for (let step = 0; step < 60; step++) {
        const actions = legalActions(state)
        expect(actions.length).toBeGreaterThan(0)
        const action = actions[rng.int(actions.length)]!
        state = reduceState(state, action)
        // 关键断言：游戏自己走出来的状态，必须能被自己的 decode 接受
        const raw = JSON.parse(JSON.stringify(encodeState(state)))
        const decoded = decodeState(raw)
        expect(JSON.stringify(encodeState(decoded))).toBe(JSON.stringify(raw))
        expect(decoded).toEqual(state)
      }
    }
  })
})

describe('双人同屏', () => {
  it('两个人轮流点格子：✕ → ○ → ✕；没有电脑、也不起定时器', () => {
    const state = createState(1, 'hotseat')
    expect(turnOf(state)).toBe(FIRST)
    const afterP1 = play(state, 4)
    expect(turnOf(afterP1)).toBe(SECOND)
    // 轮到玩家二：同一格棋盘点下去落到 ○ 身上
    expect(selectAction(afterP1, 0)).toEqual({ type: 'place', index: 0 })
    const afterP2 = play(afterP1, 0)
    expect(turnOf(afterP2)).toBe(FIRST)
    // 玩家一 ✕ 在中心、玩家二 ○ 在左上角
    expect(ascii(boardOf(afterP2))).toEqual(['O..', '.X.', '...'])
    expect(tictactoeGame.tickMs!(afterP2, 'hotseat')).toBeNull()
  })

  it('终局标题写清是哪一位赢（或和局），状态一律非 playing', () => {
    const p1 = stateOf([...FIRST_WINS], { difficulty: 'hotseat' })
    const p2 = stateOf([...SECOND_WINS], { difficulty: 'hotseat' })
    const draw = stateOf([...DRAW_LOG], { difficulty: 'hotseat' })
    expect(tictactoeGame.view(p1).result!.titleKey).toBe('tictactoe.won.p1')
    expect(tictactoeGame.view(p2).result!.titleKey).toBe('tictactoe.won.p2')
    expect(tictactoeGame.view(draw).result!.titleKey).toBe('tictactoe.draw.title')
    for (const state of [p1, p2, draw]) {
      expect(tictactoeGame.status(state)).toBe('won')
      // 同屏没有「你」这个视角：不记通关进度与最佳成绩，只留一条历史记录
      expect(tictactoeGame.outcomeOf!(state)).toBe('draw')
    }
  })
})

describe('计分口径', () => {
  it('movesOf = 本局总手数；contentId = 难度', () => {
    const state = settle(play(createState(1, 'starter'), 0))
    expect(movesOf(state)).toBe(2)
    expect(tictactoeGame.movesOf!(state)).toBe(2)
    expect(tictactoeGame.contentId!(state)).toBe('starter')
  })

  it('真实结果：先手赢 = won、后手赢 = lost、满盘 = draw', () => {
    expect(tictactoeGame.outcomeOf!(stateOf([...FIRST_WINS], { difficulty: 'starter' }))).toBe('won')
    expect(tictactoeGame.outcomeOf!(stateOf([...SECOND_WINS], { difficulty: 'starter' }))).toBe('lost')
    expect(tictactoeGame.outcomeOf!(stateOf([...DRAW_LOG], { difficulty: 'starter' }))).toBe('draw')
    // status 把和局并入 won（否则结果面板不出来），真实结果仍如实上报
    expect(tictactoeGame.status(stateOf([...DRAW_LOG], { difficulty: 'starter' }))).toBe('won')
    expect(outcomeOf(stateOf([...DRAW_LOG], { difficulty: 'starter' }))).toBe('draw')
    expect(boardOf(stateOf([...DRAW_LOG])).filter((mark) => mark === EMPTY)).toHaveLength(0)
    expect(at(2, 1)).toBe(7)
  })
})
