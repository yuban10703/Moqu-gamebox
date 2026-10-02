/**
 * 壳层会话：把「游戏规则 + 存档协议 + 输入处理」串起来。
 *
 * 明确的边界（对应验收 C03/C06 与产品规范第 5 条）：
 * - 输入按顺序处理：每个被接受的动作立即产生状态变化，不做整体防抖；
 *   只有持久化做节流（500ms 合并 + 关键节点强制立即提交）。
 * - 界面响应 ≠ 已保存：保存状态单独暴露（保存中 / 已保存 / 失败+重试）。
 * - 被拒绝的输入给出明确文字提示，并且**不进入动作日志**。
 * - 暂停后不接受输入；页面隐藏、离开游戏、关卡结束时强制落盘。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  IllegalActionError,
  applyAction,
  newEnvelope,
  reseal,
  toCompletionRecord,
  type ControlSpec,
  type GameDef,
  type GameView,
  type SaveEnvelope,
  type SaveFailureReason,
} from '@eink/core'
import type { AppStorage } from '@eink/platform'

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'failed'

export interface GameProgress {
  completed?: string[]
  bestMoves?: Record<string, number>
}

export interface SessionOptions<S, A> {
  game: GameDef<S, A>
  storage: AppStorage
  difficulty: string
  /** 每次成功提交后回调（用于刷新游戏库进度） */
  onCommitted?: (envelope: SaveEnvelope) => void
  now?: () => number
}

export interface SessionApi<S, A> {
  ready: boolean
  game: GameDef<S, A>
  state: S
  view: GameView
  controls: ControlSpec[]
  saveStatus: SaveStatus
  failureReason: SaveFailureReason | null
  noticeKey: string | null
  paused: boolean
  /** 存档损坏：界面必须提示并可导出，而不是静默重置 */
  corrupt: boolean
  solved: boolean
  progress: GameProgress
  /** 本关已用时（可变引用，由 <Timer> 自己按秒读取，避免整页重渲染） */
  elapsedRef: { current: number }
  /** 本关开始时已累计的用时，用于计算「本关用时」 */
  levelStartRef: { current: number }
  /** 计时是否应该在跑 */
  clockActive: boolean
  dispatch(action: A): boolean
  undo(): void
  restart(): void
  nextLevel(): void
  pause(): void
  resume(): void
  retrySave(): void
  clearNotice(): void
  flush(): Promise<void>
  discardAndRestart(): Promise<void>
}

const COMMIT_DEBOUNCE_MS = 500

