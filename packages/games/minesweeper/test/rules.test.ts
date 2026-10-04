/**
 * 扫雷规则层测试。覆盖验收点：
 *   1. 确定性：同 seed 同操作序列 → 同状态；
 *   2. 首点安全：首点及其 8 邻域内绝无雷（多种子 × 多难度 × 多落点）；
 *   3. 洪水式连锁翻开；
 *   4. 踩雷 → lost、标记模式插旗/取消、已翻开格插旗抛错；
 *   5. 翻开所有非雷格 → won；
 *   6. encode/decode 往返一致、坏数据抛错、decode 不重新布雷。
 */
import { describe, expect, it, vi } from 'vitest'
import { IllegalActionError, createRng } from '@eink/core'
import {
  cellCount,
  configFor,
  decodeState,
  DIFFICULTIES,
  DIFFICULTY_IDS,
  encodeState,
  minesweeperGame,
  neighborhoodOf,
  neighborsOf,
  type DifficultyId,
  type MinesweeperAction,
  type MinesweeperState,
} from '../src/index.js'

const game = minesweeperGame
const STARTER = configFor('starter')

function fresh(seed = 1, difficulty: DifficultyId = 'starter'): MinesweeperState {
  return game.create(seed, difficulty)
}

function act(state: MinesweeperState, action: MinesweeperAction): MinesweeperState {
  return game.reduce(state, action)
}

function firstHidden(state: MinesweeperState): number {
  const revealed = new Set(state.revealed)
  const flags = new Set(state.flags)
  for (let index = 0; index < cellCount(configFor(state.difficulty)); index++) {
    if (!revealed.has(index) && !flags.has(index)) return index
  }
  return -1
}

function statValue(state: MinesweeperState, labelKey: string): string | undefined {
  return game.view(state).stats.find((stat) => stat.labelKey === labelKey)?.value
}

function controlById(state: MinesweeperState, id: string) {
  return game.controls(state).find((control) => control.id === id)
}

/** selectAction 在契约里是可选的；扫雷必须实现它，这里断言存在后再调用 */
function selectAt(state: MinesweeperState, index: number): MinesweeperAction | null {
  const select = game.selectAction
  if (!select) throw new Error('minesweeper must implement selectAction')
  return select(state, index)
}

/** 用确定性随机源挑合法动作（测试里也不许出现 Math.random） */
function playRandom(seed: number, steps: number, difficulty: DifficultyId = 'starter'): MinesweeperState {
  const rng = createRng(seed * 7919 + 13)
  let state = fresh(seed, difficulty)
  for (let i = 0; i < steps; i++) {
    if (game.status(state) !== 'playing') break
    const choices = game.legal(state).filter((action) => action.type !== 'restart')
    state = act(state, rng.pick(choices))
  }
  return state
}

describe('确定性', () => {
  it('同 seed 同操作序列 → 状态完全相同（含 JSON 形式）', () => {
    for (const seed of [1, 2, 3, 4242]) {
      const left = playRandom(seed, 80)
      const right = playRandom(seed, 80)
      expect(left).toEqual(right)
      expect(encodeState(left)).toEqual(encodeState(right))
      expect(JSON.stringify(encodeState(left))).toBe(JSON.stringify(encodeState(right)))
    }
  })

  it('同一盘面继续走也保持确定性（逐步 reduce 与重放一致）', () => {
    const seed = 77
    const rng = createRng(1234)
    const log: MinesweeperAction[] = []
    let state = fresh(seed, 'skilled')
    while (game.status(state) === 'playing' && log.length < 60) {
      const choices = game.legal(state).filter((action) => action.type !== 'restart')
      const action = rng.pick(choices)
      log.push(action)
      state = act(state, action)
    }
    const replayed = log.reduce((acc, action) => act(acc, action), fresh(seed, 'skilled'))
    expect(replayed).toEqual(state)
  })
})

