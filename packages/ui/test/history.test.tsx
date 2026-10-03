// @vitest-environment jsdom
/**
 * 历史记录的写入行为（会话层）。
 *
 * 覆盖验收要求：结束时写一条、重载不重复写、不同难度分开、上限 5 条、旧存档缺字段不崩，
 * 外加「开始新游戏时历史记录要被带过去」（否则一开新局战绩就没了）。
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import {
  HISTORY_LIMIT,
  createMemoryKv,
  newEnvelope,
  readHistory,
  type GameDef,
  type KvBackend,
  type SaveEnvelope,
} from '@eink/core'
import { createPlatform } from '@eink/platform'
import { useSession } from '../src/session.js'

interface FakeState {
  moves: number
  outcome: 'playing' | 'won' | 'lost'
}

type FakeAction = { type: 'step' } | { type: 'finish' } | { type: 'fail' }

/** 最小可玩局面：一步就能过关或失败，便于精确验证写入时机 */
const fakeGame: GameDef<FakeState, FakeAction> = {
  id: 'history-test',
  rulesVersion: 1,
  contentVersion: 1,
  i18nNamespace: 'history-test',
  difficulties: [
    { id: 'easy', labelKey: 'history-test.difficulty.easy' },
    { id: 'hard', labelKey: 'history-test.difficulty.hard' },
  ],
  create: () => ({ moves: 0, outcome: 'playing' }),
  reduce: (state, action) => ({
    moves: state.moves + 1,
    outcome: action.type === 'finish' ? 'won' : action.type === 'fail' ? 'lost' : 'playing',
  }),
  legal: () => [],
  selectAction: () => null,
  controlAction: () => null,
  status: (state) => state.outcome,
  movesOf: (state) => state.moves,
  view: () => ({ board: null, stats: [], result: null, notice: null }),
  controls: () => [],
  encode: (state) => state,
  decode: (value) => value as FakeState,
}

const BASE_TIME = 1_700_000_000_000

afterEach(() => {
  // 每个用例都新建 kv，互不影响
})

async function mountSession(
  kv: KvBackend,
  options: { difficulty?: string; clock?: { t: number }; initialProgress?: Record<string, unknown> } = {},
) {
  const clock = options.clock ?? { t: BASE_TIME }
  const platform = await createPlatform({ kv, now: () => clock.t })
  const hook = renderHook(() =>
    useSession<FakeState, FakeAction>({
      game: fakeGame,
      storage: platform.storage,
      difficulty: options.difficulty ?? 'easy',
      now: () => clock.t,
      ...(options.initialProgress ? { initialProgress: options.initialProgress } : {}),
    }),
  )
  await waitFor(() => expect(hook.result.current.ready).toBe(true))
  return { hook, platform, clock }
}

async function readHistoryFrom(platform: Awaited<ReturnType<typeof createPlatform>>): Promise<unknown[]> {
  const envelope = await platform.storage.saves.load(fakeGame.id)
  return readHistory(envelope?.progress?.history)
}

