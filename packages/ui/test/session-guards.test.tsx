// @vitest-environment jsdom
/**
 * 会话层的三条行为守卫（都来自 2026-10-05 的浏览器试玩审计）：
 *
 * 1. **对手应手计时不被"选子/选牌"重置**：`tickActor: 'opponent'` 的玩法，等待应手期间
 *    玩家点自己的棋子、手牌不该把电脑的思考一直往后推（实测连点 3.6 秒，电脑一步不走）；
 *    自动前进/自动下落类（缺省 `'self'`）保持原语义 —— 每次有效输入都给玩家完整的一拍。
 * 2. **终局后不接受棋盘输入**：成绩已经落盘，再改局面会出现「记录说已过关、棋盘却推乱了」
 *    （实测：推箱子过关后把箱子推出目标点，结果面板消失、步数 9 → 14）。
 *    结果面板真正提供的入口（重开 / 下一关 / 输局撤销）仍然放行。
 * 3. **平局如实入账**：`outcomeOf: 'draw'` 的玩法只写一条「未获胜」的历史记录，
 *    **不写** completed / bestMoves（实测：五子棋满盘平局被记成通关 + 最佳成绩）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { IllegalActionError, createMemoryKv, type GameDef, type GameView } from '@eink/core'
import { createPlatform } from '@eink/platform'
import { useSession } from '../src/session.js'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

/** 推进假定时器并冲掉微任务（会话落盘是异步的） */
async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

async function settle(): Promise<void> {
  for (let round = 0; round < 10 && (screen.getByTestId('ready').textContent ?? '') !== 'yes'; round++) {
    await act(async () => {
      await Promise.resolve()
    })
  }
  expect(screen.getByTestId('ready').textContent).toBe('yes')
}

/* ------------------------------------------------------------------ */
/* 1) tickActor：应手计时只被「真正轮到对手」那一次重置                  */
/* ------------------------------------------------------------------ */

interface TickState {
  moves: number
  selected: number | null
  waiting: boolean
  ticks: number
  done: boolean
}
type TickAction = { type: 'select'; index: number } | { type: 'play' } | { type: 'tick' } | { type: 'restart' }

/** 一个最小的「玩家落子 → 对手应手」玩法：tickMs 只在等待应手时返回值 */
function turnGame(actor?: 'opponent'): GameDef<TickState, TickAction> {
  return {
    id: 'turn',
    rulesVersion: 1,
    contentVersion: 1,
    i18nNamespace: 'turn',
    difficulties: [{ id: 'starter', labelKey: 'turn.difficulty.starter' }],
    ...(actor ? { tickActor: actor } : {}),
    create: () => ({ moves: 0, selected: null, waiting: false, ticks: 0, done: false }),
    reduce: (state, action) => {
      if (action.type === 'select') return { ...state, selected: action.index }
      if (action.type === 'play') return { ...state, moves: state.moves + 1, waiting: true }
      if (action.type === 'restart') return { moves: 0, selected: null, waiting: false, ticks: 0, done: false }
      if (action.type === 'tick') {
        if (!state.waiting) throw new IllegalActionError('turn', 'not waiting')
        return { ...state, waiting: false, ticks: state.ticks + 1, done: state.ticks + 1 >= 2 }
      }
      throw new IllegalActionError('turn', `unknown ${(action as { type: string }).type}`)
    },
    legal: () => [],
    /** 点棋子 = 选中（纯界面状态，不计步）：会话的 selectCell 只在声明了它时才接线 */
    selectAction: (_state, index) => ({ type: 'select', index }),
    status: (state) => (state.done ? 'won' : 'playing'),
    view: (): GameView => ({ board: null, stats: [], result: null, notice: null }),
    controls: () => [],
    encode: (state) => state,
    decode: (raw) => raw as TickState,
    tickMs: (state) => (state.waiting ? 500 : null),
  }
}

function TurnHarness({ game, storage }: { game: GameDef<TickState, TickAction>; storage: Awaited<ReturnType<typeof createPlatform>>['storage'] }): React.ReactElement {
  const session = useSession({ game, storage, difficulty: 'starter' })
  return (
    <div>
      <span data-testid="ready">{session.ready ? 'yes' : 'no'}</span>
      <span data-testid="auto">{session.autoTickMs === null ? 'off' : String(session.autoTickMs)}</span>
      <span data-testid="ticks">{session.state.ticks}</span>
      <span data-testid="moves">{session.state.moves}</span>
      <button onClick={() => session.dispatch({ type: 'play' } as TickAction)}>play</button>
      <button onClick={() => session.selectCell?.(3)}>select</button>
    </div>
  )
}

