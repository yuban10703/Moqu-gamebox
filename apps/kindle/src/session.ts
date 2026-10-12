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
  type WriteFailure,
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
  /** 顶部状态提示（缺键由壳层翻译；会话只给 key） */
  onStatus: (textKey: string | null) => void
  onSaveStatus: (status: SaveStatus) => void
  /**
   * 存档写不进去时回调，参数是**事实**而不是文案：
   * `unavailable` = 这台设备/这个浏览器根本不让写（隐私模式等）；
   * `quota` = 空间满了；`io` = 其它写失败。
   * 措辞由壳层决定（会话没有 i18n，也不该硬编码文案 key 之外的东西）。
   */
  onSaveFailed: (reason: 'unavailable' | WriteFailure) => void
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
  /** 当前内容 id（关卡制 = 关卡 id；无关卡 = 难度 id）。标题与最佳成绩都按它取。 */
  contentId(): string
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

/**
 * 判断一个异常是不是「按规则的非法动作」。
 *
 * **不能只靠 `instanceof`**：`tsc --target ES5` 把 `class extends Error` 降级后
 * 原型链是断的（`Error.call(this)` 返回新对象），`instanceof` 恒为 false ——
 * 那样每个非法输入都会变成未捕获异常抛出去（真机表现：点了没反应 + 控制台报错）。
 * core 里已经用 `linkErrorSubclass` 接回了原型，这里再按"名字 + 字段"兜一道，
 * 两道都过不了才当成真 bug 抛出去。
 */
