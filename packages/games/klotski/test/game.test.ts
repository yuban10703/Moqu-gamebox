/**
 * GameDef 外壳集成测试：view / controls / stats / encode / decode / 元信息 / 属性测试 / 性能。
 */
import { describe, expect, it } from 'vitest'
import { IllegalActionError, createRng } from '@eink/core'
import {
  CAO_GOAL,
  CAO_ID,
  CELLS,
  COLS,
  DIFFICULTY_IDS,
  EXIT_CELLS,
  PACK,
  ROWS,
  createState,
  gameStatus,
  indexOf,
  klotskiGame,
  reduceKlotski,
  selectAction,
  type KlotskiState,
} from '../src/index.js'
import { solveKlotski, type SolverPiece } from './helpers.js'

/** 取某关的最短解并在规则层走完（用于构造真实的 won 局面） */
function playOptimal(levelId: string): KlotskiState {
  const level = PACK.find((item) => item.def.id === levelId)!.def
  const pieces: SolverPiece[] = level.pieces.map((piece) => ({
    id: piece.id,
    glyph: piece.glyph,
    width: piece.width,
    height: piece.height,
    start: piece.start,
  }))
  const result = solveKlotski(pieces)
  let state = createState(levelId)
  for (const move of result.solution!) {
    state = klotskiGame.reduce(state, { type: 'slide', id: move.id, dir: move.dir })
  }
  return state
}

describe('元信息与注册表接口', () => {
  it('GameDef 元信息符合契约', () => {
    expect(klotskiGame.id).toBe('klotski')
    expect(klotskiGame.i18nNamespace).toBe('klotski')
    expect(klotskiGame.rulesVersion).toBeGreaterThanOrEqual(1)
    expect(klotskiGame.contentVersion).toBeGreaterThanOrEqual(1)
    expect(klotskiGame.illegalNoticeKey).toBe('klotski.illegal.notice')
    expect(klotskiGame.difficulties.map((item) => item.id)).toEqual([...DIFFICULTY_IDS])
    expect(klotskiGame.difficulties.map((item) => item.labelKey)).toEqual([
      'klotski.difficulty.starter',
      'klotski.difficulty.skilled',
      'klotski.difficulty.challenging',
    ])
    // 关卡制但不要在 GameDef 上声明 levels（由注册表声明）
    expect((klotskiGame as { levels?: unknown }).levels).toBeUndefined()
  })

  it('contentId = 关卡 id，movesOf = 滑动次数', () => {
    const start = createState('level-3')
    expect(klotskiGame.contentId!(start)).toBe('level-3')
    expect(klotskiGame.movesOf!(start)).toBe(0)
    // level-3 的出口前两格是空的，底行右边的卒可以往右滑
    const slid = reduceKlotski(start, { type: 'slide', id: 'pawn-4', dir: 'right' })
    expect(klotskiGame.movesOf!(slid)).toBe(1)
  })

  it('controlAction 映射撤销/重开/下一关（下一关必须与 view 声明的控件成对）', () => {
    const state = createState('level-1')
    expect(klotskiGame.controlAction!(state, 'undo')).toEqual({ type: 'undo' })
    expect(klotskiGame.controlAction!(state, 'restart')).toEqual({ type: 'restart' })
    // view.ts 声明了 next-level 控件（壳层据此渲染结果面板的「下一关」），
    // 因此这里必须能映射出同名动作，reduce 也必须接得住 —— 否则就是死按钮
    expect(klotskiGame.controlAction!(state, 'next-level')).toEqual({ type: 'nextLevel' })
    expect(klotskiGame.controlAction!(state, 'hint')).toBeNull()
  })

  it('过关后「下一关」真的能进下一关，最后一关明确报错', () => {
    // 用求解器给出的完整解法构造真实的 won 局面（见 playOptimal / solve.test.ts）
    const solved = playOptimal('level-1')
    expect(klotskiGame.status(solved)).toBe('won')
    const next = klotskiGame.reduce(solved, { type: 'nextLevel' })
    expect(next.levelId).toBe('level-2')
    expect(next.moves).toBe(0)
    expect(klotskiGame.status(next)).toBe('playing')

    const last = playOptimal('level-4')
    expect(klotskiGame.status(last)).toBe('won')
    expect(() => klotskiGame.reduce(last, { type: 'nextLevel' })).toThrow(IllegalActionError)
  })

  it('create 忽略 seed：同难度永远同一关同一摆法', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      expect(klotskiGame.create(1, difficulty)).toEqual(klotskiGame.create(987654321, difficulty))
    }
  })
})

