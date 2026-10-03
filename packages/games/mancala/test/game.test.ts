/**
 * GameDef 外壳集成测试：view / controls / stats / encode / decode / 元信息 / 属性测试 / 性能。
 */
import { describe, expect, it } from 'vitest'
import { IllegalActionError, createRng } from '@eink/core'
import {
  BLACK,
  CELLS,
  COLS,
  DIFFICULTY_IDS,
  EMPTY_PIT_GLYPH,
  EMPTY_PIT_TEXT_SCALE,
  PIT_TEXT_SCALES,
  ROWS,
  STORE_TEXT_SCALES,
  WHITE,
  mancalaGame,
  reduceMancala,
  selectAction,
  storeCount,
  textScaleFor,
  totalStones,
  type MancalaState,
} from '../src/index.js'
import { INITIAL_TOTAL, drawCells, fresh, playToEnd, withCells } from './helpers.js'

function sow(state: MancalaState, index: number): MancalaState {
  return mancalaGame.reduce(state, { type: 'sow', index })
}

function legalBlackPits(state: MancalaState): number[] {
  return [7, 8, 9, 10, 11, 12].filter((pit) => (state.cells[pit] ?? 0) > 0)
}

/** 构造一个已结束的局面（坑全空，仓按参数给） */
function finishedState(mine: number, theirs: number): MancalaState {
  const base = fresh(1, 'starter')
  const cells = new Array<number>(CELLS).fill(0)
  cells[0] = theirs
  cells[13] = mine
  return { ...base, cells }
}

describe('元信息与注册表接口', () => {
  it('GameDef 元信息符合契约', () => {
    expect(mancalaGame.id).toBe('mancala')
    expect(mancalaGame.i18nNamespace).toBe('mancala')
    expect(mancalaGame.rulesVersion).toBeGreaterThanOrEqual(1)
    expect(mancalaGame.contentVersion).toBeGreaterThanOrEqual(1)
    expect(mancalaGame.illegalNoticeKey).toBe('mancala.illegal.notice')
    expect(mancalaGame.difficulties.map((item) => item.id)).toEqual([...DIFFICULTY_IDS])
    expect(mancalaGame.difficulties.map((item) => item.labelKey)).toEqual([
      'mancala.difficulty.starter',
      'mancala.difficulty.skilled',
      'mancala.difficulty.challenging',
    ])
    expect((mancalaGame as { levels?: unknown }).levels).toBeUndefined()
  })

  it('contentId = 难度，movesOf = 玩家播种次数', () => {
    const state = fresh(1, 'skilled')
    expect(mancalaGame.contentId!(state)).toBe('skilled')
    expect(mancalaGame.movesOf!(state)).toBe(0)
    const played = sow(state, 12)
    expect(mancalaGame.movesOf!(played)).toBe(1)
    expect(mancalaGame.contentId!(fresh(1, 'challenging'))).toBe('challenging')
  })

  it('controlAction 把撤销/重开映射成动作，未知 id 返回 null', () => {
    const state = fresh()
    expect(mancalaGame.controlAction!(state, 'undo')).toEqual({ type: 'undo' })
    expect(mancalaGame.controlAction!(state, 'restart')).toEqual({ type: 'restart' })
    expect(mancalaGame.controlAction!(state, 'next-level')).toBeNull()
  })

  it('create 拒绝未知难度；三档都是 2×7、每坑 4 颗', () => {
    expect(() => mancalaGame.create(0, 'impossible')).toThrow(IllegalActionError)
    for (const difficulty of DIFFICULTY_IDS) {
      const view = mancalaGame.view(mancalaGame.create(3, difficulty))
      expect(view.board!.cols).toBe(COLS)
      expect(view.board!.rows).toBe(ROWS)
      expect(view.board!.cells).toHaveLength(CELLS)
    }
  })
})

