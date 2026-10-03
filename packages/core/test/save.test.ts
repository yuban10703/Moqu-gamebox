/**
 * 存档提交协议 / 备份 / 设置的测试。
 * 这里守的是验收要求 C03–C05：写入原子化、恢复「最后一次明确提交成功」的局面、
 * 写入失败可见、跨端备份可用且导入冲突有明确策略。
 */
import { describe, expect, it } from 'vitest'
import {
  applyAction,
  newEnvelope,
  parseEnvelope,
  reseal,
  verifyChecksum,
} from '../src/save.js'
import { createMemoryKv, createSaveStore } from '../src/storage.js'
import { createBackup, parseBackup, planImport } from '../src/backup.js'
import { createBaseline } from '../src/diagnostics.js'
import { DEFAULT_SETTINGS, effectiveSettings, parseSettings, setGameSettings } from '../src/settings.js'
import { mutateSession } from '../src/save.js'

const NOW = 1_700_000_000_000

function envelope(gameId = 'sokoban') {
  return newEnvelope(
    {
      gameId,
      rulesVersion: 1,
      contentVersion: 1,
      difficulty: 'starter',
      seed: 42,
      state: { levelId: 'L01', log: [] },
    },
    NOW,
  )
}

/** 模拟走一步：状态推进 + 计数 +1 */
function step(envelope: ReturnType<typeof newEnvelope>, action: unknown, at: number) {
  const state = envelope.state as { log: unknown[] }
  return applyAction(envelope, { ...state, log: [...state.log, action] }, at)
}

