/**
 * Kindle 侧存储层：localStorage + core 的存档信封（save.ts）。
 *
 * 与 Web / Android 的关系：
 * - **信封格式完全一致**（同一个 `save.ts` 的 `newEnvelope` / `reseal` / `parseEnvelope`），
 *   所以存档可以跨端导入导出；
 * - **不做两阶段提交（pending/committed）与 CAS**：那套协议解决的是「多标签页/多端并发写」，
 *   Kindle 浏览器单进程单标签，`localStorage.setItem` 对单键本身就是原子的。
 *   代价与边界写在 docs/kindle.md 里，不假装等价。
 */
import {
  parseEnvelope,
  newEnvelope,
  reseal,
  type SaveEnvelope,
  type SaveEnvelopeV1,
} from '@eink/core'

const NS = 'moqu:1'
const KEY_SETTINGS = NS + ':settings'
const KEY_PROGRESS = NS + ':progress'
const SAVE_PREFIX = NS + ':save:'

/** 设置（Kindle 版只保留真正生效的项） */
export interface KindleSettings {
  locale: 'zh-CN' | 'en-US'
  /** 方向键是否显示（点格子的玩法可以关掉，把屏幕让给棋盘） */
  dpad: boolean
  /** 棋盘最大边长（像素），0 = 跟随屏幕 */
  boardMax: number
  /** 是否允许自动步进（贪吃蛇/俄罗斯方块/对手应手） */
  autoTick: boolean
  /** 灰度模拟（老引擎不支持 CSS 变量时的兜底；本版本恒为纯黑白） */
  highContrast: boolean
}

export const DEFAULT_SETTINGS: KindleSettings = {
  locale: 'zh-CN',
  dpad: true,
  boardMax: 0,
  autoTick: true,
  highContrast: false,
}

/** 跨局战绩（与 Web 端的 GameProgress 同名字段，便于互相导入） */
export interface GameProgress {
  completed?: string[]
  bestMoves?: Record<string, number>
  bestScore?: Record<string, number>
  history?: Array<{ gameId: string; difficulty: string; outcome: string; moves: number; at: number }>
}

function readRaw(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch (e) {
    return null
  }
}

function writeRaw(key: string, value: string): boolean {
  try {
    window.localStorage.setItem(key, value)
    return true
  } catch (e) {
    return false
  }
}

function removeRaw(key: string): void {
  try {
    window.localStorage.removeItem(key)
  } catch (e) {
    /* 忽略：删除失败不影响游戏继续 */
  }
}

function allKeys(prefix: string): string[] {
  const out: string[] = []
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i)
      if (key && key.indexOf(prefix) === 0) out.push(key)
    }
  } catch (e) {
    /* 忽略 */
  }
  return out
}

// ---------- 设置 ----------
export function loadSettings(): KindleSettings {
  const raw = readRaw(KEY_SETTINGS)
  if (!raw) return DEFAULT_SETTINGS
  let parsed: Partial<KindleSettings>
  try {
    parsed = JSON.parse(raw) as Partial<KindleSettings>
  } catch (e) {
    return DEFAULT_SETTINGS
  }
  const merged: KindleSettings = {
    locale: DEFAULT_SETTINGS.locale,
    dpad: DEFAULT_SETTINGS.dpad,
    boardMax: DEFAULT_SETTINGS.boardMax,
    autoTick: DEFAULT_SETTINGS.autoTick,
    highContrast: DEFAULT_SETTINGS.highContrast,
  }
  /*
   * 逐项**校验类型**再收下：这里是用户数据的入口，localStorage 里的值可能来自
   * 旧版本或被改过 —— 例如 locale 若被写成不认识的语言，i18n 会整页落到 fallback，
   * 设置页也显示不出当前语言。坏值一律退回默认值，而不是原样带进壳层。
   */
  if (parsed.locale === 'zh-CN' || parsed.locale === 'en-US') merged.locale = parsed.locale
  if (typeof parsed.dpad === 'boolean') merged.dpad = parsed.dpad
  if (typeof parsed.autoTick === 'boolean') merged.autoTick = parsed.autoTick
  if (typeof parsed.highContrast === 'boolean') merged.highContrast = parsed.highContrast
  if (typeof parsed.boardMax === 'number' && Number.isFinite(parsed.boardMax) && parsed.boardMax >= 0) {
    merged.boardMax = parsed.boardMax
  }
  return merged
}

