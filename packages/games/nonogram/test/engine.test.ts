/**
 * 数织规则层测试。覆盖验收点：
 *   1. 三态循环：空 → 黑 → 叉 → 空（点一下换一态）；
 *   2. 判胜与未完成：黑格与答案逐格一致才算过关，叉与空都算"非黑"；
 *   3. 检查：不即时判错，点检查才报数量；**不标出是哪几行、不揭示答案**；动过标记之后结果作废；
 *   4. 清屏：标记全清、检查结果作废、步数不回退；
 *   5. 题号越界 / 坏存档一律抛错；
 *   6. encode → decode 往返一致（含随机走若干步之后）。
 */
import { describe, expect, it } from 'vitest'
import { IllegalActionError, createRng, type BoardView } from '@eink/core'
import {
  DIFFICULTY_IDS,
  MARK_BLACK,
  MARK_CROSS,
  MARK_CYCLE,
  MARK_EMPTY,
  PUZZLES,
  blackCount,
  colMatches,
  createState,
  decodeState,
  encodeState,
  gameStatus,
  hasMarks,
  isSolved,
  legalActions,
  nextMark,
  nonogramGame,
  progressFor,
  puzzleOf,
  rowMatches,
  selectAction,
  solutionBits,
  totalCells,
  wrongColCount,
  wrongLineCount,
  wrongRowCount,
  type CellMark,
  type NonogramAction,
  type NonogramState,
} from '../src/index.js'

const game = nonogramGame

function act(state: NonogramState, action: NonogramAction): NonogramState {
  return game.reduce(state, action)
}

/** 把某些格子点成指定的标记（空 → 黑 → 叉，最多点两下） */
function setMark(state: NonogramState, index: number, mark: CellMark): NonogramState {
  let next = state
  for (let step = 0; step < MARK_CYCLE.length && next.marks[index] !== mark; step++) {
    next = act(next, { type: 'cycle', index })
  }
  return next
}

function paint(state: NonogramState, indices: readonly number[]): NonogramState {
  let next = state
  for (const index of indices) next = setMark(next, index, MARK_BLACK)
  return next
}

interface CraftPlan {
  /** 答案里是黑、但故意不涂的格子（"少涂一格"） */
  missing?: readonly number[]
  /** 答案里是白、却涂黑的格子（"多涂一格"） */
  extra?: readonly number[]
  /** 打成叉的格子（覆盖其它打算） */
  cross?: readonly number[]
}

/**
 * 照答案拼一个局面。
 *
 * 顺序有讲究：**先涂"多余的"和叉、最后涂答案的黑格** —— 反过来的话，
 * 中途会出现"已经涂满答案"的一瞬间，之后那一下就会因为"已过关"被规则层拒绝。
 */
function craft(state: NonogramState, plan: CraftPlan = {}): NonogramState {
  const answer = solutionBits(puzzleOf(state))
  const cross = new Set(plan.cross ?? [])
  const missing = new Set(plan.missing ?? [])
  let next = state
  for (const index of plan.extra ?? []) next = setMark(next, index, MARK_BLACK)
  for (const index of cross) next = setMark(next, index, MARK_CROSS)
  for (let index = 0; index < answer.length; index++) {
    if (!answer[index] || missing.has(index) || cross.has(index)) continue
    next = setMark(next, index, MARK_BLACK)
  }
  return next
}

function statValue(state: NonogramState, labelKey: string): string | undefined {
  return game.view(state).stats.find((stat) => stat.labelKey === labelKey)?.value
}

/** 数织一定有棋盘；取出来顺便把类型收窄（GameView.board 是可空的） */
function boardOf(state: NonogramState): BoardView {
  const board = game.view(state).board
  if (!board) throw new Error('nonogram always has a board')
  return board
}

function answerBlacks(state: NonogramState): number[] {
  const answer = solutionBits(puzzleOf(state))
  const out: number[] = []
  answer.forEach((filled, index) => {
    if (filled) out.push(index)
  })
  return out
}