describe('存档提交协议', () => {
  it('首次提交分配 commitId 1，第二次为 2，内容可原样读回', async () => {
    const kv = createMemoryKv()
    const store = createSaveStore(kv, { now: () => NOW })
    const first = await store.commit(envelope())
    expect(first).toEqual({ ok: true, commitId: 1 })

    const loaded = await store.load('sokoban')
    expect(loaded?.commitId).toBe(1)
    expect(loaded && verifyChecksum(loaded)).toBe(true)

    const second = await store.commit(step(loaded!, { type: 'move', dir: 'up' }, NOW + 1))
    expect(second).toEqual({ ok: true, commitId: 2 })
    const reloaded = await store.load('sokoban')
    expect(reloaded?.moves).toBe(1)
    expect((reloaded?.state as { log: unknown[] }).log).toHaveLength(1)
    expect(reloaded?.commitId).toBe(2)
  })

  it('用陈旧 commitId 提交会被判定为冲突（多标签页/多端防覆盖）', async () => {
    const kv = createMemoryKv()
    const store = createSaveStore(kv, { now: () => NOW })
    await store.commit(envelope())
    // 另一个窗口又提交了一次
    const current = await store.load('sokoban')
    await store.commit(step(current!, { type: 'move', dir: 'up' }, NOW + 1))

    // 本窗口仍以为自己基于 commitId 1
    const stale = reseal({ ...(current as NonNullable<typeof current>), commitId: 1 })
    const result = await store.commit(stale)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('conflict')
  })

  it('写入失败时返回明确原因，且不破坏已有存档', async () => {
    const kv = createMemoryKv()
    const store = createSaveStore(kv, { now: () => NOW })
    await store.commit(envelope())
    const current = await store.load('sokoban')

    kv.failNext(new Error('QuotaExceededError: storage full'))
    const failed = await store.commit(step(current!, { type: 'move', dir: 'up' }, NOW + 1))
    expect(failed.ok).toBe(false)
    if (!failed.ok) expect(failed.reason).toBe('quota')

    // 原存档仍然可读，且仍是提交成功的那一版
    const stillThere = await store.load('sokoban')
    expect(stillThere?.commitId).toBe(1)
    expect(stillThere?.moves).toBe(0)
  })

  it('崩溃后 recover 会补提交未完成的 pending', async () => {
    const kv = createMemoryKv()
    const store = createSaveStore(kv, { now: () => NOW })
    const target = reseal({ ...envelope(), commitId: 1 })
    await kv.setMany([['save:1:pending:sokoban', JSON.stringify({ target })]])

    const report = await store.recover()
    expect(report.recovered).toEqual(['sokoban'])
    const loaded = await store.load('sokoban')
    expect(loaded?.commitId).toBe(1)
    // pending 已被清理
    expect(await kv.get('save:1:pending:sokoban')).toBeNull()
  })

  it('recover 丢弃损坏的 pending，并保留原有存档', async () => {
    const kv = createMemoryKv()
    const store = createSaveStore(kv, { now: () => NOW })
    await store.commit(envelope())
    await kv.setMany([['save:1:pending:sokoban', '{not json']])

    const report = await store.recover()
    expect(report.discarded).toEqual(['sokoban'])
    expect((await store.load('sokoban'))?.commitId).toBe(1)
  })

  it('recover 上报「已提交但损坏」的存档，且不删除它', async () => {
    const kv = createMemoryKv()
    const store = createSaveStore(kv, { now: () => NOW })
    await store.commit(envelope())
    // 模拟外部损坏：JSON 合法（结构像样）但校验和不匹配
    await kv.setMany([
      ['save:1:committed:sokoban', '{"envelope":{"gameId":"sokoban"},"checksum":"deadbeef"}'],
    ])

    const report = await store.recover()
    expect(report.corrupt).toEqual(['sokoban'])
    // 不能静默丢弃：数据要留着，由界面提供导出/清除
    expect(report.discarded).toEqual([])
    expect(await kv.get('save:1:committed:sokoban')).not.toBeNull()
    expect(await store.loadResult('sokoban')).toEqual({ status: 'corrupt', reason: expect.any(String) })
  })

  it('已提交的存档被截断成垃圾时，list() 仍用 key 里的 gameId 上报为损坏', async () => {
    const kv = createMemoryKv()
    const store = createSaveStore(kv, { now: () => NOW })
    await store.commit(envelope())
    await kv.setMany([['save:1:committed:sokoban', '{broken']])

    const metas = await store.list()
    expect(metas).toHaveLength(1)
    expect(metas[0]).toMatchObject({ gameId: 'sokoban', corrupt: true })
  })

  it('健康存档不会被误报为损坏', async () => {
    const kv = createMemoryKv()
    const store = createSaveStore(kv, { now: () => NOW })
    await store.commit(envelope())
    const report = await store.recover()
    expect(report.corrupt).toEqual([])
  })

  it('recover 清理陈旧的 pending（提交点已经越过它）', async () => {
    const kv = createMemoryKv()
    const store = createSaveStore(kv, { now: () => NOW })
    await store.commit(envelope())
    const stale = reseal({ ...envelope(), commitId: 0 })
    await kv.setMany([['save:1:pending:sokoban', JSON.stringify({ target: stale })]])

    const report = await store.recover()
    expect(report.cleaned).toEqual(['sokoban'])
    expect(report.recovered).toEqual([])
    expect((await store.load('sokoban'))?.commitId).toBe(1)
  })

  it('列表能给出全部存档的元信息，损坏项会被标记', async () => {
    const kv = createMemoryKv()
    const store = createSaveStore(kv, { now: () => NOW })
    await store.commit(envelope('sokoban'))
    await store.commit(envelope('other-game'))
    await kv.setMany([
      [
        'save:1:committed:broken',
        JSON.stringify({ gameId: 'broken', commitId: 3, updatedAt: NOW, difficulty: 'x', moves: 2 }),
      ],
    ])

    const list = await store.list()
    expect(list.map((meta) => meta.gameId).sort()).toEqual(['broken', 'other-game', 'sokoban'])
    expect(list.find((meta) => meta.gameId === 'broken')?.corrupt).toBe(true)
  })

  it('迁移前备份会留下副本，clearAll 能整体清空', async () => {
    const kv = createMemoryKv()
    const store = createSaveStore(kv, { now: () => NOW })
    await store.commit(envelope())
    await store.backupBefore('sokoban', 1)
    expect(await kv.get('save:1:backup:sokoban:1')).not.toBeNull()

    await store.clearAll()
    expect(await store.list()).toEqual([])
    expect((await store.rawAll()).length).toBe(0)
  })
})

