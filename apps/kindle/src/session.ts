/**
 * 对局会话（vanilla ES5 版，语义对齐 packages/ui/src/session.ts）。
 *
 * 契约（与原版逐条对齐，改动都会在这里写明理由）：
 * 1. `reduce` 是唯一的局面入口：撤销 / 重开 / 下一关 / 跳关都是**派发给游戏的动作**
 *    （`{type:'undo'|'restart'|'nextLevel'|'startLevel'}`），不是壳层去改状态 ——
 *    各玩法的撤销栈在自己的 state 里（`log`），壳层再存一份必然对不上。
 * 2. **终局后只放行那四个动作**：否则会出现「记录说已过关、棋盘却已被推乱」的自相矛盾
 *    （真机实测过：推箱子过关后接着推，步数 9 → 14，而 completed 早已写入）。
 * 3. 非法动作必须给明确文字提示（`illegalNoticeKey`），绝不静默；
 *    但「点了一个规则层不产生动作的格子」只在**对局中且没在等自动步进**时提示。
 * 4. 自动步进只由本模块起表；间隔被 MIN_TICK_MS 钳位；玩家每次有效输入重置计时；
 *    `tickActor === 'opponent'` 时玩家的动作不推迟对手（只在对局开始时计一次）。
 * 5. 每一步立即提交存档（不是防抖）：断了只丢当前这一步。
 *
 * 与原版的差异（有意为之，见 docs/kindle.md）：
 * - 没有 pending/committed 两阶段与 CAS（Kindle 单进程单标签，单键写本身原子）；
 * - 存档同步写 localStorage，配额/隐私模式失败时降级为「可玩但不落盘」并明确提示；
 * - 计时器用 `window.setTimeout`（原版用 effect 重建），语义相同。
 */
import {
  IllegalActionError,
  MIN_TICK_MS,
  type ControlSpec,
  type GameDef,
  type GameStatus,
  type GameView,
  type MoveDir,
} from '@eink/core'
import type { SaveEnvelopeV1 } from '@eink/core'
import {
  createSave,
  deleteSave,
  loadProgress,
  loadSave,
  recordOutcome,
  storageAvailable,
  updateSave,
  writeSave,
  type GameProgress,
} from './store.js'

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'failed' | 'corrupt'

/** 壳层动作：撤销 / 重开 / 下一关 / 跳关（由所有玩法共用，不属于各游戏自己的动作联合） */
export type ShellAction =
  | { type: 'undo' }
  | { type: 'restart' }
  | { type: 'nextLevel' }
  | { type: 'startLevel'; levelId: string }

/** 终局后仍然接受的动作（按动作名判断） */
const FINISHED_ACTIONS: Record<string, boolean> = {
  undo: true,
  restart: true,
  nextLevel: true,
  startLevel: true,
}

/** 极矮屏下自动步进的放大系数：停表会让贪吃蛇永远不前进，放大才既看得清又走得动 */
const CRAMPED_TICK_SLOWDOWN = 1.5

export interface SessionOptions<S, A> {
  game: GameDef<S, A>
  difficulty: string
  /** 关卡制玩法的首个内容 id（无关卡传 null）；只用于开局那一次 startLevel */
  startContentId: string | null
  /** 从存档继续（false = 忽略存档开新局） */
  resume: boolean
  /** 是否允许自动步进（设置里可关） */
  autoTick: boolean
  /** 是否需要渲染（状态变了就调一次，由屏幕层重画） */
  onRender: () => void
  /** 顶部状态提示（保存失败 / 坏档） */
  onStatus: (textKey: string | null) => void
  onSaveStatus: (status: SaveStatus) => void
  /** 对局结束（只在第一次跃迁时回调一次） */
  onFinished: (outcome: 'won' | 'lost' | 'draw', view: GameView) => void
}

export interface Session<S, A> {
  game: GameDef<S, A>
  difficulty: string
  state: S
  view: GameView
  controls: ControlSpec[]
  status: GameStatus
  saveStatus: SaveStatus
  noticeKey: string | null
  paused: boolean
  finished: boolean
  solved: boolean
  elapsedMs: number
  progress: GameProgress
  newRecord: boolean
  autoTickMs: number | null
  dispatch(action: A): boolean
  selectCell(index: number): void
  runControl(controlId: string): boolean
  move(dir: MoveDir): void
  steal(slot: number): void
  hasControl(id: string): boolean
  undo(): void
  restart(): void
  restartFresh(): void
  nextLevel(): void
  startLevel(contentId: string): void
  pause(): void
  resume(): void
  retrySave(): void
  clearNotice(): void
  dispose(): void
}