describe('首点安全（延迟布雷）', () => {
  it('首点前没有雷；首点及其 8 邻域内绝无雷（多难度 × 多种子 × 多落点）', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      const config = DIFFICULTIES[difficulty]
      const total = cellCount(config)
      const firsts = [
        0,
        config.cols - 1,
        config.cols,
        Math.floor(total / 2),
        total - 1,
      ]
      for (const seed of [0, 1, 7, 42, 99991]) {
        const initial = fresh(seed, difficulty)
        expect(initial.mines).toEqual([])
        expect(initial.firstIndex).toBeNull()
        expect(initial.firstClickUsed).toBe(false)
        for (const first of firsts) {
          const state = act(initial, { type: 'reveal', index: first })
          expect(state.firstIndex).toBe(first)
          expect(state.firstClickUsed).toBe(true)
          expect(state.mines).toHaveLength(config.mineCount)
          expect(state.rngCursor).toBe(config.mineCount)
          // 内部状态：安全区内没有雷
          const safe = new Set(neighborhoodOf(config, first))
          for (const mine of state.mines) expect(safe.has(mine)).toBe(false)
          // 视图层面：安全区里看不到雷
          const board = game.view(state).board!
          for (const index of neighborhoodOf(config, first)) {
            expect(board.cells[index]!.kind).not.toBe('mine')
          }
          expect(game.status(state)).not.toBe('lost')
        }
      }
    }
  })

  it('首点必然被翻开，且不会踩雷', () => {
    for (const seed of [3, 4, 5]) {
      const state = act(fresh(seed, 'challenging'), { type: 'reveal', index: 0 })
      expect(state.revealed).toContain(0)
      expect(state.mines).not.toContain(0)
      expect(game.status(state)).toBe('playing')
    }
  })
})

describe('洪水式连锁翻开', () => {
  /** 手工构造：左下一颗雷 + 最下一行整行雷，首点 (0,0)，(4,4) 插旗 */
  const FIXTURE: unknown = {
    difficulty: 'starter',
    seed: 0,
    mines: [63, 72, 73, 74, 75, 76, 77, 78, 79, 80],
    revealed: [],
    flags: [40],
    firstIndex: 0,
    firstClickUsed: true,
    rngCursor: 10,
    flagMode: false,
  }

  it('从 0 雷格连锁翻开整片 0 区，覆盖所有可达格但不越过数字带', () => {
    const state = decodeState(FIXTURE)
    expect(game.status(state)).toBe('playing')
    const after = act(state, { type: 'reveal', index: 0 })
    // 第 0~6 行基本都能连到（第 6 行右侧几格本身是 0 雷），随后第 7 行只有
    // 挨着最下一行雷的 64~71 会被翻开；63 与第 8 行的雷不会翻开
    const expected: number[] = []
    for (let index = 0; index <= 62; index++) if (index !== 40) expected.push(index)
    for (let index = 64; index <= 71; index++) expected.push(index)
    expect(after.revealed).toEqual(expected)
    // 旗子不被连锁翻开，雷也不会被翻开
    expect(after.revealed).not.toContain(40)
    expect(after.revealed).not.toContain(63)
    for (const mine of after.mines) expect(after.revealed).not.toContain(mine)
    // 视图：链式翻开的空白格是 empty，紧邻雷的是 number，旗子保持 flag
    const board = game.view(after).board!
    expect(board.cells[0]!.kind).toBe('empty')
    expect(board.cells[0]!.glyph).toBe('')
    expect(board.cells[62]!.kind).toBe('empty')
    expect(board.cells[64]!.kind).toBe('number')
    expect(board.cells[64]!.glyph).toBe('4')
    expect(board.cells[40]!.kind).toBe('flag')
    expect(board.cells[63]!.kind).toBe('hidden')
    expect(board.cells[72]!.kind).toBe('hidden')
  })

  it('数字格本身被翻开，但不继续扩散', () => {
    const state = decodeState(FIXTURE)
    const after = act(state, { type: 'reveal', index: 54 })
    expect(after.revealed).toEqual([54])
    expect(game.view(after).board!.cells[54]!.kind).toBe('number')
    expect(game.view(after).board!.cells[54]!.glyph).toBe('1')
  })
})