function answerWhites(state: NonogramState): number[] {
  const answer = solutionBits(puzzleOf(state))
  const out: number[] = []
  answer.forEach((filled, index) => {
    if (!filled) out.push(index)
  })
  return out
}

/** 每个难度、每道题都拿一个初始局面（题号 = seed，题库 ≤ 6 道所以 seed 直接就是题号） */
function eachPuzzle(): Array<{ difficulty: (typeof DIFFICULTY_IDS)[number]; seed: number; state: NonogramState }> {
  const out: Array<{ difficulty: (typeof DIFFICULTY_IDS)[number]; seed: number; state: NonogramState }> = []
  for (const difficulty of DIFFICULTY_IDS) {
    for (let seed = 0; seed < 100; seed++) {
      const state = createState(seed, difficulty)
      if (state.puzzleIndex !== seed) break
      out.push({ difficulty, seed, state })
    }
  }
  return out
}

describe('三态循环', () => {
  it('点一下换下一态：空 → 黑 → 叉 → 空（循环）', () => {
    let state = createState(0, 'starter')
    const index = 7
    expect(state.marks[index]).toBe(MARK_EMPTY)
    state = act(state, { type: 'cycle', index })
    expect(state.marks[index]).toBe(MARK_BLACK)
    state = act(state, { type: 'cycle', index })
    expect(state.marks[index]).toBe(MARK_CROSS)
    state = act(state, { type: 'cycle', index })
    expect(state.marks[index]).toBe(MARK_EMPTY)
    // 三步转回原点，别的格子一点没动
    expect(state.marks.every((mark) => mark === MARK_EMPTY)).toBe(true)
    expect(state.moves).toBe(3)
  })

  it('nextMark 与 MARK_CYCLE 同源（三态只有这三种）', () => {
    expect(MARK_CYCLE).toEqual([MARK_EMPTY, MARK_BLACK, MARK_CROSS])
    for (const mark of MARK_CYCLE) {
      expect(MARK_CYCLE).toContain(nextMark(mark))
    }
    expect(nextMark(MARK_EMPTY)).toBe(MARK_BLACK)
    expect(nextMark(MARK_BLACK)).toBe(MARK_CROSS)
    expect(nextMark(MARK_CROSS)).toBe(MARK_EMPTY)
  })

  it('selectAction 只认棋盘内的格子；越界返回 null，而 reduce 对越界明确抛错', () => {
    const state = createState(0, 'starter')
    expect(selectAction(state, 0)).toEqual({ type: 'cycle', index: 0 })
    expect(selectAction(state, totalCells(state) - 1)).toEqual({
      type: 'cycle',
      index: totalCells(state) - 1,
    })
    for (const bad of [-1, totalCells(state), 1.5, Number.NaN]) {
      expect(selectAction(state, bad)).toBeNull()
      expect(() => act(state, { type: 'cycle', index: bad })).toThrow(IllegalActionError)
    }
  })

  it('未知动作抛 IllegalActionError（壳层的固定按钮 / 旧存档）', () => {
    const state = createState(0, 'starter')
    expect(() => act(state, { type: 'undo' } as unknown as NonogramAction)).toThrow(IllegalActionError)
    expect(() => act(state, { type: 'tick' } as unknown as NonogramAction)).toThrow(IllegalActionError)
  })
})

