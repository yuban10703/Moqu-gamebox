/**
 * 展示模型测试：壳层只按 board / stats / controls / result 渲染，
 * 因此这里锁死「1-bit 可读」的关键约束：
 *   - 方块一律实心黑格（mine），当前块用黑底白纹（boxOnGoal）区分，不出现任何灰阶；
 *   - 只出现三种 kind，键盘/视觉上都不会冒出别的玩法图形；
 *   - 方向盘始终可点（走不通由会话给文字反馈），撤销在无可撤销时禁用；
 *   - 统计栏固定三项（竖屏一行放得下，多一项会把棋盘压小）。
 */
import { describe, expect, it } from 'vitest'
import type { CellKind } from '@eink/core'
import { CELL_LABEL_KEYS, buildBoard, buildControls, buildStats, buildView, cellLabelKey, contentIdOf } from '../src/view.js'
import {
  CELL_FILLED,
  cellIndex,
  createState,
  difficultyOf,
  emptyBoard,
  pieceCells,
  reduceState,
  spawnPiece,
  statusOf,
  type ActivePiece,
  type TetrisState,
} from '../src/rules.js'
import { tetrisGame } from '../src/index.js'

const COLS = 10

function manual(board: readonly number[], piece: ActivePiece, overrides: Partial<TetrisState> = {}): TetrisState {
  const pieces = overrides.pieces ?? 0
  return {
    difficulty: 'starter',
    seed: 1,
    board,
    piece,
    cursor: overrides.cursor ?? pieces + 1,
    score: 0,
    lines: 0,
    pieces,
    history: [],
    ...overrides,
  }
}

function lostState(): TetrisState {
  const piece = spawnPiece('I', COLS)
  const board = emptyBoard(COLS, 18)
  for (const cell of pieceCells(piece)) board[cellIndex(COLS, cell.row, cell.col)] = CELL_FILLED
  return manual(board, piece, { score: 1200, lines: 11, pieces: 14, cursor: 15 })
}

describe('棋盘展示', () => {
  it('棋盘尺寸按难度给：入门 10×18，其余 10×16', () => {
    expect(buildBoard(createState(1, 'starter'))).toMatchObject({ kind: 'grid', cols: 10, rows: 18 })
    expect(buildBoard(createState(1, 'skilled'))).toMatchObject({ cols: 10, rows: 16 })
    expect(buildBoard(createState(1, 'challenging'))).toMatchObject({ cols: 10, rows: 16 })
    const view = buildBoard(createState(1, 'starter'))
    expect(view.cells).toHaveLength(10 * 18)
    expect(view.cells.map((cell) => cell.index)).toEqual([...Array(10 * 18).keys()])
  })

  it('空格 empty、已固定的方块 mine、当前方块 boxOnGoal —— 只有这三种 kind', () => {
    const state = createState(20261004, 'starter')
    const view = buildBoard(state)
    expect(new Set(view.cells.map((cell) => cell.kind))).toEqual(new Set(['empty', 'boxOnGoal']))
    const active = pieceCells(state.piece).map((cell) => cellIndex(COLS, cell.row, cell.col))
    for (const index of active) expect(view.cells[index]).toEqual({ index, kind: 'boxOnGoal', glyph: '' })
    // 一路落到固化：固化前玩家看到的那 4 格，固化后变成实心黑格（mine），当前块换到下一块
    let previous = state
    let locked = state
    while (locked.pieces === 0) {
      previous = locked
      locked = reduceState(locked, { type: 'move', dir: 'down' })
    }
    const settled = pieceCells(previous.piece).map((cell) => cellIndex(COLS, cell.row, cell.col))
    const after = buildBoard(locked)
    for (const index of settled) expect(after.cells[index]).toEqual({ index, kind: 'mine', glyph: '' })
    // 当前块与已固定的方块用不同 kind 区分（黑白屏上靠纹理，不靠灰度）
    expect(after.cells.filter((cell) => cell.kind === 'boxOnGoal')).toHaveLength(4)
    expect(after.cells.filter((cell) => cell.kind === 'mine')).toHaveLength(4)
  })

  it('每个用到的 kind 都有无障碍文案 key', () => {
    expect(cellLabelKey('empty')).toBe('tetris.cell.empty')
    expect(cellLabelKey('mine')).toBe('tetris.cell.mine')
    expect(cellLabelKey('boxOnGoal')).toBe('tetris.cell.boxOnGoal')
    expect(cellLabelKey('wall' as CellKind)).toBeUndefined()
    expect(Object.keys(CELL_LABEL_KEYS)).toHaveLength(3)
  })
})

describe('统计栏', () => {
  it('固定三项：分数 / 消行 / 等级', () => {
    const stats = buildStats(createState(1, 'starter'))
    expect(stats.map((stat) => stat.labelKey)).toEqual(['tetris.stat.score', 'tetris.stat.lines', 'tetris.stat.level'])
    expect(stats.map((stat) => stat.value)).toEqual(['0', '0', '1'])
  })

  it('等级由消行数推出（每 10 行一级），不依赖时间', () => {
    const stats = buildStats(manual(emptyBoard(COLS, 18), spawnPiece('T', COLS), { lines: 23, score: 4200 }))
    expect(stats[0]).toEqual({ labelKey: 'tetris.stat.score', value: '4200' })
    expect(stats[1]).toEqual({ labelKey: 'tetris.stat.lines', value: '23' })
    expect(stats[2]).toEqual({ labelKey: 'tetris.stat.level', value: '3' })
  })
})

