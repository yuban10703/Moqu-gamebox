/**
 * 历史记录：一局结束后的水单（难度 / 步数 / 用时 / 胜负 / 时间）。
 *
 * 存在 `SaveEnvelope.progress.history` 里 —— 也就是**跟着存档走**，而不是另开一份存储。
 *
 * 两条硬性约定（本项目出过"decode 拒绝自己状态"的事故，这里必须同样保守）：
 * 1. **绝不因为旧数据而抛错**：`readHistory` 对缺失、类型不对、字段缺失的记录一律宽容处理，
 *    坏记录丢掉、整体不是数组就当空数组 —— 旧存档必须照常能打开。
 * 2. **最新在前、上限 5 条**：读取时也截断，避免别人写进来的超长数组撑爆详情页。
 *
 * 写入去重（保证"每次进入结束状态只写一条"）由 `pushHistory` 兜底：
 * 若最新一条与要写入的记录完全相同（同难度、同步数、同用时、同胜负、同毫秒时间戳），就不再写。
 * 真正的第一道防线在会话层：只在 `playing → 已结束` 的**状态跃迁**上写，重载页面/重复渲染不会触发。
 */

/** 一条历史记录 */
export interface HistoryEntry {
  /** 难度 id（各游戏自己的难度标识） */
  difficulty: string
  /** 本局步数 */
  moves: number
  /** 本局用时（秒）；拿不到时记 0 */
  seconds: number
  /** true = 过关/获胜，false = 失败或平局 */
  won: boolean
  /** 记录时刻（毫秒时间戳） */
  at: number
}

/** 最多保留几条 */
export const HISTORY_LIMIT = 5

function toCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

/** 宽容解析一条记录；不可用时返回 null（而不是抛错） */
export function normalizeHistoryEntry(value: unknown): HistoryEntry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Partial<Record<keyof HistoryEntry, unknown>>
  if (typeof raw.difficulty !== 'string' || raw.difficulty === '') return null
  return {
    difficulty: raw.difficulty,
    moves: toCount(raw.moves),
    seconds: toCount(raw.seconds),
    won: raw.won === true,
    at: toCount(raw.at),
  }
}

/** 读取历史记录：非数组 / 缺字段 / 类型不对都退化成空数组，绝不抛错 */
export function readHistory(value: unknown): HistoryEntry[] {
  if (!Array.isArray(value)) return []
  const out: HistoryEntry[] = []
  for (const item of value) {
    const entry = normalizeHistoryEntry(item)
    if (entry) out.push(entry)
    if (out.length >= HISTORY_LIMIT) break
  }
  return out
}

/**
 * 压入一条记录（最新在前、上限 5 条、与最新一条完全相同时不重复写）。
 * 返回新数组，不改原数组。
 */
export function pushHistory(value: unknown, entry: HistoryEntry): HistoryEntry[] {
  const current = readHistory(value)
  const normalized = normalizeHistoryEntry(entry)
  if (!normalized) return current
  const newest = current[0]
  if (
    newest &&
    newest.difficulty === normalized.difficulty &&
    newest.moves === normalized.moves &&
    newest.seconds === normalized.seconds &&
    newest.won === normalized.won &&
    newest.at === normalized.at
  ) {
    // 同一次结束被重复提交（重复派发/重放）：不重复记录
    return current
  }
  return [normalized, ...current].slice(0, HISTORY_LIMIT)
}

/** 把记录并入 progress（保留 completed / bestMoves 等其它字段） */
export function appendHistory(
  progress: Record<string, unknown> | undefined,
  entry: HistoryEntry,
): Record<string, unknown> {
  const base = progress ?? {}
  return { ...base, history: pushHistory(base.history, entry) }
}

/**
 * 最高纪录（内容 id → 成绩，越大越好；无尽类玩法用，见 GameDef.scoreOf）。
 * 与历史记录同样宽容：不是对象、值不是非负有限数的条目一律丢掉，绝不抛错。
 */
export function readBestScore(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, number> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (key !== '' && typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) out[key] = Math.floor(raw)
  }
  return out
}

/**
 * 开新局时从旧存档继承的**跨局战绩**：历史记录与最高纪录。
 * 局面本身与本局进度不继承；「开始新游戏」「重新开始」都走这里，免得战绩跟着旧局面一起被删掉。
 */
export function carriedProgress(progress: Record<string, unknown> | undefined): Record<string, unknown> {
  const history = readHistory(progress?.history)
  const bestScore = readBestScore(progress?.bestScore)
  return {
    ...(history.length > 0 ? { history } : {}),
    ...(Object.keys(bestScore).length > 0 ? { bestScore } : {}),
  }
}
