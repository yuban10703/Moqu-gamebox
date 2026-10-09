// @vitest-environment jsdom
/**
 * 「是否算通关」= `outcomeOf(state)`（没有这个钩子才回退到 `status === 'won'`）。
 *
 * 由来（2026-10-10 NoteX2 实机走查，问题 3）：熟练档输棋的结果面板有「撤销」，入门/挑战**和局**却只有 4 个
 * 按钮。井字棋为了让结果面板出现把和局并进了 `status() === 'won'`（它自己的注释写明），
 * 而结果面板的判据用的是 `session.solved = status === 'won'` → 和局被当成"通关"，
 * 撤销被 `!session.solved` 挡掉。壳层注释写的却是「losses/draws 都给撤销」。
 *
 * 守四件事：
 *   ① 真实井字棋：和局（hotseat 九格下满）`solved=false`、真胜局 `solved=true`；
 *   ② 真实井字棋和局的结果面板**有**撤销，点它能退回上一手；
 *   ③ 真实推箱子（无 outcomeOf）通关：结果面板仍然**没有**撤销 —— 与改前一字不差，
 *      尽管那一刻规则层确实给着一个可用的 undo 控件（否则这条断言是空的）；
 *   ④ 没有 outcomeOf 的玩法口径不变：`status==='won'` 才算通关，`lost` 照旧给撤销。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import {
  IllegalActionError,
  coreDictEn,
  coreDictZh,
  createMemoryKv,
  type GameDef,
  type GameView,
} from '@eink/core'
import { createPlatform } from '@eink/platform'
import {
  LEVEL_WITNESSES,
  PACK,
  progressSummary,
  sokobanEn,
  sokobanGame,
  sokobanZh,
  type SokobanAction,
} from '@eink/sokoban'
import {
  cellLabelKey as tictactoeCellLabelKey,
  tictactoeEn,
  tictactoeGame,
  tictactoeZh,
  type TictactoeAction,
  type TictactoeState,
} from '@eink/tictactoe'
import { App } from '../src/App.js'
import { defineGame, type GameLibrary } from '../src/registry.js'
import { useSession, type SessionApi } from '../src/session.js'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

/* ------------------------------------------------------------------ */
/* ① 真实井字棋：solved 取自 outcomeOf                                  */
/* ------------------------------------------------------------------ */

/** hotseat 九格下满的和局（X O 交替，谁都没连成线）—— 真实和局，不是"算作和局" */
const DRAW_MOVES = [0, 1, 2, 4, 3, 5, 8, 6, 7]

/** 空格的编号（格子 kind 为 empty） */
function emptyCellsOf(state: TictactoeState): number[] {
  const board = tictactoeGame.view(state).board
  if (!board) throw new Error('tictactoe always has a board')
  return board.cells.filter((cell) => cell.kind === 'empty').map((cell) => cell.index)
}

/** 玩家执 X 的落点：能赢就赢，否则取第一个空格（对手是入门档随机 AI） */
function pickMove(state: TictactoeState): number {
  const cells = emptyCellsOf(state)
  for (const index of cells) {
    const next = tictactoeGame.reduce(state, { type: 'place', index })
    if (tictactoeGame.outcomeOf!(next) === 'won') return index
  }
  return cells[0]!
}

interface Plan {
  actions: TictactoeAction[]
  /** 玩家（执 X）自己的落点顺序：真机上就是要点的那几格 */
  playerMoves: number[]
  outcome: 'won' | 'lost' | 'draw' | undefined
  titleKey: string | undefined
}

/** 只用公开 API 走完一局（应手也手动派发 tick，避免依赖真实计时） */
function planGame(difficulty: string, seed: number): Plan {
  let state = tictactoeGame.create(seed, difficulty)
  const actions: TictactoeAction[] = []
  const playerMoves: number[] = []
  for (let guard = 0; guard < 32 && tictactoeGame.status(state) === 'playing'; guard++) {
    const tick = tictactoeGame.legal(state).find((action) => action.type === 'tick')
    if (tick) {
      actions.push(tick)
      state = tictactoeGame.reduce(state, tick)
      continue
    }
    const index = pickMove(state)
    const action: TictactoeAction = { type: 'place', index }
    actions.push(action)
    playerMoves.push(index)
    state = tictactoeGame.reduce(state, action)
  }
  return {
    actions,
    playerMoves,
    outcome: tictactoeGame.outcomeOf?.(state),
    titleKey: tictactoeGame.view(state).result?.titleKey,
  }
}

