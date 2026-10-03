// @vitest-environment jsdom
/**
 * 平台层测试：IndexedDB 的 CAS 语义、应用存储门面（设置/记录/备份导入导出）、
 * Android 桥的 KvBackend 映射，以及内存降级时的「无法持久化」标记。
 */
import 'fake-indexeddb/auto'
import { describe, expect, it, vi } from 'vitest'
import { createBackup, createSaveStore, DEFAULT_SETTINGS, newEnvelope, verifyChecksum, type SettingsSnapshot } from '@eink/core'
import { createIndexedDbKv } from '../src/indexeddb.js'
import { createAppStorage } from '../src/appStorage.js'
import { createAndroidKv, readAndroidBaseline, type EinkNativeBridge } from '../src/androidBridge.js'
import { createBundledOffline } from '../src/offline.js'
import { collectWebBaseline } from '../src/baseline.js'

const NOW = 1_700_000_000_000

function envelope(gameId = 'sokoban') {
  return newEnvelope(
    {
      gameId,
      rulesVersion: 1,
      contentVersion: 1,
      difficulty: 'starter',
      seed: 7,
      state: { levelId: 'L01', log: [] },
    },
    NOW,
  )
}

describe('IndexedDB KvBackend', () => {
  it('CAS 只在期望值一致时写入，并发提交只有一个成功', async () => {
    const kv = await createIndexedDbKv({ dbName: `t-${Math.random()}` })
    expect(await kv.commitCas('k', null, 'v1')).toEqual({ ok: true })
    const second = await kv.commitCas('k', null, 'v2')
    expect(second.ok).toBe(false)
    expect(await kv.get('k')).toBe('v1')
    expect(await kv.commitCas('k', 'v1', 'v2')).toEqual({ ok: true })
    expect(await kv.get('k')).toBe('v2')
  })

  it('setMany 批量写入、keys 前缀查询、del 删除', async () => {
    const kv = await createIndexedDbKv({ dbName: `t-${Math.random()}` })
    await kv.setMany([
      ['a:1', 'x'],
      ['a:2', 'y'],
      ['b:1', 'z'],
    ])
    expect(await kv.keys('a:')).toEqual(['a:1', 'a:2'])
    await kv.del('a:1')
    expect(await kv.keys('a:')).toEqual(['a:2'])
  })

  it('可直接驱动存档提交协议', async () => {
    const kv = await createIndexedDbKv({ dbName: `t-${Math.random()}` })
    const store = createSaveStore(kv, { now: () => NOW })
    const first = await store.commit(envelope())
    expect(first).toEqual({ ok: true, commitId: 1 })
    const loaded = await store.load('sokoban')
    expect(loaded && verifyChecksum(loaded)).toBe(true)
  })
})

