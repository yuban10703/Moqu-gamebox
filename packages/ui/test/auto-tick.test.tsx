// @vitest-environment jsdom
/**
 * 壳层自动步进（tick）的行为测试 —— 用 vitest 的假定时器把"时间"完全握在手里。
 *
 * 覆盖本轮验收点名的每一条：
 * 1. 到点派发 `{ type: 'tick' }`：贪吃蛇每隔 tickMs 自动前进一格（三档统一，值取自游戏包声明）；
 * 2. **玩家输入当帧生效**：点方向键立即走一格（不依赖定时器），棋盘的这次变化与时间无关；
 * 3. **输入延迟补偿**：玩家每次有效输入后重置计时，保证拿到完整的一个间隔
 *    （否则刚按完就自动再走一格，在墨水屏上像"吞输入"）；
 * 4. 暂停 / 结束 / 页面隐藏 / 离开对局一律停表，且**不泄漏定时器**；
 * 5. 定时器到点派发的 tick 被规则拒绝时**不崩、不弹提示**，直接安全停表；
 * 6. 间隔钳位（≥ MIN_TICK_MS 400ms）与极矮横屏的减速系数；
 * 7. 没有声明 tickMs 的玩法一个定时器都不起（其余 10 款行为不变）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import {
  IllegalActionError,
  MIN_TICK_MS,
  createMemoryKv,
  type GameDef,
  type GameView,
} from '@eink/core'
import { createPlatform, type AppStorage } from '@eink/platform'
import { difficultySpec, directionOf, snakeGame } from '@eink/snake'
import { CRAMPED_TICK_SLOWDOWN, useSession } from '../src/session.js'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

/**
 * 贪吃蛇声明的自动步进间隔（毫秒）——**从游戏包里读，不在测试里写死**。
 *
 * 由来：这个文件原先到处写 500，贪吃蛇把间隔调到 700 之后 11 条断言集体变红
 * （那次改动只动了 packages/games/snake）。把一个会变的产品参数抄进断言，
 * 漂移是必然的 —— 现在"壳层拿到的 = 游戏声明的"由这条常量与下面那条
 * `difficultySpec('starter').tickMs` 的断言一起守住。
 */
const SNAKE_TICK_MS = difficultySpec('starter').tickMs

/** 只做展示与输入转发的测试外壳：把会话里我们关心的几个事实直接摆进 DOM */
function SnakeHarness({
  storage,
  difficulty = 'starter',
  tickSlowdown,
}: {
  storage: AppStorage
  difficulty?: string
  tickSlowdown?: number
}): React.ReactElement {
  const session = useSession({
    game: snakeGame,
    storage,
    difficulty,
    ...(tickSlowdown ? { tickSlowdown } : {}),
  })
  return (
    <div>
      <span data-testid="ready">{session.ready ? 'yes' : 'no'}</span>
      <span data-testid="auto">{session.autoTickMs === null ? 'off' : String(session.autoTickMs)}</span>
      <span data-testid="moves">{session.state.moves}</span>
      <span data-testid="head">{session.state.body[0]}</span>
      {/* 朝向由蛇身推出（状态里没有"待生效的方向"字段了） */}
      <span data-testid="dir">
        {session.state.body.length >= 2 ? directionOf(session.state) : '-'}
      </span>
      <span data-testid="finished">{session.finished ? 'yes' : 'no'}</span>
      <button onClick={() => session.runControl?.('move-up')}>turn-up</button>
      <button onClick={() => session.runControl?.('move-left')}>turn-left</button>
      <button onClick={() => session.runControl?.('move-right')}>turn-right</button>
      <button onClick={() => session.undo()}>undo</button>
      <button onClick={session.pause}>pause</button>
      <button onClick={session.resume}>resume</button>
    </div>
  )
}

const text = (id: string): string => screen.getByTestId(id).textContent ?? ''

