/**
 * GameDef 外壳集成测试：view / controls / stats / encode / decode / 元信息 / 性能。
 * 重点：
 *   - 1-bit 呈现约定（tile 数字、empty 空白、无分组线、两项统计）；
 *   - `encode`/`decode` 严格往返，坏数据（含被改过奇偶性的盘面与历史）一律抛 IllegalActionError；
 *   - 生成性能上限。
 */
import { describe, expect, it } from 'vitest'
import { IllegalActionError } from '@eink/core'
import {
  DIFFICULTIES,
  DIFFICULTY_IDS,
  EMPTY_GLYPH,
  TILE_TEXT_SCALE,
  canSlide,
  createSolvedBoard,
  fifteenGame,
  legalActions,
  reduceFifteen,
  scrambleBoard,
  type FifteenState,
} from '../src/index.js'
import { fixtureState, fresh } from './helpers.js'

/** 取当前第一个合法方向动作 */
function firstSlide(state: FifteenState): { type: 'slide'; dir: 'up' | 'down' | 'left' | 'right' } {
  const action = legalActions(state).find(
    (item): item is { type: 'slide'; dir: 'up' | 'down' | 'left' | 'right' } =>
      item.type === 'slide',
  )
  if (!action) throw new Error('no legal slide')
  return action
}

function advance(state: FifteenState, steps: number): FifteenState {
  let current = state
  for (let step = 0; step < steps; step++) current = reduceFifteen(current, firstSlide(current))
  return current
}

describe('元信息与注册表接口', () => {
  it('GameDef 元信息符合契约', () => {
    expect(fifteenGame.id).toBe('fifteen')
    expect(fifteenGame.i18nNamespace).toBe('fifteen')
    expect(fifteenGame.rulesVersion).toBeGreaterThanOrEqual(1)
    expect(fifteenGame.contentVersion).toBeGreaterThanOrEqual(1)
    expect(fifteenGame.illegalNoticeKey).toBe('fifteen.illegal.notice')
    expect(fifteenGame.difficulties.map((item) => item.id)).toEqual([...DIFFICULTY_IDS])
    expect(fifteenGame.difficulties.map((item) => item.labelKey)).toEqual([
      'fifteen.difficulty.starter',
      'fifteen.difficulty.skilled',
      'fifteen.difficulty.challenging',
    ])
    // 无关卡玩法：不要声明 levels
    expect((fifteenGame as { levels?: unknown }).levels).toBeUndefined()
  })

  it('create 按难度给出 3×3 / 4×4 / 5×5，未知难度拒绝', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      const state = fifteenGame.create(1, difficulty)
      expect(state.board).toHaveLength(DIFFICULTIES[difficulty].size ** 2)
      expect(state.moves).toBe(0)
      expect(state.history).toHaveLength(0)
    }
    expect(() => fifteenGame.create(1, 'impossible')).toThrow(IllegalActionError)
  })

  it('contentId = 难度，movesOf = 步数（本玩法最佳成绩 = 最少步数）', () => {
    const state = advance(fresh(1, 'skilled'), 3)
    expect(fifteenGame.contentId!(state)).toBe('skilled')
    expect(fifteenGame.movesOf!(state)).toBe(3)
    expect(fifteenGame.contentId!(fifteenGame.create(1, 'challenging'))).toBe('challenging')
  })

  it('controlAction 把撤销/重开映射成动作，未知 id 返回 null', () => {
    const state = fresh()
    expect(fifteenGame.controlAction!(state, 'undo')).toEqual({ type: 'undo' })
    expect(fifteenGame.controlAction!(state, 'restart')).toEqual({ type: 'restart' })
    expect(fifteenGame.controlAction!(state, 'next-level')).toBeNull()
  })

  it('壳层直接派发的 undo / restart 都被接受', () => {
    const state = fresh(8, 'starter')
    const played = advance(state, 2)
    expect(fifteenGame.decode(fifteenGame.encode(reduceFifteen(played, { type: 'restart' })))).toEqual(
      state,
    )
    expect(reduceFifteen(played, { type: 'undo' }).moves).toBe(played.moves - 1)
  })
})