describe('view / 1-bit 呈现约定', () => {
  it('4 列 × 5 行、20 格、行优先索引，且没有分组线', () => {
    const view = klotskiGame.view(createState('level-1'))
    expect(view.board).not.toBeNull()
    expect(view.board!.kind).toBe('grid')
    expect(view.board!.cols).toBe(COLS)
    expect(view.board!.rows).toBe(ROWS)
    expect(view.board!.cells).toHaveLength(CELLS)
    view.board!.cells.forEach((cell, index) => expect(cell.index).toBe(index))
    expect(view.board!.groups).toBeUndefined()
  })

  it('块占用格是 tile + 同块合并标记；名字只写在锚格内（不用覆盖层）', () => {
    const board = klotskiGame.view(createState('level-1')).board!
    const cells = board.cells
    /*
     * 契约（现行方案）：一块棋子**只在锚格（最左上那一格）里写一次全名**，其余格空着；
     * 同块相邻的格带 mergeRight / mergeBottom（壳层据此去掉共享边，一块才看得出是一体）。
     *
     * 走过的两条弯路都记在这里，避免以后又退回去：
     *  1. 每格各写一个字 → 2×2 的曹操变成四个「曹」，像四个独立小块；
     *  2. 用绝对定位的覆盖层写整块名字 → 覆盖层与格子网格是**两套坐标系**，真机上整体错位
     *     （棋盘元素在 (30,211)、格子在 (172,259)），用户反馈"点到的不是我想点的那块 / 完全乱了"。
     * 因此覆盖层契约已删除：`BoardView.labels` 不再存在（下面显式断言它没有被重新引入）。
     */
    expect((board as { labels?: unknown }).labels).toBeUndefined()

    // 曹操 2×2：内部右/下方向带合并标记，朝外的边不带
    expect(cells[indexOf(0, 1)]!.mergeRight).toBe(true)
    expect(cells[indexOf(0, 1)]!.mergeBottom).toBe(true)
    expect(cells[indexOf(0, 2)]!.mergeRight).toBeUndefined()
    expect(cells[indexOf(1, 1)]!.mergeBottom).toBeUndefined()

    // 一块只写一次名字：10 块棋子 → 10 个带字形的格（其余 tile 格字形为空）
    const named = cells.filter((cell) => cell.kind === 'tile' && cell.glyph !== '')
    expect(named).toHaveLength(10)
    expect(cells.filter((cell) => cell.kind === 'tile').length - named.length).toBe(8)

    // 锚格就是该块最左上那一格，且字号固定 0.42 格（两字名也放得进一格）
    const anchorGlyphs: Array<[number, string]> = [
      [indexOf(0, 1), '曹操'],
      [indexOf(0, 0), '张飞'],
      [indexOf(0, 3), '马超'],
      [indexOf(2, 0), '赵云'],
      [indexOf(2, 3), '黄忠'],
      [indexOf(2, 1), '关羽'],
      [indexOf(3, 1), '卒'],
      [indexOf(3, 2), '卒'],
      [indexOf(4, 0), '卒'],
      [indexOf(4, 3), '卒'],
    ]
    for (const [index, name] of anchorGlyphs) {
      expect(cells[index], `锚格 ${index}`).toMatchObject({ kind: 'tile', glyph: name, textScale: 0.42 })
    }

    // 出口两格没有块 → goal
    for (const exit of EXIT_CELLS) {
      expect(cells[exit]).toEqual({ index: exit, kind: 'goal', glyph: '' })
    }
    expect(cells.filter((cell) => cell.kind === 'tile')).toHaveLength(18)
    expect(cells.filter((cell) => cell.kind === 'goal')).toHaveLength(2)
  })

  it('被选中的块：**整块逐格**标 selected（按格标记天然与点击区域对齐）', () => {
    const state = reduceKlotski(createState('level-1'), { type: 'select', id: CAO_ID })
    const board = klotskiGame.view(state).board!
    const cells = board.cells
    /*
     * 选中态按格标记，而不是画在覆盖层/细线框上：
     *  - 覆盖层与网格两套坐标系，真机错位（见上一个用例）；
     *  - 3px 细线框在 dpr 1.875 下落在半像素上，会渲染成破碎斜纹（真机截图确认）。
     * 同块之间已无格线，所以整块几格同时反白会连成一整块黑，不会被看成多个小方块。
     */
    const selected = cells.filter((cell) => cell.selected === true).map((cell) => cell.index)
    expect(selected.sort((a, b) => a - b)).toEqual(
      [indexOf(0, 1), indexOf(0, 2), indexOf(1, 1), indexOf(1, 2)].sort((a, b) => a - b),
    )
    // 未选中的块不带 selected 字段
    expect(cells[indexOf(0, 0)]!.selected).toBeUndefined()
    expect(cells[indexOf(2, 1)]!.selected).toBeUndefined()
    // 选中不影响锚格名字
    expect(cells[indexOf(0, 1)]!.glyph).toBe('曹操')
  })

  it('stats 恰好三项：步数 / 关卡 / 最少步数（内容恒定，高度不跳）', () => {
    const start = createState('level-1')
    const view = klotskiGame.view(start)
    expect(view.stats).toEqual([
      { labelKey: 'klotski.stat.moves', value: '0' },
      { labelKey: 'klotski.stat.level', value: '1/4' },
      { labelKey: 'klotski.stat.target', value: String(PACK[0]!.def.optimalMoves) },
    ])
    const last = klotskiGame.view(createState('level-4'))
    expect(last.stats[1]).toEqual({ labelKey: 'klotski.stat.level', value: '4/4' })
    expect(last.stats[2]!.value).toBe(String(PACK[3]!.def.optimalMoves))
  })

  it('进行中没有结果与提示；到终点后给出结果标题与明细', () => {
    const playing = createState('level-1')
    expect(klotskiGame.view(playing).result).toBeNull()
    expect(klotskiGame.view(playing).notice).toBeNull()

    const won = playOptimal('level-2')
    expect(gameStatus(won)).toBe('won')
    expect(won.positions[CAO_ID]).toBe(CAO_GOAL)
    const result = klotskiGame.view(won).result!
    expect(result.titleKey).toBe('klotski.won.title')
    expect(result.details).toEqual([
      { key: 'klotski.result.moves', params: { count: won.moves } },
      { key: 'klotski.result.target', params: { count: PACK[1]!.def.optimalMoves } },
    ])
  }, 30000)
})