/** 找一颗「先手能赢入门档 AI」的假时钟（种子 = Date.now() % 0x7fffffff） */
function findWinningPlan(): { now: number; plan: Plan } {
  for (let step = 0; step < 400; step++) {
    const now = 1_700_000_000_000 + step
    const plan = planGame('starter', now % 0x7fffffff)
    if (plan.outcome === 'won') return { now, plan }
  }
  throw new Error('no winning seed in range')
}

/** 会话探针：把 solved / finished / 结果标题暴露出来，动作由测试逐条派发 */
let sessionRef: SessionApi<TictactoeState, TictactoeAction> | null = null

function TttHarness({
  storage,
  difficulty,
}: {
  storage: Awaited<ReturnType<typeof createPlatform>>['storage']
  difficulty: string
}): React.ReactElement {
  const session = useSession({ game: tictactoeGame, storage, difficulty })
  sessionRef = session
  return (
    <div>
      <span data-testid="ready">{session.ready ? 'yes' : 'no'}</span>
      <span data-testid="finished">{session.finished ? 'yes' : 'no'}</span>
      <span data-testid="solved">{session.solved ? 'yes' : 'no'}</span>
      <span data-testid="status">{tictactoeGame.status(session.state)}</span>
      <span data-testid="outcome">{tictactoeGame.outcomeOf?.(session.state) ?? 'null'}</span>
      <span data-testid="title">{session.view.result?.titleKey ?? 'none'}</span>
    </div>
  )
}

/** 逐条派发动作：每次都在 act 里刷新一次渲染，stateRef 才跟得上 */
async function dispatchAll(actions: readonly TictactoeAction[]): Promise<void> {
  for (const action of actions) {
    let ok = false
    await act(async () => {
      ok = sessionRef!.dispatch(action)
    })
    expect(ok, `动作被拒绝：${JSON.stringify(action)}`).toBe(true)
  }
}

/**
 * 等会话 ready。
 * 假时钟下不用 waitFor（它的内部轮询也依赖定时器），按 session-guards.test.tsx 的既有办法：
 * 只冲微任务、不推进时钟 —— 于是在手派发 tick 之前，自动步进的定时器一次都不会走。
 */
async function flushReady(): Promise<void> {
  for (let round = 0; round < 10 && screen.getByTestId('ready').textContent !== 'yes'; round++) {
    await act(async () => {
      await Promise.resolve()
    })
  }
  expect(screen.getByTestId('ready').textContent).toBe('yes')
}

describe('井字棋：solved 取自 outcomeOf（和局不是通关）', () => {
  it('hotseat 九格下满和局：对局结束、状态是 won，但 solved=false', async () => {
    const platform = await createPlatform({ kv: createMemoryKv(), now: () => 1 })
    render(<TttHarness storage={platform.storage} difficulty="hotseat" />)
    await waitFor(() => expect(screen.getByTestId('ready').textContent).toBe('yes'))

    await dispatchAll(DRAW_MOVES.map((index) => ({ type: 'place', index }) as TictactoeAction))

    expect(screen.getByTestId('status').textContent).toBe('won') // 结果面板靠它出现
    expect(screen.getByTestId('outcome').textContent).toBe('draw')
    expect(screen.getByTestId('finished').textContent).toBe('yes')
    expect(screen.getByTestId('solved').textContent).toBe('no') // ← 改前是 yes，撤销因此被挡掉
    expect(screen.getByTestId('title').textContent).toBe('tictactoe.draw.title')
  })

  it('对电脑真赢下一局：solved=true（通关该有的样子）', async () => {
    // 固定假时钟（种子 = Date.now() % 0x7fffffff），并停住自动步进：应手由测试手动派发
    const { now, plan } = findWinningPlan()
    vi.useFakeTimers({ now })
    const platform = await createPlatform({ kv: createMemoryKv(), now: () => now })
    render(<TttHarness storage={platform.storage} difficulty="starter" />)
    await flushReady()

    await dispatchAll(plan.actions)

    expect(screen.getByTestId('outcome').textContent).toBe('won')
    expect(screen.getByTestId('finished').textContent).toBe('yes')
    expect(screen.getByTestId('solved').textContent).toBe('yes')
    expect(screen.getByTestId('title').textContent).toBe('tictactoe.won.title')
  })
})