describe('view / 1-bit 呈现约定', () => {
  it('棋盘尺寸与难度一致、行优先索引、没有分组线', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      const size = DIFFICULTIES[difficulty].size
      const view = fifteenGame.view(fifteenGame.create(3, difficulty))
      expect(view.board).not.toBeNull()
      expect(view.board!.kind).toBe('grid')
      expect(view.board!.cols).toBe(size)
      expect(view.board!.rows).toBe(size)
      expect(view.board!.cells).toHaveLength(size * size)
      view.board!.cells.forEach((cell, index) => expect(cell.index).toBe(index))
      // 滑块拼图没有宫结构：多一层粗线只会让画面更花
      expect(view.board!.groups).toBeUndefined()
    }
  })

  it('数字块 kind: tile + 数字字形 + textScale 0.62；空白格 kind: empty + 空字形', () => {
    const state = fixtureState([1, 2, 3, 4, 0, 5, 6, 7, 8])
    const cells = fifteenGame.view(state).board!.cells
    expect(cells[0]).toEqual({ index: 0, kind: 'tile', glyph: '1', textScale: TILE_TEXT_SCALE })
    expect(cells[4]).toEqual({ index: 4, kind: 'empty', glyph: EMPTY_GLYPH })
    expect(cells[8]).toEqual({ index: 8, kind: 'tile', glyph: '8', textScale: TILE_TEXT_SCALE })
    // 空白格不声明字号（保持默认），且所有字形都是十进制数字
    expect(cells[4]!.textScale).toBeUndefined()
    expect(cells.filter((cell) => cell.kind === 'tile')).toHaveLength(8)
    for (const cell of cells.filter((item) => item.kind === 'tile')) {
      expect(cell.glyph).toMatch(/^\d+$/)
    }
  })

  it('两位数（5×5）也能完整显示为字形', () => {
    const state = fixtureState(createSolvedBoard(5))
    const glyphs = fifteenGame.view(state).board!.cells.map((cell) => cell.glyph)
    expect(glyphs).toContain('24')
    expect(glyphs[glyphs.length - 1]).toBe('')
  })

  it('stats 恰好两项：步数 与 已归位 n/总数', () => {
    const state = advance(fresh(11, 'skilled'), 4)
    const view = fifteenGame.view(state)
    expect(view.stats).toHaveLength(2)
    expect(view.stats[0]).toEqual({ labelKey: 'fifteen.stat.moves', value: String(state.moves) })
    expect(view.stats[1]!.labelKey).toBe('fifteen.stat.placed')
    expect(view.stats[1]!.value).toMatch(/^\d+\/15$/)
    // 已还原局面的「已归位」是满值，空白格不计入总数
    const solved = fixtureState(createSolvedBoard(3))
    expect(fifteenGame.view(solved).stats[1]!.value).toBe('8/8')
  })

  it('进行中没有结果与提示；还原后给出结果标题与明细', () => {
    const playing = fixtureState([1, 2, 3, 4, 5, 6, 7, 0, 8], { moves: 9 })
    expect(fifteenGame.view(playing).result).toBeNull()
    expect(fifteenGame.view(playing).notice).toBeNull()

    const won = fixtureState(createSolvedBoard(3), { moves: 9 })
    const result = fifteenGame.view(won).result!
    expect(result.titleKey).toBe('fifteen.won.title')
    expect(result.details).toEqual([
      { key: 'fifteen.result.moves', params: { count: 9 } },
      { key: 'fifteen.result.tiles', params: { count: 8 } },
    ])
    // 本玩法没有失败态：status 只会是 playing / won
    expect(fifteenGame.status(won)).toBe('won')
    expect(fifteenGame.status(playing)).toBe('playing')
  })
})