describe('controls', () => {
  it('只声明撤销与「下一关」（关卡选择由壳层渲染），不声明 dpad', () => {
    /*
     * 壳层约定：**「下一关」由游戏声明、壳层才渲染**（无关卡玩法不声明；最后一关 enabled:false）——
     * 与 sokoban 完全一致。关卡选择与重开由壳层自有控件提供，游戏不需要声明。
     */
    const controls = klotskiGame.controls(createState('level-1'))
    expect(controls.map((control) => control.id)).toEqual(['undo', 'next-level'])
    expect(controls.some((control) => control.id === 'dpad')).toBe(false)
    expect(controls.some((control) => control.id === 'restart')).toBe(false)
  })

  it('滑过一步之后 undo 才可用', () => {
    const start = createState('level-1')
    const played = reduceKlotski(start, { type: 'slide', id: 'pawn-3', dir: 'right' })
    expect(klotskiGame.controls(played)[0]!.enabled).toBe(true)
  })
})

describe('encode / decode', () => {
  it('初始与中盘状态都严格往返（含 JSON 往返）', () => {
    for (const level of PACK) {
      const state = createState(level.def.id)
      expect(klotskiGame.decode(klotskiGame.encode(state))).toEqual(state)
      expect(klotskiGame.decode(JSON.parse(JSON.stringify(klotskiGame.encode(state))))).toEqual(
        state,
      )
    }
    let state = createState('level-2')
    // 关羽先滑到出口前两格（原来空着），底行的卒再补上它让出的位置
    for (const slide of [
      { id: 'guan', dir: 'down' as const },
      { id: 'pawn-1', dir: 'down' as const },
    ]) {
      state = reduceKlotski(state, { type: 'slide', ...slide })
    }
    expect(klotskiGame.decode(klotskiGame.encode(state))).toEqual(state)
  })

  it('坏数据一律抛 IllegalActionError（GameDef 入口）', () => {
    let played = createState('level-1')
    played = reduceKlotski(played, { type: 'slide', id: 'pawn-3', dir: 'right' })
    const raw = klotskiGame.encode(played) as Record<string, unknown>
    const positions = raw.positions as Record<string, number>
    const bad: unknown[] = [
      null,
      undefined,
      'state',
      {},
      { ...raw, levelId: 'nope' },
      { ...raw, moves: 5 },
      { ...raw, log: [{ id: CAO_ID, dir: 'up' }] },
      { ...raw, positions: { ...positions, extra: 0 } },
      { ...raw, positions: { ...positions, [CAO_ID]: indexOf(3, 3) } },
      { ...raw, selected: 'nope' },
    ]
    for (const candidate of bad) {
      expect(() => klotskiGame.decode(candidate), JSON.stringify(candidate)?.slice(0, 90)).toThrow(
        IllegalActionError,
      )
    }
  })
})

