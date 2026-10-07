/**
 * 壳层会话：把「游戏规则 + 存档协议 + 输入处理」串起来。
 *
 * 明确的边界（对应验收 C03/C06 与产品规范第 5 条）：
 * - 输入按顺序处理：每个被接受的动作立即产生状态变化，不做整体防抖；
 *   只有持久化做节流（500ms 合并 + 关键节点强制立即提交）。
 * - 界面响应 ≠ 已保存：保存状态单独暴露（保存中 / 已保存 / 失败+重试）。
 * - 被拒绝的输入给出明确文字提示，并且**不进入动作日志**。
 * - 暂停后不接受输入；页面隐藏、离开游戏、关卡结束时强制落盘。
 *
 * 自动步进（贪吃蛇自动前进 / 俄罗斯方块自动下落）：
 * - **定时器只在这里**。规则层依旧是纯函数，只多了一个普通动作 `{ type: 'tick' }`；
 * - 间隔来自 `game.tickMs(state, difficulty)`（返回 null = 当前不该自动步进），
 *   并统一钳到 `MIN_TICK_MS`（400ms）—— 墨水屏一次整屏刷新约 500ms，更快只会看到跳变与残影；
 * - **玩家每次有效输入后重置计时**：否则刚按完就自动走一格，在墨水屏上像"吞输入"；
 * - 暂停 / 结束 / 页面隐藏 / 离开对局一律停表（effect cleanup 保证不泄漏定时器）；
 * - 到点派发的 tick 若被规则拒绝（例如局面已结束），**不弹提示、不崩**，直接安全停表。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  IllegalActionError,
  MIN_TICK_MS,
  applyAction,
  newEnvelope,
  carriedProgress,
  readBestScore,
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

/**
 * 极矮横屏档（棋盘区已被压到不可用）下自动步进的放大系数。
 *
 * 为什么是 1.5 而不是停表：停表会让贪吃蛇**永远不前进**（比自动步进更不可用）；
 * 而 1.5 倍把最慢的俄罗斯方块入门档 1050ms 拉到 1575ms、贪吃蛇三档统一的 700ms 拉到 1050ms ——
 * 仍然快于"一格一次手动按键"，但玩家在 12px 的格子上也来得及看清蛇头与落点。
 */
export const CRAMPED_TICK_SLOWDOWN = 1.5

/**
 * 壳层动作：撤销 / 重开 / 下一关 / 跳关。
 *
 * 这些动作由**壳层**定义、所有玩法共用，不属于各游戏自己的动作联合 `A`，
 * 所以派发时必须在类型上做一次断言。安全性由运行期保证：每个游戏的 reduce 都会明确拒绝
 * 不认识的动作（各游戏包都有对应测试，例如「方向键 / 旧动作名明确报错」）。
 *
 * 抽成具名边界的意义：把"类型系统在此处故意让步"这件事写成一个有名字、有注释的概念，
 * 而不是在四个调用点各写一次 `as unknown as`。
 */
export type ShellAction =
  | { type: 'undo' }
  | { type: 'restart' }
  | { type: 'nextLevel' }
  | { type: 'startLevel'; levelId: string }

function asGameAction<A>(action: ShellAction): A {
  return action as unknown as A
}

/**
 * **终局后仍然接受**的动作（按动作名判断）。
 *
 * 对局一旦结束（过关 / 失败 / 平局），成绩就已经落盘了，此时再改局面会出现
 * 「记录说已过关、棋盘却已经推乱」的自相矛盾 —— 实测：推箱子过关后接着推，
 * 把箱子推出目标点，结果面板消失、步数从 9 涨到 14，而 `completed` 与历史记录早已写入。
 * 因此终局后只放行结果面板与暂停菜单里**真正存在**的入口：撤销（输局专用）、
 * 重开 / 再来一次、下一关、自由选关；棋盘与方向键一律静默拒绝。
 */
const FINISHED_ACTIONS: ReadonlySet<string> = new Set(['undo', 'restart', 'nextLevel', 'startLevel'])

