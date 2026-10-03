/**
 * 应用级存储：把「存档 / 设置 / 完成记录 / 备份导入导出」组装成一个门面。
 *
 * 存储后端优先级：
 *   1. Android 原生事务存储（SQLite，经桥调用）—— 安装包内置，最可靠；
 *   2. IndexedDB（浏览器）；
 *   3. 内存（前两者都不可用时降级，并明确告知用户「本次进度无法持久化」）。
 *
 * 冲突策略（对应 C05）：
 *   - add/overwrite：直接写入；
 *   - skip：保留本机现有进度；
 *   - keepBoth（默认）：先把本机现有进度存成备份副本，再写入导入的进度 ——
 *     两份都在，且不会被静默覆盖；备份可在数据管理页恢复。
 */
import {
  DEFAULT_SETTINGS,
  createBackup,
  createMemoryKv,
  createSaveStore,
  parseBackup,
  parseEnvelope,
  parseSettings,
  planImport,
  readMeta,
  reseal,
  type CompletionRecord,
  type ConflictStrategy,
  type DeviceBaseline,
  type KvBackend,
  type RecoveryReport,
  type SaveEnvelope,
  type SaveMeta,
  type SaveStore,
  type SettingsSnapshot,
} from '@eink/core'
import { createIndexedDbKv, hasIndexedDb } from './indexeddb.js'
import { createAndroidKv, isAndroidBridgeAvailable, type EinkNativeBridge } from './androidBridge.js'

export type StorageKind = 'android' | 'indexeddb' | 'memory'

export interface BackupSlotInfo {
  gameId: string
  slot: number
  meta: SaveMeta | null
}

export interface ImportSummary {
  added: number
  overwritten: number
  skipped: number
  keptBoth: number
  warnings: string[]
}

export type ImportOutcome = { ok: true; summary: ImportSummary } | { ok: false; reason: string }

export interface AppStorage {
  kind: StorageKind
  /** false 表示当前只能内存存储，界面必须显著提示 */
  persistent: boolean
  saves: SaveStore
  loadSettings(): Promise<SettingsSnapshot>
  saveSettings(settings: SettingsSnapshot): Promise<boolean>
  /**
   * 「我的信息」：用户在关于页自己写的备注（可编辑、可保存）。
   *
   * 为什么放在这一层：它与存档/设置一样必须走**同一套本机存储后端**
   * （Android 原生 SQLite / 浏览器 IndexedDB / 内存降级），
   * 界面不该自己去碰 localStorage 或 IndexedDB。
   * 与游戏进度无关：`clearAll()`（清除全部进度）**不会**删除它。
   */
  loadNote(): Promise<string>
  saveNote(text: string): Promise<boolean>
  listRecords(): Promise<CompletionRecord[]>
  appendRecord(record: CompletionRecord): Promise<void>
  listBackups(): Promise<BackupSlotInfo[]>
  restoreBackup(gameId: string, slot: number): Promise<boolean>
  recover(): Promise<RecoveryReport>
  createBackupText(baseline: DeviceBaseline, exportedAt: number): Promise<string>
  applyImport(text: string, strategy: ConflictStrategy): Promise<ImportOutcome>
  clearAll(): Promise<void>
}

const SETTINGS_KEY = 'settings:1'
const RECORDS_PREFIX = 'records:1:'
const BACKUP_PREFIX = 'save:1:backup:'
/** 「我的信息」的存储键；版本号与其它键一致带 `:1`，将来改格式时可以并存迁移 */
const NOTE_KEY = 'about:1:note'
/** 「我的信息」的最大长度：够写一段自我介绍，又不至于把本机存储写爆 */
export const NOTE_MAX_LENGTH = 2000

export interface AppStorageOptions {
  bridge?: EinkNativeBridge | null
  now?: () => number
  /** 测试注入 */
  kv?: KvBackend
  /** 注入 kv 时显式声明存储类型 */
  kind?: StorageKind
}

