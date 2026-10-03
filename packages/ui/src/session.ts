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
  readHistory,
  reseal,
  toCompletionRecord,
  pushHistory,
  type HistoryEntry,
  type ControlSpec,
  type GameDef,
  type GameView,
  type SaveEnvelope,
  type SaveFailureReason,
} from '@eink/core'
import type { AppStorage } from '@eink/platform'


/**
 * 新一局的种子。
 *
 * 此前两处都写死 `seed: 0` —— 后果是**所有靠种子生成的玩法每局都一模一样**：
 * 扫雷的雷区、迷宫的墙、记忆配对的洗牌、2048 的出块、海战棋的舰队全部固定，
 * 玩家第二次打开就是同一局（实测确认过）。种子会随存档一起保存，
 * 因此"恢复存档时棋盘不变"这条性质不受影响。
 */
function nextSeed(): number {
  // 只用时间戳：一次新开局 = 一个新种子；同毫秒内连点两次也无妨（概率极低且不影响可玩性）
  return Date.now() % 0x7fffffff
}

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'failed'

export interface GameProgress {
  completed?: string[]
  bestMoves?: Record<string, number>
  /** 历史记录（最新在前、最多 5 条）；读取一律走 readHistory，坏数据不抛错 */
  history?: HistoryEntry[]
}

export interface SessionOptions<S, A> {
  game: GameDef<S, A>
  storage: AppStorage
  difficulty: string
  /** 每次成功提交后回调（用于刷新游戏库进度） */
  onCommitted?: (envelope: SaveEnvelope) => void
  now?: () => number
  /**
   * 首次进入（还没有存档）时带进来的进度。
   *
   * 为什么需要：开始新游戏会先删掉旧存档，新存档是新造的 —— 但**历史记录是战绩，不该跟着局面一起丢**。
   * 因此上层把旧存档里的 `history` 通过这里带进来，只有历史记录会被继承，其余进度照旧从零开始。
   */
  initialProgress?: Record<string, unknown>
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
  /**
   * 本局是否已结束（过关 **或失败/平局**）。
   * 与 solved 区分：solved 只表示「过关」（用于记录进度与最佳成绩），
   * finished 用于决定结果面板与计时是否停止 —— 否则失败时没有任何终局反馈。
   */
  finished: boolean
  /**
   * 只读状态的原因：`corrupt`（数据坏了）还是 `unsupported-version`（来自旧规则版本）。
   * 两者对用户的意义完全不同 —— 前者是坏了，后者是需要新版本/导出备份，文案不能混用。
   */
  corruptReason?: 'corrupt' | 'unsupported-version' | undefined
  progress: GameProgress
  /** 本关已用时（可变引用，由 <Timer> 自己按秒读取，避免整页重渲染） */
  elapsedRef: { current: number }
  /** 本关开始时已累计的用时，用于计算「本关用时」 */
  levelStartRef: { current: number }
  /** 计时是否应该在跑 */
  clockActive: boolean
  dispatch(action: A): boolean
  /** 点格子：交给游戏自己映射成动作（数独/扫雷等格子玩法用）；不可点时为 undefined */
  selectCell?: (index: number) => void
  /**
   * 点游戏自定义按钮（数独数字键、扫雷标记模式、方向键等）：交给游戏映射成动作。
   * 返回是否真的派发了动作 —— 壳层据此回退到默认约定（如方向键的 `{type:'move',dir}`）。
   */
  runControl?: (controlId: string) => boolean
  undo(): void
  restart(): void
  /**
   * 「重新开始」的另一种语义：**换一个种子重新生成**（用于无关卡的随机玩法）。
   * 关卡制玩法要用 restart()（回到本关初始局面），别用这个，否则会退回第 1 关。
   */
  restartFresh(): void
  nextLevel(): void
  /** 自由选关：直接跳到指定关卡（详情页点关卡） */
  startLevel(levelId: string): void
  pause(): void
  resume(): void
  retrySave(): void
  clearNotice(): void
  flush(): Promise<void>
  discardAndRestart(): Promise<void>
}


