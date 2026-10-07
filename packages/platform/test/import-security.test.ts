import { describe, expect, it } from 'vitest'
import { createBackup, createBaseline, createMemoryKv, DEFAULT_SETTINGS, newEnvelope, reseal,
  type KvBackend } from '@eink/core'
import { createAppStorage } from '../src/appStorage.js'

const NOW = 1700000000000
const env = () => newEnvelope({ gameId: 'sokoban', rulesVersion: 1, contentVersion: 1,
  difficulty: 'starter', seed: 7, state: { levelId: 'L01', log: [] } }, NOW)
const backup = () => JSON.stringify(createBackup({ device: createBaseline({ platform: 'web', recordedAt: NOW }),
  saves: [reseal({ ...env(), state: { levelId: 'L02', log: [] } })], records: [],
  settings: DEFAULT_SETTINGS, exportedAt: NOW }))

describe('safe save replacement', () => {
  it.each(['overwrite', 'keepBoth'] as const)('keeps the current save on an import write failure (%s), including recovery', async (strategy) => {
    const memory = createMemoryKv()
    let fail = false
    const kv: KvBackend = { ...memory, async commitCas(key, expected, value) {
      if (fail && key === 'save:1:committed:sokoban') throw new Error('quota exceeded')
      return memory.commitCas(key, expected, value)
    } }
    const storage = await createAppStorage({ kv, now: () => NOW })
    await storage.saves.commit(env())
    const before = await memory.get('save:1:committed:sokoban')
    fail = true
    const result = await storage.applyImport(backup(), strategy)
    expect(result.ok).toBe(false)
    expect(await memory.get('save:1:committed:sokoban')).toBe(before)
    fail = false
    await storage.recover()
    expect(await memory.get('save:1:committed:sokoban')).toBe(before)
  })

  it('keeps the current save when restoring a backup fails', async () => {
    const memory = createMemoryKv()
    let fail = false
    const kv: KvBackend = { ...memory, async commitCas(key, expected, value) {
      if (fail) throw new Error('disk full')
      return memory.commitCas(key, expected, value)
    } }
    const storage = await createAppStorage({ kv, now: () => NOW })
    await storage.saves.commit(env())
    await storage.saves.backupBefore('sokoban', NOW)
    const current = (await storage.saves.load('sokoban'))!
    await storage.saves.commit(reseal({ ...current, state: { levelId: 'L03', log: [] } }))
    const before = await memory.get('save:1:committed:sokoban')
    fail = true
    expect(await storage.restoreBackup('sokoban', NOW)).toBe(false)
    expect(await memory.get('save:1:committed:sokoban')).toBe(before)
    fail = false
    await storage.recover()
    expect(await memory.get('save:1:committed:sokoban')).toBe(before)
  })

  it('does not overwrite the first archive when multiple imports use the same timestamp', async () => {
    const memory = createMemoryKv()
    const storage = await createAppStorage({ kv: memory, now: () => NOW })
    await storage.saves.commit(env())
    await storage.applyImport(backup(), 'keepBoth')
    await storage.applyImport(backup(), 'keepBoth')
    const archives = await storage.listBackups()
    expect(archives).toHaveLength(2)
    expect(await storage.restoreBackup('sokoban', NOW)).toBe(true)
    expect((await storage.saves.load('sokoban'))?.state).toEqual(env().state)
  })

  it('rejects an autosave from a session opened before replacement', async () => {
    const storage = await createAppStorage({ kv: createMemoryKv(), now: () => NOW })
    await storage.saves.commit(env())
    const stale = (await storage.saves.load('sokoban'))!
    expect((await storage.applyImport(backup(), 'overwrite')).ok).toBe(true)
    expect(await storage.saves.commit(stale)).toMatchObject({ ok: false, reason: 'conflict' })
    expect((await storage.saves.load('sokoban'))?.state).toEqual({ levelId: 'L02', log: [] })
  })

  it('does not overwrite a concurrent update while replacing a save', async () => {
    const memory = createMemoryKv()
    let concurrent: string | null = null
    const kv: KvBackend = { ...memory, async commitCas(key, expected, value) {
      if (concurrent && key === 'save:1:committed:sokoban') {
        await memory.setMany([[key, concurrent]])
        concurrent = null
      }
      return memory.commitCas(key, expected, value)
    } }
    const storage = await createAppStorage({ kv, now: () => NOW })
    await storage.saves.commit(env())
    const latest = JSON.stringify(reseal({ ...env(), commitId: 2, state: { levelId: 'L03', log: [] } }))
    concurrent = latest
    expect((await storage.applyImport(backup(), 'overwrite')).ok).toBe(false)
    expect(await memory.get('save:1:committed:sokoban')).toBe(latest)
    await storage.recover()
    expect(await memory.get('save:1:committed:sokoban')).toBe(latest)
  })

  it('ignores malformed records already in local storage so export remains usable', async () => {
    const storage = await createAppStorage({ kv: createMemoryKv({
      'records:1:1': 'null', 'records:1:2': 'null',
    }) })
    expect(await storage.listRecords()).toEqual([])
    await expect(storage.createBackupText(createBaseline({ platform: 'web', recordedAt: NOW }), NOW)).resolves.toBeTypeOf('string')
  })
})
