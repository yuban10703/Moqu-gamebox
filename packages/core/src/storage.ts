/**
 * 存档提交协议（对应验收 C03：关键动作后有序提交、写入原子化、保留最近有效状态、
 * 恢复「最后一次明确提交成功」的局面）。
 *
 * 协议（两端同构，KvBackend 提供原子原语）：
 *   1. 写 pending（意图）
 *   2. compare-and-set 写 committed（真正的提交点）
 *   3. 删除 pending
 * 崩溃/断电发生在任何一步，recover() 都能得到确定结果：
 *   - pending 的 commitId > committed 的 commitId 且校验通过 → 补提交（恢复）
 *   - 否则 → 该 pending 是陈旧或损坏的意图，删除并记录
 *
 * 多标签页/多端防覆盖靠 committed 上的 CAS：期望值与实际值不符即返回 conflict，
 * 绝不静默覆盖另一个窗口已经写入的进度。
 */
import {
  parseEnvelope,
  readMeta,
  reseal,
  type SaveEnvelope,
  type SaveEnvelopeV1,
  type SaveMeta,
} from './save.js'
import type { SaveFailureReason } from './version.js'

export interface KvBackend {
  get(key: string): Promise<string | null>
  del(key: string): Promise<void>
  keys(prefix: string): Promise<string[]>
  /**
   * 原子「读-比对-写」：仅当当前值等于 expectedValue 时写入 newValue。
   * IndexedDB 用单个 readwrite 事务实现；Android 侧用 SQLite 事务实现。
   */
  commitCas(
    key: string,
    expectedValue: string | null,
    newValue: string,
  ): Promise<{ ok: true } | { ok: false; current: string | null }>
  /** 原子批量写入（用于把 pending 提升为 committed） */
  setMany(entries: Array<[string, string]>): Promise<void>
}

export type CommitResult =
  | { ok: true; commitId: number }
  | { ok: false; reason: SaveFailureReason; detail?: string }

export interface RecoveryReport {
  /** 补提交成功的游戏 */
  recovered: string[]
  /** 陈旧 pending（提交点已越过）被清理的游戏 */
  cleaned: string[]
  /** 损坏或无法校验的 pending 被丢弃的游戏 */
  discarded: string[]
  /**
   * **已提交但无法校验**的游戏（数据被外部损坏、写入截断等）。
   * 这些不会被自动删除 —— 删掉就等于用户无声丢档；界面据它给出「导出/清除」的恢复入口。
   */
  corrupt: string[]
}

export interface SaveStore {
  commit(envelope: SaveEnvelopeV1): Promise<CommitResult>
  /** Atomic import/restore: never delete the current save or leave a failed replacement intent. */
  replace(envelope: SaveEnvelopeV1, options?: { backupSlot?: number; onlyIfEmpty?: boolean }): Promise<CommitResult>
  load(gameId: string): Promise<SaveEnvelope | null>
  /**
   * 区分「没有存档」「有存档」与「存档损坏/版本不支持」。
   * 界面必须能区分后两者：损坏的存档要保留并可导出，而不是被当成空存档静默覆盖（对应 C04）。
   */
  loadResult(gameId: string): Promise<LoadResult>
  list(): Promise<SaveMeta[]>
  remove(gameId: string): Promise<void>
  clearAll(): Promise<void>
  recover(): Promise<RecoveryReport>
  /** 迁移前落一份备份副本 */
  backupBefore(gameId: string, slot: number): Promise<void>
  /** 诊断用：逐个读取原始文本（含损坏项） */
  rawAll(): Promise<Array<{ key: string; text: string }>>
}

export type LoadResult =
  | { status: 'ok'; envelope: SaveEnvelope }
  | { status: 'empty' }
  | { status: 'corrupt'; reason: 'corrupt' | 'unsupported-version' }

const NS = 'save:1'
const committedKey = (gameId: string) => `${NS}:committed:${gameId}`
const pendingKey = (gameId: string) => `${NS}:pending:${gameId}`
const backupKey = (gameId: string, slot: number) => `${NS}:backup:${gameId}:${slot}`
const COMMITTED_PREFIX = `${NS}:committed:`