/* ------------------------------------------------------------------ */
/* ②③④ 结果面板里的撤销按钮                                            */
/* ------------------------------------------------------------------ */

/** 井字棋库：defaultDifficulty 决定「新游戏」用哪一档 */
function tttLibraryWith(defaultDifficulty: string): GameLibrary {
  return {
    entries: [
      defineGame({
        game: tictactoeGame,
        cellLabelKey: tictactoeCellLabelKey,
        rulesKeys: ['tictactoe.rules.body', 'tictactoe.rules.body2', 'tictactoe.rules.body3'],
        defaultDifficulty,
      }),
    ],
    dicts: {
      'zh-CN': { ...coreDictZh, ...tictactoeZh },
      'en-US': { ...coreDictEn, ...tictactoeEn },
    },
  }
}

/** 双人同屏：九格下满的和局不需要等应手，测试里一步到位 */
const tttLibrary = tttLibraryWith('hotseat')
/** 对电脑（入门档随机 AI）：用来走一局真胜局 */
const tttComputerLibrary = tttLibraryWith('starter')

const sokobanLibrary: GameLibrary = {
  entries: [
    defineGame({
      game: sokobanGame,
      rulesKeys: ['sokoban.rules.body', 'sokoban.rules.body2'],
      defaultDifficulty: 'starter',
      levels: PACK.map((level) => ({ id: level.def.id })),
      progressFor: (completed) => {
        const summary = progressSummary(completed)
        return { done: summary.done, total: summary.total }
      },
      indexOfLevel: (levelId) => Math.max(0, PACK.findIndex((level) => level.def.id === levelId)),
    }),
  ],
  dicts: {
    'zh-CN': { ...coreDictZh, ...sokobanZh },
    'en-US': { ...coreDictEn, ...sokobanEn },
  },
}

/** 首页方块：英文名里可能带软连字符，按"人看到的文字"匹配 */
function tileByTitle(title: string): HTMLElement {
  const normalized = title.replace(/\u00AD/g, '')
  const tile = Array.from(document.querySelectorAll<HTMLElement>('.eink-tile')).find(
    (node) => node.textContent?.replace(/\u00AD/g, '').trim() === normalized,
  )
  if (!tile) throw new Error(`tile ${title} not found`)
  return tile
}

async function enterGame(
  library: GameLibrary,
  title: string,
  // 假玩法没有棋盘：等一个只有它才有的元素（真实玩法等棋盘）
  marker: () => Element = () => screen.getByRole('grid'),
  // 新局种子 = Date.now() % 0x7fffffff；要复现某一局（例如先手必胜的那颗种子）就传它
  clock: number = 1_700_000_000_000,
): Promise<void> {
  vi.spyOn(Date, 'now').mockReturnValue(clock)
  const platform = await createPlatform({ kv: createMemoryKv(), now: () => clock })
  render(<App platform={platform} library={library} />)
  await waitFor(() => expect(screen.getByText(/All games/)).toBeTruthy())
  fireEvent.click(tileByTitle(title))
  await waitFor(() => expect(screen.getByText(/How to play/)).toBeTruthy())
  fireEvent.click(screen.getByText('New game'))
  await waitFor(() => expect(marker()).toBeTruthy())
}

function cellAt(index: number): HTMLElement {
  const cell = document.querySelectorAll<HTMLElement>('.eink-board__cell')[index]
  if (!cell) throw new Error(`cell ${index} not found`)
  return cell
}

function resultPanel(): HTMLElement {
  const panel = document.querySelector<HTMLElement>('.eink-section--result')
  if (!panel) throw new Error('result panel not rendered')
  return panel
}

