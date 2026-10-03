/**
 * GameDef 外壳集成测试：view / controls / stats / encode / decode / 元信息 /
 * 三种起始布局的可解性（独立求解器 + 规则层执行）/ 属性测试 / 性能。
 */
import { describe, expect, it } from 'vitest'
import { IllegalActionError, createRng } from '@eink/core'
import {
  BOARD_SIZE,
  DIFFICULTIES,
  DIFFICULTY_IDS,
  HOLE_INDEXES,
  PEG_GLYPH,
  PEG_TEXT_SCALE,
  countPegs,
  indexOf,
  isHole,
  legalActions,
  pegsolitaireGame,
  type PegState,
} from '../src/index.js'
import { boardWith, fixtureState, solvePegSolitaire } from './helpers.js'

/** 在真实局面上走一步合法跳吃（返回新局面） */
function playOneJump(state: PegState): PegState {
  const jump = legalActions(state).find(
    (action): action is { type: 'jump'; from: number; to: number } => action.type === 'jump',
  )!
  const selected = pegsolitaireGame.reduce(state, { type: 'select', index: jump.from })
  return pegsolitaireGame.reduce(selected, { type: 'jump', from: jump.from, to: jump.to })
}

describe('元信息与注册表接口', () => {
  it('GameDef 元信息符合契约', () => {
    expect(pegsolitaireGame.id).toBe('pegsolitaire')
    expect(pegsolitaireGame.i18nNamespace).toBe('pegsolitaire')
    expect(pegsolitaireGame.rulesVersion).toBeGreaterThanOrEqual(1)
    expect(pegsolitaireGame.contentVersion).toBeGreaterThanOrEqual(1)
    expect(pegsolitaireGame.illegalNoticeKey).toBe('pegsolitaire.illegal.notice')
    expect(pegsolitaireGame.difficulties.map((item) => item.id)).toEqual([...DIFFICULTY_IDS])
    expect(pegsolitaireGame.difficulties.map((item) => item.labelKey)).toEqual([
      'pegsolitaire.difficulty.starter',
      'pegsolitaire.difficulty.skilled',
      'pegsolitaire.difficulty.challenging',
    ])
    // 无关卡玩法：不要声明 levels
    expect((pegsolitaireGame as { levels?: unknown }).levels).toBeUndefined()
  })

  it('contentId = 难度，movesOf = 跳吃次数', () => {
    const state = playOneJump(pegsolitaireGame.create(0, 'skilled'))
    expect(pegsolitaireGame.contentId!(state)).toBe('skilled')
    expect(pegsolitaireGame.movesOf!(state)).toBe(1)
    expect(pegsolitaireGame.contentId!(pegsolitaireGame.create(0, 'challenging'))).toBe(
      'challenging',
    )
  })

  it('controlAction 把撤销/重开映射成动作，未知 id 返回 null', () => {
    const state = pegsolitaireGame.create(0, 'starter')
    expect(pegsolitaireGame.controlAction!(state, 'undo')).toEqual({ type: 'undo' })
    expect(pegsolitaireGame.controlAction!(state, 'restart')).toEqual({ type: 'restart' })
    expect(pegsolitaireGame.controlAction!(state, 'next-level')).toBeNull()
  })

  it('未知难度拒绝', () => {
    expect(() => pegsolitaireGame.create(0, 'impossible')).toThrow(IllegalActionError)
  })
})