export interface SaveStoreOptions {
  now?: () => number
}

export function createSaveStore(
  kv: KvBackend,
  options: SaveStoreOptions = {},
): SaveStore {
  const now = options.now ?? (() => Date.now())

  const readEnvelope = async (key: string): Promise<LoadResult> => {
    const text = await kv.get(key)
    if (text === null) return { status: 'empty' }
    const parsed = parseEnvelope(text)
    return parsed.ok
      ? { status: 'ok', envelope: parsed.envelope }
      : { status: 'corrupt', reason: parsed.reason }
  }

  return {
    async replace(envelope, options = {}) {
      try {
        const key = committedKey(envelope.gameId)
        const current = await kv.get(key)
        if (options.onlyIfEmpty && current !== null) return { ok: false, reason: 'conflict' }
        const previousId = current ? (readMeta(current)?.commitId ?? 0) : 0
        const target = reseal({ ...envelope, commitId: previousId + 1, updatedAt: now() })
        if (options.backupSlot !== undefined && current !== null) {
          // Reserve a fresh archive key atomically; equal timestamps must not overwrite a backup.
          let archived = false
          for (let offset = 0; offset < 1000; offset++) {
            const result = await kv.commitCas(backupKey(envelope.gameId, options.backupSlot + offset), null, current)
            if (result.ok) { archived = true; break }
          }
          if (!archived) return { ok: false, reason: 'io', detail: 'backup slots exhausted' }
        }
        const result = await kv.commitCas(key, current, JSON.stringify(target))
        if (!result.ok) return { ok: false, reason: 'conflict', detail: 'concurrent replacement detected' }
        return { ok: true, commitId: target.commitId }
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        return { ok: false, reason: /quota|exceeded|space/i.test(detail) ? 'quota' : 'io', detail }
      }
    },

    async commit(envelope) {
      try {
        const target = reseal({ ...envelope, updatedAt: now(), commitId: envelope.commitId + 1 })
        const committedKeyForGame = committedKey(envelope.gameId)
        const expectedRaw = await kv.get(committedKeyForGame)

        // 期望值与当前值必须一致：否则说明另一处已经写入（多标签页/多端）
        const expectedCommitId = expectedRaw ? (readMeta(expectedRaw)?.commitId ?? null) : 0
        if (expectedRaw && expectedCommitId !== envelope.commitId) {
          return {
            ok: false,
            reason: 'conflict',
            detail: `expected commitId ${envelope.commitId}, found ${String(expectedCommitId)}`,
          }
        }
        if (!expectedRaw && envelope.commitId !== 0) {
          return { ok: false, reason: 'conflict', detail: 'missing committed record' }
        }

        await kv.setMany([[pendingKey(envelope.gameId), JSON.stringify({ target })]])
        const payload = JSON.stringify(target)
        const cas = await kv.commitCas(committedKeyForGame, expectedRaw, payload)
        if (!cas.ok) {
          return { ok: false, reason: 'conflict', detail: 'concurrent write detected' }
        }
        await kv.del(pendingKey(envelope.gameId))
        return { ok: true, commitId: target.commitId }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const quota = /quota|exceeded|space/i.test(message)
        return { ok: false, reason: quota ? 'quota' : 'io', detail: message }
      }
    },

    async load(gameId) {
      const result = await readEnvelope(committedKey(gameId))
      return result.status === 'ok' ? result.envelope : null
    },

    loadResult: (gameId) => readEnvelope(committedKey(gameId)),

    async list() {
      const keys = await kv.keys(COMMITTED_PREFIX)
      const out: SaveMeta[] = []
      for (const key of keys) {
        const text = await kv.get(key)
        if (text === null) continue
        const meta = readMeta(text)
        if (meta) {
          out.push(meta)
          continue
        }
        // 连 meta 都读不出来（写入被截断、外部损坏等）：**不能静默跳过** ——
        // 跳过等于用户在首页看不到任何异常，进度无声消失。
        // key 里就带着 gameId，据此上报为损坏，界面会给「导出/清除」入口。
        const gameId = key.slice(COMMITTED_PREFIX.length)
        if (gameId) {
          out.push({ gameId, commitId: 0, updatedAt: 0, difficulty: '', moves: 0, corrupt: true })
        }
      }
      return out
    },

    async remove(gameId) {
      await kv.del(committedKey(gameId))
      await kv.del(pendingKey(gameId))
    },

    async clearAll() {
      const keys = await kv.keys(NS)
      for (const key of keys) await kv.del(key)
    },

    async backupBefore(gameId, slot) {
      const text = await kv.get(committedKey(gameId))
      if (text === null) return
      await kv.setMany([[backupKey(gameId, slot), text]])
    },

    async recover() {
      const report: RecoveryReport = { recovered: [], cleaned: [], discarded: [], corrupt: [] }
      const pendingKeys = await kv.keys(`${NS}:pending:`)
      for (const key of pendingKeys) {
        const gameId = key.slice(`${NS}:pending:`.length)
        const text = await kv.get(key)
        if (text === null) continue
        let target: SaveEnvelope | null = null
        try {
          const wrapper = JSON.parse(text) as { target?: unknown }
          const parsed = parseEnvelope(wrapper.target)
          target = parsed.ok ? parsed.envelope : null
        } catch {
          target = null
        }
        if (!target) {
          await kv.del(key)
          report.discarded.push(gameId)
          continue
        }
        const committed = await readEnvelope(committedKey(gameId))
        const committedId = committed.status === 'ok' ? committed.envelope.commitId : null
        if (committedId === null || target.commitId > committedId) {
          await kv.setMany([[committedKey(gameId), JSON.stringify(target)]])
          await kv.del(key)
          report.recovered.push(gameId)
        } else {
          await kv.del(key)
          report.cleaned.push(gameId)
        }
      }
      // 已提交的存档也要体检：损坏时**不删除**，只上报，由界面提供导出/清除入口。
      // 原先只扫 pending，于是被外部损坏的已提交存档会被静默忽略 ——
      // 首页照常显示「进度 0/16」，用户无声无息丢档（探索式测试发现）。
      const committedKeys = await kv.keys(`${NS}:committed:`)
      for (const key of committedKeys) {
        const gameId = key.slice(`${NS}:committed:`.length)
        const loaded = await readEnvelope(key)
        if (loaded.status === 'corrupt') report.corrupt.push(gameId)
      }
      return report
    },

    async rawAll() {
      const keys = await kv.keys(NS)
      const out: Array<{ key: string; text: string }> = []
      for (const key of keys) {
        const text = await kv.get(key)
        if (text !== null) out.push({ key, text })
      }
      return out
    },
  }
}

/** 内存实现：测试与「存储不可用」降级用 */
export function createMemoryKv(initial: Record<string, string> = {}): KvBackend & {
  snapshot(): Record<string, string>
  failNext(error: Error): void
} {
  const map = new Map<string, string>(Object.entries(initial))
  let pendingFailure: Error | null = null
  const maybeFail = () => {
    if (pendingFailure) {
      const error = pendingFailure
      pendingFailure = null
      throw error
    }
  }
  return {
    async get(key) {
      maybeFail()
      return map.get(key) ?? null
    },
    async del(key) {
      maybeFail()
      map.delete(key)
    },
    async keys(prefix) {
      return [...map.keys()].filter((key) => key.startsWith(prefix)).sort()
    },
    async commitCas(key, expectedValue, newValue) {
      maybeFail()
      const current = map.get(key) ?? null
      if (current !== expectedValue) return { ok: false, current }
      map.set(key, newValue)
      return { ok: true }
    },
    async setMany(entries) {
      maybeFail()
      for (const [key, value] of entries) map.set(key, value)
    },
    snapshot: () => Object.fromEntries(map.entries()),
    failNext: (error) => {
      pendingFailure = error
    },
  }
}