describe('view / 1-bit 呈现约定', () => {
  it('2 行 × 7 列、14 格、没有分组线；仓是 number、有石子的坑是 tile、空坑是 floor+·', () => {
    const state = fresh(1, 'starter')
    const view = mancalaGame.view(state)
    expect(view.board!.kind).toBe('grid')
    expect(view.board!.groups).toBeUndefined()
    expect(view.board!.cells).toHaveLength(CELLS)
    view.board!.cells.forEach((cell, index) => expect(cell.index).toBe(index))
    // 两个仓
    expect(view.board!.cells[0]).toEqual({
      index: 0,
      kind: 'number',
      glyph: '0',
      textScale: STORE_TEXT_SCALES[0],
    })
    expect(view.board!.cells[13]).toEqual({
      index: 13,
      kind: 'number',
      glyph: '0',
      textScale: STORE_TEXT_SCALES[0],
    })
    // 有石子的坑：数字字形
    for (const pit of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
      expect(view.board!.cells[pit], `pit ${pit}`).toEqual({
        index: pit,
        kind: 'tile',
        glyph: '4',
        textScale: PIT_TEXT_SCALES[0],
      })
    }
    // 空坑：floor + 小点
    const empty = mancalaGame.view(withCells([[7, 0]]))
    expect(empty.board!.cells[7]).toEqual({
      index: 7,
      kind: 'floor',
      glyph: EMPTY_PIT_GLYPH,
      textScale: EMPTY_PIT_TEXT_SCALE,
    })
  })

  it('两位数/三位数逐级缩小字号（仓与坑各有自己的档位）', () => {
    expect(textScaleFor(4, 'pit')).toBe(0.62)
    expect(textScaleFor(12, 'pit')).toBe(0.5)
    expect(textScaleFor(123, 'pit')).toBe(0.42)
    expect(textScaleFor(4, 'store')).toBe(0.55)
    expect(textScaleFor(12, 'store')).toBe(0.45)
    expect(textScaleFor(123, 'store')).toBe(0.38)
    const state = withCells([
      [7, 12],
      [8, 105],
    ])
    const cells = mancalaGame.view(state).board!.cells
    expect(cells[7]).toEqual({ index: 7, kind: 'tile', glyph: '12', textScale: 0.5 })
    expect(cells[8]).toEqual({ index: 8, kind: 'tile', glyph: '105', textScale: 0.42 })
  })

  it('stats 恰好三项恒定输出：黑方仓 / 白方仓 / 步数', () => {
    const state = fresh(1, 'starter')
    expect(mancalaGame.view(state).stats).toEqual([
      { labelKey: 'mancala.stat.black', value: '0' },
      { labelKey: 'mancala.stat.white', value: '0' },
      { labelKey: 'mancala.stat.moves', value: '0' },
    ])
    const played = sow(state, 12)
    const view = mancalaGame.view(played)
    expect(view.stats[0]).toEqual({
      labelKey: 'mancala.stat.black',
      value: String(storeCount(played.cells, BLACK)),
    })
    expect(view.stats[1]).toEqual({
      labelKey: 'mancala.stat.white',
      value: String(storeCount(played.cells, WHITE)),
    })
    expect(view.stats[2]).toEqual({ labelKey: 'mancala.stat.moves', value: '1' })
  })

  it('进行中没有结果；胜/负/平各自给出结果标题与明细', () => {
    expect(mancalaGame.view(fresh()).result).toBeNull()
    expect(mancalaGame.view(fresh()).notice).toBeNull()

    const win = mancalaGame.view(finishedState(26, 22)).result!
    expect(win.titleKey).toBe('mancala.won.title')
    expect(win.details).toEqual([
      { key: 'mancala.result.black', params: { count: 26 } },
      { key: 'mancala.result.white', params: { count: 22 } },
    ])
    const lose = mancalaGame.view(finishedState(20, 28)).result!
    expect(lose.titleKey).toBe('mancala.lost.title')
    const draw = mancalaGame.view(finishedState(24, 24)).result!
    expect(draw.titleKey).toBe('mancala.draw.title')
  })

  it('真实终局也给出结果（胜负与账面一致）', () => {
    const finished = playToEnd(2024, 'skilled', sow)
    const mine = storeCount(finished.cells, BLACK)
    const theirs = storeCount(finished.cells, WHITE)
    const expected = mine > theirs ? 'won' : mine < theirs ? 'lost' : 'draw'
    expect(mancalaGame.view(finished).result!.titleKey).toBe(`mancala.${expected}.title`)
    expect(totalStones(finished.cells)).toBe(INITIAL_TOTAL)
    expect(maxDigits(finished.cells)).toBeLessThanOrEqual(3)
  })
})

function maxDigits(cells: readonly number[]): number {
  return Math.max(...cells.map((count) => String(count).length))
}