function markCount(): number {
  return document.querySelectorAll('.eink-board__cell[data-kind="tile"]').length
}

describe('结果面板的撤销：和局有、通关没有', () => {
  it('井字棋和局：面板里有撤销，点它退回上一手（九格回到八格、面板消失）', async () => {
    await enterGame(tttLibrary, 'Tic-tac-toe')
    for (const index of DRAW_MOVES) fireEvent.click(cellAt(index))

    await waitFor(() => expect(document.querySelector('.eink-section--result')).not.toBeNull())
    expect(markCount()).toBe(9)
    const panel = resultPanel()
    expect(panel.textContent).toMatch(/Draw/) // 标题确实是和局
    const undo = within(panel).getByRole('button', { name: 'Undo' }) as HTMLButtonElement
    expect(undo.disabled).toBe(false)

    fireEvent.click(undo)
    await waitFor(() => expect(document.querySelector('.eink-section--result')).toBeNull())
    expect(markCount()).toBe(8) // 和局撤销只退最后一手
    expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy()
  })

  it('井字棋真赢下一局（对电脑）：结果面板没有撤销', async () => {
    // 同一颗种子先推演一遍：玩家执 X 的落点序列 + 终局结果（入门档 AI 是随机但确定性的）
    const { now, plan } = findWinningPlan()
    expect(plan.outcome).toBe('won')
    expect(plan.playerMoves.length).toBeGreaterThan(0)

    await enterGame(tttComputerLibrary, 'Tic-tac-toe', () => screen.getByRole('grid'), now)
    for (let step = 0; step < plan.playerMoves.length; step++) {
      const index = plan.playerMoves[step]!
      fireEvent.click(cellAt(index))
      const last = step === plan.playerMoves.length - 1
      if (last) break
      // 电脑应手是两拍（壳层按 tickMs 自动派发），等它落定再做下一手
      const expected = 2 * (step + 1)
      await waitFor(() => expect(markCount()).toBeGreaterThanOrEqual(expected), { timeout: 6000 })
    }

    await waitFor(() => expect(document.querySelector('.eink-section--result')).not.toBeNull(), {
      timeout: 6000,
    })
    const panel = resultPanel()
    expect(panel.textContent).toMatch(/You win/) // 真赢了，不是和局
    expect(within(panel).queryByRole('button', { name: 'Undo' })).toBeNull()
  })

  it('推箱子（没有 outcomeOf）通关：结果面板仍然没有撤销 —— 与改前一致', async () => {
    // 规则层先确认：通关那一刻 undo 控件确实是「可用」的，所以面板里没有它是壳层判据决定的
    const witness = LEVEL_WITNESSES['L01']!
    let state = sokobanGame.create(0, 'starter')
    for (const dir of witness) {
      if (sokobanGame.status(state) !== 'playing') break
      state = sokobanGame.reduce(state, { type: 'move', dir } as SokobanAction)
    }
    expect(sokobanGame.status(state)).toBe('won')
    expect(sokobanGame.controls(state).some((control) => control.id === 'undo' && control.enabled)).toBe(true)

    await enterGame(sokobanLibrary, 'Sokoban')
    for (const dir of witness) {
      if (screen.queryByText(/Level solved/)) break
      fireEvent.click(screen.getByLabelText(dir[0]!.toUpperCase() + dir.slice(1)))
    }
    await waitFor(() => expect(screen.getByText(/Level solved/)).toBeTruthy())
    const panel = resultPanel()
    expect(within(panel).queryByRole('button', { name: 'Undo' })).toBeNull()
    // 面板该有的入口都在（不是整个面板没渲染）
    expect(within(panel).getByRole('button', { name: 'Play again' })).toBeTruthy()
    expect(within(panel).getByRole('button', { name: 'Back to library' })).toBeTruthy()
  })
})

/* ------------------------------------------------------------------ */
/* ④ 没有 outcomeOf 的玩法：口径不变                                    */
/* ------------------------------------------------------------------ */

interface FakeState {
  moves: number
  done: boolean
}