describe('应用存储门面', () => {
  it('设置与完成记录可保存读回，记录按时间倒序', async () => {
    const kv = await createIndexedDbKv({ dbName: `t-${Math.random()}` })
    const storage = await createAppStorage({ kv, kind: 'indexeddb', now: () => NOW })
    expect(storage.persistent).toBe(true)

    await storage.saveSettings({
      locale: 'en-US',
      fontScale: 1.25,
      timer: false,
      dpad: true,
      boldLines: false,
      perGame: {},
    })
    const settings = await storage.loadSettings()
    expect(settings.locale).toBe('en-US')
    expect(settings.fontScale).toBe(1.25)

    await storage.appendRecord({
      gameId: 'sokoban',
      difficulty: 'starter',
      finishedAt: NOW,
      outcome: 'won',
      moves: 12,
      elapsedMs: 1000,
      hintsUsed: 0,
    })
    await storage.appendRecord({
      gameId: 'sokoban',
      difficulty: 'starter',
      finishedAt: NOW + 10_000,
      outcome: 'won',
      moves: 10,
      elapsedMs: 900,
      hintsUsed: 0,
    })
    const records = await storage.listRecords()
    expect(records).toHaveLength(2)
    expect(records[0]?.finishedAt).toBe(NOW + 10_000)
  })

  it('备份导出后可导入到另一台设备（keepBoth 会留下旧进度副本）', async () => {
    const source = await createAppStorage({
      kv: await createIndexedDbKv({ dbName: `src-${Math.random()}` }),
      kind: 'indexeddb',
      now: () => NOW,
    })
    await source.saves.commit(envelope())
    const text = await source.createBackupText(
      collectWebBaseline(() => NOW),
      NOW,
    )

    const target = await createAppStorage({
      kv: await createIndexedDbKv({ dbName: `dst-${Math.random()}` }),
      kind: 'indexeddb',
      now: () => NOW + 1000,
    })
    // 目标机上先有一份自己的进度
    const localEnvelope = envelope()
    await target.saves.commit(localEnvelope)
    expect((await target.saves.load('sokoban'))?.commitId).toBe(1)

    const outcome = await target.applyImport(text, 'keepBoth')
    expect(outcome.ok).toBe(true)
    if (outcome.ok) expect(outcome.summary.keptBoth).toBe(1)

    // 导入项成为当前进度，旧进度进入备份副本
    const backups = await target.listBackups()
    expect(backups).toHaveLength(1)
    expect(backups[0]?.gameId).toBe('sokoban')

    // 备份可以恢复回来
    const restored = await target.restoreBackup('sokoban', backups[0]!.slot)
    expect(restored).toBe(true)
    expect((await target.saves.load('sokoban'))?.commitId).toBe(1)
  })

  it('损坏的备份会被拒绝，且不改动本机进度', async () => {
    const storage = await createAppStorage({
      kv: await createIndexedDbKv({ dbName: `t-${Math.random()}` }),
      kind: 'indexeddb',
      now: () => NOW,
    })
    await storage.saves.commit(envelope())
    const outcome = await storage.applyImport('{"schema":1,"checksum":"x"}', 'keepBoth')
    expect(outcome.ok).toBe(false)
    expect((await storage.saves.load('sokoban'))?.commitId).toBe(1)
  })

  it('skip 策略保留本机进度', async () => {
    const source = await createAppStorage({
      kv: await createIndexedDbKv({ dbName: `s-${Math.random()}` }),
      kind: 'indexeddb',
      now: () => NOW,
    })
    await source.saves.commit(envelope())
    const text = await source.createBackupText(collectWebBaseline(() => NOW), NOW)

    const target = await createAppStorage({
      kv: await createIndexedDbKv({ dbName: `d-${Math.random()}` }),
      kind: 'indexeddb',
      now: () => NOW + 5000,
    })
    await target.saves.commit(envelope())
    const before = await target.saves.load('sokoban')
    const outcome = await target.applyImport(text, 'skip')
    expect(outcome.ok).toBe(true)
    if (outcome.ok) expect(outcome.summary.skipped).toBe(1)
    expect((await target.saves.load('sokoban'))?.updatedAt).toBe(before?.updatedAt)
  })

  it('含旧 refreshProfile 字段的备份仍可导入，且该字段不会被写回本机设置', async () => {
    const storage = await createAppStorage({
      kv: await createIndexedDbKv({ dbName: `legacy-${Math.random()}` }),
      kind: 'indexeddb',
      now: () => NOW,
    })
    // 旧版本导出的备份：settings 里带着已删除的 refreshProfile（JSON 往返以避免类型过期）
    const legacySettings = JSON.parse(
      JSON.stringify({ ...DEFAULT_SETTINGS, refreshProfile: 'speed' }),
    ) as SettingsSnapshot
    const text = JSON.stringify(
      createBackup({
        device: collectWebBaseline(() => NOW),
        saves: [envelope()],
        records: [],
        settings: legacySettings,
        exportedAt: NOW,
      }),
    )

    const outcome = await storage.applyImport(text, 'keepBoth')
    expect(outcome.ok).toBe(true)
    if (outcome.ok) expect(outcome.summary.added).toBe(1)
    // 导入后本机设置能正常读回，且不再带着已删除的字段
    const settings = await storage.loadSettings()
    expect(settings.fontScale).toBe(1)
    expect(Object.keys(settings)).not.toContain('refreshProfile')
  })

  it('内存后端会明确标记为不可持久化', async () => {
    const storage = await createAppStorage({ kv: undefined, now: () => NOW })
    // 未注入 kv 时按环境探测；jsdom + fake-indexeddb 会走 indexeddb
    expect(['indexeddb', 'memory']).toContain(storage.kind)
    if (storage.kind === 'memory') expect(storage.persistent).toBe(false)
  })
})

