/**
 * 存档格式与校验。
 *
 * 关键设计：
 * - **游戏状态是唯一事实来源**：`state` 字段就是 `GameDef.encode()` 的产物，
 *   由各游戏自己负责版本化与迁移（推箱子把动作日志放在自己的状态里，因此天然可重放）。
 * - `moves` 只是派生计数，用于列表展示，不参与还原。
 * - 任何解析失败都返回明确原因，由上层决定「保留并提示」还是「拒绝」，绝不静默丢弃。
 */
import { SAVE_SCHEMA } from './version.js'
import type { CompletionRecord } from './types.js'

export interface SaveSession {
  elapsedMs: number
  undos: number
  restarts: number
  hintsUsed: number
  ended?: 'won' | 'lost'
}

export interface SaveEnvelopeV1 {
  schema: typeof SAVE_SCHEMA
  gameId: string
  rulesVersion: number
  contentVersion: number
  difficulty: string
  seed: number
  /** 游戏状态（GameDef.encode 的产物） */
  state: unknown
  /** 派生的玩家动作数 */
  moves: number
  session: SaveSession
  /** 游戏自定义的持久进度（已完成关卡、最佳记录等） */
  progress: Record<string, unknown>
  updatedAt: number
  /** 由 SaveStore 分配的提交编号；0 表示尚未提交 */
  commitId: number
  checksum: string
}

export type SaveEnvelope = SaveEnvelopeV1

export type MigrationResult =
  | { ok: true; envelope: SaveEnvelope }
  | { ok: false; reason: 'corrupt' | 'unsupported-version' }

/** 稳定序列化：递归按 key 排序，保证校验和可复现 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value))
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortValue((value as Record<string, unknown>)[key])
    }
    return out
  }
  return value
}

/** FNV-1a 32 位，十六进制输出：够快够小，用于发现损坏而非防篡改 */
export function fnv1a(text: string): string {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/**
 * 对任意可 JSON 序列化的结构算校验和。
 *
 * 存档信封、备份文件都用它。之所以单独抽出来：备份原先写成
 * `computeChecksum(body as unknown as Omit<SaveEnvelopeV1,'checksum'>)` ——
 * 那是把"备份体"伪装成"存档信封"来通过类型检查，断言本身不成立。
 * 取值方式与 `computeChecksum` 完全一致（`fnv1a(canonicalJson(v))`），所以校验和不变、旧数据照旧可读。
 */
export function checksumOf(value: unknown): string {
  return fnv1a(canonicalJson(value))
}

export function computeChecksum(envelope: Omit<SaveEnvelopeV1, 'checksum'>): string {
  return checksumOf(envelope)
}

export function sealEnvelope(envelope: Omit<SaveEnvelopeV1, 'checksum'>): SaveEnvelopeV1 {
  return { ...envelope, checksum: computeChecksum(envelope) }
}

export function verifyChecksum(envelope: SaveEnvelopeV1): boolean {
  const { checksum, ...rest } = envelope
  return computeChecksum(rest) === checksum
}

export interface NewEnvelopeInput {
  gameId: string
  rulesVersion: number
  contentVersion: number
  difficulty: string
  seed: number
  state: unknown
}

export function newEnvelope(
  input: NewEnvelopeInput,
  now: number,
  progress: Record<string, unknown> = {},
): SaveEnvelopeV1 {
  return sealEnvelope({
    schema: SAVE_SCHEMA,
    gameId: input.gameId,
    rulesVersion: input.rulesVersion,
    contentVersion: input.contentVersion,
    difficulty: input.difficulty,
    seed: input.seed,
    state: input.state,
    moves: 0,
    session: { elapsedMs: 0, undos: 0, restarts: 0, hintsUsed: 0 },
    progress,
    updatedAt: now,
    commitId: 0,
  })
}

/** 应用一次玩家动作后的新存档（返回新对象，不修改入参） */
export function applyAction(
  envelope: SaveEnvelopeV1,
  nextState: unknown,
  now: number,
  options: { progress?: Record<string, unknown>; session?: Partial<SaveSession>; countMove?: boolean } = {},
): SaveEnvelopeV1 {
  return reseal({
    ...envelope,
    state: nextState,
    moves: options.countMove === false ? envelope.moves : envelope.moves + 1,
    session: { ...envelope.session, ...(options.session ?? {}) },
    progress: options.progress ?? envelope.progress,
    updatedAt: now,
  })
}

export function mutateSession(
  envelope: SaveEnvelopeV1,
  patch: Partial<SaveSession>,
  now: number,
): SaveEnvelopeV1 {
  return reseal({
    ...envelope,
    session: { ...envelope.session, ...patch },
    updatedAt: now,
  })
}

export function reseal(envelope: SaveEnvelopeV1): SaveEnvelopeV1 {
  const { checksum: _checksum, ...rest } = envelope
  return sealEnvelope(rest)
}

/**
 * 解析并迁移存档。任何无法安全处理的输入都返回明确原因，
 * 由上层决定「保留并提示」还是「拒绝」——绝不静默丢弃。
 */
export function parseEnvelope(raw: unknown): MigrationResult {
  let value: unknown = raw
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw)
    } catch {
      return { ok: false, reason: 'corrupt' }
    }
  }
  if (!value || typeof value !== 'object') return { ok: false, reason: 'corrupt' }
  const candidate = value as Partial<SaveEnvelopeV1> & { schema?: number }
  if (typeof candidate.schema !== 'number') return { ok: false, reason: 'corrupt' }

  let migrated = candidate as SaveEnvelopeV1
  if (candidate.schema > SAVE_SCHEMA) {
    return { ok: false, reason: 'unsupported-version' }
  }
  if (candidate.schema < SAVE_SCHEMA) {
    const upgraded = migrateEnvelope(candidate as SaveEnvelopeV1)
    if (!upgraded) return { ok: false, reason: 'unsupported-version' }
    migrated = upgraded
  }

  if (!isStructurallyValid(migrated)) return { ok: false, reason: 'corrupt' }
  if (!verifyChecksum(migrated)) return { ok: false, reason: 'corrupt' }
  return { ok: true, envelope: migrated }
}

