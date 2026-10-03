/**
 * GameDef 外壳集成测试：view / controls / stats / encode / decode / 元信息 / 属性测试 / 性能。
 */
import { describe, expect, it } from 'vitest'
import { IllegalActionError, createRng } from '@eink/core'
import {
  BLACK,
  BLACK_GLYPH,
  BOARD_SIZE,
  GRID_CELLS,
  OPTION_GLYPH,
  OPTION_TEXT_SCALE,
  POINT_COUNT,
  STONE_TEXT_SCALE,
  WHITE,
  WHITE_GLYPH,
  boardCount,
  emptyPoints,
  gameStatus,
  gridIndexOf,
  isPointAtGrid,
  ninemensGame,
  pointAtGrid,
  reduceNinemens,
  selectAction,
  stuckPlayer,
  type NinemensState,
} from '../src/index.js'
import { fixture, fresh, invariantProblems } from './helpers.js'

function act(state: NinemensState, action: Parameters<typeof reduceNinemens>[1]): NinemensState {
  return ninemensGame.reduce(state, action)
}

describe('元信息与注册表接口', () => {
  it('GameDef 元信息符合契约', () => {
    expect(ninemensGame.id).toBe('ninemens')
    expect(ninemensGame.i18nNamespace).toBe('ninemens')
    expect(ninemensGame.rulesVersion).toBeGreaterThanOrEqual(1)
    expect(ninemensGame.contentVersion).toBeGreaterThanOrEqual(1)
    expect(ninemensGame.illegalNoticeKey).toBe('ninemens.illegal.notice')
    expect(ninemensGame.difficulties.map((item) => item.id)).toEqual([
      'starter',
      'skilled',
      'challenging',
    ])
    expect(ninemensGame.difficulties.map((item) => item.labelKey)).toEqual([
      'ninemens.difficulty.starter',
      'ninemens.difficulty.skilled',
      'ninemens.difficulty.challenging',
    ])
    expect((ninemensGame as { levels?: unknown }).levels).toBeUndefined()
  })

  it('contentId = 难度，movesOf = 玩家动作数', () => {
    const state = fresh(1, 'skilled')
    expect(ninemensGame.contentId!(state)).toBe('skilled')
    expect(ninemensGame.movesOf!(state)).toBe(0)
    const played = act(state, { type: 'place', index: 8 })
    expect(ninemensGame.movesOf!(played)).toBe(1)
    expect(ninemensGame.contentId!(fresh(1, 'challenging'))).toBe('challenging')
  })

  it('controlAction 把撤销/重开映射成动作，未知 id 返回 null', () => {
    const state = fresh()
    expect(ninemensGame.controlAction!(state, 'undo')).toEqual({ type: 'undo' })
    expect(ninemensGame.controlAction!(state, 'restart')).toEqual({ type: 'restart' })
    expect(ninemensGame.controlAction!(state, 'next-level')).toBeNull()
  })

  it('create 拒绝未知难度；棋盘恒为 7×7', () => {
    expect(() => ninemensGame.create(0, 'impossible')).toThrow(IllegalActionError)
    const view = ninemensGame.view(ninemensGame.create(3, 'starter'))
    expect(view.board!.cols).toBe(BOARD_SIZE)
    expect(view.board!.rows).toBe(BOARD_SIZE)
    expect(view.board!.cells).toHaveLength(GRID_CELLS)
  })
})