describe('view / 1-bit 呈现约定', () => {
  it('7×7 棋盘、49 格、行优先索引，且没有分组线', () => {
    const view = pegsolitaireGame.view(pegsolitaireGame.create(0, 'starter'))
    expect(view.board).not.toBeNull()
    expect(view.board!.kind).toBe('grid')
    expect(view.board!.cols).toBe(BOARD_SIZE)
    expect(view.board!.rows).toBe(BOARD_SIZE)
    expect(view.board!.cells).toHaveLength(BOARD_SIZE * BOARD_SIZE)
    view.board!.cells.forEach((cell, index) => expect(cell.index).toBe(index))
    // 棋盘没有宫结构：多一层线只会更花
    expect(view.board!.groups).toBeUndefined()
  })

  it('缺角是 wall、空孔是 empty、棋子是 tile + ● + textScale 0.6', () => {
    const state = pegsolitaireGame.create(0, 'starter')
    const cells = pegsolitaireGame.view(state).board!.cells
    expect(cells[indexOf(0, 0)]).toEqual({ index: indexOf(0, 0), kind: 'wall', glyph: '' })
    expect(cells[indexOf(3, 3)]).toEqual({ index: indexOf(3, 3), kind: 'empty', glyph: '' })
    expect(cells[indexOf(2, 2)]).toEqual({
      index: indexOf(2, 2),
      kind: 'tile',
      glyph: PEG_GLYPH,
      textScale: PEG_TEXT_SCALE,
    })
    expect(cells.filter((cell) => cell.kind === 'wall')).toHaveLength(16)
    expect(cells.filter((cell) => cell.kind === 'empty')).toHaveLength(1)
    expect(cells.filter((cell) => cell.kind === 'tile')).toHaveLength(32)
  })

  it('被选中的棋子标 selected: true（壳层重描边），取消后不再标', () => {
    const state = pegsolitaireGame.create(0, 'starter')
    const peg = indexOf(2, 2)
    const selected = pegsolitaireGame.reduce(state, { type: 'select', index: peg })
    const cells = pegsolitaireGame.view(selected).board!.cells
    expect(cells[peg]!.selected).toBe(true)
    expect(cells.filter((cell) => cell.selected === true)).toHaveLength(1)
    // 其他棋子不带 selected 字段
    const other = indexOf(4, 2)
    expect(cells[other]!.selected).toBeUndefined()
    const cancelled = pegsolitaireGame.reduce(selected, { type: 'select', index: peg })
    expect(
      pegsolitaireGame.view(cancelled).board!.cells.filter((cell) => cell.selected === true),
    ).toHaveLength(0)
  })

  it('stats 恰好三项：剩余棋子 / 跳吃次数 / 还需跳吃', () => {
    const state = playOneJump(pegsolitaireGame.create(0, 'starter'))
    const view = pegsolitaireGame.view(state)
    const pegs = countPegs(state.pegs)
    expect(view.stats).toEqual([
      { labelKey: 'pegsolitaire.stat.pegs', value: String(pegs) },
      { labelKey: 'pegsolitaire.stat.moves', value: '1' },
      // 每跳一次恰好少一枚棋子 ⇒ 还需跳 pegs − 1 次
      { labelKey: 'pegsolitaire.stat.remaining', value: String(pegs - 1) },
    ])
  })

  it('进行中没有结果与提示；只剩一枚棋子后给出结果标题与明细', () => {
    const playing = pegsolitaireGame.create(0, 'starter')
    expect(pegsolitaireGame.view(playing).result).toBeNull()
    expect(pegsolitaireGame.view(playing).notice).toBeNull()

    const won = fixtureState(boardWith([indexOf(2, 4)]), { moves: 31 })
    expect(pegsolitaireGame.status(won)).toBe('won')
    const result = pegsolitaireGame.view(won).result!
    expect(result.titleKey).toBe('pegsolitaire.won.title')
    expect(result.details).toEqual([
      { key: 'pegsolitaire.result.moves', params: { count: 31 } },
      { key: 'pegsolitaire.result.pegs', params: { count: 1 } },
    ])
  })
})

describe('controls', () => {
  it('只声明撤销（点格子是主要输入），不声明 dpad / 重开 / 下一关', () => {
    const controls = pegsolitaireGame.controls(pegsolitaireGame.create(0, 'starter'))
    expect(controls).toHaveLength(1)
    const undo = controls[0]!
    expect(undo.id).toBe('undo')
    expect(undo.role).toBe('action')
    expect(undo.labelKey).toBe('shell.game.undo')
    expect(undo.enabled).toBe(false)
    expect(controls.some((control) => control.role === 'dpad')).toBe(false)
    expect(controls.some((control) => control.id === 'restart')).toBe(false)
    expect(controls.some((control) => control.id === 'next-level')).toBe(false)
  })

  it('跳吃过之后 undo 才可用；仅选中不算', () => {
    const state = pegsolitaireGame.create(0, 'starter')
    const selected = pegsolitaireGame.reduce(state, {
      type: 'select',
      index: indexOf(2, 2),
    })
    expect(pegsolitaireGame.controls(selected)[0]!.enabled).toBe(false)
    expect(pegsolitaireGame.controls(playOneJump(state))[0]!.enabled).toBe(true)
  })
})