describe('对手应手的计时（tickActor）', () => {
  it("tickActor: 'opponent'：等待应手期间点自己的棋子不重置计时", async () => {
    vi.useFakeTimers()
    const platform = await createPlatform({ kv: createMemoryKv(), now: () => 1 })
    render(<TurnHarness game={turnGame('opponent')} storage={platform.storage} />)
    await settle()

    fireEvent.click(screen.getByText('play'))
    expect(screen.getByTestId('auto').textContent).toBe('500')

    // 走到 400ms，然后连点「选子」——它只是界面状态，不该把应手往后推
    await advance(400)
    fireEvent.click(screen.getByText('select'))
    fireEvent.click(screen.getByText('select'))
    expect(screen.getByTestId('ticks').textContent).toBe('0')

    // 原来的 500ms 到点：应手照常落下（旧行为会被重置到 900ms，这里会红）
    await advance(100)
    expect(screen.getByTestId('ticks').textContent).toBe('1')
  })

  it('缺省（自动前进类）：有效输入仍然重置计时，玩家拿到完整的一拍', async () => {
    vi.useFakeTimers()
    const platform = await createPlatform({ kv: createMemoryKv(), now: () => 1 })
    render(<TurnHarness game={turnGame()} storage={platform.storage} />)
    await settle()

    fireEvent.click(screen.getByText('play'))
    await advance(400)
    fireEvent.click(screen.getByText('select'))
    await advance(100)
    // 计时被重置：500ms 这一刻不该有应手
    expect(screen.getByTestId('ticks').textContent).toBe('0')
    await advance(400)
    expect(screen.getByTestId('ticks').textContent).toBe('1')
  })
})

/* ------------------------------------------------------------------ */
/* 2) 终局守卫：结束后棋盘输入不再改局面                                */
/* ------------------------------------------------------------------ */

interface EndState {
  moves: number
  done: boolean
}
type EndAction = { type: 'move' } | { type: 'finish' } | { type: 'restart' }

function endingGame(): GameDef<EndState, EndAction> {
  return {
    id: 'ending',
    rulesVersion: 1,
    contentVersion: 1,
    i18nNamespace: 'ending',
    difficulties: [{ id: 'starter', labelKey: 'ending.difficulty.starter' }],
    create: () => ({ moves: 0, done: false }),
    reduce: (state, action) => {
      if (action.type === 'move') return { ...state, moves: state.moves + 1 }
      if (action.type === 'finish') return { ...state, done: true }
      if (action.type === 'restart') return { moves: 0, done: false }
      throw new IllegalActionError('ending', `unknown ${(action as { type: string }).type}`)
    },
    legal: () => [],
    status: (state) => (state.done ? 'won' : 'playing'),
    view: (): GameView => ({ board: null, stats: [], result: null, notice: null }),
    controls: () => [],
    encode: (state) => state,
    decode: (raw) => raw as EndState,
    movesOf: (state) => state.moves,
    contentId: () => 'starter',
  }
}

function EndHarness({ storage }: { storage: Awaited<ReturnType<typeof createPlatform>>['storage'] }): React.ReactElement {
  const session = useSession({ game: endingGame(), storage, difficulty: 'starter' })
  return (
    <div>
      <span data-testid="ready">{session.ready ? 'yes' : 'no'}</span>
      <span data-testid="moves">{session.state.moves}</span>
      <span data-testid="finished">{session.finished ? 'yes' : 'no'}</span>
      <span data-testid="completed">{JSON.stringify(session.progress.completed ?? null)}</span>
      <span data-testid="history">{JSON.stringify(session.progress.history ?? [])}</span>
      <button onClick={() => session.dispatch({ type: 'move' } as EndAction)}>move</button>
      <button onClick={() => session.dispatch({ type: 'finish' } as EndAction)}>finish</button>
      <button onClick={() => session.restart()}>restart</button>
    </div>
  )
}