describe('历史记录：写入时机与去重', () => {
  it('进入结束状态时写一条（含难度/步数/胜负/时间戳）', async () => {
    const kv = createMemoryKv()
    const { hook, platform } = await mountSession(kv)
    act(() => {
      hook.result.current.dispatch({ type: 'finish' })
    })
    await waitFor(async () => expect(await readHistoryFrom(platform)).toHaveLength(1))
    const [record] = await readHistoryFrom(platform)
    expect(record).toMatchObject({ difficulty: 'easy', moves: 1, won: true, at: BASE_TIME, seconds: 0 })
  })

  it('失败同样记录（won=false）', async () => {
    const kv = createMemoryKv()
    const { hook, platform } = await mountSession(kv)
    act(() => {
      hook.result.current.dispatch({ type: 'fail' })
    })
    await waitFor(async () => expect(await readHistoryFrom(platform)).toHaveLength(1))
    expect((await readHistoryFrom(platform))[0]).toMatchObject({ won: false, moves: 1 })
  })

  it('结束后继续派发动作不会重复写（同一结束状态只有一条）', async () => {
    const kv = createMemoryKv()
    const { hook, platform } = await mountSession(kv)
    act(() => {
      hook.result.current.dispatch({ type: 'finish' })
    })
    await waitFor(async () => expect(await readHistoryFrom(platform)).toHaveLength(1))
    // 结束后再派发：局面已结束，不应再产生记录
    act(() => {
      hook.result.current.dispatch({ type: 'finish' })
      hook.result.current.dispatch({ type: 'step' })
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(await readHistoryFrom(platform)).toHaveLength(1)
  })

  it('重载页面（重新挂载同一个存档）不会重复写', async () => {
    const kv = createMemoryKv()
    const first = await mountSession(kv)
    act(() => {
      first.hook.result.current.dispatch({ type: 'finish' })
    })
    await waitFor(async () => expect(await readHistoryFrom(first.platform)).toHaveLength(1))
    first.hook.unmount()

    // 重新挂载 = 用户重新打开页面；此时存档已是结束状态，绝不能又写一条
    const second = await mountSession(kv)
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(await readHistoryFrom(second.platform)).toHaveLength(1)
    expect(second.hook.result.current.finished).toBe(true)
  })

  it('不同难度分别记录（各自成条）', async () => {
    const kv = createMemoryKv()
    const clock = { t: BASE_TIME }
    const easy = await mountSession(kv, { difficulty: 'easy', clock })
    act(() => {
      easy.hook.result.current.dispatch({ type: 'finish' })
    })
    await waitFor(async () => expect(await readHistoryFrom(easy.platform)).toHaveLength(1))
    easy.hook.unmount()

    clock.t += 1_000
    const hard = await mountSession(kv, { difficulty: 'hard', clock })
    // 打开的是上一局的结束存档 → 直接重开一局再结束
    await act(async () => {
      await hard.hook.result.current.discardAndRestart()
    })
    act(() => {
      hard.hook.result.current.dispatch({ type: 'finish' })
    })
    await waitFor(async () => expect(await readHistoryFrom(hard.platform)).toHaveLength(2))
    const list = await readHistoryFrom(hard.platform)
    expect(list.map((item) => (item as { difficulty: string }).difficulty)).toEqual(['hard', 'easy'])
  })

  it('上限 5 条：连打 7 局只留最近 5 条，最新在前', async () => {
    const kv = createMemoryKv()
    const clock = { t: BASE_TIME }
    const { hook, platform } = await mountSession(kv, { clock })
    for (let round = 1; round <= 7; round++) {
      await act(async () => {
        await hook.result.current.discardAndRestart()
      })
      clock.t += 1_000
      act(() => {
        hook.result.current.dispatch({ type: 'finish' })
      })
      await waitFor(async () =>
        expect((await readHistoryFrom(platform)).length).toBe(Math.min(round, HISTORY_LIMIT)),
      )
    }
    const list = await readHistoryFrom(platform)
    expect(list).toHaveLength(HISTORY_LIMIT)
    const times = list.map((item) => (item as { at: number }).at)
    expect(times).toEqual([...times].sort((a, b) => b - a))
  })

  it('「开始新游戏」带进来的历史会被继承，而不是被清空', async () => {
    const kv = createMemoryKv()
    const carry = { history: [{ difficulty: 'easy', moves: 9, seconds: 30, won: true, at: BASE_TIME - 5_000 }] }
    const { hook, platform } = await mountSession(kv, { initialProgress: carry })
    act(() => {
      hook.result.current.dispatch({ type: 'finish' })
    })
    await waitFor(async () => expect(await readHistoryFrom(platform)).toHaveLength(2))
    expect((await readHistoryFrom(platform))[0]).toMatchObject({ moves: 1, won: true })
  })
})

describe('历史记录：旧存档兼容', () => {
  it('存档里没有 history / history 是坏数据时都能正常打开与追加', async () => {
    for (const bad of [undefined, 'nope', [{}, 7, { difficulty: '' }], { not: 'an array' }]) {
      const kv = createMemoryKv()
      const platform = await createPlatform({ kv, now: () => BASE_TIME })
      const envelope: SaveEnvelope = newEnvelope(
        {
          gameId: fakeGame.id,
          rulesVersion: 1,
          contentVersion: 1,
          difficulty: 'easy',
          seed: 1,
          state: fakeGame.encode(fakeGame.create(1, 'easy')),
        },
        BASE_TIME,
        bad === undefined ? { completed: ['x'], bestMoves: { x: 3 } } : { history: bad },
      )
      const result = await platform.storage.saves.commit(envelope)
      expect(result.ok).toBe(true)

      const { hook } = await mountSession(kv)
      expect(hook.result.current.ready).toBe(true)
      expect(hook.result.current.corrupt).toBe(false)
      act(() => {
        hook.result.current.dispatch({ type: 'finish' })
      })
      await waitFor(async () => expect(await readHistoryFrom(platform)).toHaveLength(1))
      // 旧字段没被弄丢
      const stored = await platform.storage.saves.load(fakeGame.id)
      const progress = stored?.progress as { completed?: string[]; bestMoves?: Record<string, number> } | undefined
      if (bad === undefined) {
        expect(progress?.completed).toEqual(['x'])
        expect(progress?.bestMoves).toEqual({ x: 3 })
      }
    }
  })
})