export async function createAppStorage(options: AppStorageOptions = {}): Promise<AppStorage> {
  const now = options.now ?? (() => Date.now())
  let kind: StorageKind = 'memory'
  let kv: KvBackend = options.kv ?? createMemoryKv()

  if (!options.kv) {
    const bridge = options.bridge ?? (isAndroidBridgeAvailable() ? window.EinkNative! : null)
    if (bridge) {
      kv = createAndroidKv(bridge)
      kind = 'android'
    } else if (hasIndexedDb()) {
      try {
        kv = await createIndexedDbKv()
        kind = 'indexeddb'
      } catch {
        kv = createMemoryKv()
        kind = 'memory'
      }
    }
  } else {
    kind = options.kind ?? 'memory'
  }

  const saves = createSaveStore(kv, { now })

  const loadSettings = async (): Promise<SettingsSnapshot> => {
    const text = await kv.get(SETTINGS_KEY)
    if (!text) return { ...DEFAULT_SETTINGS }
    try {
      return parseSettings(JSON.parse(text))
    } catch {
      return { ...DEFAULT_SETTINGS }
    }
  }

  const saveSettings = async (settings: SettingsSnapshot): Promise<boolean> => {
    try {
      await kv.setMany([[SETTINGS_KEY, JSON.stringify(settings)]])
      return true
    } catch {
      return false
    }
  }

  /*
   * 「我的信息」（关于页）。读失败一律退化成空串：这是一块可选的个人备注，
   * 读不出来时界面应该显示空输入框，而不是弹错误。
   */
  const loadNote = async (): Promise<string> => {
    try {
      const text = await kv.get(NOTE_KEY)
      return text === null ? '' : text.slice(0, NOTE_MAX_LENGTH)
    } catch {
      return ''
    }
  }

  const saveNote = async (text: string): Promise<boolean> => {
    try {
      await kv.setMany([[NOTE_KEY, text.slice(0, NOTE_MAX_LENGTH)]])
      return true
    } catch {
      return false
    }
  }

  const listRecords = async (): Promise<CompletionRecord[]> => {
    const keys = await kv.keys(RECORDS_PREFIX)
    const out: CompletionRecord[] = []
    for (const key of keys) {
      const text = await kv.get(key)
      if (!text) continue
      try {
        out.push(JSON.parse(text) as CompletionRecord)
      } catch {
        // 单条记录损坏不影响其它记录
      }
    }
    return out.sort((a, b) => b.finishedAt - a.finishedAt)
  }

  const appendRecord = async (record: CompletionRecord): Promise<void> => {
    const key = `${RECORDS_PREFIX}${String(record.finishedAt).padStart(16, '0')}:${Math.floor(
      Math.random() * 1e6,
    ).toString(36)}`
    await kv.setMany([[key, JSON.stringify(record)]])
  }

  const listBackups = async (): Promise<BackupSlotInfo[]> => {
    const keys = await kv.keys(BACKUP_PREFIX)
    const out: BackupSlotInfo[] = []
    for (const key of keys) {
      const rest = key.slice(BACKUP_PREFIX.length)
      const separator = rest.lastIndexOf(':')
      if (separator < 0) continue
      const gameId = rest.slice(0, separator)
      const slot = Number.parseInt(rest.slice(separator + 1), 10)
      if (!Number.isFinite(slot)) continue
      const text = await kv.get(key)
      out.push({ gameId, slot, meta: text ? readMeta(text) : null })
    }
    return out.sort((a, b) => b.slot - a.slot)
  }

  const restoreBackup = async (gameId: string, slot: number): Promise<boolean> => {
    const text = await kv.get(`${BACKUP_PREFIX}${gameId}:${slot}`)
    if (!text) return false
    const parsed = parseEnvelope(text)
    if (!parsed.ok) return false
    await saves.remove(gameId)
    const result = await saves.commit(reseal({ ...parsed.envelope, commitId: 0 }))
    return result.ok
  }

  const createBackupText = async (baseline: DeviceBaseline, exportedAt: number): Promise<string> => {
    const metas = await saves.list()
    const envelopes: SaveEnvelope[] = []
    for (const meta of metas) {
      const envelope = await saves.load(meta.gameId)
      if (envelope) envelopes.push(envelope)
    }
    const settingsText = await kv.get(SETTINGS_KEY)
    let settings: SettingsSnapshot | null = null
    if (settingsText) {
      try {
        settings = parseSettings(JSON.parse(settingsText))
      } catch {
        settings = null
      }
    }
    const backup = createBackup({
      device: baseline,
      saves: envelopes,
      records: await listRecords(),
      settings,
      exportedAt,
    })
    return JSON.stringify(backup, null, 2)
  }

  const applyImport = async (text: string, strategy: ConflictStrategy): Promise<ImportOutcome> => {
    const parsed = parseBackup(text)
    if (!parsed.ok) return { ok: false, reason: parsed.errors.join(',') }

    const existing = await saves.list()
    const plan = planImport(parsed.backup.saves, existing, strategy)
    const summary: ImportSummary = {
      added: 0,
      overwritten: 0,
      skipped: 0,
      keptBoth: 0,
      warnings: [...parsed.warnings],
    }

    const byGame = new Map(parsed.backup.saves.map((envelope) => [envelope.gameId, envelope]))
    for (const decision of plan.decisions) {
      const incoming = byGame.get(decision.gameId)
      if (!incoming) continue
      const fresh = reseal({ ...incoming, commitId: 0 })
      if (decision.action === 'skip') {
        summary.skipped++
        continue
      }
      if (decision.action === 'add') {
        const result = await saves.commit(fresh)
        if (result.ok) summary.added++
        else summary.warnings.push(`commit-failed:${decision.gameId}:${result.reason}`)
        continue
      }
      // overwrite / keepBoth 都需要先移除现有记录；keepBoth 额外落一份备份副本
      if (decision.action === 'keepBoth') {
        await saves.backupBefore(decision.gameId, now())
        summary.keptBoth++
      } else {
        summary.overwritten++
      }
      await saves.remove(decision.gameId)
      const result = await saves.commit(fresh)
      if (!result.ok) summary.warnings.push(`commit-failed:${decision.gameId}:${result.reason}`)
    }

    if (parsed.backup.settings) await saveSettings(parsed.backup.settings)
    for (const record of parsed.backup.records) await appendRecord(record)
    return { ok: true, summary }
  }

  const clearAll = async (): Promise<void> => {
    await saves.clearAll()
    await kv.del(SETTINGS_KEY)
    for (const key of await kv.keys(RECORDS_PREFIX)) await kv.del(key)
  }

  return {
    kind,
    persistent: kind !== 'memory',
    saves,
    loadSettings,
    saveSettings,
    loadNote,
    saveNote,
    listRecords,
    appendRecord,
    listBackups,
    restoreBackup,
    recover: () => saves.recover(),
    createBackupText,
    applyImport,
    clearAll,
  }
}
