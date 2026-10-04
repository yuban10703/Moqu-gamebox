/**
 * 展示模型测试：1-bit 可读性（靠形状/反白而不是灰阶区分）、统计栏、控件、结果页文案 key。
 */
import { describe, expect, it } from 'vitest'
import {
  INITIAL_LENGTH,
  NO_FOOD,
  createState,
  freeCellCount,
  gameStatus,
  type SnakeState,
} from '../src/rules.js'
import { DIFFICULTY_IDS, difficultySpec } from '../src/meta.js'
import {
  CELL_LABEL_KEYS,
  buildBoard,
  buildControls,
  buildStats,
  buildView,
  cellGlyphAt,
  cellKindAt,
  contentIdOf,
  progressFor,
} from '../src/view.js'
import { SEED, hamiltonianCycle, stateWith, tick, turn } from './helpers.js'

const SIZE = 12

function deadState(): SnakeState {
  // 头 (5,0)=5 朝左：按上 = 立即朝上走一格 → 出界，当场结束
  return turn(stateWith('skilled', { body: [5, 6, 7], food: 100 }), 'up')
}

function wonState(): SnakeState {
  const score = (SIZE * SIZE - INITIAL_LENGTH) / difficultySpec('skilled').growth
  return stateWith('skilled', {
    body: hamiltonianCycle(SIZE),
    food: NO_FOOD,
    score,
    cursor: 1 + score,
  })
}

describe('棋盘展示模型', () => {
  it.each(DIFFICULTY_IDS)('%s：棋盘尺寸与格子数与难度一致', (difficulty) => {
    const spec = difficultySpec(difficulty)
    const board = buildBoard(createState(SEED, difficulty))
    expect(board.kind).toBe('grid')
    expect(board.cols).toBe(spec.size)
    expect(board.rows).toBe(spec.size)
    expect(board.cells).toHaveLength(spec.size * spec.size)
    expect(board.cells.map((cell) => cell.index)).toEqual(
      Array.from({ length: spec.size * spec.size }, (_, index) => index),
    )
  })

  it('蛇头反白、蛇身空心箱、食物圆环、障碍斜纹、空格纯白（形状两两不同）', () => {
    const state = createState(SEED, 'challenging')
    const head = state.body[0]!
    expect(cellKindAt(state, head)).toBe('mine')
    for (const cell of state.body.slice(1)) expect(cellKindAt(state, cell)).toBe('box')
    expect(cellKindAt(state, state.food)).toBe('goal')
    for (const cell of state.obstacles) expect(cellKindAt(state, cell)).toBe('wall')
    const empty = Array.from({ length: SIZE * SIZE }, (_, index) => index).filter(
      (index) =>
        !state.body.includes(index) &&
        !state.obstacles.includes(index) &&
        index !== state.food,
    )
    expect(empty.length).toBeGreaterThan(0)
    for (const cell of empty) expect(cellKindAt(state, cell)).toBe('empty')
  })

  it('撞死后的蛇头换成白底加粗叉号，与活着的黑格一眼可分', () => {
    const dead = deadState()
    expect(gameStatus(dead)).toBe('lost')
    expect(cellKindAt(dead, dead.body[0]!)).toBe('flag')
    expect(cellGlyphAt(dead, dead.body[0]!)).toBe('×')
    // 蛇身与食物不受影响
    expect(cellKindAt(dead, dead.body[1]!)).toBe('box')
  })

  it('每个用到的 kind 都有无障碍标签 key（壳层不硬编码玩法文案）', () => {
    const kinds = new Set(
      [createState(SEED, 'challenging'), deadState(), wonState()].flatMap((state) =>
        buildBoard(state).cells.map((cell) => cell.kind),
      ),
    )
    for (const kind of kinds) {
      // 约定固定：注册表写 `(kind) => `snake.cell.${kind}`` 就能直接取到文案
      expect(CELL_LABEL_KEYS[kind], kind).toBe(`snake.cell.${kind}`)
    }
  })

  it('展示模型里没有平台概念（只有格子、统计、控件与文案 key）', () => {
    const view = buildView(createState(SEED, 'skilled'))
    expect(Object.keys(view).sort()).toEqual(['board', 'notice', 'result', 'stats'])
    expect(view.notice).toBeNull()
    expect(JSON.stringify(view)).not.toMatch(/px|rgb|style|class|dom/i)
  })

  it('玩法自己不再产生提示文字（按下方向键当帧就走一格，棋盘本身就是反馈）', () => {
    // 上一版这里会亮一行「下一格向下」—— 因为那时转向要等下一个 tick 才动。
    // 现在按键立即执行，文字提示只会是噪音；"走不通"仍由壳层的 illegalNoticeKey 负责。
    const turned = turn(createState(SEED, 'skilled'), 'down')
    expect(buildView(turned).notice).toBeNull()
    expect(buildView(tick(turned)).notice).toBeNull()
    expect(buildView(deadState()).notice).toBeNull()
  })
})

