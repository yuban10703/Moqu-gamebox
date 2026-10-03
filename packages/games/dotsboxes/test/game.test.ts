/**
 * GameDef 外壳集成测试：view / controls / stats / encode / decode / 元信息 / 属性测试 / 性能。
 */
import { describe, expect, it } from 'vitest'
import { IllegalActionError, createRng } from '@eink/core'
import {
  BLACK,
  DIFFICULTY_IDS,
  WHITE,
  boxIndexAt,
  configFor,
  countScores,
  dotsboxesGame,
  emptyState,
  gameStatus,
  indexOf,
  isBox,
  isDot,
  isEdge,
  openEdges,
  selectAction,
  type DotsBoxesState,
  type DifficultyId,
  type Side,
} from '../src/index.js'
import { customState } from './helpers.js'

function fresh(seed = 20240607, difficulty: DifficultyId = 'starter'): DotsBoxesState {
  return emptyState(seed, difficulty)
}

function claim(state: DotsBoxesState, index: number): DotsBoxesState {
  return dotsboxesGame.reduce(state, { type: 'claim', index })
}

/** 用随机黑方 + 指定难点白方把一局打完 */
function playFullGame(seed: number, difficulty: DifficultyId): DotsBoxesState {
  const rng = createRng(seed)
  let state = fresh(seed, difficulty)
  let guard = 0
  while (gameStatus(state) === 'playing') {
    const edges = openEdges(state)
    if (edges.length === 0) break
    if (guard++ > 5000) throw new Error('game did not finish')
    state = claim(state, edges[rng.int(edges.length)]!)
  }
  return state
}

describe('元信息与注册表接口', () => {
  it('GameDef 元信息符合契约', () => {
    expect(dotsboxesGame.id).toBe('dotsboxes')
    expect(dotsboxesGame.i18nNamespace).toBe('dotsboxes')
    expect(dotsboxesGame.rulesVersion).toBeGreaterThanOrEqual(1)
    expect(dotsboxesGame.contentVersion).toBeGreaterThanOrEqual(1)
    expect(dotsboxesGame.illegalNoticeKey).toBe('dotsboxes.illegal.notice')
    expect(dotsboxesGame.difficulties.map((item) => item.id)).toEqual([...DIFFICULTY_IDS])
    expect(dotsboxesGame.difficulties.map((item) => item.labelKey)).toEqual([
      'dotsboxes.difficulty.starter',
      'dotsboxes.difficulty.skilled',
      'dotsboxes.difficulty.challenging',
    ])
    // 无关卡玩法：不要声明 levels
    expect((dotsboxesGame as { levels?: unknown }).levels).toBeUndefined()
  })

  it('contentId = 难度，movesOf = 玩家画线数', () => {
    const state = fresh(1, 'skilled')
    expect(dotsboxesGame.contentId!(state)).toBe('skilled')
    expect(dotsboxesGame.movesOf!(state)).toBe(0)
    const played = claim(state, openEdges(state)[0]!)
    expect(dotsboxesGame.movesOf!(played)).toBe(1)
    expect(dotsboxesGame.contentId!(fresh(1, 'challenging'))).toBe('challenging')
  })

  it('controlAction 把撤销/重开映射成动作，未知 id 返回 null', () => {
    const state = fresh()
    expect(dotsboxesGame.controlAction!(state, 'undo')).toEqual({ type: 'undo' })
    expect(dotsboxesGame.controlAction!(state, 'restart')).toEqual({ type: 'restart' })
    expect(dotsboxesGame.controlAction!(state, 'next-level')).toBeNull()
  })

  it('create 拒绝未知难度；三档棋盘尺寸正确', () => {
    expect(() => dotsboxesGame.create(0, 'impossible')).toThrow(IllegalActionError)
    for (const difficulty of DIFFICULTY_IDS) {
      const config = configFor(difficulty)
      const view = dotsboxesGame.view(dotsboxesGame.create(3, difficulty))
      expect(view.board!.cols).toBe(config.gridSize)
      expect(view.board!.rows).toBe(config.gridSize)
      expect(view.board!.cells).toHaveLength(config.cells)
    }
  })
})