describe('三种起始布局都可解（独立求解器 + 规则层执行）', () => {
  it('每档难度都能解出「只剩 1 枚」的完整序列，并按规则层走到 won', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      const start = pegsolitaireGame.create(0, difficulty)
      const result = solvePegSolitaire(start.pegs)
      // 触到节点上限说明结论不可信，必须显式失败
      expect(result.exhausted, `${difficulty} 求解超时`).toBe(false)
      expect(result.solution, `${difficulty} 应当有解`).not.toBeNull()
      // 每跳一次恰好少一枚棋子 ⇒ 解的长度必然是「起始棋子数 − 1」
      expect(result.solution!.length, difficulty).toBe(countPegs(start.pegs) - 1)

      let state = start
      for (const jump of result.solution!) {
        state = pegsolitaireGame.reduce(state, { type: 'select', index: jump.from })
        state = pegsolitaireGame.reduce(state, { type: 'jump', from: jump.from, to: jump.to })
      }
      expect(countPegs(state.pegs), difficulty).toBe(1)
      expect(pegsolitaireGame.status(state), difficulty).toBe('won')
      expect(state.moves).toBe(result.solution!.length)
      expect(state.history).toHaveLength(state.moves)
      // 解开后的局面也能严格往返
      expect(pegsolitaireGame.decode(pegsolitaireGame.encode(state))).toEqual(state)
    }
  }, 20000)

  it('起始布局的棋子数符合预期（starter 32 枚，其余 31 枚）', () => {
    expect(countPegs(pegsolitaireGame.create(0, 'starter').pegs)).toBe(32)
    expect(countPegs(pegsolitaireGame.create(0, 'skilled').pegs)).toBe(31)
    expect(countPegs(pegsolitaireGame.create(0, 'challenging').pegs)).toBe(31)
    expect(DIFFICULTIES.starter.emptyHoles).toHaveLength(1)
    expect(DIFFICULTIES.skilled.emptyHoles).toHaveLength(2)
    expect(DIFFICULTIES.challenging.emptyHoles).toHaveLength(2)
  })
})

describe('求解器区分度（证明它不是恒真 / 恒假）', () => {
  it('构造的无解布局会被判定为无解（未触上限）', () => {
    // 唯一一步跳吃之后剩两枚隔着一枚空孔的棋子，再也跳不动
    const deadEnd = boardWith([indexOf(2, 2), indexOf(2, 3), indexOf(2, 6)])
    const dead = solvePegSolitaire(deadEnd)
    expect(dead.exhausted).toBe(false)
    expect(dead.solution).toBeNull()

    // 两枚棋子离得远，一步也跳不了
    const stuck = boardWith([indexOf(0, 2), indexOf(6, 4)])
    const noMoves = solvePegSolitaire(stuck)
    expect(noMoves.exhausted).toBe(false)
    expect(noMoves.solution).toBeNull()
  })

  it('同一个求解器对可解小局面能给出解，并能被规则层执行到 won', () => {
    const oneJump = boardWith([indexOf(2, 2), indexOf(2, 3)])
    const result = solvePegSolitaire(oneJump)
    expect(result.exhausted).toBe(false)
    expect(result.solution).toHaveLength(1)

    let state = fixtureState(oneJump)
    for (const jump of result.solution!) {
      state = pegsolitaireGame.reduce(state, { type: 'select', index: jump.from })
      state = pegsolitaireGame.reduce(state, { type: 'jump', from: jump.from, to: jump.to })
    }
    expect(pegsolitaireGame.status(state)).toBe('won')
  })
})