describe('属性测试', () => {
  it('随机 60 步合法动作：每步 encode→decode 往返一致且局面仍可继续操作', () => {
    const rng = createRng(20240607)
    let state = createState('level-2')
    let applied = 0
    let guard = 0
    while (applied < 60 && guard++ < 100000) {
      if (gameStatus(state) !== 'playing') {
        state = reduceKlotski(state, { type: 'restart' })
        continue
      }
      // 模拟随机点击：只有点到「块」或「选中块旁边的合法空格」才会产生动作
      const index = rng.int(CELLS)
      const action = selectAction(state, index)
      if (action === null) continue
      state = reduceKlotski(state, action)
      applied += 1

      const encoded = klotskiGame.encode(state)
      const decoded = klotskiGame.decode(encoded)
      expect(decoded, `step ${applied}`).toEqual(state)
      expect(klotskiGame.encode(decoded)).toEqual(encoded)
      expect(klotskiGame.decode(JSON.parse(JSON.stringify(encoded))), `step ${applied}`).toEqual(
        state,
      )
      // 局面永远可用（最差也能撤销或重新开始）
      expect(klotskiGame.legal(decoded).length).toBeGreaterThan(0)
      state = decoded
    }
    expect(applied).toBe(60)
    expect(state.moves).toBeGreaterThan(0)
  })

  it('随机点击不会让方块重叠或跑出棋盘', () => {
    const rng = createRng(99)
    let state = createState('level-3')
    for (let step = 0; step < 60; step++) {
      if (gameStatus(state) !== 'playing') state = reduceKlotski(state, { type: 'restart' })
      const action = selectAction(state, rng.int(CELLS))
      if (action === null) continue
      state = reduceKlotski(state, action)
      const positions = Object.values(state.positions)
      expect(new Set(positions).size).toBeGreaterThan(0)
      // 每个块的左上角都在盘内
      const level = PACK.find((item) => item.def.id === state.levelId)!.def
      for (const piece of level.pieces) {
        const start = state.positions[piece.id]!
        const row = Math.floor(start / COLS)
        const col = start % COLS
        expect(row + piece.height).toBeLessThanOrEqual(ROWS)
        expect(col + piece.width).toBeLessThanOrEqual(COLS)
      }
    }
  })
})

describe('性能', () => {
  it('中盘存档解码 < 50ms', () => {
    const rng = createRng(7)
    let state = createState('level-2')
    let applied = 0
    let guard = 0
    while (applied < 60 && guard++ < 100000) {
      const action = selectAction(state, rng.int(CELLS))
      if (action === null) continue
      state = reduceKlotski(state, action)
      applied += 1
    }
    const started = performance.now()
    const decoded = klotskiGame.decode(klotskiGame.encode(state))
    expect(performance.now() - started).toBeLessThan(50)
    expect(decoded.moves).toBe(state.moves)
  })

  it('单次 encode + decode 也在宽松上限内', () => {
    const state = createState('level-1')
    const started = performance.now()
    klotskiGame.decode(klotskiGame.encode(state))
    expect(performance.now() - started).toBeLessThan(50)
  })
})