describe('view / 1-bit 呈现约定', () => {
  it('点=wall、方格=empty、未画的边=floor，且没有分组线', () => {
    const difficulty: DifficultyId = 'starter'
    const config = configFor(difficulty)
    const view = dotsboxesGame.view(fresh(1, difficulty))
    expect(view.board!.kind).toBe('grid')
    expect(view.board!.groups).toBeUndefined()
    expect(view.board!.cells).toHaveLength(config.cells)
    let dots = 0
    let boxes = 0
    let edges = 0
    for (const cell of view.board!.cells) {
      if (cell.kind === 'wall') dots += 1
      else if (cell.kind === 'empty') boxes += 1
      else if (cell.kind === 'floor') edges += 1
      expect(cell.glyph).toBe('')
      expect(cell.textScale).toBeUndefined()
    }
    expect(dots).toBe((config.boxes + 1) ** 2)
    expect(boxes).toBe(config.boxCount)
    expect(edges).toBe(config.edgeCount)
    // 抽查坐标：偶偶是点、奇奇是方格、其余是边
    expect(view.board!.cells[indexOf(0, 0, config)]!.kind).toBe('wall')
    expect(view.board!.cells[indexOf(1, 1, config)]!.kind).toBe('empty')
    expect(view.board!.cells[indexOf(0, 1, config)]!.kind).toBe('floor')
    expect(isDot(indexOf(0, 0, config), config)).toBe(true)
    expect(isBox(indexOf(1, 1, config), config)).toBe(true)
    expect(isEdge(indexOf(0, 1, config), config)).toBe(true)
  })

  it('黑方画横边 -、竖边 |；白方画横边 =、竖边 ‖；占领的方格 ■ / □', () => {
    const difficulty: DifficultyId = 'starter'
    const config = configFor(difficulty)
    // 手工局面：黑画横边 (0,1) 与竖边 (1,0)，白画横边 (0,3) 与竖边 (1,2)，方格 (1,1) 归黑
    const box = boxIndexAt(0, 0, config)
    const state = customState(difficulty, {
      claimed: [indexOf(0, 1, config), indexOf(1, 0, config), indexOf(0, 3, config), indexOf(1, 2, config)],
      owners: [[box, BLACK]],
    })
    // 先按黑方视角确认黑边字形
    const blackCells = dotsboxesGame.view(state).board!.cells
    expect(blackCells[indexOf(0, 1, config)]).toEqual({
      index: indexOf(0, 1, config),
      kind: 'tile',
      glyph: '-',
      textScale: expect.any(Number),
    })
    expect(blackCells[indexOf(1, 0, config)]!.glyph).toBe('|')
    expect(blackCells[box]!.glyph).toBe('■')
    // 白边字形：把同两条边改判给白方
    const whiteState: DotsBoxesState = {
      ...state,
      edges: state.edges.map((owner, index) =>
        index === indexOf(0, 3, config) || index === indexOf(1, 2, config) ? WHITE : owner,
      ),
      owners: state.owners.map((owner, index) => (index === box ? WHITE : owner)),
    }
    const whiteCells = dotsboxesGame.view(whiteState).board!.cells
    expect(whiteCells[indexOf(0, 3, config)]!.glyph).toBe('=')
    expect(whiteCells[indexOf(1, 2, config)]!.glyph).toBe('‖')
    expect(whiteCells[box]!.glyph).toBe('□')
  })

  it('真实对局里画过的边与占领的方格都会变成 tile', () => {
    const state = claim(fresh(1, 'starter'), indexOf(0, 1, configFor('starter')))
    const cells = dotsboxesGame.view(state).board!.cells
    // 黑方刚画的边
    expect(cells[indexOf(0, 1, configFor('starter'))]!.kind).toBe('tile')
    expect(cells[indexOf(0, 1, configFor('starter'))]!.glyph).toBe('-')
    // 白方应手也画了一条边（日志长度 2）
    const whiteEdges = state.edges
      .map((owner, index) => ({ owner, index }))
      .filter((item) => item.owner === WHITE)
    expect(whiteEdges.length).toBeGreaterThan(0)
    for (const { index } of whiteEdges) {
      expect(cells[index]!.kind).toBe('tile')
      expect(['=', '‖']).toContain(cells[index]!.glyph)
    }
  })

  it('stats 恰好三项恒定输出：黑方格 / 白方格 / 剩余边', () => {
    const difficulty: DifficultyId = 'starter'
    const config = configFor(difficulty)
    const state = fresh(1, difficulty)
    expect(dotsboxesGame.view(state).stats).toEqual([
      { labelKey: 'dotsboxes.stat.black', value: '0' },
      { labelKey: 'dotsboxes.stat.white', value: '0' },
      { labelKey: 'dotsboxes.stat.remaining', value: String(config.edgeCount) },
    ])
    // 黑方一步 + 白方应手（开局不可能占格，白方正好也画一条边）
    const played = claim(state, openEdges(state)[0]!)
    expect(dotsboxesGame.view(played).stats[2]).toEqual({
      labelKey: 'dotsboxes.stat.remaining',
      value: String(config.edgeCount - 2),
    })
  })

  it('进行中没有结果与提示；终局给出结果标题与黑白明细', () => {
    const playing = fresh(1, 'starter')
    expect(dotsboxesGame.view(playing).result).toBeNull()
    expect(dotsboxesGame.view(playing).notice).toBeNull()

    const finished = playFullGame(5, 'starter')
    const view = dotsboxesGame.view(finished)
    const scores = countScores(finished.owners)
    const expected =
      scores.black > scores.white ? 'won' : scores.black < scores.white ? 'lost' : 'draw'
    const result = view.result!
    expect(result.titleKey).toBe(`dotsboxes.${expected}.title`)
    expect(result.details).toEqual([
      { key: 'dotsboxes.result.black', params: { count: scores.black } },
      { key: 'dotsboxes.result.white', params: { count: scores.white } },
    ])
    // 终局必然所有方格都有归属（画满 = 全部占领）
    expect(scores.black + scores.white).toBe(configFor('starter').boxCount)
  })

  it('手工构造的平局局面上，结果标题用 draw', () => {
    const difficulty: DifficultyId = 'skilled'
    const config = configFor(difficulty)
    const finished = playFullGame(5, difficulty)
    const owners = new Array<Side | null>(config.cells).fill(null)
    let index = 0
    for (let row = 0; row < config.boxes; row++) {
      for (let col = 0; col < config.boxes; col++) {
        owners[boxIndexAt(row, col, config)] = index++ < config.boxCount / 2 ? BLACK : WHITE
      }
    }
    const state = { ...finished, owners }
    expect(dotsboxesGame.view(state).result!.titleKey).toBe('dotsboxes.draw.title')
  })
})