/**
 * 迁移链。当前只有 schema 1，所以这里是恒等迁移；
 * 未来新增 schema 时在此追加 `case 1 -> 2` 之类的单步迁移，禁止跳级。
 * 迁移前必须先落备份（由 SaveStore 负责），这里只做结构升级。
 */
function migrateEnvelope(input: SaveEnvelopeV1): SaveEnvelopeV1 | null {
  return input
}

function isStructurallyValid(value: SaveEnvelopeV1): boolean {
  return (
    typeof value.gameId === 'string' &&
    value.gameId.length > 0 &&
    typeof value.rulesVersion === 'number' &&
    typeof value.contentVersion === 'number' &&
    typeof value.difficulty === 'string' &&
    typeof value.seed === 'number' &&
    value.state !== undefined &&
    typeof value.moves === 'number' &&
    !!value.session &&
    typeof value.session === 'object' &&
    typeof value.session.elapsedMs === 'number' &&
    typeof value.commitId === 'number' &&
    typeof value.updatedAt === 'number' &&
    !!value.progress &&
    typeof value.progress === 'object' &&
    typeof value.checksum === 'string'
  )
}

/** 仅取元信息，用于列表与冲突判断（不解析游戏状态） */
export interface SaveMeta {
  gameId: string
  commitId: number
  updatedAt: number
  difficulty: string
  moves: number
  ended?: 'won' | 'lost'
  corrupt: boolean
}

export function readMeta(text: string): SaveMeta | null {
  const parsed = parseEnvelope(text)
  if (!parsed.ok) {
    try {
      const raw = JSON.parse(text) as Partial<SaveEnvelopeV1>
      if (typeof raw?.gameId !== 'string') return null
      return {
        gameId: raw.gameId,
        commitId: typeof raw.commitId === 'number' ? raw.commitId : 0,
        updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : 0,
        difficulty: typeof raw.difficulty === 'string' ? raw.difficulty : '',
        moves: typeof raw.moves === 'number' ? raw.moves : 0,
        corrupt: true,
      }
    } catch {
      return null
    }
  }
  const env = parsed.envelope
  return {
    gameId: env.gameId,
    commitId: env.commitId,
    updatedAt: env.updatedAt,
    difficulty: env.difficulty,
    moves: env.moves,
    ...(env.session.ended ? { ended: env.session.ended } : {}),
    corrupt: false,
  }
}

export function toCompletionRecord(
  envelope: SaveEnvelopeV1,
  outcome: 'won' | 'lost',
  best?: Record<string, number>,
): CompletionRecord {
  return {
    gameId: envelope.gameId,
    difficulty: envelope.difficulty,
    finishedAt: envelope.updatedAt,
    outcome,
    moves: envelope.moves,
    elapsedMs: envelope.session.elapsedMs,
    hintsUsed: envelope.session.hintsUsed,
    ...(best ? { best } : {}),
  }
}