describe('判胜与未完成', () => {
  it('黑格与答案逐格一致 → won（每道题都验一遍）', () => {
    for (const { state } of eachPuzzle()) {
      const solved = craft(state)
      expect(isSolved(solved), puzzleOf(state).id).toBe(true)
      expect(gameStatus(solved), puzzleOf(state).id).toBe('won')
      expect(wrongLineCount(solved), puzzleOf(state).id).toBe(0)
      expect(wrongRowCount(solved)).toBe(0)
      expect(wrongColCount(solved)).toBe(0)
      expect(solved.marks.filter((mark) => mark === MARK_BLACK)).toHaveLength(answerBlacks(state).length)
    }
  })

  it('少涂一格 / 多涂一格 / 把该黑的格子打成叉 → 都不算完成', () => {
    for (const { state } of eachPuzzle()) {
      const blacks = answerBlacks(state)
      const whites = answerWhites(state)
      const missing = craft(state, { missing: [blacks[0]!] })
      const extra = craft(state, { extra: [whites[0]!] })
      const crossed = craft(state, { cross: [blacks[blacks.length - 1]!] })
      for (const [name, board] of [['少涂', missing], ['多涂', extra], ['打成叉', crossed]] as const) {
        expect(isSolved(board), `${puzzleOf(state).id} ${name}`).toBe(false)
        expect(gameStatus(board), `${puzzleOf(state).id} ${name}`).toBe('playing')
        expect(wrongLineCount(board), `${puzzleOf(state).id} ${name}`).toBeGreaterThan(0)
      }
    }
  })

  it('叉与空在判胜里完全等价：把**答案之外**的格子打成叉照样过关', () => {
    for (const { state } of eachPuzzle()) {
      const whites = answerWhites(state)
      const board = craft(state, { cross: [whites[0]!, whites[whites.length - 1]!] })
      expect(gameStatus(board), puzzleOf(state).id).toBe('won')
      // 打成叉的格子确实存下来了（只是不影响判定）
      expect(board.marks[whites[0]!]).toBe(MARK_CROSS)
    }
  })

  it('过关之后不能再点格子（selectAction 返回 null，reduce 抛错）', () => {
    const solved = craft(createState(0, 'starter'))
    expect(gameStatus(solved)).toBe('won')
    expect(selectAction(solved, 0)).toBeNull()
    expect(() => act(solved, { type: 'cycle', index: 0 })).toThrow(IllegalActionError)
    expect(() => act(solved, { type: 'check' })).toThrow(IllegalActionError)
    // 重开是例外：任何时候都允许（回到同一道题的白纸）
    const restarted = act(solved, { type: 'restart' })
    expect(gameStatus(restarted)).toBe('playing')
    expect(hasMarks(restarted)).toBe(false)
  })

  it('空盘一定是"未完成"（不会把没涂的当成过关）', () => {
    for (const { state } of eachPuzzle()) {
      expect(gameStatus(state)).toBe('playing')
      expect(wrongLineCount(state)).toBeGreaterThan(0)
    }
  })
})