describe('控制项', () => {
  it('四个方向盘动作：左右移动、上旋转、下落 + 撤销', () => {
    const controls = buildControls(createState(20261004, 'starter'))
    expect(controls.filter((control) => control.role === 'dpad').map((control) => control.dir)).toEqual([
      'up',
      'down',
      'left',
      'right',
    ])
    expect(controls.map((control) => control.id)).toEqual(['move-up', 'move-down', 'move-left', 'move-right', 'undo'])
    for (const control of controls.filter((item) => item.role === 'dpad')) {
      // 方向盘始终可点：走不通时给文字反馈，而不是静默无响应
      expect(control.enabled).toBe(true)
      expect(control.tone).toBe('normal')
      expect(control.labelKey.startsWith('tetris.dir.')).toBe(true)
    }
    // 开局没有可撤销的动作
    const undo = controls.find((control) => control.id === 'undo')!
    expect(undo.role).toBe('action')
    expect(undo.enabled).toBe(false)
    expect(undo.labelKey).toBe('shell.game.undo')
  })

  it('走不通的方向标 muted（仍然可点）', () => {
    const piece: ActivePiece = { id: 'T', row: 0, col: 0, rot: 0 }
    const controls = buildControls(manual(emptyBoard(COLS, 18), piece))
    expect(controls.find((control) => control.id === 'move-left')!.tone).toBe('muted')
    expect(controls.find((control) => control.id === 'move-right')!.tone).toBe('normal')
  })

  it('走一步之后撤销变为可点（壳层据此决定按钮是否可点）', () => {
    const moved = reduceState(createState(20261004, 'starter'), { type: 'move', dir: 'left' })
    expect(buildControls(moved).find((control) => control.id === 'undo')!.enabled).toBe(true)
  })

  it('输掉之后撤销仍然可用（结果面板上的撤销入口）', () => {
    const lost = lostState()
    expect(statusOf(lost)).toBe('lost')
    const moved = reduceState(createState(20261004, 'starter'), { type: 'move', dir: 'left' })
    const controls = buildControls({ ...lost, history: moved.history })
    // 已经结束：四个方向都不可用（仍可点，点了给文字反馈）
    expect(controls.filter((control) => control.role === 'dpad').every((control) => control.tone === 'muted')).toBe(true)
    // 但撤销是可点的 —— 壳层结果面板正是靠它给出「撤销回上一手」
    expect(controls.find((control) => control.id === 'undo')!.enabled).toBe(true)
  })
})

describe('结果页与视图', () => {
  it('进行中：没有结果面板、没有提示（走不通由会话统一提示）', () => {
    const view = buildView(createState(1, 'starter'))
    expect(view.result).toBeNull()
    expect(view.notice).toBeNull()
    expect(view.stats).toHaveLength(3)
  })

  it('失败：标题 + 分数/消行/固定块数', () => {
    const view = buildView(lostState())
    expect(view.result?.titleKey).toBe('tetris.lost.title')
    expect(view.result?.details.map((detail) => detail.key)).toEqual([
      'tetris.result.score',
      'tetris.result.lines',
      'tetris.result.pieces',
    ])
    expect(view.result?.details.map((detail) => detail.params?.count)).toEqual([1200, 11, 14])
  })

  it('内容 id = 难度 id（无关卡玩法）', () => {
    expect(contentIdOf(createState(1, 'skilled'))).toBe('skilled')
    expect(tetrisGame.contentId?.(createState(1, 'challenging'))).toBe('challenging')
  })

  it('每个难度的棋盘都放得进竖屏可用区（格子 ≥ 22px）', () => {
    /*
     * 可用区口径取自真机实测（见 docs/handover.md 第 8 节：P6Plus 竖屏 439×847、字号 1.5× 下
     * 关灯 5×5 与五子棋 15×15 都拿到 415×415），并加上 packages/ui/test/games-contract.test.ts
     * 里用的 415×420 这一档 —— 这是本项目记录过的最小可用区，按它算才是有意义的守卫。
     */
    const areas = [
      { name: 'P6Plus 竖屏（1.5× 字号，实测最紧）', width: 415, height: 420 },
      { name: '更大视口', width: 407, height: 500 },
    ]
    for (const spec of tetrisGame.difficulties) {
      const board = buildBoard(createState(1, spec.id))
      for (const area of areas) {
        const cell = Math.min((area.width - 10) / board.cols, (area.height - 10) / board.rows)
        expect(cell, `${spec.id} @ ${area.name}`).toBeGreaterThanOrEqual(22)
      }
    }
    // 10 列是定死的：再宽就放不下 22px 的格子（可用区宽 415 → 415/11 ≈ 37 但高度才是瓶颈）
    for (const spec of tetrisGame.difficulties) {
      expect(difficultyOf(spec.id).cols).toBe(10)
    }
  })
})