/** 推进假定时器并冲掉微任务（会话的落盘是异步的） */
async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

/** 反复冲微任务直到会话进入 ready（不用 waitFor：它在假定时器下不可靠） */
async function settle(): Promise<void> {
  for (let round = 0; round < 10 && text('ready') !== 'yes'; round++) {
    await act(async () => {
      await Promise.resolve()
    })
  }
  expect(text('ready')).toBe('yes')
}

async function mount(storage?: AppStorage): Promise<AppStorage> {
  const target = storage ?? (await createPlatform({ kv: createMemoryKv(), now: () => 1_700_000_000_000 })).storage
  render(<SnakeHarness storage={target} />)
  await settle()
  return target
}

describe('自动步进：到点派发 tick', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('贪吃蛇每隔 tickMs 自动前进一格（三档统一）', async () => {
    await mount()
    expect(text('auto')).toBe(String(SNAKE_TICK_MS))
    expect(Number(text('auto'))).toBeGreaterThanOrEqual(MIN_TICK_MS)
    expect(text('moves')).toBe('0')
    const heads: string[] = [text('head')]

    for (let step = 1; step <= 3; step++) {
      await advance(SNAKE_TICK_MS)
      expect(text('moves')).toBe(String(step))
      heads.push(text('head'))
    }
    // 蛇确实在动，而不是只有一个计数器在变
    expect(new Set(heads).size).toBe(heads.length)
    // 没有按键：计时器一直挂着，且每个间隔都恰好一格
    expect(vi.getTimerCount()).toBe(1)
  })

  it('间隔**不随难度变化**：入门 / 熟练 / 挑战在壳层里拿到的都是同一个值', async () => {
    vi.useRealTimers()
    vi.useFakeTimers()
    const observed: string[] = []
    for (const difficulty of ['starter', 'skilled', 'challenging'] as const) {
      cleanup()
      const platform = await createPlatform({ kv: createMemoryKv(), now: () => 1 })
      render(<SnakeHarness storage={platform.storage} difficulty={difficulty} />)
      await settle()
      observed.push(text('auto'))
      // 到点确实走一格（不是把间隔写得比声明更大就完事）
      await advance(Number(text('auto')))
      expect(text('moves')).toBe('1')
    }
    // 1) 三个难度一模一样（差 1ms 都算"没统一"）
    expect(new Set(observed).size).toBe(1)
    // 2) 就是游戏声明的那个值（三档同一个），且不低于 core 的 400ms 硬下限
    expect(observed).toEqual([String(SNAKE_TICK_MS), String(SNAKE_TICK_MS), String(SNAKE_TICK_MS)])
    expect(Number(observed[0])).toBeGreaterThanOrEqual(MIN_TICK_MS)
    // 3) 与玩法**自己声明的**值一致：壳层没有偷偷改数字
    expect(Number(observed[0])).toBe(difficultySpec('starter').tickMs)
  })
})

describe('玩家输入当帧生效：点方向键立即走一格', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('点下去当帧就换向并前进一格，完全不需要推进定时器', async () => {
    await mount()
    const before = text('head')
    expect(text('dir')).toBe('right')

    fireEvent.click(screen.getByText('turn-up'))

    // 关键断言：这一步与时间无关 —— 没推进任何定时器，局面已经变了
    expect(text('moves')).toBe('1')
    expect(text('dir')).toBe('up')
    expect(text('head')).not.toBe(before)
  })

  it('连续快速点两个方向（上 → 左）不丢输入：两格都走掉了', async () => {
    await mount()
    fireEvent.click(screen.getByText('turn-up'))
    fireEvent.click(screen.getByText('turn-left'))
    expect(text('moves')).toBe('2')
    expect(text('dir')).toBe('left')

    // 计时从**最后一次输入**算起：差 1ms 都不会自己动，满一格才动
    await advance(SNAKE_TICK_MS - 1)
    expect(text('moves')).toBe('2')
    await advance(1)
    expect(text('moves')).toBe('3')
    expect(text('dir')).toBe('left')
  })

  it('按当前朝向 = 手动往前一格（不是把蛇按住不动的办法）', async () => {
    await mount()
    fireEvent.click(screen.getByText('turn-right'))
    expect(text('moves')).toBe('1')
    expect(text('dir')).toBe('right')
  })
})