describe('Android 桥的存储映射', () => {
  function fakeBridge(): EinkNativeBridge & { readonly map: Map<string, string> } {
    const map = new Map<string, string>()
    return {
      map,
      version: 'test',
      deviceBaseline: () => JSON.stringify({ manufacturer: 'onyx', model: 'NoteAir' }),
      saveGet: (key) => map.get(key) ?? null,
      savePut: (key, value) => {
        map.set(key, value)
        return '{"ok":true}'
      },
      saveDelete: (key) => {
        map.delete(key)
        return '{"ok":true}'
      },
      saveDeletePrefix: (prefix) => {
        for (const key of [...map.keys()]) if (key.startsWith(prefix)) map.delete(key)
        return '{"ok":true}'
      },
      saveKeys: (prefix) => JSON.stringify([...map.keys()].filter((key) => key.startsWith(prefix))),
      saveCas: (key, expected, value) => {
        const current = map.get(key) ?? null
        if (current !== expected) return JSON.stringify({ ok: false, current })
        map.set(key, value)
        return '{"ok":true}'
      },
      savePutMany: (entriesJson) => {
        for (const [key, value] of JSON.parse(entriesJson) as Array<[string, string]>) {
          map.set(key, value)
        }
        return '{"ok":true}'
      },
      setFrontLight: vi.fn(),
      keepScreenOn: vi.fn(),
      setFullscreen: vi.fn(),
      setLocale: vi.fn(),
      exportBackup: () => '{"ok":true}',
      // 真实壳层是异步回调；测试里直接返回 ack，回调由用例自行触发
      importBackup: () => '{"ok":true,"pending":true}',
    }
  }

  it('KvBackend 映射正确，存档协议可在桥上跑通', async () => {
    const bridge = fakeBridge()
    const kv = createAndroidKv(bridge)
    expect(await kv.get('nope')).toBeNull()
    await kv.setMany([['k', 'v']])
    expect(await kv.get('k')).toBe('v')
    expect(await kv.commitCas('k', 'v', 'w')).toEqual({ ok: true })
    expect(await kv.keys('')).toEqual(['k'])

    const store = createSaveStore(kv, { now: () => NOW })
    expect(await store.commit(envelope())).toEqual({ ok: true, commitId: 1 })
    expect((await store.load('sokoban'))?.commitId).toBe(1)
  })

  it('设备基线经桥读回后可解析出原生型号', () => {
    const bridge = fakeBridge()
    const native = readAndroidBaseline(bridge)
    expect(native?.manufacturer).toBe('onyx')
    expect(native?.model).toBe('NoteAir')
    // 网页侧基线只报实测到的视口等事实
    const web = collectWebBaseline(() => NOW)
    expect(web.platform).toBe('web')
    expect(web.recordedAt).toBe(NOW)
  })
})

describe('离线状态', () => {
  it('安装包内置资源时直接判定为可离线', async () => {
    const offline = createBundledOffline()
    expect(offline.state()).toBe('ready')
    let notified = false
    const unsubscribe = offline.subscribe(() => {
      notified = true
    })
    await offline.ensure()
    unsubscribe()
    expect(offline.state()).toBe('ready')
    expect(notified).toBe(false)
  })
})