function isIllegalAction(error: unknown): boolean {
  if (error instanceof IllegalActionError) return true
  if (error === null || typeof error !== 'object') return false
  const bag = error as { name?: unknown; gameId?: unknown; reason?: unknown }
  return bag.name === 'IllegalActionError' && typeof bag.gameId === 'string' && typeof bag.reason === 'string'
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

/**
 * 新一局的种子。
 *
 * 这里原先四处都写死 `game.create(0, difficulty)` —— 后果不是"稍微单调"，
 * 而是**所有靠种子生成的玩法每一局完全一样**：扫雷的雷区、记忆配对的洗牌、
 * 2048 的出块、斗地主的牌、恶魔轮盘赌的装填顺序全部固定，玩家第二次打开还是同一局。
 *
 * 更糟的是 core 的 mulberry32 里有一句 `state = (seed >>> 0) || 0x9e3779b9`
 * —— 种子 0 会落到那个固定常量上，所以"种子 0"不是"某一个随机局"，而是"唯一那一局"。
 *
 * 种子会跟着存档一起写进信封，因此"读档时棋盘不变"这条性质不受影响：
 * 只有**开新局**（含重开、跳关）才换种子。
 */
function nextSeed(): number {
  return Date.now() % 0x7fffffff
}

export function createSession<S, A>(options: SessionOptions<S, A>): Session<S, A> {
  const game = options.game
  let difficulty = options.difficulty
  // 由 startNewGame() / 读档分支负责赋值；用确定赋值断言让类型检查认账
  let state!: S
  let envelope: SaveEnvelopeV1 | null = null
  let status: GameStatus
  let paused = false
  let disposed = false
  let noticeKey: string | null = null
  let saveStatus: SaveStatus = 'idle'
  let progress: GameProgress = loadProgress()
  let newRecord = false
  let canPersist = storageAvailable()
  // 本局实际使用的种子：新局时取新种子，读档时沿用存档里的
  let currentSeed = 0
  let finishedHandled = false
  let clockStart = Date.now()
  let storedElapsed = 0

  /**
   * 开新局。
   *
   * 必须**只经过这一个入口** —— 现代版当初就踩过"存档里写了新种子、界面却还是
   * 用字面量 0 生成的局面"的坑（同一个错误在两处修过、第三处又漏了）。
   * 这里把"取种子"和"建局面"绑死，就不会再出现两者不一致。
   */
  function startNewGame(): void {
    currentSeed = nextSeed()
    state = game.create(currentSeed, difficulty)
  }

  // ---------- 载入或新建 ----------
  if (options.resume) {
    const loaded = loadSave(game.id)
    if (loaded.status === 'ok') {
      try {
        state = game.decode(loaded.envelope.state)
        envelope = loaded.envelope
        // 读档：沿用存档里的种子，棋盘与离开时完全一致
        currentSeed = loaded.envelope.seed
        storedElapsed = loaded.envelope.session.elapsedMs
        const envProgress = loaded.envelope.progress as GameProgress
        if (envProgress && envProgress.completed) progress = envProgress
        difficulty = loaded.envelope.difficulty
      } catch (e) {
        // 存档解不开：**保留原档不覆盖**，本局从新局开始，并明确提示
        startNewGame()
        envelope = null
        saveStatus = 'corrupt'
        noticeKey = 'shell.storage.corruptHint'
      }
    } else if (loaded.status === 'corrupt') {
      startNewGame()
      envelope = null
      saveStatus = 'corrupt'
      noticeKey = loaded.reason === 'unsupported-version' ? 'shell.storage.unsupportedHint' : 'shell.storage.corruptHint'
    } else {
      startNewGame()
    }
  } else {
    startNewGame()
    // 「开新局」要真的丢掉旧档，否则下次进来又变成「继续」
    deleteSave(game.id)
  }
  status = game.status(state)

  /*
   * 一开始就知道写不进去的（隐私模式 / 禁用存储）：**立刻说**。
   * 等到第一次落盘才报的话，玩家已经先玩了一会儿才开始被告知 ——
   * 而这类问题不会自己好，越早说越好。
   */
  if (!canPersist) {
    saveStatus = 'failed'
    options.onSaveFailed('unavailable')
  }

  /*
   * 关卡制玩法：开局时把玩家选的那一关派发一次（游戏自己认识 startLevel）。
   *
   * 这里**不能**用 `game.controlAction !== undefined` 当前置条件 —— 推箱子既支持
   * `{type:'startLevel'}`、又没有 controlAction，于是玩家在详情页选了第 4 关，
   * 进去永远是第 1 关：界面上没有任何报错，只是"选了没用"。
   * （klotski 恰好有 controlAction，所以只有推箱子中招，更难发现。）
   *
   * 正确做法是不预判能力，直接派发、让规则层拒绝：
   * 不支持的玩法会抛 IllegalActionError，接住即可，玩家无感。
   */
  if (options.startContentId !== null && options.resume === false) {
    try {
      state = game.reduce(state, { type: 'startLevel', levelId: options.startContentId } as unknown as A)
      status = game.status(state)
    } catch (e) {
      /* 该玩法不支持跳关（或关卡 id 不认）：保持在第一关，不打扰玩家 */
    }
  }

  /**
   * 当前累计用时。暂停/终局/坏档时**停表**（不随挂机增长）。
   *
   * 原先三处各自手算且口径不一（getter 看 status，commit 用
   * `storedElapsed + (now - clockStart)`，dispose 再加一遍）：
   *   · commit 在暂停期间仍会算上暂停时长；
   *   · dispose 在暂停后把同一段时间**再**算一遍（玩 1 分钟 + 暂停 5 分钟 = 记 11 分钟）；
   *   · 终局后停在结果页多久，离开时就会多算多久。
   * 现在只有这一处知道"表在不在走"，其余一律取它。
   */
  function clockActive(): boolean {
    return status === 'playing' && !paused
  }

  function elapsedNow(): number {
    return storedElapsed + (clockActive() ? Date.now() - clockStart : 0)
  }

  // ---------- 存档 ----------
  function commit(): void {
    if (disposed && envelope === null) return
    if (!canPersist) {
      // 一开局就写不进去：必须立刻说出来，否则玩家会玩很久才发现进度全丢
      saveStatus = 'failed'
      options.onSaveStatus('failed')
      options.onSaveFailed('unavailable')
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
        currentSeed,
        game.encode(state),
        progressBag,
      )
    } else {
      envelope = updateSave(envelope, game.encode(state), moves, progressBag, {
        elapsedMs: elapsedNow(),
      })
    }
    const written = writeSave(envelope)
    saveStatus = written.ok ? 'saved' : 'failed'
    options.onSaveStatus(saveStatus)
    if (!written.ok) {
      // 不在失败后就把 canPersist 关掉：空间可能只是暂时满了，
      // 关掉之后连"重试"都没机会。让玩家点重试再试一次。
      options.onSaveFailed(written.reason)
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
    // 收尾后重新排程；两类玩法（自己步进 / 对手在 tick 里应手）走的都是同一条路，
    // 原先这里的 if/else 两支一字不差，只会误导读者以为对手玩法有特殊节奏
    void fromTick
    scheduleTick()
  }

  function finish(): void {
    if (finishedHandled) return
    finishedHandled = true
    /*
     * 终局把表**定格**：status 不再是 playing，clockActive() 为 false，
     * 之后停在结果面板多久，「用时」都不会继续涨
     * （这一次 settle 里马上还有一次 commit，定格要发生在它之前）。
     */
    storedElapsed = elapsedNow()
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

  /**
   * 设置提示并**通知壳层**。
   *
   * 之前只改 `noticeKey` 不回调，于是界面上的提示一旦出现就永远留在那里：
   * 「这里不能这样点」在玩家后续成功走了好几步之后还挂在屏幕顶上 ——
   * 在一个"每一步都要重画"的界面上，这种陈旧信息比没有提示更误导。
   */
  function setNotice(key: string | null): void {
    if (noticeKey === key) return
    noticeKey = key
    options.onStatus(key)
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
      if (isIllegalAction(e)) {
        setNotice(game.illegalNoticeKey ?? null)
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
    setNotice(null)
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
      /*
       * 「是否算通关」：**优先用玩法如实上报的 outcomeOf**，而不是只认 status。
       * 棋类把和局并进了 status()==='won'（只为让结果面板出现），但和局不是通关 ——
       * 只看 status 会把和局玩家挡在撤销门外（输局/和局才给撤销）。
       * 与 React 版 session.solved 同一条口径（outcomeOf 优先，缺钩子的玩法看 status）。
       */
      if (game.outcomeOf) {
        try {
          return game.outcomeOf(state) === 'won'
        } catch (e) {
          /* 读取失败就退回 status */
        }
      }
      return status === 'won'
    },
    get elapsedMs(): number {
      return elapsedNow()
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
          setNotice(game.illegalNoticeKey)
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

    contentId: function contentId(): string {
      return readContentId(game, state, difficulty)
    },

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
      startNewGame()
      /*
       * 计时归零。
       * 「重开」现在会走到这里（无关卡玩法都是换新一局），不归零的话新局的
       * 「用时」会带上上一局的时间 —— 玩家看到刚开局就显示 3 分钟，只会以为坏了。
       */
      storedElapsed = 0
      clockStart = Date.now()
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
      setNotice(null)
      options.onRender()
    },

    dispose(): void {
      if (disposed) return
      disposed = true
      /*
       * 只在**没在暂停**时才把这一段的用时并入。
       * pause() 已经把当前这一段累计进 storedElapsed，但**没有**重置 clockStart
       * （要等 resume() 才重置）—— 如果这里不区分，暂停期间流逝的时间会被再算一次：
       * 玩 1 分钟、暂停 5 分钟、离开，存档里记成 11 分钟。
       */
      if (!paused) storedElapsed += Date.now() - clockStart
      stopTick()
      if (canPersist && !(saveStatus === 'corrupt' && envelope === null)) commit()
    },
  }

  clockStart = Date.now()
  scheduleTick()
  return api
}