export function saveSettings(settings: KindleSettings): boolean {
  return writeRaw(KEY_SETTINGS, JSON.stringify(settings))
}

// ---------- 战绩 ----------
export function loadProgress(): GameProgress {
  const raw = readRaw(KEY_PROGRESS)
  if (!raw) return {}
  try {
    return JSON.parse(raw) as GameProgress
  } catch (e) {
    return {}
  }
}

export function saveProgress(progress: GameProgress): boolean {
  return writeRaw(KEY_PROGRESS, JSON.stringify(progress))
}

/** 记录一次对局结束：过关写 completed + 最佳步数，失败只写历史。 */
export function recordOutcome(
  gameId: string,
  difficulty: string,
  contentId: string,
  outcome: 'won' | 'lost' | 'draw',
  moves: number,
  score: number | null,
): { progress: GameProgress; newRecord: boolean } {
  const progress = loadProgress()
  const completed = progress.completed ? progress.completed.slice(0) : []
  const bestMoves: Record<string, number> = {}
  const bestScore: Record<string, number> = {}
  for (const k in progress.bestMoves ?? {}) bestMoves[k] = (progress.bestMoves ?? {})[k]
  for (const k in progress.bestScore ?? {}) bestScore[k] = (progress.bestScore ?? {})[k]
  const history = (progress.history ?? []).slice(0)

  let newRecord = false
  if (outcome === 'won' && contentId) {
    if (completed.indexOf(contentId) < 0) completed.push(contentId)
    const prevMoves = bestMoves[contentId]
    if (prevMoves === undefined || (typeof moves === 'number' && Number.isFinite(moves) && moves < prevMoves)) {
      bestMoves[contentId] = moves
    }
  }
  if (
    contentId &&
    typeof score === 'number' &&
    Number.isFinite(score) &&
    score >= 0
  ) {
    /*
     * 破纪录语义与现代版一致：**第一次拿到正分也算破纪录**（此前"必须先有旧纪录"，
     * 于是无限模式的第 1 轮赢了不显示"新纪录"，第 2 轮反而显示）。
     * 入库前取整（分数来自玩法，可能与"轮数"一样本就是整数，但别依赖这一点）。
     */
    const clean = Math.floor(score)
    const prevScore = bestScore[contentId]
    const beaten = clean > 0 && (prevScore === undefined || clean > prevScore)
    if (beaten) {
      bestScore[contentId] = clean
      newRecord = true
    }
  }
  history.unshift({ gameId: gameId, difficulty: difficulty, outcome: outcome, moves: moves, at: Date.now() })
  while (history.length > 5) history.pop()

  const next: GameProgress = {
    completed: completed,
    bestMoves: bestMoves,
    bestScore: bestScore,
    history: history,
  }
  saveProgress(next)
  return { progress: next, newRecord: newRecord }
}

// ---------- 存档信封 ----------
export type LoadResult =
  | { status: 'ok'; envelope: SaveEnvelopeV1 }
  | { status: 'empty' }
  | { status: 'corrupt'; reason: 'corrupt' | 'unsupported-version' }

function saveKey(gameId: string): string {
  return SAVE_PREFIX + gameId
}

/** 读存档：区分「没有」「有」「坏了」，坏了绝不静默覆盖（与 Web 端口径一致）。 */
export function loadSave(gameId: string): LoadResult {
  const raw = readRaw(saveKey(gameId))
  if (raw === null) return { status: 'empty' }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    return { status: 'corrupt', reason: 'corrupt' }
  }
  const result = parseEnvelope(parsed)
  if (result.ok) return { status: 'ok', envelope: result.envelope }
  const reason = 'reason' in result ? result.reason : 'corrupt'
  return {
    status: 'corrupt',
    reason: reason === 'unsupported-version' ? 'unsupported-version' : 'corrupt',
  }
}

export type WriteFailure = 'quota' | 'io'

/**
 * 写存档。失败时**带上原因**：界面要据此说明白"是空间满了还是别的"，
 * 只说"保存失败"用户不知道该怎么办。
 */