export function useSession<S, A>(options: SessionOptions<S, A>): SessionApi<S, A> {
  const { game, storage, difficulty, onCommitted } = options
  const now = options.now ?? (() => Date.now())

  const [state, setState] = useState<S>(() => game.create(0, difficulty))
  const [ready, setReady] = useState(false)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [failureReason, setFailureReason] = useState<SaveFailureReason | null>(null)
  const [noticeKey, setNoticeKey] = useState<string | null>(null)
  const [paused, setPaused] = useState(false)
  const [corrupt, setCorrupt] = useState(false)
  const [progress, setProgress] = useState<GameProgress>({})

  const envelopeRef = useRef<SaveEnvelope | null>(null)
  const timerRef = useRef<number | null>(null)
  const elapsedRef = useRef(0)
  const levelStartRef = useRef(0)
  const pausedRef = useRef(false)
  const corruptRef = useRef(false)
  const dirtyRef = useRef(false)
  const stateRef = useRef(state)
  stateRef.current = state

  const commitNow = useCallback(
    async (envelope: SaveEnvelope) => {
      // 存档处于损坏/不兼容状态时不得自动写回：否则会把损坏内容「修好校验和」后覆盖掉原档
      if (corruptRef.current) return
      setSaveStatus('saving')
      const result = await storage.saves.commit(envelope)
      if (result.ok) {
        const current = envelopeRef.current
        if (current && current.checksum !== envelope.checksum) {
          // 提交期间状态又前进了：把新的提交编号传递到最新状态，避免下一笔提交被误判为冲突
          envelopeRef.current = reseal({ ...current, commitId: result.commitId })
        } else {
          envelopeRef.current = { ...envelope, commitId: result.commitId }
        }
        dirtyRef.current = false
        setFailureReason(null)
        setSaveStatus('saved')
        onCommitted?.(envelopeRef.current)
      } else {
        setFailureReason(result.reason)
        setSaveStatus('failed')
      }
    },
    [storage, onCommitted],
  )

  const scheduleCommit = useCallback(() => {
    dirtyRef.current = true
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      const envelope = envelopeRef.current
      if (envelope) void commitNow(envelope)
    }, COMMIT_DEBOUNCE_MS)
  }, [commitNow])

  const flush = useCallback(async () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
    const envelope = envelopeRef.current
    if (envelope) await commitNow(envelope)
  }, [commitNow])

  // 载入存档；损坏或规则版本不匹配时进入 corrupt 状态（保留数据，交由界面提示与导出）
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const result = await storage.saves.loadResult(game.id)
      if (cancelled) return
      if (result.status === 'empty') {
        const fresh = newEnvelope(
          {
            gameId: game.id,
            rulesVersion: game.rulesVersion,
            contentVersion: game.contentVersion,
            difficulty,
            seed: 0,
            state: game.encode(game.create(0, difficulty)),
          },
          now(),
        )
        envelopeRef.current = fresh
        setProgress((fresh.progress ?? {}) as GameProgress)
        setReady(true)
        return
      }
      if (result.status === 'corrupt') {
        // 保留原档、只读可导出；由用户显式决定是否重新开始
        corruptRef.current = true
        setCorrupt(true)
        setReady(true)
        return
      }
      const existing = result.envelope
      envelopeRef.current = existing
      setProgress((existing.progress ?? {}) as GameProgress)
      elapsedRef.current = existing.session.elapsedMs
      levelStartRef.current = existing.session.elapsedMs
      if (existing.rulesVersion !== game.rulesVersion) {
        corruptRef.current = true
        setCorrupt(true)
        setReady(true)
        return
      }
      try {
        const decoded = game.decode(existing.state)
        if (cancelled) return
        setState(decoded)
        setReady(true)
      } catch {
        corruptRef.current = true
        setCorrupt(true)
        setReady(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [game, storage, difficulty, now])

  const persist = useCallback(
    (next: S, options: { force: boolean; progress?: GameProgress; ended?: 'won' | 'lost' }) => {
      const envelope = envelopeRef.current
      if (!envelope) return
      const mergedProgress = { ...(envelope.progress ?? {}), ...(options.progress ?? {}) }
      const updated = applyAction(envelope, game.encode(next), now(), {
        progress: mergedProgress,
        session: {
          elapsedMs: elapsedRef.current,
          ...(options.ended ? { ended: options.ended } : {}),
        },
      })
      envelopeRef.current = updated
      setState(next)
      if (options.force) void commitNow(updated)
      else scheduleCommit()
    },
    [game, now, commitNow, scheduleCommit],
  )

  const finalizeLevel = useCallback(
    (next: S) => {
      const levelId = (next as { levelId?: string }).levelId ?? ''
      const stats = game.view(next).stats
      const moves = Number.parseInt(stats.find((stat) => stat.labelKey === 'sokoban.stat.moves')?.value ?? '0', 10)
      const completed = new Set(progress.completed ?? [])
      completed.add(levelId)
      const bestMoves = { ...(progress.bestMoves ?? {}) }
      if (Number.isFinite(moves) && (bestMoves[levelId] === undefined || moves < bestMoves[levelId]!)) {
        bestMoves[levelId] = moves
      }
      const nextProgress: GameProgress = { completed: [...completed], bestMoves }
      setProgress(nextProgress)
      persist(next, { force: true, progress: nextProgress, ended: 'won' })

      const envelope = envelopeRef.current
      if (envelope) {
        const record = toCompletionRecord(
          { ...envelope, session: { ...envelope.session, elapsedMs: elapsedRef.current - levelStartRef.current } },
          'won',
          bestMoves,
        )
        void storage.appendRecord(record)
      }
    },
    [game, progress, persist, storage],
  )

  const dispatch = useCallback(
    (action: A): boolean => {
      if (pausedRef.current || corrupt || !ready) return false
      try {
        const current = stateRef.current
        const next = game.reduce(current, action)
        const solvedNow = game.status(next) === 'won'
        const wasSolved = game.status(current) === 'won'
        if (solvedNow && !wasSolved) {
          // 过关必须在**一次提交**里同时写入「新状态 + 完成进度 + 结束标记」：
          // 分两次提交会互相争抢同一个提交编号，后一笔被提交栅栏判为冲突，
          // 结果就是「界面显示过关、存档里却没有进度」。
          finalizeLevel(next)
        } else {
          persist(next, { force: false })
        }
        if (action && typeof action === 'object' && (action as { type?: string }).type === 'nextLevel') {
          levelStartRef.current = elapsedRef.current
        }
        return true
      } catch (error) {
        if (error instanceof IllegalActionError && game.illegalNoticeKey) {
          setNoticeKey(game.illegalNoticeKey)
        }
        return false
      }
    },
    [game, corrupt, ready, persist, finalizeLevel],
  )

  const pause = useCallback(() => {
    pausedRef.current = true
    setPaused(true)
    void flush()
  }, [flush])

  const resume = useCallback(() => {
    pausedRef.current = false
    setPaused(false)
  }, [])

  const clearNotice = useCallback(() => setNoticeKey(null), [])

  /**
   * 显式重试：采用存储里当前的提交编号，用本机进度覆盖过去。
   * 这是用户可见的「以我的进度为准」动作，因此可以覆盖；自动路径绝不会这么做。
   */
  const retrySave = useCallback(async () => {
    const envelope = envelopeRef.current
    if (!envelope) return
    const stored = await storage.saves.loadResult(game.id)
    const baseCommitId = stored.status === 'ok' ? stored.envelope.commitId : 0
    await commitNow(reseal({ ...envelope, commitId: baseCommitId }))
  }, [commitNow, storage, game])

  const discardAndRestart = useCallback(async () => {
    await storage.saves.remove(game.id)
    const fresh = newEnvelope(
      {
        gameId: game.id,
        rulesVersion: game.rulesVersion,
        contentVersion: game.contentVersion,
        difficulty,
        seed: 0,
        state: game.encode(game.create(0, difficulty)),
      },
      now(),
    )
    envelopeRef.current = fresh
    elapsedRef.current = 0
    levelStartRef.current = 0
    corruptRef.current = false
    setProgress({})
    setCorrupt(false)
    setState(game.create(0, difficulty))
    setSaveStatus('idle')
  }, [storage, game, difficulty, now])

  // 页面隐藏/退出时强制落盘
  useEffect(() => {
    const onHide = (): void => {
      if (document.visibilityState === 'hidden' && dirtyRef.current) void flush()
    }
    const onPageHide = (): void => {
      if (dirtyRef.current) void flush()
    }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', onPageHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', onPageHide)
    }
  }, [flush])

  const solved = ready && !corrupt && game.status(state) === 'won'
  const view = useMemo<GameView>(() => {
    if (!ready || corrupt) return { board: null, stats: [], result: null, notice: null }
    const base = game.view(state)
    return noticeKey ? { ...base, notice: { textKey: noticeKey } } : base
  }, [game, state, ready, corrupt, noticeKey])

  return {
    ready,
    game,
    state,
    view,
    controls: ready && !corrupt ? game.controls(state) : [],
    saveStatus,
    failureReason,
    noticeKey,
    paused,
    corrupt,
    solved,
    progress,
    elapsedRef,
    levelStartRef,
    clockActive: ready && !paused && !solved && !corrupt,
    dispatch,
    undo: () => dispatch({ type: 'undo' } as unknown as A),
    restart: () => dispatch({ type: 'restart' } as unknown as A),
    nextLevel: () => dispatch({ type: 'nextLevel' } as unknown as A),
    pause,
    resume,
    retrySave,
    clearNotice,
    flush,
    discardAndRestart,
  }
}