describe('输入延迟补偿：有效输入后重置计时', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('输入本身当帧走一格，但输入之后不会紧接着又被自动 tick 推一格', async () => {
    await mount()
    // 还差 50ms 就要自动走一格
    await advance(SNAKE_TICK_MS - 50)
    expect(text('moves')).toBe('0')

    // 此刻玩家按下「上」：当帧走一格，并且计时必须从这一刻重新开始
    fireEvent.click(screen.getByText('turn-up'))
    expect(text('moves')).toBe('1')
    expect(text('dir')).toBe('up')

    // 再走 100ms：若没有重置，早就该自动走掉一格了
    await advance(100)
    expect(text('moves')).toBe('1')

    // 从输入算起满一格才自动再走一格：沿刚按下的方向（朝上）
    await advance(SNAKE_TICK_MS - 100)
    expect(text('moves')).toBe('2')
    expect(text('dir')).toBe('up')
  })

  it('被拒绝的输入不算有效输入，不会重置计时（规则层已明确提示走不通）', async () => {
    await mount()
    await advance(SNAKE_TICK_MS - 50)
    // 蛇头朝右，按「左」是原地掉头：规则层拒绝它（壳层给"走不通"提示）
    fireEvent.click(screen.getByText('turn-left'))
    expect(text('moves')).toBe('0') // 被拒绝：一格都没走
    expect(text('dir')).toBe('right')
    // 若被拒绝的输入也重置计时，这一刻就还不会走
    await advance(50)
    expect(text('moves')).toBe('1')
  })

  it('撤销也是一次有效输入：撤销后同样重新计时', async () => {
    await mount()
    fireEvent.click(screen.getByText('turn-up')) // t=0：当帧走一格
    await advance(SNAKE_TICK_MS) // 自动再走一格
    expect(text('moves')).toBe('2')
    await advance(SNAKE_TICK_MS - 100) // 下一次自动步进原本在 2 格处
    fireEvent.click(screen.getByText('undo'))
    expect(text('moves')).toBe('0') // 撤销回「按上之前」（连自动走的那格一起退回）
    await advance(100) // 原定的那一拍：若没重置，自动步进就会在这里发生
    expect(text('moves')).toBe('0')
    await advance(SNAKE_TICK_MS) // 撤销时刻 + 一格
    expect(text('moves')).toBe('1')
  })
})