describe('检查：不即时判错、只报数量、不揭示答案', () => {
  it('不点检查就什么都不报：涂错了也还是 playing，统计栏是破折号、没有提示', () => {
    const state = createState(0, 'starter')
    const wrong = paint(state, [10, 11, 12, 13, 14, 15])
    expect(gameStatus(wrong)).toBe('playing')
    expect(statValue(wrong, 'nonogram.stat.wrong')).toBe('—')
    expect(game.view(wrong).notice).toBeNull()
  })

  it('手算过的局面：只涂中间一行 → 4 行不符 + 正中一列也不符（检查报 5）', () => {
    // starter-1 是十字：正中一行整行黑、正中一列整列黑
    const state = createState(0, 'starter')
    const middleRow = [10, 11, 12, 13, 14]
    const painted = paint(state, middleRow)
    // 逐行/逐列核对：四行都不符（每行都该有一个黑格，只有中间那行对了）；
    // 两侧四列都符合（答案里它们各只有一个黑格），只有正中那列该有 5 个黑格、现在只有 1 个 → 不符
    expect(wrongRowCount(painted)).toBe(4)
    expect(wrongColCount(painted)).toBe(1)
    expect(wrongLineCount(painted)).toBe(5)
    expect(rowMatches(painted, 2)).toBe(true)
    expect(rowMatches(painted, 0)).toBe(false)
    expect(colMatches(painted, 0)).toBe(true)
    expect(colMatches(painted, 2)).toBe(false)
    // 检查之前提示栏是空的；检查之后统计栏给出数量、提示栏给出固定文案
    const checked = act(painted, { type: 'check' })
    expect(checked.wrongLines).toBe(5)
    expect(statValue(checked, 'nonogram.stat.wrong')).toBe('5')
    expect(game.view(checked).notice).toEqual({ textKey: 'nonogram.notice.check' })
    // 检查本身不算步数
    expect(checked.moves).toBe(painted.moves)
  })

  it('检查一格都不标：棋盘、线索带、格子标记全都原样（不揭示答案）', () => {
    const wrong = craft(createState(1, 'skilled'), { extra: [0, 99], missing: [55] })
    const before = boardOf(wrong)
    const checked = act(wrong, { type: 'check' })
    const after = boardOf(checked)
    // 格子的画法完全没变（kind / glyph / wrong 标记都一致）
    expect(after.cells).toEqual(before.cells)
    expect(after.cells.some((cell) => cell.wrong === true)).toBe(false)
    // 线索带也没变
    expect(after.rowClues).toEqual(before.rowClues)
    expect(after.colClues).toEqual(before.colClues)
    // 标记位一个没动
    expect(checked.marks).toEqual(wrong.marks)
    // 只有"数量"这一项是新的信息
    expect(checked.wrongLines).toBe(wrongLineCount(checked))
    expect(checked.wrongLines).toBeGreaterThan(0)
  })

  it('动过标记之后检查结果作废（不显示过期的数字）', () => {
    const wrong = craft(createState(0, 'starter'), { extra: [0] })
    const checked = act(wrong, { type: 'check' })
    expect(checked.wrongLines).not.toBeNull()
    const moved = act(checked, { type: 'cycle', index: 24 })
    expect(moved.wrongLines).toBeNull()
    expect(statValue(moved, 'nonogram.stat.wrong')).toBe('—')
    expect(game.view(moved).notice).toBeNull()
  })

  it('「不符行数」= 行 + 列，且与逐行逐列核对的结果一致（随机局面）', () => {
    const rng = createRng(20261010)
    let state = createState(3, 'challenging')
    for (let step = 0; step < 40; step++) {
      state = act(state, { type: 'cycle', index: Math.floor(rng.next() * totalCells(state)) })
      const checked = wrongLineCount(state)
      let rows = 0
      for (let row = 0; row < puzzleOf(state).solution.length; row++) if (!rowMatches(state, row)) rows++
      let cols = 0
      for (let col = 0; col < puzzleOf(state).solution[0]!.length; col++) if (!colMatches(state, col)) cols++
      expect(wrongRowCount(state)).toBe(rows)
      expect(wrongColCount(state)).toBe(cols)
      expect(checked).toBe(rows + cols)
      // 唯一解 + "按线索核对"的定义：没有一行不符 ⟺ 就是答案
      if (checked === 0) expect(isSolved(state)).toBe(true)
    }
  })
})

describe('清屏', () => {
  it('标记全清、检查结果作废，步数不回退（清屏不是"撤销"）', () => {
    let state = craft(createState(2, 'skilled'), { extra: [7] })
    state = act(state, { type: 'check' })
    expect(hasMarks(state)).toBe(true)
    const movesBefore = state.moves
    const cleared = act(state, { type: 'clearMarks' })
    expect(cleared.marks.every((mark) => mark === MARK_EMPTY)).toBe(true)
    expect(blackCount(cleared)).toBe(0)
    expect(cleared.wrongLines).toBeNull()
    expect(cleared.moves).toBe(movesBefore)
    expect(gameStatus(cleared)).toBe('playing')
    // 清完就是白纸：清屏按钮该被禁用（点了不会有任何效果）
    expect(game.controls(cleared).find((control) => control.id === 'clear')?.enabled).toBe(false)
  })

  it('空盘上清屏幂等：返回同一个状态（无事发生，也不算非法）', () => {
    const state = createState(0, 'starter')
    expect(act(state, { type: 'clearMarks' })).toBe(state)
  })

  it('有标记时清屏按钮可用；检查按钮一直可用', () => {
    const empty = createState(0, 'starter')
    const marked = act(empty, { type: 'cycle', index: 0 })
    expect(game.controls(empty).find((control) => control.id === 'clear')?.enabled).toBe(false)
    expect(game.controls(marked).find((control) => control.id === 'clear')?.enabled).toBe(true)
    for (const state of [empty, marked]) {
      expect(game.controls(state).find((control) => control.id === 'check')?.enabled).toBe(true)
    }
  })

  it('controlAction 把按钮映射成动作（清屏 / 检查 / 重开）', () => {
    const state = createState(0, 'starter')
    expect(game.controlAction?.(state, 'clear')).toEqual({ type: 'clearMarks' })
    expect(game.controlAction?.(state, 'check')).toEqual({ type: 'check' })
    expect(game.controlAction?.(state, 'restart')).toEqual({ type: 'restart' })
    expect(game.controlAction?.(state, 'digit-1')).toBeNull()
  })
})