describe('胜负与标记', () => {
  it('翻到雷 → lost，视图亮出全部雷，之后拒绝操作', () => {
    let state = act(fresh(3, 'starter'), { type: 'reveal', index: 40 })
    expect(game.status(state)).toBe('playing')
    const mine = state.mines.find((index) => !state.revealed.includes(index))
    expect(mine).toBeDefined()
    // 输之前不会亮雷
    expect(game.view(state).board!.cells[mine!]!.kind).not.toBe('mine')

    state = act(state, { type: 'reveal', index: mine! })
    expect(game.status(state)).toBe('lost')
    expect(state.revealed).toContain(mine)
    const view = game.view(state)
    for (const index of state.mines) {
      expect(view.board!.cells[index]!.kind).toBe('mine')
      expect(view.board!.cells[index]!.glyph).toBe('✳')
    }
    expect(view.result!.titleKey).toBe('minesweeper.lost.title')
    expect(() => act(state, { type: 'reveal', index: firstHidden(state) })).toThrow(IllegalActionError)
    expect(() => act(state, { type: 'toggleFlag', index: firstHidden(state) })).toThrow(IllegalActionError)
    expect(() => act(state, { type: 'toggleFlagMode' })).toThrow(IllegalActionError)
    expect(selectAt(state, firstHidden(state))).toBeNull()
    // 输局后只剩重开与撤销：撤销正是把局面退回踩雷之前的那一步
    expect(game.legal(state).map((action) => action.type)).toEqual(['restart', 'undo'])
  })

  it('已翻开的格子不能插旗 → 抛 IllegalActionError', () => {
    const state = act(fresh(5, 'starter'), { type: 'reveal', index: 40 })
    const revealedIndex = state.revealed[0]!
    expect(() => act(state, { type: 'toggleFlag', index: revealedIndex })).toThrow(IllegalActionError)
  })

  it('标记模式：点格子 = 插旗 / 取消旗，开关状态在控件文案里写明', () => {
    let state = act(fresh(6, 'starter'), { type: 'reveal', index: 40 })
    const target = firstHidden(state)
    expect(target).toBeGreaterThanOrEqual(0)
    // 未开标记模式：点格子 = 翻开
    expect(selectAt(state, target)).toEqual({ type: 'reveal', index: target })
    expect(controlById(state, 'flag-mode')!.labelKey).toBe('minesweeper.control.flagMode.off')

    state = act(state, { type: 'toggleFlagMode' })
    expect(state.flagMode).toBe(true)
    expect(selectAt(state, target)).toEqual({ type: 'toggleFlag', index: target })
    const control = controlById(state, 'flag-mode')!
    expect(control.role).toBe('action')
    expect(control.enabled).toBe(true)
    expect(control.emphasis).toBe('primary')
    expect(control.labelKey).toBe('minesweeper.control.flagMode.on')

    state = act(state, { type: 'toggleFlag', index: target })
    expect(state.flags).toEqual([target])
    expect(game.view(state).board!.cells[target]!.kind).toBe('flag')
    expect(game.view(state).board!.cells[target]!.glyph).toBe('⚑')
    // 剩余雷数 = 总雷数 − 旗数
    expect(statValue(state, 'minesweeper.stat.mines')).toBe('9')

    state = act(state, { type: 'toggleFlag', index: target })
    expect(state.flags).toEqual([])
    expect(game.view(state).board!.cells[target]!.kind).toBe('hidden')

    // 已翻开的格子在标记模式下不可点
    const revealedIndex = state.revealed[0]!
    expect(selectAt(state, revealedIndex)).toBeNull()
    // 关掉标记模式
    state = act(state, { type: 'toggleFlagMode' })
    expect(state.flagMode).toBe(false)
  })

  it('已插旗的格子受旗子保护：点它不会翻开', () => {
    let state = act(fresh(8, 'starter'), { type: 'reveal', index: 40 })
    const target = firstHidden(state)
    state = act(state, { type: 'toggleFlag', index: target })
    expect(selectAt(state, target)).toBeNull()
    const after = act(state, { type: 'reveal', index: target })
    expect(after).toEqual(state)
    expect(after.revealed).not.toContain(target)
  })

  it('重复翻开已翻开的格子是幂等的（不报错、状态不变）', () => {
    const state = act(fresh(9, 'starter'), { type: 'reveal', index: 40 })
    const again = act(state, { type: 'reveal', index: state.revealed[0]! })
    expect(again).toEqual(state)
    expect(again.revealed).toEqual(state.revealed)
  })

  it('翻开所有非雷格 → won，之后只剩重开可用', () => {
    let state = act(fresh(11, 'starter'), { type: 'reveal', index: 40 })
    let guard = 0
    while (game.status(state) === 'playing' && guard < 500) {
      guard++
      const mineSet = new Set(state.mines)
      const revealed = new Set(state.revealed)
      let target = -1
      for (let index = 0; index < cellCount(STARTER); index++) {
        if (!mineSet.has(index) && !revealed.has(index)) {
          target = index
          break
        }
      }
      expect(target).toBeGreaterThanOrEqual(0)
      state = act(state, { type: 'reveal', index: target })
    }
    expect(game.status(state)).toBe('won')
    expect(state.revealed).toHaveLength(cellCount(STARTER) - STARTER.mineCount)
    const view = game.view(state)
    expect(view.result!.titleKey).toBe('minesweeper.won.title')
    expect(statValue(state, 'minesweeper.stat.progress')).toBe('71/81')
    expect(statValue(state, 'minesweeper.stat.mines')).toBe('10')
    // 赢局后同样只剩重开与撤销（撤销回到赢之前，供玩家回看最后一步）
    expect(game.legal(state).map((action) => action.type)).toEqual(['restart', 'undo'])
    expect(() => act(state, { type: 'reveal', index: 0 })).toThrow(IllegalActionError)
  })

  it('restart 回到初始状态，且输局后仍可重开；同种子重来雷图一致', () => {
    let state = act(fresh(9, 'skilled'), { type: 'reveal', index: 30 })
    const firstLayout = [...state.mines]
    state = act(state, { type: 'toggleFlagMode' })
    state = act(state, { type: 'restart' })
    expect(state).toEqual(fresh(9, 'skilled'))
    expect(state.mines).toEqual([])
    expect(state.flagMode).toBe(false)
    expect(game.status(state)).toBe('playing')

    state = act(state, { type: 'reveal', index: 30 })
    expect(state.mines).toEqual(firstLayout)

    const mine = state.mines.find((index) => !state.revealed.includes(index))!
    const lost = act(state, { type: 'reveal', index: mine })
    expect(game.status(lost)).toBe('lost')
    expect(game.status(act(lost, { type: 'restart' }))).toBe('playing')
  })
})