describe('停表：暂停 / 结束 / 隐藏 / 离开对局', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('暂停面板打开时棋盘完全不动，恢复后继续', async () => {
    await mount()
    await advance(SNAKE_TICK_MS)
    expect(text('moves')).toBe('1')

    fireEvent.click(screen.getByText('pause'))
    expect(text('auto')).toBe('off')
    expect(vi.getTimerCount()).toBe(0)
    await advance(3000) // 采样 3 秒
    expect(text('moves')).toBe('1') // 一格都没走

    fireEvent.click(screen.getByText('resume'))
    expect(text('auto')).toBe(String(SNAKE_TICK_MS))
    await advance(SNAKE_TICK_MS)
    expect(text('moves')).toBe('2')
  })

  it('对局结束后停表，且不再有任何定时器', async () => {
    vi.useRealTimers()
    vi.useFakeTimers()
    const platform = await createPlatform({ kv: createMemoryKv(), now: () => 1 })
    render(<SnakeHarness storage={platform.storage} difficulty="skilled" />)
    await settle()
    fireEvent.click(screen.getByText('turn-up')) // 朝上：按下的那一格立刻走掉，之后自动爬
    for (let step = 0; step < 8 && text('finished') !== 'yes'; step++) await advance(SNAKE_TICK_MS)
    expect(text('finished')).toBe('yes')
    expect(text('auto')).toBe('off')
    expect(vi.getTimerCount()).toBe(0)
    const moves = text('moves')
    await advance(5000)
    expect(text('moves')).toBe(moves)
  })

  it('页面隐藏时停表，回到前台后恢复', async () => {
    await mount()
    const setVisibility = (value: 'visible' | 'hidden'): void => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value })
    }
    setVisibility('hidden')
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(text('auto')).toBe('off')
    expect(vi.getTimerCount()).toBe(0)
    await advance(3000)
    expect(text('moves')).toBe('0')

    setVisibility('visible')
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(text('auto')).toBe(String(SNAKE_TICK_MS))
    await advance(SNAKE_TICK_MS)
    expect(text('moves')).toBe('1')
  })

  it('离开对局（卸载）后定时器归零，不泄漏', async () => {
    const storage = await mount()
    expect(vi.getTimerCount()).toBe(1)
    cleanup()
    expect(vi.getTimerCount()).toBe(0)
    // 卸载后再推进时间也不会报错（没有回调落在已卸载的组件上）
    await advance(5000)
    void storage
  })
})

describe('tick 被规则拒绝时的降级', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  /** 一个「到点必被拒绝」的玩法：reduce 对 tick 抛 IllegalActionError（例如局面已终局） */
  function rejectingGame(tickMs: number): GameDef<{ moves: number }, { type: string }> {
    return {
      id: 'rejecting',
      rulesVersion: 1,
      contentVersion: 1,
      i18nNamespace: 'rejecting',
      difficulties: [{ id: 'starter', labelKey: 'rejecting.difficulty.starter' }],
      create: () => ({ moves: 0 }),
      reduce: (state, action) => {
        if (action.type === 'tick') throw new IllegalActionError('rejecting', 'game over')
        return state
      },
      legal: () => [],
      status: () => 'playing',
      view: (): GameView => ({ board: null, stats: [], result: null, notice: null }),
      controls: () => [],
      encode: (state) => state,
      decode: (raw) => raw as { moves: number },
      tickMs: () => tickMs,
    }
  }

  function RejectingHarness({ storage }: { storage: AppStorage }): React.ReactElement {
    const session = useSession({ game: rejectingGame(500), storage, difficulty: 'starter' })
    return (
      <div>
        <span data-testid="ready">{session.ready ? 'yes' : 'no'}</span>
        <span data-testid="auto">{session.autoTickMs === null ? 'off' : String(session.autoTickMs)}</span>
      </div>
    )
  }

  it('到点被拒绝：不崩、不弹提示，直接安全停表', async () => {
    const platform = await createPlatform({ kv: createMemoryKv(), now: () => 1 })
    render(<RejectingHarness storage={platform.storage} />)
    await settle()
    expect(text('auto')).toBe('500')
    expect(vi.getTimerCount()).toBe(1)
    // 到点后 reducer 抛错：会话必须自己停下来
    await advance(500)
    expect(text('auto')).toBe('off')
    expect(vi.getTimerCount()).toBe(0)
    // 再推进时间也不会反复触发
    await advance(5000)
    expect(text('auto')).toBe('off')
  })
})