describe('步数与内容 id', () => {
  it('步数只数涂黑 / 打叉（清屏与检查不计步）', () => {
    let state = createState(0, 'starter')
    expect(game.movesOf?.(state)).toBe(0)
    state = act(state, { type: 'cycle', index: 0 })
    state = act(state, { type: 'cycle', index: 0 })
    state = act(state, { type: 'cycle', index: 1 })
    expect(state.moves).toBe(3)
    state = act(state, { type: 'check' })
    expect(state.moves).toBe(3)
    state = act(state, { type: 'clearMarks' })
    expect(state.moves).toBe(3)
  })

  it('contentId 是题号（进度与最佳步数按题记）', () => {
    expect(game.contentId?.(createState(0, 'starter'))).toBe('starter-1')
    expect(game.contentId?.(createState(1, 'starter'))).toBe('starter-2')
    expect(game.contentId?.(createState(0, 'challenging'))).toBe('challenging-1')
  })

  it('progressFor 按题号算进度（16 道题全解出才是 100%）', () => {
    expect(progressFor([])).toEqual({ done: 0, total: PUZZLES.length })
    expect(progressFor(['starter-1', 'skilled-3', '不存在的题'])).toEqual({
      done: 2,
      total: PUZZLES.length,
    })
    expect(progressFor(PUZZLES.map((puzzle) => puzzle.id))).toEqual({
      done: PUZZLES.length,
      total: PUZZLES.length,
    })
  })
})

describe('存档：encode → decode 往返一致', () => {
  it('初始状态往返一致，且再编码完全相同', () => {
    for (const { state } of eachPuzzle()) {
      const raw = encodeState(state)
      const decoded = decodeState(raw)
      expect(decoded).toEqual(state)
      expect(JSON.stringify(encodeState(decoded))).toBe(JSON.stringify(raw))
    }
  })

  it('随机走 60 步，每一步之后都能原样存档往返（含检查与清屏）', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      const rng = createRng(20261010)
      let state = createState(5, difficulty)
      for (let step = 0; step < 60; step++) {
        const actions = legalActions(state)
        if (actions.length === 0) break
        const action = rng.pick(actions)
        try {
          state = act(state, action)
        } catch {
          continue
        }
        const raw = encodeState(state)
        const decoded = decodeState(raw)
        expect(decoded).toEqual(state)
        expect(JSON.stringify(encodeState(decoded))).toBe(JSON.stringify(raw))
      }
    }
  })

  it('检查结果也进存档，且读回来之后仍然自洽', () => {
    const wrong = craft(createState(0, 'starter'), { extra: [0] })
    const checked = act(wrong, { type: 'check' })
    const decoded = decodeState(encodeState(checked))
    expect(decoded.wrongLines).toBe(checked.wrongLines)
    expect(decoded).toEqual(checked)
  })
})