export function useSession<S, A>(options: SessionOptions<S, A>): SessionApi<S, A> {
  const { game, storage, difficulty, onCommitted, initialProgress } = options
  /**
   * `now` 必须稳定：它进的是加载 effect 的依赖数组。
   * 之前写成 `options.now ?? (() => Date.now())`，每次渲染都产生新函数，
   * effect 于是每渲染必重跑，而 effect 里又会 setState 一个**新对象**（decode 的结果），
   * 形成无限重渲染循环 —— 在内存存储上只是空转，走原生桥时会把渲染线程打满，
   * 表现为「触摸没反应、JS 不响应」。真机上才暴露出来，测试用稳定 now 时看不出来。
   */
  const now = useMemo(() => options.now ?? (() => Date.now()), [options.now])

  const [state, setState] = useState<S>(() => game.create(0, difficulty))
  const [ready, setReady] = useState(false)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [failureReason, setFailureReason] = useState<SaveFailureReason | null>(null)
  const [noticeKey, setNoticeKey] = useState<string | null>(null)
  const [paused, setPaused] = useState(false)
  const [corrupt, setCorrupt] = useState(false)
  const [corruptReason, setCorruptReason] = useState<'corrupt' | 'unsupported-version' | undefined>(undefined)
  const [progress, setProgress] = useState<GameProgress>({})

  const envelopeRef = useRef<SaveEnvelope | null>(null)
  const elapsedRef = useRef(0)
  const levelStartRef = useRef(0)
  const pausedRef = useRef(false)
  const corruptRef = useRef(false)
  const dirtyRef = useRef(false)
  const stateRef = useRef(state)
  stateRef.current = state

  /**
   * 串行 + 最新覆盖的提交队列。
   *
   * 为什么不是防抖：「最后一次操作」与「页面被重载/崩溃」之间存在窗口，
   * 窗口内最后一步会丢（WebView 崩溃自愈正是主动重载）。改为每一步立即提交，
   * 用队列保证不会并发提交（并发会让 CAS 判成 conflict 而显示保存失败），
   * 且队列只保留最新一份状态 —— 中间态没必要写盘。
   */
  const queueRef = useRef<SaveEnvelope | null>(null)
  const runningRef = useRef(false)

  const commitOnce = useCallback(
    async (envelope: SaveEnvelope) => {
      // 存档处于损坏/不兼容状态时不得自动写回：否则会把损坏内容「修好校验和」后覆盖掉原档
      if (corruptRef.current) return
      /**
       * 提交前用「最后成功提交的 commitId」重新盖章。
       *
       * 连续快速操作（连按方向键、测试里的见证解法）会基于同一份已提交状态派生出多份存档，
       * 它们的 commitId 都等于当时已提交的那个值；若原样提交，第二份起就会被 CAS 判成
       * conflict（期望 N、实存 M>N），于是「界面在前进、存档却停在旧状态」。
       */
      const lastCommittedId = envelopeRef.current?.commitId ?? 0
      const stamped = envelope.commitId === lastCommittedId ? envelope : reseal({ ...envelope, commitId: lastCommittedId })
      setSaveStatus('saving')
      const result = await storage.saves.commit(stamped)
      if (result.ok) {
        const current = envelopeRef.current
        if (current && current.checksum !== stamped.checksum) {
          // 提交期间状态又前进了：把新的提交编号传递到最新状态，避免下一笔提交被误判为冲突
          envelopeRef.current = reseal({ ...current, commitId: result.commitId })
        } else {
          envelopeRef.current = { ...stamped, commitId: result.commitId }
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

  const commitNow = useCallback(
    async (envelope: SaveEnvelope) => {
      queueRef.current = envelope
      if (runningRef.current) return
      runningRef.current = true
      try {
        while (queueRef.current) {
          const target = queueRef.current
          queueRef.current = null
          await commitOnce(target)
        }
      } finally {
        runningRef.current = false
      }
    },
    [commitOnce],
  )

  const scheduleCommit = useCallback(
    (envelope: SaveEnvelope) => {
      dirtyRef.current = true
      // 立即提交：不再有防抖窗口，最后一步不会因重载/崩溃而丢
      void commitNow(envelope)
    },
    [commitNow],
  )

  const flush = useCallback(async () => {
    const envelope = envelopeRef.current
    if (envelope) await commitNow(envelope)
  }, [commitNow])

  // 载入存档；损坏或规则版本不匹配时进入 corrupt 状态（保留数据，交由界面提示与导出）
  //
  // 每个 (游戏, 难度) 只允许加载一次：用「已加载标识 + 世代号」而不是 cleanup 取消，
  // 避免依赖数组变化时把正在进行的加载取消掉，导致 ready 永远为 false。
  const loadedKeyRef = useRef<string | null>(null)
  const generationRef = useRef(0)
  useEffect(() => {
    const loadKey = `${game.id}:${difficulty}`
    if (loadedKeyRef.current === loadKey) return
    loadedKeyRef.current = loadKey
    const generation = ++generationRef.current
    const isStale = (): boolean => generationRef.current !== generation

    void (async () => {
      const result = await storage.saves.loadResult(game.id)
      if (isStale()) return
      if (result.status === 'empty') {
        const seed = nextSeed()
        const fresh = newEnvelope(
          {
            gameId: game.id,
            rulesVersion: game.rulesVersion,
            contentVersion: game.contentVersion,
            difficulty,
            seed,
            state: game.encode(game.create(seed, difficulty)),
          },
          now(),
          // 只有「历史记录」这类跨局战绩会被继承（见 SessionOptions.initialProgress）
          initialProgress ? { ...initialProgress } : {},
        )
        envelopeRef.current = fresh
        setProgress((fresh.progress ?? {}) as GameProgress)
        setReady(true)
        return
      }
      if (result.status === 'corrupt') {
        // 保留原档、只读可导出；由用户显式决定是否重新开始。
        // status 都是 corrupt，但 reason 可能是「不支持的数据版本」——文案要区分开
        corruptRef.current = true
        setCorrupt(true)
        if (result.reason === 'unsupported-version') setCorruptReason('unsupported-version')
        setReady(true)
        return
      }
      const existing = result.envelope
      envelopeRef.current = existing
      setProgress((existing.progress ?? {}) as GameProgress)
      elapsedRef.current = existing.session.elapsedMs
      /**
       * 界面上显示的是 `elapsed - levelStart`（本关用时）。恢复存档时若把两者都设成已保存值，
       * 差值恒为 0 —— 用户重开应用后会发现「用时」被清零（探索式测试发现）。
       * 这里把本关起点归零，让计时从已保存的总用时继续；进入下一关时再按当时用时重置
       * （见 nextLevel 分支），语义仍然正确。
       */
      levelStartRef.current = 0
      if (existing.rulesVersion !== game.rulesVersion) {
        // 规则版本变了：这不是「数据损坏」，而是旧存档需要被明确说明（并保留原档可导出）
        corruptRef.current = true
        setCorrupt(true)
        setCorruptReason('unsupported-version')
        setReady(true)
        return
      }
      try {
        const decoded = game.decode(existing.state)
        if (isStale()) return
        setState(decoded)
        setReady(true)
      } catch {
        corruptRef.current = true
        setCorrupt(true)
        setReady(true)
      }
    })()
  }, [game, storage, difficulty, now, initialProgress])

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
      else scheduleCommit(updated)
    },
    [game, now, commitNow, scheduleCommit],
  )

  /**
   * 本局战绩（历史记录用）：难度取当前会话难度，步数/用时取游戏自己声明的口径。
   * 拿不到就记 0 —— 历史记录必须是"能写进去"的，不能因为某个玩法没声明计步就整条丢掉。
   */
  const buildHistoryEntry = useCallback(
    (next: S, won: boolean): HistoryEntry => {
      const rawMoves = game.movesOf?.(next) ?? (next as { moves?: number }).moves
      const moves =
        typeof rawMoves === 'number' && Number.isFinite(rawMoves) && rawMoves > 0
          ? Math.floor(rawMoves)
          : 0
      const elapsedMs = elapsedRef.current - levelStartRef.current
      const seconds =
        Number.isFinite(elapsedMs) && elapsedMs > 0 ? Math.round(elapsedMs / 1000) : 0
      return { difficulty, moves, seconds, won, at: now() }
    },
    [difficulty, game, now],
  )

  const finalizeLevel = useCallback(
    (next: S) => {
      // 内容 id 与计步都由游戏自己声明（原先硬编码 sokoban.stat.moves 与 state.levelId，
      // 导致无关卡游戏通关会写入 completed:[''] 与 0 步的最佳成绩）
      const levelId = game.contentId?.(next) ?? (next as { levelId?: string }).levelId ?? ''
      const moves = game.movesOf?.(next) ?? (next as { moves?: number }).moves
      const completed = new Set(progress.completed ?? [])
      if (levelId) completed.add(levelId)
      const bestMoves = { ...(progress.bestMoves ?? {}) }
      if (
        levelId &&
        typeof moves === 'number' &&
        Number.isFinite(moves) &&
        (bestMoves[levelId] === undefined || moves < bestMoves[levelId]!)
      ) {
        bestMoves[levelId] = moves
      }
      // 历史记录与「完成进度」写在同一笔提交里：分两次提交会争抢同一个提交编号（见 dispatch 里的注释）
      const history = pushHistory(progress.history, buildHistoryEntry(next, true))
      const nextProgress: GameProgress = { completed: [...completed], bestMoves, history }
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
    [buildHistoryEntry, game, progress, persist, storage],
  )

  /**
   * 失败/平局的收尾：同样要落盘一条历史记录。
   * 原先失败只是走普通的节流提交，既没有 `ended:'lost'` 标记也不写战绩 —— 历史记录里就只剩胜局了。
   */
  const finalizeLoss = useCallback(
    (next: S) => {
      const history = pushHistory(progress.history, buildHistoryEntry(next, false))
      const nextProgress: GameProgress = { ...progress, history }
      setProgress(nextProgress)
      persist(next, { force: true, progress: nextProgress, ended: 'lost' })
    },
    [buildHistoryEntry, persist, progress],
  )

  const dispatch = useCallback(
    (action: A): boolean => {
      if (pausedRef.current || corrupt || !ready) return false
      try {
        const current = stateRef.current
        const next = game.reduce(current, action)
        const statusNow = game.status(next)
        const wasPlaying = game.status(current) === 'playing'
        if (statusNow !== 'playing' && wasPlaying) {
          // 结束（过关或失败）必须在**一次提交**里同时写入「新状态 + 进度 + 历史记录 + 结束标记」：
          // 分两次提交会互相争抢同一个提交编号，后一笔被提交栅栏判为冲突，
          // 结果就是「界面显示过关、存档里却没有进度」。
          // 只在 `playing → 结束` 的跃迁上写历史：重载页面、重复渲染都不会触发，
          // 因此同一局绝不会记两条（pushHistory 还会对完全相同的记录再兜一道）。
          if (statusNow === 'won') finalizeLevel(next)
          else finalizeLoss(next)
        } else {
          persist(next, { force: false })
        }
        const kind = action && typeof action === 'object' ? (action as { type?: string }).type : undefined
        // 换关（下一关 / 自由选关）都要重置本关计时起点，否则用时会把上一关的算进来
        if (kind === 'nextLevel' || kind === 'startLevel') {
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
    [game, corrupt, ready, persist, finalizeLevel, finalizeLoss],
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
    const seed = nextSeed()
    // 「重开/再来一局」丢掉的是这一局的局面，不是历史战绩 —— 历史记录跟着新存档继续
    const carried: GameProgress = { history: readHistory(progress.history) }
    const fresh = newEnvelope(
      {
        gameId: game.id,
        rulesVersion: game.rulesVersion,
        contentVersion: game.contentVersion,
        difficulty,
        seed,
        state: game.encode(game.create(seed, difficulty)),
      },
      now(),
      carried as Record<string, unknown>,
    )
    envelopeRef.current = fresh
    elapsedRef.current = 0
    levelStartRef.current = 0
    corruptRef.current = false
    setProgress(carried)
    setCorrupt(false)
    /*
     * 必须用**同一个新种子**生成界面状态。
     * 这里原先写的是 `game.create(0, difficulty)` —— 存档里是新的 seed，界面却是用字面量 0 生成的，
     * 于是"重新开始"永远显示同一道题（用户反馈："扫雷在我点重新开始后不是新的题目"）。
     * 和之前"两处都写死 seed: 0"是同一类错误，这次漏的是第三处。
     */
    setState(game.create(seed, difficulty))
    setSaveStatus('idle')
  }, [storage, game, difficulty, now, progress])

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

  const status = ready && !corrupt ? game.status(state) : 'playing'

  const solved = status === 'won'

  const finished = status !== 'playing'
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
    corruptReason,
    solved,
    finished,
    progress,
    elapsedRef,
    levelStartRef,
    clockActive: ready && !paused && !finished && !corrupt,
    dispatch,
    // 只有声明了 selectAction 的游戏才把点格子接进来，其余游戏点击格子的行为完全不变
    ...(game.selectAction
      ? {
          selectCell: (index: number) => {
            const action = game.selectAction?.(state, index)
            if (action) dispatch(action)
          },
        }
      : {}),
    ...(game.controlAction
      ? {
          runControl: (controlId: string) => {
            const action = game.controlAction?.(state, controlId)
            if (!action) return false
            return dispatch(action)
          },
        }
      : {}),
    undo: () => dispatch({ type: 'undo' } as unknown as A),
    restart: () => dispatch({ type: 'restart' } as unknown as A),
    restartFresh: () => void discardAndRestart(),
    nextLevel: () => dispatch({ type: 'nextLevel' } as unknown as A),
    startLevel: (levelId: string) => dispatch({ type: 'startLevel', levelId } as unknown as A),
    pause,
    resume,
    retrySave,
    clearNotice,
    flush,
    discardAndRestart,
  }
}