describe('view / 1-bit 呈现约定', () => {
  it('非点位是 wall（25 格）、空点位是 empty、没有分组线', () => {
    const state = fresh(1, 'starter')
    const view = ninemensGame.view(state)
    expect(view.board!.kind).toBe('grid')
    expect(view.board!.groups).toBeUndefined()
    expect(view.board!.cells).toHaveLength(GRID_CELLS)
    view.board!.cells.forEach((cell, index) => expect(cell.index).toBe(index))
    // 空棋盘 + 落子期：空点位会被标成可落点（number + ·），非点位是 wall
    let walls = 0
    let options = 0
    for (const cell of view.board!.cells) {
      if (cell.kind === 'wall') {
        walls += 1
        expect(cell.glyph).toBe('')
        expect(pointAtGrid(cell.index)).toBe(-1)
      } else if (cell.kind === 'number') {
        options += 1
        expect(cell.glyph).toBe(OPTION_GLYPH)
        expect(cell.textScale).toBe(OPTION_TEXT_SCALE)
        expect(isPointAtGrid(cell.index)).toBe(true)
      }
      expect(cell.kind).not.toBe('tile')
    }
    expect(walls).toBe(25)
    expect(options).toBe(POINT_COUNT)
  })

  it('黑子 ● / 白子 ○（0.6）；选中的子带 selected', () => {
    const moving = fixture([0, 8, 9, 16], [1, 2, 3, 4], { inHand: { black: 0, white: 0 } })
    const cells = ninemensGame.view(moving).board!.cells
    expect(cells[gridIndexOf(0)]).toMatchObject({
      kind: 'tile',
      glyph: BLACK_GLYPH,
      textScale: STONE_TEXT_SCALE,
    })
    expect(cells[gridIndexOf(1)]).toMatchObject({ kind: 'tile', glyph: WHITE_GLYPH })
    // 选中黑子 0 之后带 selected；同时它的合法落点被标出
    const selected = act(moving, { type: 'select', index: 0 })
    const selectedCells = ninemensGame.view(selected).board!.cells
    expect(selectedCells[gridIndexOf(0)]!.selected).toBe(true)
    expect(selectedCells[gridIndexOf(7)]).toMatchObject({
      kind: 'number',
      glyph: OPTION_GLYPH,
      textScale: OPTION_TEXT_SCALE,
    })
    // 不相邻的空点 20 不标可落点
    expect(selectedCells[gridIndexOf(20)]!.kind).toBe('empty')
    void emptyPoints
  })

  it('待吃子时把可吃的对方子标成 selected', () => {
    const state = fixture([8, 9, 10, 11], [0, 1, 2, 12], {
      pendingRemove: 1,
      inHand: { black: 5, white: 5 },
    })
    const cells = ninemensGame.view(state).board!.cells
    expect(cells[gridIndexOf(12)]!.selected).toBe(true)
    // 三连里的子受保护 → 不高亮
    expect(cells[gridIndexOf(0)]!.selected).toBeUndefined()
  })

  it('stats 恰好三项恒定输出：黑白在场 + 我方待落', () => {
    const state = fresh(1, 'starter')
    expect(ninemensGame.view(state).stats).toEqual([
      { labelKey: 'ninemens.stat.black', value: '0' },
      { labelKey: 'ninemens.stat.white', value: '0' },
      { labelKey: 'ninemens.stat.hand', value: '9' },
    ])
    const played = act(state, { type: 'place', index: 8 })
    const view = ninemensGame.view(played)
    expect(view.stats[0]).toEqual({
      labelKey: 'ninemens.stat.black',
      value: String(boardCount(played, BLACK)),
    })
    expect(view.stats[1]).toEqual({
      labelKey: 'ninemens.stat.white',
      value: String(boardCount(played, WHITE)),
    })
    expect(Number(view.stats[2]!.value)).toBe(played.inHand[BLACK])
  })

  it('进行中没有结果；负/胜各自给出结果标题与明细', () => {
    expect(ninemensGame.view(fresh()).result).toBeNull()
    expect(ninemensGame.view(fresh()).notice).toBeNull()

    const lost = fixture([1, 2, 3, 4], [0, 5, 9, 10, 11], {
      inHand: { black: 0, white: 0 },
      removed: { black: 5, white: 4 },
    })
    const lostResult = ninemensGame.view(lost).result!
    expect(stuckPlayer(lost)).toBe(BLACK)
    expect(lostResult.titleKey).toBe('ninemens.lost.title')
    expect(lostResult.details[0]!.key).toBe('ninemens.result.moves')
    expect(lostResult.details[1]!.key).toBe('ninemens.result.captured')

    // 反过来：白方（对手）被堵死 → 黑方胜
    const won = fixture([0, 5, 9, 10, 11], [1, 2, 3, 4], {
      inHand: { black: 0, white: 0 },
      removed: { black: 4, white: 5 },
      turn: WHITE,
    })
    expect(stuckPlayer(won)).toBe(WHITE)
    expect(ninemensGame.view(won).result!.titleKey).toBe('ninemens.won.title')
  })
})