describe('存档：坏数据一律抛错', () => {
  const good = encodeState(craft(createState(0, 'starter'), { extra: [0] })) as Record<string, unknown>

  it('根不是对象 / 难度不认识', () => {
    for (const bad of [null, undefined, 42, 'state', []]) {
      expect(() => decodeState(bad)).toThrow(IllegalActionError)
    }
    expect(() => decodeState({ ...good, difficulty: 'endless' })).toThrow(IllegalActionError)
    expect(() => decodeState({ ...good, difficulty: undefined })).toThrow(IllegalActionError)
  })

  it('题号越界 / 非整数（题库只有 6 道入门题）', () => {
    for (const puzzleIndex of [6, 7, -1, 1.5, '3', null, undefined, Number.NaN]) {
      expect(() => decodeState({ ...good, puzzleIndex })).toThrow(IllegalActionError)
    }
    // 换难度之后题号范围跟着变（挑战档只有 4 道）
    const challenging = encodeState(createState(0, 'challenging')) as Record<string, unknown>
    expect(() => decodeState({ ...challenging, puzzleIndex: 4 })).toThrow(IllegalActionError)
    expect(() => decodeState({ ...challenging, puzzleIndex: 3 })).not.toThrow()
  })

  it('标记位：长度不对 / 出现 0/1/2 之外的字符 / 不是字符串', () => {
    expect(() => decodeState({ ...good, marks: '0'.repeat(24) })).toThrow(IllegalActionError)
    expect(() => decodeState({ ...good, marks: '0'.repeat(26) })).toThrow(IllegalActionError)
    expect(() => decodeState({ ...good, marks: '0'.repeat(24) + 'x' })).toThrow(IllegalActionError)
    expect(() => decodeState({ ...good, marks: [0, 1, 2] })).toThrow(IllegalActionError)
    expect(() => decodeState({ ...good, marks: undefined })).toThrow(IllegalActionError)
  })

  it('步数：负数 / 小数 / 非数字', () => {
    for (const moves of [-1, 1.5, '3', null]) {
      expect(() => decodeState({ ...good, moves })).toThrow(IllegalActionError)
    }
  })

  it('检查结果必须与标记对得上（改过的存档不能谎报"全对"）', () => {
    // good 是"多涂了一格"的未完成局面：谎报 0 行不符 → 拒收
    expect(() => decodeState({ ...good, wrongLines: 0 })).toThrow(IllegalActionError)
    // 超出行列总数的数字 → 拒收
    expect(() => decodeState({ ...good, wrongLines: 999 })).toThrow(IllegalActionError)
    expect(() => decodeState({ ...good, wrongLines: -1 })).toThrow(IllegalActionError)
    expect(() => decodeState({ ...good, wrongLines: 1.5 })).toThrow(IllegalActionError)
    // 未检查（null）永远合法
    expect(() => decodeState({ ...good, wrongLines: null })).not.toThrow()
    // 真正的答案局面：0 行不符是自洽的
    const solved = encodeState(craft(createState(0, 'starter'))) as Record<string, unknown>
    const checked = { ...solved, wrongLines: 0 }
    expect(() => decodeState(checked)).not.toThrow()
    expect(decodeState(checked).wrongLines).toBe(0)
  })

  it('旧存档没有 moves 字段时按 0 读（缺省宽容，值本身仍然严格）', () => {
    const { moves: _moves, ...withoutMoves } = good
    expect(decodeState(withoutMoves).moves).toBe(0)
  })
})

describe('legal 与随机回放', () => {
  it('legal 里的动作全部合法（随机挑 80 步，一步都不抛错）', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      const rng = createRng(4242)
      let state = createState(9, difficulty)
      for (let step = 0; step < 80; step++) {
        const actions = legalActions(state)
        if (actions.length === 0) break
        state = act(state, rng.pick(actions))
      }
      expect(gameStatus(state)).toBe('playing')
    }
  })

  it('过关之后 legal 只剩重开（不再发格子动作）', () => {
    const solved = craft(createState(0, 'starter'))
    expect(legalActions(solved)).toEqual([{ type: 'restart' }])
  })

  it('没有随机、没有 AI：同一 seed 同一动作序列得到同一状态（含存档字节）', () => {
    const play = (seed: number): string => {
      const rng = createRng(seed * 31 + 7)
      let state = createState(seed, 'skilled')
      for (let step = 0; step < 30; step++) {
        const actions = legalActions(state)
        state = act(state, rng.pick(actions))
      }
      return JSON.stringify(encodeState(state))
    }
    for (const seed of [0, 1, 2, 3]) expect(play(seed)).toBe(play(seed))
  })
})