export interface GameProgress {
  completed?: string[]
  bestMoves?: Record<string, number>
  /** 历史记录（最新在前、最多 5 条）；读取一律走 readHistory，坏数据不抛错 */
  history?: HistoryEntry[]
  /** 无尽类玩法的最高纪录（内容 id → 成绩，越大越好，见 GameDef.scoreOf）；跨局继承 */
  bestScore?: Record<string, number>
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
   * 为什么需要：开始新游戏会先删掉旧存档，新存档是新造的 —— 但**跨局战绩不该跟着局面一起丢**。
   * 上层用 `carriedProgress()` 从旧存档里取出历史记录、最高纪录、已通关记录与每关最佳步数，
   * 从这里带进新存档；局面本身照旧从零开始（只有设置页的「清除全部进度」才会真的清空它们）。
   */
  initialProgress?: Record<string, unknown>
  /**
   * 自动步进的减速系数（≥1，缺省 1）。
   *
   * 为什么需要：极矮横屏（实测 BOOX P6Plus 强制横屏 879×407）下棋盘区会被压到几乎为 0、
   * 格子只剩 12px 左右。这种档位下**停表会让贪吃蛇彻底不前进**（比自动步进更不可用），
   * 因此外壳改为把间隔放大，让玩家在看得清之前不至于被"自动"坑死。
   */
  tickSlowdown?: number
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
  /** 刚结束的这一局打破了最高纪录（只在声明了 scoreOf 的玩法里出现；开下一局即复位） */
  newRecord: boolean
  /** 本关已用时（可变引用，由 <Timer> 自己按秒读取，避免整页重渲染） */
  elapsedRef: { current: number }
  /** 本关开始时已累计的用时，用于计算「本关用时」 */
  levelStartRef: { current: number }
  /** 计时是否应该在跑 */
  clockActive: boolean
  /**
   * 实际生效的自动步进间隔（毫秒）；null = 当前没有在自动步进。
   * 暴露出来是为了让"暂停/结束/隐藏是否真的停表"成为可断言、可在真机探针里读到的事实，
   * 而不是靠肉眼观察棋盘。
   */
  autoTickMs: number | null
  dispatch(action: A): boolean
  /** 点格子：交给游戏自己映射成动作（数独/扫雷等格子玩法用）；不可点时为 undefined */
  selectCell?: (index: number) => void
  /** 对决类：抢对手道具的选择（游戏声明了 stealAction 才有） */
  stealCell?: (slot: number) => void
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
  const [newRecord, setNewRecord] = useState(false)

  const envelopeRef = useRef<SaveEnvelope | null>(null)
  const elapsedRef = useRef(0)
  const levelStartRef = useRef(0)
  const pausedRef = useRef(false)
  const corruptRef = useRef(false)
  const dirtyRef = useRef(false)
  const stateRef = useRef(state)
  stateRef.current = state

  /**
   * 自动步进的三个壳层状态：
   * - `tickEpoch`：玩家每次有效输入 +1，作为 effect 依赖 → 定时器被清掉重建，**计时重新开始**；
   * - `tickHalted`：tick 被规则拒绝（例如局面已结束）时置位 → 安全停表，不再空转；
   * - `hidden`：页面隐藏（visibilitychange / pagehide）时置位 → 停表，回到前台再恢复。
   * 三者都是"停表"的正规理由，缺一个都会出现"看不见的地方还在自己走"。
   */
  const [tickEpoch, setTickEpoch] = useState(0)
  const [tickHalted, setTickHalted] = useState(false)
  const tickHaltedRef = useRef(false)
  const [hidden, setHidden] = useState(
    () => typeof document !== 'undefined' && document.visibilityState === 'hidden',
  )

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
        /*
         * 界面状态与存档必须是**同一个**新局面。
         * 原先这里只把新种子写进了存档信封，界面却还停在 useState 的占位局面 `create(0, …)` 上，
         * 于是第一次进入任何游戏看到的都是「种子 0」那一局（扫雷同一张雷图、2048 同一个开局、
         * 斗地主同一副牌），走第一步后存档也被这个种子 0 的局面覆盖 —— 与 nextSeed 的初衷相反。
         */
        const initial = game.create(seed, difficulty)
        setState(initial)
        const fresh = newEnvelope(
          {
            gameId: game.id,
            rulesVersion: game.rulesVersion,
            contentVersion: game.contentVersion,
            difficulty,
            seed,
            state: game.encode(initial),
          },
          now(),
          // 跨局战绩（历史记录 / 最高纪录 / 已通关 / 最佳步数）会被继承，见 SessionOptions.initialProgress
          initialProgress ? { ...initialProgress } : {},
        )
        envelopeRef.current = fresh
        setProgress((fresh.progress ?? {}) as GameProgress)
        setReady(true)
        /*
         * 这里**不**主动提交：新开的一局还没有任何玩家动作，界面处于 idle（"没有需要写入的变化"）。
         * 玩家按返回时会走 pause() → flush() 落盘，因此正常路径不会丢；
         * 只有"开局后直接杀进程"才会丢，代价是下一局换一道题（不涉及任何已完成进度）。
         * 真正会丢进度的是下面的 discardAndRestart（它先把旧档删掉），那一处必须立即提交。
         */
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