describe('controls', () => {
  it('只声明撤销，不声明 dpad / restart / next-level', () => {
    const controls = ninemensGame.controls(fresh())
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

  it('落过子之后 undo 才可用', () => {
    const state = fresh()
    expect(ninemensGame.controls(act(state, { type: 'place', index: 8 }))[0]!.enabled).toBe(true)
  })
})

describe('encode / decode', () => {
  it('初始 / 中盘 / 终局状态都严格往返', () => {
    const state = fresh(2024, 'starter')
    expect(ninemensGame.decode(ninemensGame.encode(state))).toEqual(state)
    expect(ninemensGame.decode(JSON.parse(JSON.stringify(ninemensGame.encode(state))))).toEqual(state)

    let mid = fresh(17, 'challenging')
    const rng = createRng(17)
    for (let ply = 0; ply < 12 && gameStatus(mid) === 'playing'; ply++) {
      const actions = ninemensGame.legal(mid).filter((action) => action.type !== 'restart')
      const action = actions[rng.int(actions.length)]!
      if (action.type === 'undo') continue
      mid = act(mid, action)
    }
    expect(ninemensGame.decode(ninemensGame.encode(mid))).toEqual(mid)
  })

  it('坏数据一律抛 IllegalActionError（GameDef 入口）', () => {
    let played = fresh(23, 'starter')
    played = act(played, { type: 'place', index: 8 })
    const raw = ninemensGame.encode(played) as Record<string, unknown>
    const bad: unknown[] = [
      null,
      undefined,
      'state',
      {},
      { ...raw, difficulty: 'nope' },
      {
        ...raw,
        points: (raw.points as Array<string | null>).map((owner, index) =>
          index === 20 ? 'black' : owner,
        ),
      },
      { ...raw, phase: 'moving' },
      { ...raw, turn: 'white' },
      { ...raw, moves: (raw.moves as number) + 1 },
      { ...raw, log: [] },
    ]
    for (const candidate of bad) {
      expect(
        () => ninemensGame.decode(candidate),
        JSON.stringify(candidate)?.slice(0, 90),
      ).toThrow(IllegalActionError)
    }
  })
})

describe('属性测试', () => {
  it('随机 60 步合法动作：每步 encode→decode 往返一致、不变量成立、终局后拒绝动作', () => {
    const rng = createRng(20240607)
    let state = fresh(20240607, 'skilled')
    let applied = 0
    let realActions = 0
    let guard = 0
    while (applied < 60 && guard++ < 200000) {
      const action = selectAction(state, rng.int(GRID_CELLS))
      if (action === null) {
        // 点不到任何合法动作：要么是终局，要么只是点到了盘外/受保护的点
        if (gameStatus(state) !== 'playing') {
          // 终局后所有点击都必须被拒绝（终局的完整覆盖见下一个测试）
          for (let grid = 0; grid < GRID_CELLS; grid++) expect(selectAction(state, grid)).toBeNull()
          expect(() => act(state, { type: 'place', index: 8 })).toThrow(IllegalActionError)
          state = act(state, { type: 'restart' })
        }
        continue
      }
      state = act(state, action)
      applied += 1
      if (action.type !== 'select' && action.type !== 'undo' && action.type !== 'restart') realActions += 1

      expect(invariantProblems(state), `step ${applied}`).toEqual([])
      const encoded = ninemensGame.encode(state)
      const decoded = ninemensGame.decode(encoded)
      expect(decoded, `step ${applied}`).toEqual(state)
      expect(ninemensGame.encode(decoded)).toEqual(encoded)
      expect(ninemensGame.decode(JSON.parse(JSON.stringify(encoded))), `step ${applied}`).toEqual(state)
      expect(ninemensGame.legal(decoded).length).toBeGreaterThan(0)
      state = decoded
    }
    expect(applied).toBe(60)
    expect(realActions).toBeGreaterThan(0)
  })

  it('终局后不再接受任何动作', () => {
    const over = fixture([1, 2, 3, 4], [0, 5, 9, 10, 11], {
      inHand: { black: 0, white: 0 },
      removed: { black: 5, white: 4 },
    })
    expect(gameStatus(over)).toBe('lost')
    const legal = ninemensGame.legal(over)
    expect(legal.some((action) => action.type === 'place' || action.type === 'move')).toBe(false)
    expect(() => act(over, { type: 'place', index: 20 })).toThrow(IllegalActionError)
    expect(gameStatus(act(over, { type: 'restart' }))).toBe('playing')
  })
})

describe('性能', () => {
  it('challenging 整回合应手 < 500ms；单次 decode < 50ms', () => {
    let worst = 0
    let state = fresh(7, 'challenging')
    const rng = createRng(7)
    for (let ply = 0; ply < 20 && gameStatus(state) === 'playing'; ply++) {
      const actions = ninemensGame.legal(state).filter(
        (action) => action.type === 'place' || action.type === 'move' || action.type === 'remove',
      )
      if (actions.length === 0) break
      const started = performance.now()
      state = act(state, actions[rng.int(actions.length)]!)
      const elapsed = performance.now() - started
      if (elapsed > worst) worst = elapsed
    }
    expect(worst).toBeLessThan(500)

    const started = performance.now()
    ninemensGame.decode(ninemensGame.encode(state))
    expect(performance.now() - started).toBeLessThan(50)
  })
})