describe('间隔钳位与极矮横屏减速', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('低于 400ms 的声明会被钳到 MIN_TICK_MS', async () => {
    const platform = await createPlatform({ kv: createMemoryKv(), now: () => 1 })
    const fast: GameDef<{ moves: number }, { type: string }> = {
      id: 'fast',
      rulesVersion: 1,
      contentVersion: 1,
      i18nNamespace: 'fast',
      difficulties: [{ id: 'starter', labelKey: 'fast.difficulty.starter' }],
      create: () => ({ moves: 0 }),
      reduce: (state) => state,
      legal: () => [],
      status: () => 'playing',
      view: () => ({ board: null, stats: [], result: null, notice: null }),
      controls: () => [],
      encode: (state) => state,
      decode: (raw) => raw as { moves: number },
      tickMs: () => 60, // 远快于墨水屏刷新
    }
    function Harness(): React.ReactElement {
      const session = useSession({ game: fast, storage: platform.storage, difficulty: 'starter' })
      return (
        <div>
          <span data-testid="ready">{session.ready ? 'yes' : 'no'}</span>
          <span data-testid="auto">{session.autoTickMs === null ? 'off' : String(session.autoTickMs)}</span>
        </div>
      )
    }
    render(<Harness />)
    await settle()
    expect(text('auto')).toBe(String(MIN_TICK_MS))
  })

  it('极矮横屏传入减速系数后，间隔按倍数放大（仍不低于下限）', async () => {
    await mount(undefined)
    cleanup()
    const platform = await createPlatform({ kv: createMemoryKv(), now: () => 1 })
    render(<SnakeHarness storage={platform.storage} tickSlowdown={CRAMPED_TICK_SLOWDOWN} />)
    await settle()
    // 放大的是**声明值本身**：声明 × 系数，不另写一个数（写死 750 的话，
    // 声明值一改这里就红 —— 这次 500→700 就是这么红的）。
    expect(text('auto')).toBe(String(Math.round(SNAKE_TICK_MS * CRAMPED_TICK_SLOWDOWN)))
    // 与玩法声明的统一值联动：放大的是**声明值**本身，不是另写一个数
    expect(Number(text('auto'))).toBe(
      Math.round(difficultySpec('starter').tickMs * CRAMPED_TICK_SLOWDOWN),
    )
    // 放大之后仍不低于硬下限（这里远高于它：防的是"减速系数被改成 <1"）
    expect(Number(text('auto'))).toBeGreaterThanOrEqual(MIN_TICK_MS)
    await advance(Math.round(SNAKE_TICK_MS * CRAMPED_TICK_SLOWDOWN))
    expect(text('moves')).toBe('1')
  })

  it('没有声明 tickMs 的玩法一个定时器都不起（其余 10 款行为不变）', async () => {
    const platform = await createPlatform({ kv: createMemoryKv(), now: () => 1 })
    const plain: GameDef<{ moves: number }, { type: string }> = {
      id: 'plain',
      rulesVersion: 1,
      contentVersion: 1,
      i18nNamespace: 'plain',
      difficulties: [{ id: 'starter', labelKey: 'plain.difficulty.starter' }],
      create: () => ({ moves: 0 }),
      reduce: (state) => state,
      legal: () => [],
      status: () => 'playing',
      view: () => ({ board: null, stats: [], result: null, notice: null }),
      controls: () => [],
      encode: (state) => state,
      decode: (raw) => raw as { moves: number },
    }
    function Harness(): React.ReactElement {
      const session = useSession({ game: plain, storage: platform.storage, difficulty: 'starter' })
      return (
        <div>
          <span data-testid="ready">{session.ready ? 'yes' : 'no'}</span>
          <span data-testid="auto">{session.autoTickMs === null ? 'off' : String(session.autoTickMs)}</span>
        </div>
      )
    }
    render(<Harness />)
    await settle()
    expect(text('auto')).toBe('off')
    expect(vi.getTimerCount()).toBe(0)
    await advance(10_000)
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('会话层面的事实（供真机探针使用）', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('autoTickMs 是"计时器真的挂着"的可断言事实，而不是猜的', async () => {
    await mount()
    expect(text('auto')).toBe(String(SNAKE_TICK_MS))
    fireEvent.click(screen.getByText('pause'))
    expect(text('auto')).toBe('off')
    fireEvent.click(screen.getByText('resume'))
    expect(text('auto')).toBe(String(SNAKE_TICK_MS))
  })
})