describe('撤销', () => {
  /** 手工构造：左下一颗雷 + 最下一行整行雷，首点 (0,0) 已用过，(4,4) 插旗 */
  const CHAIN_FIXTURE: unknown = {
    difficulty: 'starter',
    seed: 0,
    mines: [63, 72, 73, 74, 75, 76, 77, 78, 79, 80],
    revealed: [],
    flags: [40],
    firstIndex: 0,
    firstClickUsed: true,
    rngCursor: 10,
    flagMode: false,
  }

  /** 找一个还没翻开的非雷格（用于「撤销之后还能继续玩」） */
  function firstSafeHidden(state: MinesweeperState): number {
    const mineSet = new Set(state.mines)
    const revealed = new Set(state.revealed)
    for (let index = 0; index < cellCount(configFor(state.difficulty)); index++) {
      if (!mineSet.has(index) && !revealed.has(index)) return index
    }
    return -1
  }

  it('走一步 → 撤销回到上一步；没有历史时明确抛错', () => {
    const initial = fresh(21, 'starter')
    // 还没动作：撤销必须明确抛错（壳层据此把按钮置灰），而不是静默无事发生
    expect(controlById(initial, 'undo')!.enabled).toBe(false)
    expect(() => act(initial, { type: 'undo' })).toThrow(IllegalActionError)

    const revealed = act(initial, { type: 'reveal', index: 40 })
    expect(controlById(revealed, 'undo')!.enabled).toBe(true)
    const undone = act(revealed, { type: 'undo' })
    expect(encodeState(undone)).toEqual(encodeState(initial))
    // 这一步是首点：延迟布雷一并作废（mines 清空、首点标记归零、随机游标归零）
    expect(undone.mines).toEqual([])
    expect(undone.firstIndex).toBeNull()
    expect(undone.firstClickUsed).toBe(false)
    expect(undone.rngCursor).toBe(0)
    // 历史用光后再撤销仍然抛错
    expect(() => act(undone, { type: 'undo' })).toThrow(IllegalActionError)
  })

  it('撤销连锁翻开：一次动作翻开的整片区域一起收回', () => {
    const initial = decodeState(CHAIN_FIXTURE)
    const opened = act(initial, { type: 'reveal', index: 0 })
    expect(opened.revealed.length).toBeGreaterThan(10)
    const undone = act(opened, { type: 'undo' })
    expect(undone.revealed).toEqual([])
    expect(undone.flags).toEqual(initial.flags)
    expect(encodeState(undone)).toEqual(encodeState(initial))
  })

  it('插旗 / 取消旗都能撤销，撤销后可以继续正常玩', () => {
    const initial = act(fresh(31, 'starter'), { type: 'reveal', index: 40 })
    const target = firstHidden(initial)
    const flagged = act(initial, { type: 'toggleFlag', index: target })
    expect(flagged.flags).toContain(target)

    const undone = act(flagged, { type: 'undo' })
    expect(encodeState(undone)).toEqual(encodeState(initial))
    // 撤销后重做同一个插旗动作：结果与第一次完全相同
    expect(encodeState(act(undone, { type: 'toggleFlag', index: target }))).toEqual(
      encodeState(flagged),
    )
    // 取消旗也能撤销（插旗与取消旗互为逆操作）
    const unflagged = act(flagged, { type: 'toggleFlag', index: target })
    expect(encodeState(act(unflagged, { type: 'undo' }))).toEqual(encodeState(flagged))

    // 继续正常玩：再翻开一个非雷格，状态合法且能存档往返
    const safe = firstSafeHidden(undone)
    expect(safe).toBeGreaterThanOrEqual(0)
    const continued = act(undone, { type: 'reveal', index: safe })
    expect(game.status(continued)).toBe('playing')
    expect(continued.revealed.length).toBeGreaterThan(undone.revealed.length)
    expect(game.decode(game.encode(continued))).toEqual(continued)
  })

  it('踩雷输掉后撤销 → 回到踩雷之前的局面，并且还能继续玩', () => {
    const started = act(fresh(3, 'starter'), { type: 'reveal', index: 40 })
    const mine = started.mines.find((index) => !started.revealed.includes(index))!
    const lost = act(started, { type: 'reveal', index: mine })
    expect(game.status(lost)).toBe('lost')
    expect(game.view(lost).result!.titleKey).toBe('minesweeper.lost.title')
    // 输局后撤销仍然可用 —— 这正是玩家最需要撤销的时刻
    expect(controlById(lost, 'undo')!.enabled).toBe(true)

    const back = act(lost, { type: 'undo' })
    expect(game.status(back)).toBe('playing')
    expect(game.view(back).result).toBeNull()
    expect(back.revealed).not.toContain(mine)
    // 盘面逐字段回到踩雷之前；视图也不再亮出全部雷
    expect(encodeState(back)).toEqual(encodeState(started))
    expect(game.view(back).board!.cells[mine]!.kind).toBe('hidden')
    for (const index of back.mines) expect(game.view(back).board!.cells[index]!.kind).not.toBe('mine')

    // 撤销之后可以继续玩：换一个非雷格翻开，不进入任何坏状态
    const safe = firstSafeHidden(back)
    expect(safe).toBeGreaterThanOrEqual(0)
    const continued = act(back, { type: 'reveal', index: safe })
    expect(game.status(continued)).toBe('playing')
    expect(game.decode(game.encode(continued))).toEqual(continued)
  })

  it('撤销后重做同一步得到完全相同的局面（确定性：同种子同结果）', () => {
    for (const seed of [1, 7, 20260101]) {
      const initial = fresh(seed, 'skilled')
      const first = act(initial, { type: 'reveal', index: 30 })
      // 撤销首点后再点同一格：按同一 seed 布出的雷图必须一模一样
      const redone = act(act(first, { type: 'undo' }), { type: 'reveal', index: 30 })
      expect(encodeState(redone)).toEqual(encodeState(first))

      // 第二步（含可能踩雷的那一步）同样：撤销后重做结果一致
      const second = act(first, { type: 'reveal', index: firstHidden(first) })
      const secondAgain = act(act(second, { type: 'undo' }), {
        type: 'reveal',
        index: firstHidden(first),
      })
      expect(encodeState(secondAgain)).toEqual(encodeState(second))
    }
  })

  it('标记模式开关不属于棋步：撤销不回退它（有意行为）', () => {
    const revealed = act(fresh(41, 'starter'), { type: 'reveal', index: 40 })
    const modeOn = act(revealed, { type: 'toggleFlagMode' })
    // 开关本身不产生可撤销历史
    expect(modeOn.history).toHaveLength(revealed.history.length)
    const flagged = act(modeOn, { type: 'toggleFlag', index: firstHidden(modeOn) })
    const undone = act(flagged, { type: 'undo' })
    // 撤销的是插旗那一步；标记模式是界面模式，保持开启
    expect(undone.flagMode).toBe(true)
    expect(encodeState(undone)).toEqual(encodeState(modeOn))
  })

  it('撤销栈随存档往返；旧存档（没有 history 字段）仍然能读', () => {
    let state = act(fresh(5, 'starter'), { type: 'reveal', index: 40 })
    state = act(state, { type: 'toggleFlag', index: firstHidden(state) })
    expect(state.history).toHaveLength(2)

    const decoded = game.decode(JSON.parse(JSON.stringify(game.encode(state))))
    expect(decoded).toEqual(state)
    expect(decoded.history).toHaveLength(2)
    // 撤销栈一起还原：decode 之后撤销得到同一局面
    expect(encodeState(act(decoded, { type: 'undo' }))).toEqual(encodeState(act(state, { type: 'undo' })))

    // 旧存档：删掉 history 字段（模拟加撤销之前存下的进度）仍能读，历史视为空
    const legacy = game.encode(state) as Record<string, unknown>
    delete legacy.history
    const old = game.decode(legacy)
    expect(old.history).toEqual([])
    expect(encodeState(old)).toEqual(encodeState({ ...state, history: [] }))

    // 坏 history 一律拒绝，而不是带着半个撤销栈继续
    expect(() => game.decode({ ...legacy, history: 'nope' })).toThrow(IllegalActionError)
    expect(() => game.decode({ ...legacy, history: [{ kind: 'nope' }] })).toThrow(IllegalActionError)
    expect(() =>
      game.decode({ ...legacy, history: [{ kind: 'reveal', added: [999], wasFirstClick: false }] }),
    ).toThrow(IllegalActionError)
    expect(() =>
      game.decode({ ...legacy, history: [{ kind: 'flag', index: -1 }] }),
    ).toThrow(IllegalActionError)
  })
})

