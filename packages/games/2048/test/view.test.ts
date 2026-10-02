/**
 * 展示模型测试：壳层只按 board/stats/controls/result 渲染，
 * 因此这里锁死「1-bit 可读」的关键约束：数字方块靠数字本身分辨、不用灰阶，
 * 方向盘始终可点（走不通由会话给文字反馈），撤销在无可撤销时禁用。
 */
import { describe, expect, it } from 'vitest'
import { IllegalActionError } from '@eink/core'
import {
  contentIdOf,
  contentIndex,
  CONTENT_IDS,
  progressFor,
  game2048,
} from '../src/index.js'
import { buildBoard, buildControls, buildView, CELL_LABEL_KEYS, cellLabelKey } from '../src/view.js'
import { createState, emptyBoard, reduceState, type Game2048State } from '../src/rules.js'

function stateWith(board: readonly number[], overrides: Partial<Game2048State> = {}): Game2048State {
  return {
    difficulty: 'starter',
    seed: 1,
    board,
    score: 0,
    moves: 0,
    cursor: 0,
    history: [],
    ...overrides,
  }
}

const ZERO16 = emptyBoard(4)

describe('棋盘展示', () => {
  it('4×4：空格是 empty、数字是 tile 且 glyph 为数字字符串', () => {
    const board = [0, 2, 0, 128, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    const view = buildBoard(stateWith(board))
    expect(view.kind).toBe('grid')
    expect(view.cols).toBe(4)
    expect(view.rows).toBe(4)
    expect(view.cells).toHaveLength(16)
    expect(view.cells[0]).toEqual({ index: 0, kind: 'empty', glyph: '' })
    expect(view.cells[1]).toEqual({ index: 1, kind: 'tile', glyph: '2' })
    expect(view.cells[3]).toEqual({ index: 3, kind: 'tile', glyph: '128' })
    // 只出现 empty / tile 两种 kind，保证壳层能用「描边方块 vs 空白」区分，不依赖灰阶
    expect(new Set(view.cells.map((cell) => cell.kind))).toEqual(new Set(['empty', 'tile']))
  })

  it('5×5 挑战档棋盘是 25 格', () => {
    const board = emptyBoard(5)
    board[12] = 2048
    const view = buildBoard(stateWith(board, { difficulty: 'challenging' }))
    expect(view.cols).toBe(5)
    expect(view.rows).toBe(5)
    expect(view.cells).toHaveLength(25)
    expect(view.cells[12]!.glyph).toBe('2048')
  })

  it('每个 kind 都有无障碍文案 key', () => {
    expect(cellLabelKey('empty')).toBe('2048.cell.empty')
    expect(cellLabelKey('tile')).toBe('2048.cell.tile')
    expect(cellLabelKey('wall')).toBeUndefined()
    expect(Object.keys(CELL_LABEL_KEYS)).toEqual(['empty', 'tile'])
  })
})

describe('统计栏', () => {
  it('包含分数、步数、目标，且数值随局面变化', () => {
    const state = stateWith([2, 2, 0, 0, ...ZERO16.slice(4)], { score: 36, moves: 5 })
    const view = buildView(state)
    const byKey = new Map(view.stats.map((stat) => [stat.labelKey, stat.value]))
    expect(byKey.get('2048.stat.score')).toBe('36')
    expect(byKey.get('2048.stat.moves')).toBe('5')
    expect(byKey.get('2048.stat.target')).toBe('256')
    expect(buildView(stateWith(ZERO16, { difficulty: 'skilled' })).stats.find((s) => s.labelKey === '2048.stat.target')!.value).toBe('2048')
  })
})

describe('控制项', () => {
  it('4 个 dpad + 撤销；初始无可撤销时撤销禁用', () => {
    const controls = buildControls(createState(1, 'starter'))
    expect(controls).toHaveLength(5)
    const dpads = controls.filter((control) => control.role === 'dpad')
    expect(dpads.map((control) => control.id)).toEqual(['move-up', 'move-down', 'move-left', 'move-right'])
    expect(dpads.map((control) => control.dir)).toEqual(['up', 'down', 'left', 'right'])
    // 方向盘始终可点：走不通不是「不给点」，而是点了之后有文字反馈
    expect(dpads.every((control) => control.enabled)).toBe(true)
    const undo = controls.find((control) => control.id === 'undo')!
    expect(undo.role).toBe('action')
    expect(undo.labelKey).toBe('shell.game.undo')
    expect(undo.enabled).toBe(false)
  })

  it('走不通的方向用 muted 呈现，但仍可点', () => {
    const stuck = stateWith([2, 4, 8, 16, 16, 8, 4, 2, 2, 4, 8, 16, 16, 8, 4, 2])
    const controls = buildControls(stuck)
    expect(controls.filter((control) => control.role === 'dpad').every((control) => control.tone === 'muted')).toBe(true)
    expect(controls.filter((control) => control.role === 'dpad').every((control) => control.enabled)).toBe(true)
    const movable = stateWith([2, 4, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    const right = buildControls(movable).find((control) => control.id === 'move-right')!
    expect(right.tone).toBe('normal')
  })

  it('移动后可撤销，撤销回去后又禁用', () => {
    // 手工局面保证「向左」一定有效，避免依赖随机初始盘
    let state = stateWith([2, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0])
    state = reduceState(state, { type: 'move', dir: 'left' })
    expect(buildControls(state).find((control) => control.id === 'undo')!.enabled).toBe(true)
    state = reduceState(state, { type: 'undo' })
    expect(buildControls(state).find((control) => control.id === 'undo')!.enabled).toBe(false)
  })

  it('不提供 next-level / restart 控件（壳层自带重开按钮）', () => {
    const ids = buildControls(createState(2, 'starter')).map((control) => control.id)
    expect(ids).not.toContain('next-level')
    expect(ids).not.toContain('restart')
  })
})

describe('结果面板', () => {
  it('进行中 result 为 null', () => {
    const view = buildView(createState(3, 'starter'))
    expect(view.result).toBeNull()
    expect(view.notice).toBeNull()
  })

  it('won：标题与分数/步数明细', () => {
    const board = emptyBoard(4)
    board[0] = 256
    const view = buildView(stateWith(board, { score: 128, moves: 12 }))
    expect(view.result?.titleKey).toBe('2048.won.title')
    expect(view.result?.details.map((detail) => detail.key)).toEqual(['2048.result.score', '2048.result.moves'])
    expect(view.result?.details[0]!.params).toEqual({ count: 128 })
    expect(view.result?.details[1]!.params).toEqual({ count: 12 })
  })

  it('lost：标题与明细', () => {
    const stuck = [2, 4, 8, 16, 16, 8, 4, 2, 2, 4, 8, 16, 16, 8, 4, 2]
    const view = buildView(stateWith(stuck, { score: 40, moves: 30 }))
    expect(view.result?.titleKey).toBe('2048.lost.title')
    expect(view.result?.details).toHaveLength(2)
  })
})

describe('注册表辅助', () => {
  it('内容 id 用难度 id，进度按难度档计数', () => {
    expect(contentIdOf(createState(1, 'challenging'))).toBe('challenging')
    expect(CONTENT_IDS).toEqual(['starter', 'skilled', 'challenging'])
    expect(contentIndex('skilled')).toBe(1)
    expect(contentIndex('nope')).toBe(0)
    expect(progressFor([])).toEqual({ done: 0, total: 3 })
    expect(progressFor(['starter', 'challenging', 'sokoban-1'])).toEqual({ done: 2, total: 3 })
  })

  it('contentId / movesOf 钩子供壳层记录进度与最佳步数', () => {
    // 手工局面保证「向左」一定有效
    const state = stateWith([2, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0], { difficulty: 'skilled' })
    expect(game2048.contentId?.(state)).toBe('skilled')
    expect(game2048.movesOf?.(state)).toBe(0)
    const moved = reduceState(state, { type: 'move', dir: 'left' })
    expect(game2048.movesOf?.(moved)).toBe(1)
    // 撤销也回退计数：最佳成绩不会把撤销算成额外步数
    expect(game2048.movesOf?.(reduceState(moved, { type: 'undo' }))).toBe(0)
  })

  it('GameDef 的 view/controls 与构建器一致', () => {
    const state = createState(9, 'starter')
    expect(game2048.view(state)).toEqual(buildView(state))
    expect(game2048.controls(state)).toEqual(buildControls(state))
  })

  it('难度未知时构建展示模型会抛 IllegalActionError', () => {
    const broken = { ...createState(1, 'starter'), difficulty: 'nope' } as unknown as Game2048State
    expect(() => buildView(broken)).toThrow(IllegalActionError)
  })
})