describe('controls / 方向盘', () => {
  it('四个 dpad 方向（按固定顺序）+ 一个 undo，且不声明重开/下一关', () => {
    const controls = fifteenGame.controls(fresh())
    expect(controls.map((control) => control.id)).toEqual([
      'move-up',
      'move-down',
      'move-left',
      'move-right',
      'undo',
    ])
    const dpad = controls.filter((control) => control.role === 'dpad')
    expect(dpad.map((control) => control.dir)).toEqual(['up', 'down', 'left', 'right'])
    expect(dpad.every((control) => control.enabled)).toBe(true)
    expect(dpad.every((control) => control.labelKey.startsWith('fifteen.dir.'))).toBe(true)
    const undo = controls.find((control) => control.id === 'undo')!
    expect(undo.labelKey).toBe('shell.game.undo')
    expect(undo.enabled).toBe(false)
    expect(controls.some((control) => control.id === 'restart')).toBe(false)
    expect(controls.some((control) => control.id === 'next-level')).toBe(false)
  })

  it('走不通的方向 tone: muted（但仍可点），走得通的 normal', () => {
    // 用固定夹具钉死呈现：空白在左上角时上/左贴边
    const corner = fixtureState([0, 1, 2, 3, 4, 5, 6, 7, 8])
    const controls = fifteenGame.controls(corner)
    const toneOf = (dir: 'up' | 'down' | 'left' | 'right'): string | undefined =>
      controls.find((control) => control.dir === dir)!.tone
    expect(toneOf('up')).toBe('muted')
    expect(toneOf('left')).toBe('muted')
    expect(toneOf('down')).toBe('normal')
    expect(toneOf('right')).toBe('normal')
    // 方向盘按钮始终可点（走不通由壳层给文字反馈，不是禁用）
    expect(controls.filter((control) => control.role === 'dpad').every((control) => control.enabled)).toBe(
      true,
    )
  })

  it('tone 与规则层 canSlide 完全一致（真实打乱局面）', () => {
    const state = fresh()
    const size = DIFFICULTIES[state.difficulty].size
    for (const control of fifteenGame.controls(state).filter((item) => item.role === 'dpad')) {
      const expected = canSlide(state.board, size, control.dir!) ? 'normal' : 'muted'
      expect(control.tone, control.dir).toBe(expected)
    }
  })

  it('有历史之后 undo 才可用', () => {
    const state = fresh()
    expect(fifteenGame.controls(state).find((control) => control.id === 'undo')!.enabled).toBe(false)
    const played = reduceFifteen(state, firstSlide(state))
    expect(fifteenGame.controls(played).find((control) => control.id === 'undo')!.enabled).toBe(true)
  })
})