export function writeSave(envelope: SaveEnvelopeV1): { ok: true } | { ok: false; reason: WriteFailure } {
  try {
    window.localStorage.setItem(saveKey(envelope.gameId), JSON.stringify(envelope))
    return { ok: true }
  } catch (e) {
    const name = e && typeof e === 'object' && 'name' in e ? String((e as { name: unknown }).name) : ''
    const message = e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : ''
    const quota = /quota|exceed|full/i.test(name + ' ' + message)
    return { ok: false, reason: quota ? 'quota' : 'io' }
  }
}

export function deleteSave(gameId: string): void {
  removeRaw(saveKey(gameId))
}

/** 新建一份存档（局面从零开始，跨局战绩从 progress 带进来） */
export function createSave(
  gameId: string,
  rulesVersion: number,
  contentVersion: number,
  difficulty: string,
  seed: number,
  state: unknown,
  progress: Record<string, unknown>,
): SaveEnvelopeV1 {
  return newEnvelope(
    {
      gameId: gameId,
      rulesVersion: rulesVersion,
      contentVersion: contentVersion,
      difficulty: difficulty,
      seed: seed,
      state: state,
    },
    Date.now(),
    progress,
  )
}

/** 用最新局面重新盖章（commitId 递增，checksum 重算） */
export function updateSave(
  envelope: SaveEnvelopeV1,
  state: unknown,
  moves: number,
  progress: Record<string, unknown>,
  session: { elapsedMs?: number; undos?: number; restarts?: number; hintsUsed?: number },
): SaveEnvelopeV1 {
  // checksum 先沿用旧值：reseal 会把它摘掉重算，这里只是为了满足类型
  const base: SaveEnvelopeV1 = {
    schema: envelope.schema,
    checksum: envelope.checksum,
    gameId: envelope.gameId,
    rulesVersion: envelope.rulesVersion,
    contentVersion: envelope.contentVersion,
    difficulty: envelope.difficulty,
    seed: envelope.seed,
    state: state,
    moves: moves,
    session: {
      elapsedMs: session.elapsedMs !== undefined ? session.elapsedMs : envelope.session.elapsedMs,
      undos: session.undos !== undefined ? session.undos : envelope.session.undos,
      restarts: session.restarts !== undefined ? session.restarts : envelope.session.restarts,
      hintsUsed: session.hintsUsed !== undefined ? session.hintsUsed : envelope.session.hintsUsed,
    },
    progress: progress,
    updatedAt: Date.now(),
    commitId: envelope.commitId + 1,
  }
  return reseal(base)
}

export function listSaves(): Array<{ gameId: string; difficulty: string; updatedAt: number; moves: number }> {
  const keys = allKeys(SAVE_PREFIX)
  const out: Array<{ gameId: string; difficulty: string; updatedAt: number; moves: number }> = []
  for (let i = 0; i < keys.length; i++) {
    const raw = readRaw(keys[i])
    if (!raw) continue
    try {
      const env = JSON.parse(raw) as SaveEnvelope
      out.push({
        gameId: env.gameId,
        difficulty: env.difficulty,
        updatedAt: env.updatedAt,
        moves: env.moves,
      })
    } catch (e) {
      /* 坏档跳过：设置页的「导出」仍能拿到原文 */
    }
  }
  return out
}

/** 诊断/导出用：把所有原始文本读出来（含坏档） */
export function rawSaves(): Array<{ key: string; text: string }> {
  const keys = allKeys(SAVE_PREFIX)
  const out: Array<{ key: string; text: string }> = []
  for (let i = 0; i < keys.length; i++) {
    out.push({ key: keys[i], text: readRaw(keys[i]) ?? '' })
  }
  return out
}

export function clearAll(): void {
  const keys = allKeys(NS + ':')
  for (let i = 0; i < keys.length; i++) removeRaw(keys[i])
}

/** 可用性探测：localStorage 不可用（隐私模式/配额满）时要能提前发现并提示 */
export function storageAvailable(): boolean {
  try {
    const probe = NS + ':probe'
    window.localStorage.setItem(probe, '1')
    window.localStorage.removeItem(probe)
    return true
  } catch (e) {
    return false
  }
}