  /**
   * 最高纪录（无尽类玩法）：本局成绩比纪录高就更新，并标记「新纪录」。
   * 赢局与输局都要算 —— 无尽模式只会以失败收场。
   */
  const scoreProgress = useCallback(
    (next: S, base: GameProgress): Pick<GameProgress, 'bestScore'> => {
      const score = game.scoreOf?.(next)
      const contentId = game.contentId?.(next) ?? (next as { levelId?: string }).levelId ?? ''
      if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || !contentId) {
        setNewRecord(false)
        return base.bestScore ? { bestScore: base.bestScore } : {}
      }
      const bestScore = readBestScore(base.bestScore)
      const previous = bestScore[contentId]
      const beaten = score > 0 && (previous === undefined || score > previous)
      if (beaten) bestScore[contentId] = Math.floor(score)
      setNewRecord(beaten)
      return { bestScore }
    },
    [game],
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
      const nextProgress: GameProgress = {
        ...progress,
        completed: [...completed],
        bestMoves,
        history,
        ...scoreProgress(next, progress),
      }
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
    [buildHistoryEntry, game, progress, persist, scoreProgress, storage],
  )

  /**
   * 失败/平局的收尾：同样要落盘一条历史记录。
   * 原先失败只是走普通的节流提交，既没有 `ended:'lost'` 标记也不写战绩 —— 历史记录里就只剩胜局了。
   */
  const finalizeLoss = useCallback(
    (next: S) => {
      const history = pushHistory(progress.history, buildHistoryEntry(next, false))
      const nextProgress: GameProgress = { ...progress, history, ...scoreProgress(next, progress) }
      setProgress(nextProgress)
      persist(next, { force: true, progress: nextProgress, ended: 'lost' })
    },
    [buildHistoryEntry, persist, progress, scoreProgress],
  )

  /**
   * 统一的动作执行路径：玩家输入与自动步进走同一条（自动步进只是 `auto = true`）。
   *
   * `auto` 的差别只有两处，都是为了"自动的东西不该像玩家操作"：
   * - 被拒绝时不弹「走不通」提示（没人按任何东西，弹提示会莫名其妙）；
   * - 被拒绝时调用方（定时器）据此安全停表，而不是继续空转。
   */
  const runAction = useCallback(
    (action: A, auto: boolean): boolean => {
      if (pausedRef.current || corrupt || !ready) return false
      const current = stateRef.current
      const kind = action && typeof action === 'object' ? (action as { type?: string }).type : undefined
      // 判一次就够：下面「是否刚刚结束」的跃迁判断复用它（status 对棋类要算合法着法，不便宜）
      const wasPlaying = game.status(current) === 'playing'
      /*
       * 终局守卫：见 FINISHED_ACTIONS 的说明。放在 reduce **之前**，
       * 拒绝时既不写盘也不弹提示（方向键在结果面板上本来就没有意义）。
       * 注意 `auto`（tick）同样被拦下：局面已经结束，自动步进不该再把状态推着走。
       */
      if (!wasPlaying && !(kind !== undefined && FINISHED_ACTIONS.has(kind))) {
        return false
      }
      // 自动步进的计时用「这次操作前后有没有在等自动步进」来判断（见下方 tickActor 分支）
      const pendingBefore = game.tickMs?.(current, difficulty) ?? null
      try {
        const next = game.reduce(current, action)
        const statusNow = game.status(next)
        if (statusNow !== 'playing' && wasPlaying) {
          // 结束（过关或失败）必须在**一次提交**里同时写入「新状态 + 进度 + 历史记录 + 结束标记」：
          // 分两次提交会互相争抢同一个提交编号，后一笔被提交栅栏判为冲突，
          // 结果就是「界面显示过关、存档里却没有进度」。
          // 只在 `playing → 结束` 的跃迁上写历史：重载页面、重复渲染都不会触发，
          // 因此同一局绝不会记两条（pushHistory 还会对完全相同的记录再兜一道）。
          //
          // 平局要按 `outcomeOf` 如实入账：`status` 把平局并入 `won`（为了出结果面板），
          // 但平局**不是**通关 —— 不写 completed / bestMoves，历史记录记成「未获胜」。
          const outcome = game.outcomeOf?.(next) ?? (statusNow === 'won' ? 'won' : 'lost')
          if (outcome === 'won') finalizeLevel(next)
          else finalizeLoss(next)
        } else {
          persist(next, { force: false })
        }
        /*
         * 换关（下一关 / 自由选关）与**重开本关**都要重置本关计时起点：
         * 界面上的「用时」是 `elapsed - levelStart`（本关用时），
         * 少了 `restart` 这一支，重开推箱子/华容道之后用时会把重开前的分钟数继续算进去
         * ——实测 439×847：重开前 0:26、点完"重新开始"立刻显示 0:28，
         * 而对话框上写的是「重开本关会清空当前进度」。本关的记录用时会一并被算大。
         */
        if (kind === 'nextLevel' || kind === 'startLevel' || kind === 'restart') {
          levelStartRef.current = elapsedRef.current
        }
        /*
         * 输入延迟补偿：玩家的**有效**输入成功后重置自动步进的计时，
         * 保证他每次操作之后都拿到完整的一个间隔。
         * 没有这一条，玩家刚按完转向、下一个 tick 就立刻到点，墨水瓶上看起来像"吞输入"。
         * 被拒绝的输入不算有效输入，因此不重置（规则层的提示已经明确告诉他没生效）。
         *
         * 对手应手类（tickActor: 'opponent'）是例外：只有「刚刚轮到对手」这一次重置计时。
         * 否则等待应手期间点自己的棋子、手牌会一次次把电脑的思考往后推 ——
         * 实测连点 3.6 秒，电脑一步不走（等于可以无限拖住对手）。
         */
        if (kind !== 'tick') {
          const pendingAfter = game.tickMs?.(next, difficulty) ?? null
          const startedWaiting = pendingBefore === null && pendingAfter !== null
          if (game.tickActor !== 'opponent' || startedWaiting) {
            setTickEpoch((value) => value + 1)
          }
          // 上一次 tick 被规则拒绝而停过表：玩家又操作了，给他一次恢复的机会
          if (tickHaltedRef.current) {
            tickHaltedRef.current = false
            setTickHalted(false)
          }
        }
        return true
      } catch (error) {
        if (!auto && error instanceof IllegalActionError && game.illegalNoticeKey) {
          setNoticeKey(game.illegalNoticeKey)
        }
        return false
      }
    },
    [game, difficulty, corrupt, ready, persist, finalizeLevel, finalizeLoss],
  )

  /** 玩家输入（含壳层的撤销/重开/换关）：auto = false */
  const dispatch = useCallback((action: A): boolean => runAction(action, false), [runAction])

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
    // 「重开/再来一局」丢掉的是这一局的局面，不是跨局战绩 —— 历史记录、最高纪录、
    // 已通关记录与最佳步数都跟着新存档继续（carriedProgress 的口径）
    const carried: GameProgress = carriedProgress(progress as Record<string, unknown>) as GameProgress
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
    /*
     * 「重新开始」也要**立即落盘**，不能等玩家走下一步。
     *
     * 原先这里只换内存里的信封（并 remove 掉旧档），存档因此处于"空的"状态：
     * 实测（浏览器存档接口）重开后 `loadResult(gameId)` 返回 `empty`，
     * 要等到下一次操作才写入。用户重开一局、还没落子就退出/崩溃 → 这一局凭空消失，
     * 而旧档已经被删掉，等于"重开把进度弄没了"。这与「每一步立即提交」的既有口径不一致。
     */
    setSaveStatus('idle')
    void commitNow(fresh)
  }, [storage, game, difficulty, now, progress, commitNow])

  // 页面隐藏/退出时强制落盘；同时把"隐藏"这件事告诉自动步进（隐藏时必须停表）
  useEffect(() => {
    const sync = (): void => setHidden(document.visibilityState === 'hidden')
    const onHide = (): void => {
      sync()
      if (document.visibilityState === 'hidden' && dirtyRef.current) void flush()
    }
    const onPageHide = (): void => {
      setHidden(true)
      if (dirtyRef.current) void flush()
    }
    // 从后退缓存（bfcache）恢复时页面重新可见，别把表永久停掉
    const onPageShow = (): void => sync()
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', onPageHide)
    window.addEventListener('pageshow', onPageShow)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', onPageHide)
      window.removeEventListener('pageshow', onPageShow)
    }
  }, [flush])

  const status = ready && !corrupt ? game.status(state) : 'playing'

  const solved = status === 'won'

  const finished = status !== 'playing'

  /**
   * 自动步进：间隔由游戏声明，壳层只负责"什么时候该走"。
   *
   * 注意 `game.tickMs` 只在**确实该走**的时候才问游戏：
   * 暂停 / 结束 / 存档损坏 / 页面隐藏 / 已经停过表，一律不启用定时器（连问都不问）。
   */
  const slowdown = options.tickSlowdown && options.tickSlowdown > 1 ? options.tickSlowdown : 1
  const declaredTickMs =
    ready && !corrupt && !paused && !finished && !hidden && !tickHalted
      ? (game.tickMs?.(state, difficulty) ?? null)
      : null
  /**
   * 钳位：任何玩法声明的间隔都不得低于 MIN_TICK_MS（400ms）——
   * 墨水屏一次整屏刷新约 500ms，更快只会看到跳变与残影（见 core/types.ts 的 MIN_TICK_MS）。
   */
  const autoTickMs =
    declaredTickMs === null ? null : Math.max(MIN_TICK_MS, Math.round(declaredTickMs * slowdown))

  // 定时器回调里读最新的 runAction（否则每次 state 变化都要重建定时器，节奏会被打乱）
  const runActionRef = useRef(runAction)
  runActionRef.current = runAction

  useEffect(() => {
    if (autoTickMs === null) return
    const timer = setInterval(() => {
      const ok = runActionRef.current({ type: 'tick' } as unknown as A, true)
      if (!ok) {
        // 规则层拒绝了这一步（例如局面刚好结束）：**不崩、不弹提示**，直接安全停表
        clearInterval(timer)
        tickHaltedRef.current = true
        setTickHalted(true)
      }
    }, autoTickMs)
    // cleanup 覆盖三条路径：暂停/结束/隐藏导致 autoTickMs 变化、输入导致 tickEpoch 变化、离开对局卸载组件
    return () => clearInterval(timer)
  }, [autoTickMs, tickEpoch, difficulty, game.id])

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
    newRecord: newRecord && finished,
    elapsedRef,
    levelStartRef,
    clockActive: ready && !paused && !finished && !corrupt,
    autoTickMs,
    dispatch,
    // 同样只有声明了 stealAction 的游戏才有「抢道具」这条路
    ...(game.stealAction
      ? {
          stealCell: (slot: number) => {
            const action = game.stealAction?.(state, slot)
            if (action) {
              clearNotice()
              dispatch(action)
            }
          },
        }
      : {}),
    // 只有声明了 selectAction 的游戏才把点格子接进来，其余游戏点击格子的行为完全不变
    ...(game.selectAction
      ? {
          selectCell: (index: number) => {
            const action = game.selectAction?.(state, index)
            if (action) {
              // 有效点击要先把上一次的无效提示清掉，否则会出现"牌翻开了、提示还写着点不了"
              clearNotice()
              dispatch(action)
              return
            }
            /*
             * 点了一个规则层**不会产生动作**的格子：已翻开的雷格、已配对/已翻开的牌、
             * 已有棋子的交叉点、够不着的空格…… 这些在规则层都是明确的非法动作
             * （各玩法的 reduce 会抛错），但 selectAction 先返回 null，于是界面静默无响应。
             *
             * 实测（浏览器探针，439×847）：扫雷点已翻开的格子、记忆配对点已翻开的牌、
             * 五子棋点已有棋子的点、华容道点够不着的空格 —— 四个玩法全都一声不响，
             * 而它们的 `illegalNoticeKey` 文案（"这里不能这样操作 / 这里不能这样点 /
             * 这里不能落子 / 这一步滑不过去"）在界面里**根本没有出现的机会**
             * （唯一能触发它的是键盘方向键，那本身又是另一个缺陷）。
             *
             * 因此这里统一补上反馈：文案仍由**游戏包**提供，壳层不硬编码任何玩法文案。
             * 只在"正在对局"时提示：终局后棋盘仍可见，那时的点击不该再弹错误。
             *
             * 还有一类**不该提示**的点击：正在等自动步进的时候（`autoTickMs !== null`）。
             * 此时点棋盘的多半是「对手还没应手就急着点」，而各玩法的提示文案说的是别的原因
             * （五子棋「这里不能落子」实际只是没轮到玩家），照着念反而误导 —— 静默等一拍更诚实。
             * 贪吃蛇 / 俄罗斯方块这类自动前进的玩法没有 selectAction，不受这条影响。
             */
            if (status === 'playing' && autoTickMs === null && game.illegalNoticeKey) {
              setNoticeKey(game.illegalNoticeKey)
            }
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
    undo: () => dispatch(asGameAction<A>({ type: 'undo' })),
    restart: () => dispatch(asGameAction<A>({ type: 'restart' })),
    restartFresh: () => void discardAndRestart(),
    nextLevel: () => dispatch(asGameAction<A>({ type: 'nextLevel' })),
    startLevel: (levelId: string) => dispatch(asGameAction<A>({ type: 'startLevel', levelId })),
    pause,
    resume,
    retrySave,
    clearNotice,
    flush,
    discardAndRestart,
  }
}