describe('难度与板面', () => {
  it('三档难度符合规格（9×9/10、12×12/25、16×16/50）', () => {
    expect(DIFFICULTIES.starter).toEqual({ cols: 9, rows: 9, mineCount: 10 })
    expect(DIFFICULTIES.skilled).toEqual({ cols: 12, rows: 12, mineCount: 25 })
    expect(DIFFICULTIES.challenging).toEqual({ cols: 16, rows: 16, mineCount: 50 })
    expect(game.difficulties.map((difficulty) => difficulty.id)).toEqual([
      'starter',
      'skilled',
      'challenging',
    ])
    for (const difficulty of DIFFICULTY_IDS) {
      expect(game.difficulties.find((item) => item.id === difficulty)!.labelKey).toBe(
        `minesweeper.difficulty.${difficulty}`,
      )
      const board = game.view(fresh(1, difficulty)).board!
      const config = DIFFICULTIES[difficulty]
      expect(board.kind).toBe('grid')
      expect(board.cols).toBe(config.cols)
      expect(board.rows).toBe(config.rows)
      expect(board.cells).toHaveLength(cellCount(config))
      expect(board.cells.map((cell) => cell.index)).toEqual(
        Array.from({ length: cellCount(config) }, (_, index) => index),
      )
    }
    expect(() => game.create(1, 'nope')).toThrow(IllegalActionError)
  })

  it('开局板面全是 hidden，统计显示剩余雷数与已翻开进度', () => {
    const state = fresh(1, 'skilled')
    const board = game.view(state).board!
    expect(board.cells.every((cell) => cell.kind === 'hidden')).toBe(true)
    // 未翻格不带字形：底纹由壳层铺在棋盘上，玩法只声明 kind
    expect(board.cells.every((cell) => cell.glyph === '')).toBe(true)
    expect(statValue(state, 'minesweeper.stat.mines')).toBe('25')
    expect(statValue(state, 'minesweeper.stat.progress')).toBe('0/144')
    expect(game.view(state).result).toBeNull()
  })
})

