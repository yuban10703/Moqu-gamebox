// @vitest-environment jsdom
/**
 * 最高纪录（无尽类玩法，GameDef.scoreOf）：会话层的写入、破纪录标记与跨局继承。
 *
 * 无尽模式只会以失败收场，所以输局也必须记成绩；「重新开始」「开始新游戏」都不能把纪录清掉。
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { carriedProgress, createMemoryKv, readBestMoves, readBestScore, readCompleted, type GameDef, type KvBackend } from '@eink/core'
import { createPlatform } from '@eink/platform'
import { useSession } from '../src/session.js'

interface FakeState {
  score: number
  over: boolean
}

type FakeAction = { type: 'score' } | { type: 'die' }

const fakeGame: GameDef<FakeState, FakeAction> = {
  id: 'best-score-test',
  rulesVersion: 1,
  contentVersion: 1,
  i18nNamespace: 'best-score-test',
  difficulties: [{ id: 'endless', labelKey: 'best-score-test.difficulty.endless' }],
  create: () => ({ score: 0, over: false }),
  reduce: (state, action) => (action.type === 'score' ? { ...state, score: state.score + 1 } : { ...state, over: true }),
  legal: () => [],
  status: (state) => (state.over ? 'lost' : 'playing'),
  contentId: () => 'endless',
  scoreOf: (state) => state.score,
  view: () => ({ board: null, stats: [], result: null, notice: null }),
  controls: () => [],
  encode: (state) => state,
  decode: (value) => value as FakeState,
}

async function mountSession(kv: KvBackend, initialProgress?: Record<string, unknown>) {
  const platform = await createPlatform({ kv, now: () => 1_700_000_000_000 })
  const hook = renderHook(() =>
    useSession<FakeState, FakeAction>({
      game: fakeGame,
      storage: platform.storage,
      difficulty: 'endless',
      now: () => 1_700_000_000_000,
      ...(initialProgress ? { initialProgress } : {}),
    }),
  )
  await waitFor(() => expect(hook.result.current.ready).toBe(true))
  return { hook, platform }
}

function play(hook: Awaited<ReturnType<typeof mountSession>>['hook'], score: number): void {
  for (let i = 0; i < score; i++) {
    act(() => {
      hook.result.current.dispatch({ type: 'score' })
    })
  }
  act(() => {
    hook.result.current.dispatch({ type: 'die' })
  })
}

describe('最高纪录', () => {
  it('输局也记成绩；第一次有成绩就是新纪录', async () => {
    const { hook, platform } = await mountSession(createMemoryKv())
    play(hook, 3)
    await waitFor(() => expect(hook.result.current.finished).toBe(true))
    expect(hook.result.current.progress.bestScore).toEqual({ endless: 3 })
    expect(hook.result.current.newRecord).toBe(true)
    await waitFor(async () => {
      const envelope = await platform.storage.saves.load(fakeGame.id)
      expect(readBestScore(envelope?.progress?.bestScore)).toEqual({ endless: 3 })
    })
  })

  it('没超过纪录：纪录不变、不标新纪录；超过才更新', async () => {
    const { hook } = await mountSession(createMemoryKv(), { bestScore: { endless: 5 } })
    play(hook, 2)
    await waitFor(() => expect(hook.result.current.finished).toBe(true))
    expect(hook.result.current.progress.bestScore).toEqual({ endless: 5 })
    expect(hook.result.current.newRecord).toBe(false)

    await act(async () => {
      await hook.result.current.discardAndRestart()
    })
    // 重新开始：纪录跟着新存档走，新纪录标记随新局复位
    expect(hook.result.current.progress.bestScore).toEqual({ endless: 5 })
    expect(hook.result.current.newRecord).toBe(false)
    play(hook, 7)
    await waitFor(() => expect(hook.result.current.finished).toBe(true))
    expect(hook.result.current.progress.bestScore).toEqual({ endless: 7 })
    expect(hook.result.current.newRecord).toBe(true)
  })

  it('0 分不算纪录', async () => {
    const { hook } = await mountSession(createMemoryKv())
    play(hook, 0)
    await waitFor(() => expect(hook.result.current.finished).toBe(true))
    expect(readBestScore(hook.result.current.progress.bestScore)).toEqual({})
    expect(hook.result.current.newRecord).toBe(false)
  })
})

describe('跨局继承（开始新游戏 / 重新开始 / 自由选关）', () => {
  it('历史记录、最高纪录、已通关记录、每关最佳步数都带过去；坏数据丢掉', () => {
    const carry = carriedProgress({
      completed: ['a', 'b', '', 3, 'a'],
      bestMoves: { a: 3, b: 0, bad: -1, worse: 'x' },
      history: [{ difficulty: 'endless', moves: 0, seconds: 1, won: false, at: 1 }],
      bestScore: { endless: 4, bad: -1, worse: 'x' },
    })
    expect(carry).toEqual({
      history: [{ difficulty: 'endless', moves: 0, seconds: 1, won: false, at: 1 }],
      bestScore: { endless: 4 },
      // 已通关记录与最佳步数是**跨局成绩**，不该被「开始新游戏 / 自由选关」清掉
      // （实测缺陷：通关第 1 关后从关卡列表点第 5 关，详情页进度 1/16 直接回到 0/16）
      completed: ['a', 'b'],
      bestMoves: { a: 3, b: 0 },
    })
    expect(carriedProgress(undefined)).toEqual({})
    expect(readBestScore([1, 2])).toEqual({})
    expect(readCompleted('nope')).toEqual([])
    expect(readBestMoves(null)).toEqual({})
  })
})