describe('统计栏与结果页', () => {
  it('统计三项：分数 / 蛇长 / 步数', () => {
    const state = turn(createState(SEED, 'skilled'), 'down')
    expect(buildStats(state)).toEqual([
      { labelKey: 'snake.stat.score', value: '0' },
      { labelKey: 'snake.stat.length', value: '3' },
      { labelKey: 'snake.stat.moves', value: '1' },
    ])
  })

  it('对局中不显示结果页', () => {
    const view = buildView(createState(SEED, 'skilled'))
    expect(gameStatus(createState(SEED, 'skilled'))).toBe('playing')
    expect(view.result).toBeNull()
  })

  it('撞死后给出失败标题与三项明细', () => {
    const view = buildView(deadState())
    expect(view.result?.titleKey).toBe('snake.lost.title')
    expect(view.result?.details.map((detail) => detail.key)).toEqual([
      'snake.result.score',
      'snake.result.length',
      'snake.result.moves',
    ])
  })

  it('填满棋盘给出胜利标题', () => {
    const won = wonState()
    expect(freeCellCount(won)).toBe(0)
    expect(buildView(won).result?.titleKey).toBe('snake.won.title')
  })
})

describe('控件', () => {
  it('四个方向按钮 + 撤销 + 重开，且原地掉头那个方向变暗', () => {
    const controls = buildControls(createState(SEED, 'skilled'))
    expect(controls.filter((control) => control.role === 'dpad').map((control) => control.id)).toEqual([
      'move-up',
      'move-down',
      'move-left',
      'move-right',
    ])
    const left = controls.find((control) => control.id === 'move-left')!
    expect(left.dir).toBe('left')
    expect(left.tone).toBe('muted')
    expect(controls.find((control) => control.id === 'move-right')!.tone).toBe('normal')
    // 方向盘按钮始终可点：走不通由会话给出文字提示，而不是静默无响应
    expect(controls.filter((control) => control.role === 'dpad').every((c) => c.enabled)).toBe(true)
    expect(controls.map((control) => control.id)).toContain('undo')
    expect(controls.map((control) => control.id)).toContain('restart')
  })

  it('撤销按钮按「有没有历史」启用/禁用（壳层据此决定按钮可不可点）', () => {
    const start = createState(SEED, 'skilled')
    const undoOf = (state: SnakeState): boolean =>
      buildControls(state).find((control) => control.id === 'undo')!.enabled
    expect(undoOf(start)).toBe(false)
    const moved = turn(start, 'down')
    expect(undoOf(moved)).toBe(true)
    // 撞死之后仍然可以撤销（那一步正是最想退回的）
    expect(undoOf(deadState())).toBe(true)
  })

  it('对局结束后不再给出方向（但撤销仍可用）', () => {
    const dead = deadState()
    const controls = buildControls(dead)
    expect(controls.filter((control) => control.role === 'dpad').every((c) => c.tone === 'normal')).toBe(
      true,
    )
    expect(controls.find((control) => control.id === 'undo')!.enabled).toBe(true)
  })
})

describe('注册表辅助', () => {
  it('内容 id = 难度 id', () => {
    expect(contentIdOf(createState(SEED, 'skilled'))).toBe('skilled')
  })

  it('进度按已完成的难度档计数', () => {
    expect(progressFor([])).toEqual({ done: 0, total: DIFFICULTY_IDS.length })
    expect(progressFor(['starter', 'challenging', 'unknown'])).toEqual({
      done: 2,
      total: DIFFICULTY_IDS.length,
    })
  })
})