describe('controls', () => {
  it('只声明撤销，不声明 dpad / restart / next-level', () => {
    const controls = dotsboxesGame.controls(fresh())
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

  it('画过一条边之后 undo 才可用', () => {
    const state = fresh()
    const played = claim(state, openEdges(state)[0]!)
    expect(dotsboxesGame.controls(played)[0]!.enabled).toBe(true)
  })
})

describe('encode / decode', () => {
  it('初始 / 中盘 / 终局状态都严格往返', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      const state = fresh(2024, difficulty)
      expect(dotsboxesGame.decode(dotsboxesGame.encode(state))).toEqual(state)
      expect(
        dotsboxesGame.decode(JSON.parse(JSON.stringify(dotsboxesGame.encode(state)))),
      ).toEqual(state)
    }
    let state = fresh(17, 'challenging')
    for (let turn = 0; turn < 5; turn++) state = claim(state, openEdges(state)[0]!)
    expect(dotsboxesGame.decode(dotsboxesGame.encode(state))).toEqual(state)
    const finished = playFullGame(9, 'starter')
    expect(dotsboxesGame.decode(dotsboxesGame.encode(finished))).toEqual(finished)
  })

  it('坏数据一律抛 IllegalActionError（GameDef 入口）', () => {
    let played = fresh(23, 'starter')
    played = claim(played, openEdges(played)[0]!)
    const raw = dotsboxesGame.encode(played) as Record<string, unknown>
    const config = configFor('starter')
    const bad: unknown[] = [
      null,
      undefined,
      'state',
      {},
      { ...raw, difficulty: 'nope' },
      {
        ...raw,
        owners: (raw.owners as Array<string | null>).map((owner, index) =>
          index === boxIndexAt(0, 0, config) ? BLACK : owner,
        ),
      },
      { ...raw, turn: WHITE },
      { ...raw, moves: (raw.moves as number) + 1 },
      { ...raw, log: [indexOf(1, 1, config)] },
      { ...raw, log: [] },
    ]
    for (const candidate of bad) {
      expect(() => dotsboxesGame.decode(candidate), JSON.stringify(candidate)?.slice(0, 90)).toThrow(
        IllegalActionError,
      )
    }
  })
})