describe('encode / decode', () => {
  it('初始与中盘状态往返一致（含 JSON 往返）', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      const state = pegsolitaireGame.create(0, difficulty)
      expect(pegsolitaireGame.decode(pegsolitaireGame.encode(state))).toEqual(state)
      expect(
        pegsolitaireGame.decode(JSON.parse(JSON.stringify(pegsolitaireGame.encode(state)))),
      ).toEqual(state)
    }
    const played = playOneJump(pegsolitaireGame.create(0, 'skilled'))
    expect(played.history).toHaveLength(1)
    const decoded = pegsolitaireGame.decode(pegsolitaireGame.encode(played))
    expect(decoded).toEqual(played)
    expect(pegsolitaireGame.encode(decoded)).toEqual(pegsolitaireGame.encode(played))
  })

  it('选中态也随存档往返', () => {
    const state = pegsolitaireGame.reduce(pegsolitaireGame.create(0, 'starter'), {
      type: 'select',
      index: indexOf(2, 2),
    })
    const decoded = pegsolitaireGame.decode(pegsolitaireGame.encode(state))
    expect(decoded.selected).toBe(indexOf(2, 2))
    expect(decoded).toEqual(state)
  })

  it('坏数据一律抛 IllegalActionError', () => {
    const played = playOneJump(pegsolitaireGame.create(0, 'starter'))
    const raw = pegsolitaireGame.encode(played) as {
      difficulty: string
      pegs: boolean[]
      selected: number | null
      moves: number
      history: Array<{ from: number; to: number; jumped: number }>
    }
    const emptyHole = raw.pegs.findIndex((peg, index) => !peg && isHole(index))
    const pegHole = raw.pegs.findIndex((peg) => peg)
    const record = raw.history[0]!
    const bad: unknown[] = [
      null,
      undefined,
      42,
      'state',
      {},
      [],
      { ...raw, difficulty: 'impossible' },
      { ...raw, pegs: 'nope' },
      { ...raw, pegs: raw.pegs.slice(0, raw.pegs.length - 1) },
      { ...raw, pegs: [...raw.pegs, false] },
      { ...raw, pegs: raw.pegs.map((peg, index) => (index === 0 ? 1 : peg)) },
      // 非孔位（缺角）上凭空多出棋子
      { ...raw, pegs: raw.pegs.map((peg, index) => (index === indexOf(0, 0) ? true : peg)) },
      // 棋子数凭空变化：拿走一枚 / 多放一枚
      { ...raw, pegs: raw.pegs.map((peg, index) => (index === pegHole ? false : peg)) },
      { ...raw, pegs: raw.pegs.map((peg, index) => (index === emptyHole ? true : peg)) },
      // 选中不存在的棋子 / 非法选中值
      { ...raw, selected: emptyHole },
      { ...raw, selected: indexOf(0, 0) },
      { ...raw, selected: -1 },
      { ...raw, selected: 1.5 },
      { ...raw, selected: 49 },
      { ...raw, moves: -1 },
      { ...raw, moves: 1.5 },
      { ...raw, moves: raw.moves - 1 },
      { ...raw, moves: raw.moves + 1 },
      { ...raw, history: 'nope' },
      { ...raw, history: [] },
      { ...raw, history: [null] },
      // 记录里的 from/to 不是孔位
      { ...raw, history: [{ from: indexOf(0, 0), to: record.to, jumped: record.jumped }] },
      { ...raw, history: [{ from: record.from, to: indexOf(0, 0), jumped: record.jumped }] },
      // 斜线（jumpedIndex 推不出来）
      {
        ...raw,
        history: [
          { from: indexOf(3, 3), to: indexOf(4, 4), jumped: indexOf(4, 3) },
        ],
      },
      // jumped 字段与 from/to 推算不一致
      {
        ...raw,
        history: [{ from: record.from, to: record.to, jumped: record.jumped + 1 }],
      },
      // 重放不合法：第一步就落在有棋子的孔上
      {
        ...raw,
        history: [{ from: indexOf(0, 2), to: indexOf(2, 2), jumped: indexOf(1, 2) }],
      },
      // 重放结果与棋子表不一致（历史被截断 / 凭空改棋子）
      { ...raw, pegs: raw.pegs.map((peg) => !peg) },
    ]
    for (const candidate of bad) {
      expect(
        () => pegsolitaireGame.decode(candidate),
        JSON.stringify(candidate)?.slice(0, 120),
      ).toThrow(IllegalActionError)
    }
  })

  it('正常存档的重放校验是宽松的：合法中盘/终局都能解码', () => {
    let state = pegsolitaireGame.create(0, 'starter')
    for (let step = 0; step < 3; step++) state = playOneJump(state)
    expect(pegsolitaireGame.decode(pegsolitaireGame.encode(state))).toEqual(state)
    expect(pegsolitaireGame.status(state)).toBe('playing')
  })
})