type FakeAction = { type: 'finish' } | { type: 'undo' } | { type: 'restart' }

/** 最小玩法：`finish` 结束，结束时的 status 由参数给；不声明 outcomeOf（15 款旧玩法就是这样） */
function fakeGame(status: 'won' | 'lost'): GameDef<FakeState, FakeAction> {
  return {
    id: `fake-${status}`,
    rulesVersion: 1,
    contentVersion: 1,
    i18nNamespace: 'fake',
    illegalNoticeKey: 'fake.illegal',
    difficulties: [{ id: 'starter', labelKey: 'fake.difficulty.starter' }],
    create: () => ({ moves: 0, done: false }),
    reduce: (state, action) => {
      if (action.type === 'finish') return { moves: state.moves + 1, done: true }
      if (action.type === 'undo') return { moves: Math.max(0, state.moves - 1), done: false }
      if (action.type === 'restart') return { moves: 0, done: false }
      throw new IllegalActionError('fake', 'unknown action')
    },
    legal: () => [],
    status: (state) => (state.done ? status : 'playing'),
    view: (state): GameView => ({
      board: null,
      stats: [],
      notice: null,
      result: state.done
        ? { titleKey: status === 'won' ? 'fake.won.title' : 'fake.lost.title', details: [] }
        : null,
    }),
    controls: (state) =>
      state.done
        ? [{ id: 'undo', labelKey: 'shell.game.undo', role: 'action', enabled: true, emphasis: 'normal' }]
        : [{ id: 'finish', labelKey: 'fake.action.finish', role: 'action', enabled: true, emphasis: 'primary' }],
    controlAction: (_state, controlId) =>
      controlId === 'undo' ? { type: 'undo' } : controlId === 'finish' ? { type: 'finish' } : null,
    encode: (state) => state,
    decode: (raw) => raw as FakeState,
    movesOf: (state) => state.moves,
    contentId: () => 'starter',
  }
}

function fakeLibrary(status: 'won' | 'lost'): GameLibrary {
  return {
    entries: [
      defineGame({
        game: fakeGame(status),
        rulesKeys: ['fake.rules.body'],
        defaultDifficulty: 'starter',
      }),
    ],
    dicts: {
      'zh-CN': {
        ...coreDictZh,
        'fake.title': '假玩法',
        'fake.rules.body': '测试用',
        'fake.difficulty.starter': '入门',
        'fake.illegal': '不行',
        'fake.action.finish': '结束',
        'fake.won.title': '赢了',
        'fake.lost.title': '输了',
      },
      'en-US': {
        ...coreDictEn,
        'fake.title': 'Fake',
        'fake.rules.body': 'for tests',
        'fake.difficulty.starter': 'Starter',
        'fake.illegal': 'Nope',
        'fake.action.finish': 'Finish',
        'fake.won.title': 'Won',
        'fake.lost.title': 'Lost',
      },
    },
  }
}

describe('没有 outcomeOf 的玩法：solved 仍然是 status === won（口径不变）', () => {
  it('status 变 won：没有撤销（与改前一致）', async () => {
    await enterGame(fakeLibrary('won'), 'Fake', () => screen.getByRole('button', { name: 'Finish' }))
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }))
    await waitFor(() => expect(document.querySelector('.eink-section--result')).not.toBeNull())
    const panel = resultPanel()
    expect(panel.textContent).toContain('Won')
    expect(within(panel).queryByRole('button', { name: 'Undo' })).toBeNull()
  })

  it('status 变 lost：照旧给撤销，点了能回到对局中', async () => {
    await enterGame(fakeLibrary('lost'), 'Fake', () => screen.getByRole('button', { name: 'Finish' }))
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }))
    await waitFor(() => expect(document.querySelector('.eink-section--result')).not.toBeNull())
    const panel = resultPanel()
    expect(panel.textContent).toContain('Lost')
    const undo = within(panel).getByRole('button', { name: 'Undo' }) as HTMLButtonElement
    expect(undo.disabled).toBe(false)
    fireEvent.click(undo)
    await waitFor(() => expect(document.querySelector('.eink-section--result')).toBeNull())
  })
})