function readContentId<S>(game: GameDef<S, unknown>, state: S, fallback: string): string {
  if (game.contentId) {
    try {
      return game.contentId(state)
    } catch (e) {
      /* 落到兜底 */
    }
  }
  const bag = state as unknown as Record<string, unknown>
  if (bag && typeof bag.levelId === 'string') return bag.levelId
  if (bag && typeof bag.difficulty === 'string') return bag.difficulty
  return fallback
}

function readSeed<S>(state: S): number {
  const bag = state as unknown as Record<string, unknown>
  if (bag && typeof bag.seed === 'number') return bag.seed
  return 0
}

export function createSession<S, A>(options: SessionOptions<S, A>): Session<S, A> {
  const game = options.game
  let difficulty = options.difficulty
  let state: S
  let envelope: SaveEnvelopeV1 | null = null
  let status: GameStatus
  let paused = false
  let disposed = false
  let noticeKey: string | null = null
  let saveStatus: SaveStatus = 'idle'
  let progress: GameProgress = loadProgress()
  let newRecord = false
  let canPersist = storageAvailable()
  let finishedHandled = false
  let clockStart = Date.now()
  let storedElapsed = 0

  // ---------- 载入或新建 ----------
  if (options.resume) {
    const loaded = loadSave(game.id)
    if (loaded.status === 'ok') {
      try {
        state = game.decode(loaded.envelope.state)
        envelope = loaded.envelope
        storedElapsed = loaded.envelope.session.elapsedMs
        const envProgress = loaded.envelope.progress as GameProgress
        if (envProgress && envProgress.completed) progress = envProgress
        difficulty = loaded.envelope.difficulty
      } catch (e) {
        // 存档解不开：**保留原档不覆盖**，本局从新局开始，并明确提示
        state = game.create(0, difficulty)
        envelope = null
        saveStatus = 'corrupt'
        noticeKey = 'shell.storage.corruptHint'
      }
    } else if (loaded.status === 'corrupt') {
      state = game.create(0, difficulty)
      envelope = null
      saveStatus = 'corrupt'
      noticeKey = loaded.reason === 'unsupported-version' ? 'shell.storage.unsupportedHint' : 'shell.storage.corruptHint'
    } else {
      state = game.create(0, difficulty)
    }
  } else {
    state = game.create(0, difficulty)
    // 「开新局」要真的丢掉旧档，否则下次进来又变成「继续」
    deleteSave(game.id)
  }
  status = game.status(state)

  // 关卡制玩法：把玩家选的关卡在开局时派发一次（游戏自己认识 startLevel）
  if (options.startContentId !== null && options.resume === false && game.controlAction !== undefined) {
    // 只有真正支持跳关的玩法才派发；不支持时派发会被 reduce 拒绝并给提示，反而打扰玩家
    try {
      state = game.reduce(state, { type: 'startLevel', levelId: options.startContentId } as unknown as A)
      status = game.status(state)
    } catch (e) {
      /* 该玩法不支持跳关：保持在第一关，不打扰 */
    }
  }

  // ---------- 存档 ----------
  function commit(): void {
    if (disposed && envelope === null) return
    if (!canPersist) {
      saveStatus = 'failed'
      options.onSaveStatus('failed')
      return
    }
    // 坏档在场时不写回：否则会把坏内容「修好校验和」后覆盖掉原档
    if (saveStatus === 'corrupt' && envelope === null) {
      options.onSaveStatus('corrupt')
      return
    }
    options.onSaveStatus('saving')
    const moves = game.movesOf ? safeMoves(game, state) : 0
    const progressBag = progress as unknown as Record<string, unknown>
    if (envelope === null) {
      envelope = createSave(
        game.id,
        game.rulesVersion,
        game.contentVersion,
        difficulty,
        readSeed(state),
        game.encode(state),
        progressBag,
      )
    } else {
      envelope = updateSave(envelope, game.encode(state), moves, progressBag, {
        elapsedMs: storedElapsed + (Date.now() - clockStart),
      })
    }
    saveStatus = writeSave(envelope) ? 'saved' : 'failed'
    options.onSaveStatus(saveStatus)
    if (saveStatus === 'failed') {
      canPersist = false
      options.onStatus('shell.storage.failed')
    }
  }

  function safeMoves(def: GameDef<S, A>, current: S): number {
    try {
      return def.movesOf ? def.movesOf(current) : 0
    } catch (e) {
      return 0
    }
  }

  // ---------- 自动步进 ----------
  let tickTimer: number | null = null
  let activeTickMs: number | null = null

  function stopTick(): void {
    if (tickTimer !== null) {
      window.clearTimeout(tickTimer)
      tickTimer = null
    }
    activeTickMs = null
  }

  function scheduleTick(): void {
    stopTick()
    if (disposed || paused) return
    if (!options.autoTick) return
    if (status !== 'playing') return
    let declared: number | null = null
    try {
      declared = game.tickMs ? game.tickMs(state, difficulty) : null
    } catch (e) {
      declared = null
    }
    if (declared === null || declared === undefined || declared <= 0) return
    // 面板整屏刷新约 2 次/秒：低于 MIN_TICK_MS 的声明一律钳位，否则只剩跳变与残影
    let ms = declared < MIN_TICK_MS ? MIN_TICK_MS : declared
    if (game.tickActor === 'opponent') ms = Math.round(ms * CRAMPED_TICK_SLOWDOWN)
    activeTickMs = ms
    tickTimer = window.setTimeout(function fire(): void {
      tickTimer = null
      if (disposed || paused) return
      if (status !== 'playing') {
        activeTickMs = null
        return
      }
      let next: S
      try {
        next = game.reduce(state, { type: 'tick' } as unknown as A)
      } catch (e) {
        // tick 被拒绝（局面已结束等）：安全停表，不空转
        activeTickMs = null
        return
      }
      state = next
      settle(true)
    }, ms)
  }

  // ---------- 一次成功变更后的统一收尾 ----------
  function settle(fromTick: boolean): void {
    const prev = status
    status = game.status(state)
    if (status !== 'playing' && prev === 'playing') finish()
    commit()
    options.onRender()
    if (fromTick || game.tickActor !== 'opponent') scheduleTick()
    else scheduleTick()
  }

  function finish(): void {
    if (finishedHandled) return
    finishedHandled = true
    let raw: 'won' | 'lost' | 'draw' = status === 'won' ? 'won' : 'lost'
    if (game.outcomeOf) {
      try {
        raw = game.outcomeOf(state)
      } catch (e) {
        /* 保持 status 推出的结果 */
      }
    }
    const contentId = readContentId(game, state, difficulty)
    const moves = safeMoves(game, state)
    let score: number | null = null
    if (game.scoreOf) {
      try {
        score = game.scoreOf(state)
      } catch (e) {
        score = null
      }
    }
    // 平局只写历史：不写通关进度、不写最佳成绩
    const result = recordOutcome(game.id, difficulty, contentId, raw, moves, score)
    progress = result.progress
    newRecord = result.newRecord
    stopTick()
    options.onFinished(raw, game.view(state))
  }

  // ---------- 核心分发 ----------
  function dispatch(action: A): boolean {
    if (disposed) return false
    const actionType = (action as unknown as { type?: string }).type ?? ''
    // 终局后只放行四个壳层动作：棋盘与方向键一律静默拒绝
    if (status !== 'playing' && FINISHED_ACTIONS[actionType] !== true) return false

    let next: S
    try {
      next = game.reduce(state, action)
    } catch (e) {
      if (e instanceof IllegalActionError) {
        noticeKey = game.illegalNoticeKey ?? null
        if (noticeKey) options.onStatus(noticeKey)
        options.onRender()
        return false
      }
      throw e
    }
    if (next === state) return false
    state = next
    if (actionType === 'undo' || actionType === 'restart' || actionType === 'startLevel') {
      // 撤销 / 重开 / 跳关之后局面可能重新变为「进行中」：允许再判一次终局
      finishedHandled = false
      status = game.status(state)
    }
    noticeKey = null
    settle(false)
    return true
  }

  function hasControl(id: string): boolean {
    const controls = game.controls(state)
    for (let i = 0; i < controls.length; i++) {
      if (controls[i].id === id && controls[i].enabled === true) return true
    }
    return false
  }

  const api: Session<S, A> = {
    game: game,
    difficulty: difficulty,
    state: state,
    get view(): GameView {
      return game.view(state)
    },
    get controls(): ControlSpec[] {
      return game.controls(state)
    },
    get status(): GameStatus {
      return status
    },
    get saveStatus(): SaveStatus {
      return saveStatus
    },
    get noticeKey(): string | null {
      return noticeKey
    },
    get paused(): boolean {
      return paused
    },
    get finished(): boolean {
      return status !== 'playing'
    },
    get solved(): boolean {
      return status === 'won'
    },
    get elapsedMs(): number {
      return storedElapsed + (status === 'playing' && !paused ? Date.now() - clockStart : 0)
    },
    get progress(): GameProgress {
      return progress
    },
    get newRecord(): boolean {
      return newRecord
    },
    get autoTickMs(): number | null {
      return activeTickMs
    },
    dispatch: dispatch,

    selectCell(index: number): void {
      if (!game.selectAction) return
      const action = game.selectAction(state, index)
      if (action === null) {
        /*
         * 点了一个规则层不会产生动作的格子（已翻开的雷格、已有棋子的交叉点…）。
         * 只在「对局中且没在等自动步进」时提示 —— 等对手应手时点棋盘多半只是着急，
         * 此时照着 illegalNoticeKey 念（原因其实是"没轮到你"）反而误导。
         */
        if (status === 'playing' && activeTickMs === null && game.illegalNoticeKey) {
          noticeKey = game.illegalNoticeKey
          options.onStatus(noticeKey)
          options.onRender()
        }
        return
      }
      dispatch(action)
    },

    runControl(controlId: string): boolean {
      if (!game.controlAction) return false
      const action = game.controlAction(state, controlId)
      if (action === null) return false
      return dispatch(action)
    },

    move(dir: MoveDir): void {
      // 方向键的动作名由游戏决定（数字华容道是 {type:'slide'}），没映射才回落 {type:'move'}
      if (game.controlAction) {
        const mapped = game.controlAction(state, 'move-' + dir)
        if (mapped !== null) {
          dispatch(mapped)
          return
        }
      }
      dispatch({ type: 'move', dir: dir } as unknown as A)
    },

    steal(slot: number): void {
      if (!game.stealAction) return
      const action = game.stealAction(state, slot)
      if (action === null) return
      dispatch(action)
    },

    hasControl: hasControl,

    undo(): void {
      if (!hasControl('undo')) return
      dispatch({ type: 'undo' } as unknown as A)
    },

    restart(): void {
      dispatch({ type: 'restart' } as unknown as A)
    },

    restartFresh(): void {
      // 换一个种子重新生成：删掉旧档再开新局（跨局战绩不跟着丢）
      deleteSave(game.id)
      envelope = null
      finishedHandled = false
      state = game.create(Math.floor(Math.random() * 2147483647), difficulty)
      status = game.status(state)
      noticeKey = null
      commit()
      options.onRender()
      scheduleTick()
    },

    nextLevel(): void {
      dispatch({ type: 'nextLevel' } as unknown as A)
    },

    startLevel(contentId: string): void {
      dispatch({ type: 'startLevel', levelId: contentId } as unknown as A)
    },

    pause(): void {
      if (paused) return
      paused = true
      storedElapsed += Date.now() - clockStart
      stopTick()
      options.onRender()
    },

    resume(): void {
      if (!paused) return
      paused = false
      clockStart = Date.now()
      options.onRender()
      scheduleTick()
    },

    retrySave(): void {
      canPersist = storageAvailable()
      commit()
    },

    clearNotice(): void {
      noticeKey = null
      options.onStatus(null)
      options.onRender()
    },

    dispose(): void {
      if (disposed) return
      disposed = true
      storedElapsed += Date.now() - clockStart
      stopTick()
      if (canPersist && !(saveStatus === 'corrupt' && envelope === null)) commit()
    },
  }

  clockStart = Date.now()
  scheduleTick()
  return api
}