describe('属性测试', () => {
  it('随机 60 步合法动作：每步 encode→decode 往返一致且能继续对局', () => {
    const rng = createRng(20240607)
    let state = fresh(20240607, 'skilled')
    let applied = 0
    let guard = 0
    while (applied < 60 && guard++ < 200000) {
      if (gameStatus(state) !== 'playing') {
        state = dotsboxesGame.reduce(state, { type: 'restart' })
        continue
      }
      // 模拟随机点击：只有点到未画的边才会产生动作
      const action = selectAction(state, rng.int(configFor(state.difficulty).cells))
      if (action === null || action.type !== 'claim') continue
      state = claim(state, action.index)
      applied += 1

      const encoded = dotsboxesGame.encode(state)
      const decoded = dotsboxesGame.decode(encoded)
      expect(decoded, `step ${applied}`).toEqual(state)
      expect(dotsboxesGame.encode(decoded)).toEqual(encoded)
      expect(dotsboxesGame.decode(JSON.parse(JSON.stringify(encoded))), `step ${applied}`).toEqual(
        state,
      )
      // 局面永远可用（最差也能撤销或重新开始）
      expect(dotsboxesGame.legal(decoded).length).toBeGreaterThan(0)
      state = decoded
    }
    expect(applied).toBe(60)
    // 对局过程中玩家步数与日志长度都单调前进
    expect(state.moves).toBeGreaterThan(0)
    expect(state.log.length).toBeGreaterThanOrEqual(state.moves)
  })

  it('白方应手后轮次永远回到黑方（除非对局结束）', () => {
    const rng = createRng(99)
    let state = fresh(99, 'challenging')
    for (let turn = 0; turn < 60; turn++) {
      if (gameStatus(state) !== 'playing') break
      const edges = openEdges(state)
      state = claim(state, edges[rng.int(edges.length)]!)
      if (gameStatus(state) === 'playing') expect(state.turn).toBe(BLACK)
    }
  })
})

describe('性能', () => {
  it('challenging 应手 < 500ms；单次 decode < 50ms', () => {
    let worstReply = 0
    let state = fresh(7, 'challenging')
    for (let turn = 0; turn < 12 && gameStatus(state) === 'playing'; turn++) {
      const edges = openEdges(state)
      const started = performance.now()
      state = claim(state, edges[0]!)
      const elapsed = performance.now() - started
      if (elapsed > worstReply) worstReply = elapsed
    }
    expect(worstReply).toBeLessThan(500)

    const decodedStart = performance.now()
    dotsboxesGame.decode(dotsboxesGame.encode(state))
    expect(performance.now() - decodedStart).toBeLessThan(50)
  })
})