describe('encode / decode', () => {
  it('往返完全一致（含 JSON 序列化）', () => {
    for (const seed of [1, 22, 333]) {
      const state = playRandom(seed, 40)
      const raw = game.encode(state)
      expect(encodeState(state)).toEqual(raw)
      expect(decodeState(JSON.parse(JSON.stringify(raw)))).toEqual(state)
      expect(game.decode(raw)).toEqual(state)
    }
  })

  it('decode 不会重新布雷，后续行为与直接 reduce 完全一致', () => {
    const state = act(fresh(4, 'starter'), { type: 'reveal', index: 40 })
    const decoded = game.decode(JSON.parse(JSON.stringify(game.encode(state))))
    expect(decoded.mines).toEqual(state.mines)
    const target = firstHidden(decoded)
    const after = act(decoded, { type: 'reveal', index: target })
    expect(after.mines).toEqual(state.mines)
    expect(after).toEqual(act(state, { type: 'reveal', index: target }))
  })

  it('坏数据一律抛 IllegalActionError', () => {
    const base = {
      difficulty: 'starter',
      seed: 1,
      mines: [],
      revealed: [],
      flags: [],
      firstIndex: null,
      firstClickUsed: false,
      rngCursor: 0,
      flagMode: false,
    }
    const placed = {
      ...base,
      mines: [63, 72, 73, 74, 75, 76, 77, 78, 79, 80],
      firstIndex: 0,
      firstClickUsed: true,
      rngCursor: 10,
    }
    const bad: unknown[] = [
      null,
      undefined,
      42,
      'state',
      [],
      { ...base, difficulty: 'nope' },
      { ...base, seed: -1 },
      { ...base, seed: 1.5 },
      { ...base, seed: 2 ** 33 },
      { ...base, flagMode: 'no' },
      { ...base, firstClickUsed: 'no' },
      { ...base, rngCursor: -1 },
      { ...base, rngCursor: 1.5 },
      { ...base, firstIndex: 0 },
      { ...base, firstIndex: 1, firstClickUsed: true },
      { ...base, flags: [3, 3] },
      { ...base, flags: [999] },
      { ...base, flags: ['3'] },
      { ...base, revealed: [5] },
      { ...base, mines: [1, 2, 3] },
      { ...placed, mines: [0, 63, 72, 73, 74, 75, 76, 77, 78, 79] },
      { ...placed, mines: [1, 63, 72, 73, 74, 75, 76, 77, 78, 79] },
      { ...placed, mines: [63, 72] },
      { ...placed, mines: [63, 63, 72, 73, 74, 75, 76, 77, 78, 79] },
      { ...placed, revealed: [40], flags: [40] },
      { ...placed, revealed: [63, 72] },
      { ...base, mines: placed.mines },
    ]
    for (const value of bad) {
      expect(() => game.decode(value)).toThrow(IllegalActionError)
    }
    // 同一份数据在合法时应当被接受（说明上面的失败都来自具体校验，而不是整体不可用）
    expect(() => game.decode(placed)).not.toThrow()
  })
})