describe('存档校验与迁移', () => {
  it('校验和被改动后判定为损坏', () => {
    const env = envelope()
    const tampered = { ...env, difficulty: 'challenging' }
    const parsed = parseEnvelope(tampered)
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.reason).toBe('corrupt')
  })

  it('非法 JSON 判定为损坏', () => {
    const parsed = parseEnvelope('{oops')
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.reason).toBe('corrupt')
  })

  it('高于当前 schema 的存档判定为版本不受支持，而不是损坏', () => {
    const env = reseal({ ...envelope(), schema: 99 as unknown as 1 })
    const parsed = parseEnvelope(env)
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.reason).toBe('unsupported-version')
  })

  it('会话统计可独立更新且校验和随之更新', () => {
    const env = mutateSession(envelope(), { elapsedMs: 5000, hintsUsed: 1, ended: 'won' }, NOW + 9)
    expect(verifyChecksum(env)).toBe(true)
    expect(env.session.ended).toBe('won')
    const parsed = parseEnvelope(env)
    expect(parsed.ok).toBe(true)
  })
})

describe('跨端备份', () => {
  const baseline = createBaseline({
    platform: 'android',
    manufacturer: 'onyx',
    model: 'NoteAir',
    recordedAt: NOW,
  })

  function makeBackup() {
    const env = envelope()
    return createBackup({
      device: baseline,
      saves: [env],
      records: [
        {
          gameId: 'sokoban',
          difficulty: 'starter',
          finishedAt: NOW,
          outcome: 'won',
          moves: 12,
          elapsedMs: 60_000,
          hintsUsed: 0,
        },
      ],
      settings: DEFAULT_SETTINGS,
      exportedAt: NOW,
    })
  }

  it('导出后可以完整解析回来', () => {
    const parsed = parseBackup(JSON.stringify(makeBackup()))
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.backup.saves).toHaveLength(1)
      expect(parsed.backup.device.model).toBe('NoteAir')
      expect(parsed.warnings).toEqual([])
    }
  })

  it('被篡改的备份会被校验和拦住', () => {
    const backup = makeBackup()
    const tampered = JSON.stringify({ ...backup, saves: [] })
    const parsed = parseBackup(tampered)
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.errors).toContain('checksum-mismatch')
  })

  it('非 JSON 内容会被明确拒绝', () => {
    const parsed = parseBackup('nope')
    expect(parsed.ok).toBe(false)
  })

  it('导入计划覆盖三种冲突策略，默认保留双方', () => {
    const incoming = parseEnvelope(envelope()) as { ok: true; envelope: ReturnType<typeof envelope> }
    expect(incoming.ok).toBe(true)
    const existing = [
      { gameId: 'sokoban', commitId: 5, updatedAt: NOW, difficulty: 'starter', moves: 3, corrupt: false },
    ]
    expect(planImport([incoming.envelope], existing, 'keepBoth').decisions[0]?.action).toBe('keepBoth')
    expect(planImport([incoming.envelope], existing, 'overwrite').decisions[0]?.action).toBe('overwrite')
    expect(planImport([incoming.envelope], existing, 'skip').decisions[0]?.action).toBe('skip')
    expect(planImport([incoming.envelope], [], 'skip').decisions[0]?.action).toBe('add')
  })
})

describe('设置模型', () => {
  it('单游戏覆盖优先于全局默认', () => {
    const withOverride = setGameSettings(DEFAULT_SETTINGS, 'sokoban', { timer: false, difficulty: 'skilled' })
    expect(effectiveSettings(withOverride, 'sokoban').timer).toBe(false)
    expect(effectiveSettings(withOverride, 'sokoban').difficulty).toBe('skilled')
    expect(effectiveSettings(withOverride, 'other').timer).toBe(true)
  })

  it('损坏或非法的设置回落为默认值而不是崩溃', () => {
    expect(parseSettings(null).fontScale).toBe(1)
    expect(parseSettings({ fontScale: 7 }).fontScale).toBe(1)
  })

  it('旧存档里的 refreshProfile 字段被忽略且解析不报错（向后兼容）', () => {
    // 旧版本写下的设置快照里带 refreshProfile；字段已删除，但旧存档必须照常读入
    const legacy = JSON.stringify({
      locale: 'zh-CN',
      fontScale: 1.25,
      refreshProfile: 'speed',
      timer: false,
      dpad: true,
      boldLines: true,
      perGame: { sokoban: { difficulty: 'skilled' } },
    })
    const parsed = parseSettings(JSON.parse(legacy))
    expect(parsed.locale).toBe('zh-CN')
    expect(parsed.fontScale).toBe(1.25)
    expect(parsed.timer).toBe(false)
    expect(Object.keys(parsed)).not.toContain('refreshProfile')
    expect(effectiveSettings(parsed, 'sokoban').difficulty).toBe('skilled')
  })
})
