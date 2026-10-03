/**
 * 跨端手动备份（对应验收 C05）。
 *
 * 目标：Web 导出的备份能在 Android 导入，反之亦然；导入前必须校验格式、完整性、
 * 版本与覆盖冲突，并明确区分「覆盖 / 跳过 / 两者都保留」三种策略。
 * 备份里带设备基线，便于回填 A01 的设备表与支持矩阵。
 */
import { BACKUP_SCHEMA, APP_VERSION } from './version.js'
import {
  canonicalJson,
  checksumOf,
  fnv1a,
  parseEnvelope,
  type SaveEnvelope,
  type SaveEnvelopeV1,
  type SaveMeta,
} from './save.js'
import type { CompletionRecord } from './types.js'
import type { DeviceBaseline } from './diagnostics.js'
import type { SettingsSnapshot } from './settings.js'

export interface BackupFileV1 {
  schema: typeof BACKUP_SCHEMA
  appVersion: string
  exportedAt: number
  device: DeviceBaseline
  saves: SaveEnvelopeV1[]
  records: CompletionRecord[]
  settings: SettingsSnapshot | null
  checksum: string
}

export interface BackupInput {
  device: DeviceBaseline
  saves: SaveEnvelope[]
  records: CompletionRecord[]
  settings: SettingsSnapshot | null
  exportedAt: number
}

export function createBackup(input: BackupInput): BackupFileV1 {
  const body: Omit<BackupFileV1, 'checksum'> = {
    schema: BACKUP_SCHEMA,
    appVersion: APP_VERSION,
    exportedAt: input.exportedAt,
    device: input.device,
    saves: input.saves as SaveEnvelopeV1[],
    records: input.records,
    settings: input.settings,
  }
  return { ...body, checksum: checksumOf(body) }
}

export type BackupParseResult =
  | { ok: true; backup: BackupFileV1; warnings: string[] }
  | { ok: false; errors: string[] }

export function parseBackup(text: string): BackupParseResult {
  const errors: string[] = []
  const warnings: string[] = []
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, errors: ['not-json'] }
  }
  if (!raw || typeof raw !== 'object') return { ok: false, errors: ['not-object'] }
  const candidate = raw as Partial<BackupFileV1>
  if (typeof candidate.schema !== 'number') errors.push('missing-schema')
  if (typeof candidate.checksum !== 'string') errors.push('missing-checksum')
  if (!Array.isArray(candidate.saves)) errors.push('missing-saves')
  if (errors.length > 0) return { ok: false, errors }

  if ((candidate.schema ?? 0) > BACKUP_SCHEMA) {
    return { ok: false, errors: ['unsupported-version'] }
  }

  const { checksum, ...body } = candidate as BackupFileV1
  const expected = fnv1a(canonicalJson(body))
  if (expected !== checksum) errors.push('checksum-mismatch')

  const saves: SaveEnvelopeV1[] = []
  for (const entry of candidate.saves ?? []) {
    const parsed = parseEnvelope(entry)
    if (parsed.ok) saves.push(parsed.envelope)
    else warnings.push(`skipped-save:${parsed.reason}`)
  }
  if (errors.length > 0) return { ok: false, errors }

  return {
    ok: true,
    warnings,
    backup: {
      schema: candidate.schema as typeof BACKUP_SCHEMA,
      appVersion: candidate.appVersion ?? 'unknown',
      exportedAt: candidate.exportedAt ?? 0,
      device: candidate.device as DeviceBaseline,
      saves,
      records: Array.isArray(candidate.records) ? candidate.records : [],
      settings: candidate.settings ?? null,
      checksum,
    },
  }
}

export type ConflictStrategy = 'overwrite' | 'skip' | 'keepBoth'

export interface ImportDecision {
  gameId: string
  incoming: SaveMeta
  existing: SaveMeta | null
  /**
   * add：本机没有该游戏进度，直接写入；
   * overwrite：用备份覆盖（本机旧进度不再保留）；
   * skip：保留本机进度；
   * keepBoth：先把本机旧进度存成备份副本，再写入导入的进度 —— 两份都不丢。
   */
  action: 'add' | 'overwrite' | 'skip' | 'keepBoth'
}

export interface ImportPlan {
  decisions: ImportDecision[]
}

/** 生成导入计划；界面据此逐条展示冲突，默认「两者都保留」以免丢失进度 */
export function planImport(
  incoming: SaveEnvelopeV1[],
  existing: SaveMeta[],
  strategy: ConflictStrategy,
): ImportPlan {
  const byGame = new Map(existing.map((meta) => [meta.gameId, meta]))
  const decisions: ImportDecision[] = []
  for (const envelope of incoming) {
    const meta: SaveMeta = {
      gameId: envelope.gameId,
      commitId: envelope.commitId,
      updatedAt: envelope.updatedAt,
      difficulty: envelope.difficulty,
      moves: envelope.moves,
      ...(envelope.session.ended ? { ended: envelope.session.ended } : {}),
      corrupt: false,
    }
    const current = byGame.get(envelope.gameId) ?? null
    const action: ImportDecision['action'] = !current
      ? 'add'
      : strategy === 'overwrite'
        ? 'overwrite'
        : strategy === 'skip'
          ? 'skip'
          : 'keepBoth'
    decisions.push({ gameId: envelope.gameId, incoming: meta, existing: current, action })
  }
  return { decisions }
}