describe('契约细节', () => {
  it('legal 里的动作都能被 reduce 接受，selectAction 与 legal 一致', () => {
    const state = act(fresh(13, 'starter'), { type: 'reveal', index: 40 })
    for (const action of game.legal(state)) {
      expect(() => act(state, action)).not.toThrow()
    }
    const legal = game.legal(state)
    for (let index = 0; index < cellCount(STARTER); index++) {
      const action = selectAt(state, index)
      if (action === null) continue
      expect(legal).toContainEqual(action)
    }
  })

  it('未知动作（方向键派发的 move）与越界索引都抛错', () => {
    const state = fresh(1, 'starter')
    expect(() => act(state, { type: 'move' } as unknown as MinesweeperAction)).toThrow(
      IllegalActionError,
    )
    expect(() => act(state, { type: 'reveal', index: -1 })).toThrow(IllegalActionError)
    expect(() => act(state, { type: 'reveal', index: 81 })).toThrow(IllegalActionError)
    expect(() => act(state, { type: 'reveal', index: 1.5 })).toThrow(IllegalActionError)
    expect(() => act(state, { type: 'toggleFlag', index: 81 })).toThrow(IllegalActionError)
    expect(game.illegalNoticeKey).toBe('minesweeper.illegal')
    expect(game.i18nNamespace).toBe('minesweeper')
    expect(game.rulesVersion).toBeGreaterThanOrEqual(1)
    expect(game.contentVersion).toBeGreaterThanOrEqual(1)
  })

  it('全程不使用 Math.random（把它换成会抛错的桩）', () => {
    const spy = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Math.random must not be used')
    })
    try {
      let state = game.create(20260101, 'skilled')
      state = act(state, { type: 'reveal', index: 30 })
      state = act(state, { type: 'toggleFlagMode' })
      state = act(state, { type: 'toggleFlag', index: firstHidden(state) })
      state = act(state, { type: 'reveal', index: firstHidden(state) })
      expect(state.mines).toHaveLength(25)
      expect(game.decode(game.encode(state))).toEqual(state)
    } finally {
      spy.mockRestore()
    }
  })

  it('插旗数量可以超过雷数（剩余雷数随之变负，符合经典行为）', () => {
    let state = act(fresh(1, 'starter'), { type: 'reveal', index: 40 })
    let flagged = 0
    for (let index = 0; index < cellCount(STARTER) && flagged < 12; index++) {
      if (state.revealed.includes(index)) continue
      state = act(state, { type: 'toggleFlag', index })
      flagged++
    }
    expect(state.flags).toHaveLength(12)
    expect(statValue(state, 'minesweeper.stat.mines')).toBe('-2')
  })

  it('neighborsOf 与视图一致：任何格子的数字 = 周围 8 格里的雷数', () => {
    const state = act(fresh(2, 'challenging'), { type: 'reveal', index: 100 })
    const mineSet = new Set(state.mines)
    const board = game.view(state).board!
    for (const index of state.revealed) {
      if (mineSet.has(index)) continue
      const expected = neighborsOf(configFor('challenging'), index).filter((n) => mineSet.has(n)).length
      expect(board.cells[index]!.glyph).toBe(expected > 0 ? String(expected) : '')
      expect(board.cells[index]!.kind).toBe(expected > 0 ? 'number' : 'empty')
    }
  })
})