describe('controls', () => {
  it('只声明撤销，不声明 dpad / restart / next-level', () => {
    const controls = mancalaGame.controls(fresh())
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

  it('播过一次之后 undo 才可用', () => {
    const state = fresh()
    expect(mancalaGame.controls(sow(state, 7))[0]!.enabled).toBe(true)
  })
})

describe('encode / decode', () => {
  it('初始 / 中盘 / 终局状态都严格往返', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      const state = fresh(2024, difficulty)
      expect(mancalaGame.decode(mancalaGame.encode(state))).toEqual(state)
      expect(
        mancalaGame.decode(JSON.parse(JSON.stringify(mancalaGame.encode(state)))),
      ).toEqual(state)
    }
    let state = fresh(17, 'challenging')
    for (let turn = 0; turn < 3; turn++) state = sow(state, legalBlackPits(state)[0]!)
    expect(mancalaGame.decode(mancalaGame.encode(state))).toEqual(state)
    const finished = playToEnd(9, 'starter', sow)
    expect(mancalaGame.decode(mancalaGame.encode(finished))).toEqual(finished)
  })

  it('坏数据一律抛 IllegalActionError（GameDef 入口）', () => {
    let played = fresh(23, 'starter')
    played = sow(played, 12)
    const raw = mancalaGame.encode(played) as Record<string, unknown>
    const bad: unknown[] = [
      null,
      undefined,
      'state',
      {},
      { ...raw, difficulty: 'nope' },
      {
        ...raw,
        cells: (raw.cells as number[]).map((count, index) => (index === 7 ? count + 1 : count)),
      },
      { ...raw, turn: 'white' },
      { ...raw, moves: (raw.moves as number) + 1 },
      { ...raw, log: [3] },
      { ...raw, log: [] },
    ]
    for (const candidate of bad) {
      expect(() => mancalaGame.decode(candidate), JSON.stringify(candidate)?.slice(0, 90)).toThrow(
        IllegalActionError,
      )
    }
  })
})

describe('属性测试', () => {
  it('随机 60 步合法动作：每步 encode→decode 往返一致、石子守恒、终局后拒绝动作', () => {
    const rng = createRng(20240607)
    let state = fresh(20240607, 'skilled')
    let applied = 0
    let guard = 0
    let finishedSeen = 0
    while (applied < 60 && guard++ < 200000) {
      const action = selectAction(state, rng.int(CELLS))
      if (action !== null && action.type !== 'sow') continue
      if (action === null) {
        // 没有可点的格子 ⇒ 只可能是对局已结束：此时必须彻底拒绝
        const legal = legalBlackPits(state)
        if (legal.length === 0) {
          finishedSeen += 1
          for (let index = 0; index < CELLS; index++) expect(selectAction(state, index)).toBeNull()
          expect(() => sow(state, 7)).toThrow(IllegalActionError)
          state = reduceMancala(state, { type: 'restart' })
        }
        continue
      }
      state = sow(state, action.index)
      applied += 1

      // 石子守恒：14 格总数恒为 48
      expect(totalStones(state.cells), `step ${applied}\n${drawCells(state.cells)}`).toBe(
        INITIAL_TOTAL,
      )
      const encoded = mancalaGame.encode(state)
      const decoded = mancalaGame.decode(encoded)
      expect(decoded, `step ${applied}`).toEqual(state)
      expect(mancalaGame.encode(decoded)).toEqual(encoded)
      expect(mancalaGame.decode(JSON.parse(JSON.stringify(encoded))), `step ${applied}`).toEqual(
        state,
      )
      expect(mancalaGame.legal(decoded).length).toBeGreaterThan(0)
      state = decoded
    }
    expect(applied).toBe(60)
    expect(finishedSeen).toBeGreaterThan(0)
  })

  it('终局后不再接受任何动作（含 selectAction 与 reduce）', () => {
    let state = fresh(31, 'starter')
    let guard = 0
    while (isPlaying(state) && guard++ < 500) {
      state = sow(state, legalBlackPits(state)[0]!)
    }
    expect(isPlaying(state)).toBe(false)
    for (let index = 0; index < CELLS; index++) expect(selectAction(state, index)).toBeNull()
    const legal = mancalaGame.legal(state)
    expect(legal.some((action) => action.type === 'sow')).toBe(false)
    expect(legal).toContainEqual({ type: 'undo' })
    expect(() => sow(state, 7)).toThrow(IllegalActionError)
  })
})

function isPlaying(state: MancalaState): boolean {
  return legalBlackPits(state).length > 0 && [1, 2, 3, 4, 5, 6].some((pit) => (state.cells[pit] ?? 0) > 0)
}

describe('性能', () => {
  it('challenging 整回合应手 < 500ms；单次 decode < 50ms', () => {
    let worst = 0
    let state = fresh(7, 'challenging')
    for (let turn = 0; turn < 10 && isPlaying(state); turn++) {
      const started = performance.now()
      state = sow(state, legalBlackPits(state)[0]!)
      const elapsed = performance.now() - started
      if (elapsed > worst) worst = elapsed
    }
    expect(worst).toBeLessThan(500)

    const started = performance.now()
    mancalaGame.decode(mancalaGame.encode(state))
    expect(performance.now() - started).toBeLessThan(50)
  })
})