describe('属性测试', () => {
  it('随机 60 步合法点击：每步 encode→decode 往返一致且能继续', () => {
    const rng = createRng(20240607)
    let state = pegsolitaireGame.create(0, 'starter')
    let applied = 0
    let guard = 0
    while (applied < 60 && guard++ < 20000) {
      // 模拟随机点击：空孔且无选中时 selectAction 返回 null（点了没反应），跳过即可
      const index = rng.int(BOARD_SIZE * BOARD_SIZE)
      const action = pegsolitaireGame.selectAction!(state, index)
      if (action === null) continue
      state = pegsolitaireGame.reduce(state, action)
      applied += 1

      const encoded = pegsolitaireGame.encode(state)
      const decoded = pegsolitaireGame.decode(encoded)
      expect(decoded, `step ${applied}`).toEqual(state)
      expect(pegsolitaireGame.encode(decoded)).toEqual(encoded)
      expect(pegsolitaireGame.decode(JSON.parse(JSON.stringify(encoded))), `step ${applied}`).toEqual(
        state,
      )
      // 还能继续：要么还有棋子可点，要么已经只剩一枚（won）
      expect(state.pegs.some((peg) => peg) || pegsolitaireGame.status(state) === 'won').toBe(true)
      state = decoded
      // 极小概率随机点到只剩一枚：重开后继续，保证循环始终有合法点击
      if (pegsolitaireGame.status(state) === 'won') {
        state = pegsolitaireGame.reduce(state, { type: 'restart' })
      }
    }
    expect(applied).toBe(60)
    expect(state.history).toHaveLength(state.moves)
  })

  it('随机点击不会踩到非孔位，跳吃恰好让棋子数 −1', () => {
    const rng = createRng(7)
    let state = pegsolitaireGame.create(0, 'challenging')
    for (let step = 0; step < 60; step++) {
      if (pegsolitaireGame.status(state) === 'won') {
        state = pegsolitaireGame.reduce(state, { type: 'restart' })
      }
      const index = rng.int(BOARD_SIZE * BOARD_SIZE)
      const action = pegsolitaireGame.selectAction!(state, index)
      if (action === null) continue
      const before = countPegs(state.pegs)
      state = pegsolitaireGame.reduce(state, action)
      // 非孔位永远没有棋子
      for (let i = 0; i < state.pegs.length; i++) {
        if (!isHole(i)) expect(state.pegs[i], `index ${i}`).toBe(false)
      }
      // 跳吃恰好拿掉一枚棋子；纯选中不改变棋子数
      expect(countPegs(state.pegs)).toBe(action.type === 'jump' ? before - 1 : before)
    }
    expect(HOLE_INDEXES).toHaveLength(33)
  })
})

describe('性能', () => {
  it('生成 + 解码三档难度都远低于宽松上限（< 300ms）', () => {
    const started = performance.now()
    for (const difficulty of DIFFICULTY_IDS) {
      for (let repeat = 0; repeat < 20; repeat++) {
        pegsolitaireGame.decode(pegsolitaireGame.encode(pegsolitaireGame.create(0, difficulty)))
      }
    }
    expect(performance.now() - started).toBeLessThan(300)
  })

  it('独立求解器在节点上限内解出 starter（性能护栏）', () => {
    const result = solvePegSolitaire(pegsolitaireGame.create(0, 'starter').pegs, 2_000_000)
    expect(result.exhausted).toBe(false)
    expect(result.solution).not.toBeNull()
  })
})