describe('encode / decode', () => {
  it('初始局面往返一致（含 JSON 往返）', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      const state = fifteenGame.create(2024, difficulty)
      expect(fifteenGame.decode(fifteenGame.encode(state))).toEqual(state)
      expect(fifteenGame.decode(JSON.parse(JSON.stringify(fifteenGame.encode(state))))).toEqual(state)
    }
  })

  it('中盘状态（含撤销历史）往返一致', () => {
    const state = advance(fresh(606, 'skilled'), 5)
    expect(state.history).toHaveLength(5)
    const decoded = fifteenGame.decode(fifteenGame.encode(state))
    expect(decoded).toEqual(state)
    expect(fifteenGame.encode(decoded)).toEqual(fifteenGame.encode(state))
  })

  it('每份快照的步数与位置一致，第一份就是初始局面', () => {
    const state = advance(fresh(4321, 'starter'), 3)
    const decoded = fifteenGame.decode(fifteenGame.encode(state))
    expect(decoded.history.map((snapshot) => snapshot.moves)).toEqual([0, 1, 2])
    expect(decoded.history[0]!.board).toEqual(fifteenGame.create(4321, 'starter').board)
  })

  it('坏数据一律抛 IllegalActionError', () => {
    const played = advance(fresh(17, 'skilled'), 3)
    const raw = fifteenGame.encode(played) as {
      difficulty: string
      seed: number
      rngCursor: number
      board: number[]
      moves: number
      history: Array<{ board: number[]; moves: number }>
    }
    const config = DIFFICULTIES.skilled
    /** 交换两个数字块：可解性奇偶性被翻转，必须被拒绝 */
    const parityFlipped = (board: readonly number[]): number[] => {
      const next = [...board]
      const first = next.findIndex((value) => value !== 0)
      const second = next.findIndex((value, index) => value !== 0 && index > first)
      const tmp = next[first]!
      next[first] = next[second]!
      next[second] = tmp
      return next
    }
    const bad: unknown[] = [
      null,
      undefined,
      42,
      'state',
      {},
      [],
      { ...raw, difficulty: 'impossible' },
      { ...raw, seed: -1 },
      { ...raw, seed: 1.5 },
      { ...raw, seed: 0x1_0000_0000 },
      { ...raw, rngCursor: -1 },
      { ...raw, rngCursor: 1.5 },
      // 游标与同 seed 的打乱结果不符
      { ...raw, rngCursor: raw.rngCursor + 1 },
      { ...raw, board: 'nope' },
      { ...raw, board: raw.board.slice(0, raw.board.length - 1) },
      { ...raw, board: [...raw.board, 0] },
      // 重复值 / 越界值都不是合法排列
      { ...raw, board: raw.board.map((cell, index) => (index === 1 ? raw.board[0] : cell)) },
      { ...raw, board: raw.board.map((cell, index) => (index === 0 ? raw.board.length : cell)) },
      // 被改过奇偶性的盘面：逆序数判据认定无解
      { ...raw, board: parityFlipped(raw.board) },
      { ...raw, moves: -1 },
      { ...raw, moves: 1.5 },
      { ...raw, history: 'nope' },
      // 历史长度与步数不符
      { ...raw, history: raw.history.slice(0, 1) },
      { ...raw, history: raw.history.map((entry) => ({ ...entry, moves: 99 })) },
      { ...raw, history: raw.history.map((entry, index) => (index === 0 ? null : entry)) },
      {
        ...raw,
        history: raw.history.map((entry, index) =>
          index === 0 ? { ...entry, board: parityFlipped(entry.board) } : entry,
        ),
      },
      // 第一份快照不是初始局面（撤销会回不到起点）
      {
        ...raw,
        history: raw.history.map((entry, index) =>
          index === 0
            ? { board: scrambleBoard(config, raw.seed + 1).board, moves: 0 }
            : entry,
        ),
      },
      // moves === 0 时棋盘必须是可复算的初始局面（这里换成「另一个 seed 的可解盘」）
      {
        ...(fifteenGame.encode(fifteenGame.create(raw.seed, 'skilled')) as Record<string, unknown>),
        board: scrambleBoard(config, raw.seed + 1).board,
      },
    ]
    for (const candidate of bad) {
      expect(
        () => fifteenGame.decode(candidate),
        JSON.stringify(candidate)?.slice(0, 120),
      ).toThrow(IllegalActionError)
    }
  })

  it('decode 不重放动作：只搬运存档里的盘面', () => {
    const state = advance(fresh(55, 'starter'), 4)
    const decoded = fifteenGame.decode(fifteenGame.encode(state))
    expect(decoded.board).toEqual(state.board)
    expect(decoded.moves).toBe(state.moves)
  })

  it('同 seed 同动作序列 → encode 完全一致（走 GameDef 公开面）', () => {
    const run = (): unknown => {
      let state = fifteenGame.create(20240607, 'challenging')
      for (let step = 0; step < 25; step++) {
        const slides = fifteenGame
          .legal(state)
          .filter(
            (action): action is { type: 'slide'; dir: 'up' | 'down' | 'left' | 'right' } =>
              action.type === 'slide',
          )
        state = fifteenGame.reduce(state, slides[step % slides.length]!)
      }
      return fifteenGame.encode(state)
    }
    expect(run()).toEqual(run())
  })
})

describe('性能', () => {
  it('三档难度生成耗时上限（宽松 < 300ms）', () => {
    const started = performance.now()
    for (const difficulty of DIFFICULTY_IDS) {
      for (let seed = 0; seed < 10; seed++) fifteenGame.create(seed, difficulty)
    }
    const elapsed = performance.now() - started
    expect(elapsed).toBeLessThan(300)
  })

  it('单次生成与解码都在宽松上限内', () => {
    const started = performance.now()
    const state = fifteenGame.create(20240607, 'challenging')
    fifteenGame.decode(fifteenGame.encode(state))
    expect(performance.now() - started).toBeLessThan(300)
  })
})