describe('终局守卫', () => {
  it('过关后棋盘输入被静默拒绝，结果面板入口（重开）仍然可用', async () => {
    const platform = await createPlatform({ kv: createMemoryKv(), now: () => 1 })
    render(<EndHarness storage={platform.storage} />)
    await settle()

    fireEvent.click(screen.getByText('move'))
    fireEvent.click(screen.getByText('finish'))
    expect(screen.getByTestId('finished').textContent).toBe('yes')
    expect(screen.getByTestId('completed').textContent).toBe('["starter"]')
    expect(screen.getByTestId('moves').textContent).toBe('1')

    // 过关后继续点棋盘：状态必须一动不动（旧行为：步数继续涨，通关记录却已经落盘）
    for (let i = 0; i < 5; i++) fireEvent.click(screen.getByText('move'))
    expect(screen.getByTestId('moves').textContent).toBe('1')
    expect(screen.getByTestId('finished').textContent).toBe('yes')

    // 结果面板的「再来一次」走 restart，必须仍然有效
    fireEvent.click(screen.getByText('restart'))
    expect(screen.getByTestId('finished').textContent).toBe('no')
    expect(screen.getByTestId('moves').textContent).toBe('0')
  })
})

/* ------------------------------------------------------------------ */
/* 3) 平局：不写通关记录，也不写最佳成绩                                */
/* ------------------------------------------------------------------ */

interface DrawState {
  moves: number
  done: boolean
}
type DrawAction = { type: 'move' } | { type: 'draw' }

function drawingGame(): GameDef<DrawState, DrawAction> {
  return {
    id: 'drawing',
    rulesVersion: 1,
    contentVersion: 1,
    i18nNamespace: 'drawing',
    difficulties: [{ id: 'starter', labelKey: 'drawing.difficulty.starter' }],
    create: () => ({ moves: 0, done: false }),
    reduce: (state, action) => {
      if (action.type === 'move') return { ...state, moves: state.moves + 1 }
      if (action.type === 'draw') return { ...state, done: true }
      throw new IllegalActionError('drawing', `unknown ${(action as { type: string }).type}`)
    },
    legal: () => [],
    // 与五子棋/象棋同款：平局在 status 上并入 won，否则结果面板不出来
    status: (state) => (state.done ? 'won' : 'playing'),
    outcomeOf: () => 'draw',
    view: (): GameView => ({ board: null, stats: [], result: null, notice: null }),
    controls: () => [],
    encode: (state) => state,
    decode: (raw) => raw as DrawState,
    movesOf: (state) => state.moves,
    contentId: () => 'starter',
  }
}

function DrawHarness({ storage }: { storage: Awaited<ReturnType<typeof createPlatform>>['storage'] }): React.ReactElement {
  const session = useSession({ game: drawingGame(), storage, difficulty: 'starter' })
  return (
    <div>
      <span data-testid="ready">{session.ready ? 'yes' : 'no'}</span>
      <span data-testid="completed">{JSON.stringify(session.progress.completed ?? null)}</span>
      <span data-testid="bestMoves">{JSON.stringify(session.progress.bestMoves ?? null)}</span>
      <span data-testid="history">{JSON.stringify(session.progress.history ?? [])}</span>
      <button onClick={() => session.dispatch({ type: 'move' } as DrawAction)}>move</button>
      <button onClick={() => session.dispatch({ type: 'draw' } as DrawAction)}>draw</button>
    </div>
  )
}

describe('平局的账目', () => {
  it('平局只写「未获胜」的历史记录，不写 completed / bestMoves', async () => {
    const platform = await createPlatform({ kv: createMemoryKv(), now: () => 1 })
    render(<DrawHarness storage={platform.storage} />)
    await settle()

    fireEvent.click(screen.getByText('move'))
    fireEvent.click(screen.getByText('move'))
    fireEvent.click(screen.getByText('draw'))

    // 平局不是通关：进度里不该出现 completed
    expect(screen.getByTestId('completed').textContent).toBe('null')
    // 也不该记成「最佳成绩」
    expect(screen.getByTestId('bestMoves').textContent).toBe('null')
    const history = JSON.parse(screen.getByTestId('history').textContent ?? '[]') as Array<{ won: boolean; moves: number }>
    expect(history).toHaveLength(1)
    expect(history[0]!.won).toBe(false)
    expect(history[0]!.moves).toBe(2)
  })
})
