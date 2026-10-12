/**
 * Android 桥的错误面契约（评审发现：keys() 吞坏响应返回 []，让界面把「进度还在」画成
 * 「什么都没有」；commitCas 的坏响应被折叠成 conflict，空间不足会被误报成 I/O）。
 */
import { describe, expect, it } from 'vitest'
import { createAndroidKv, type EinkNativeBridge } from '../src/androidBridge.js'

type Overrides = Partial<Record<keyof EinkNativeBridge, unknown>>

function bridge(overrides: Overrides = {}): EinkNativeBridge {
  const base = {
    deviceBaseline: () => '{}',
    saveGet: () => null,
    saveDelete: () => JSON.stringify({ ok: true }),
    saveKeys: (prefix: string) => JSON.stringify([`${prefix}a`]),
    saveCas: () => JSON.stringify({ ok: true }),
    savePutMany: () => JSON.stringify({ ok: true }),
    keepScreenOn: () => {},
    setFullscreen: () => {},
    setLocale: () => {},
    exportBackup: () => JSON.stringify({ ok: true }),
    importBackup: () => JSON.stringify({ ok: true, pending: true }),
  }
  return Object.assign(base, overrides) as unknown as EinkNativeBridge
}

describe('Android 桥的错误面', () => {
  it('keys() 遇到坏响应必须抛错，而不是返回空数组（否则进度被画成「什么都没有」）', async () => {
    const kv = createAndroidKv(bridge({ saveKeys: () => 'not-json' }))
    await expect(kv.keys('save:')).rejects.toThrow('bridge keys failed')
  })

  it('keys() 正常路径仍然可用', async () => {
    const kv = createAndroidKv(bridge({}))
    expect(await kv.keys('save:')).toEqual(['save:a'])
  })

  it('commitCas() 的结构化错误要上抛（io）；真正的 CAS 冲突才返回 conflict', async () => {
    const failing = createAndroidKv(bridge({ saveCas: () => JSON.stringify({ ok: false, error: 'io' }) }))
    await expect(failing.commitCas('k', null, 'v')).rejects.toThrow('io')

    const conflicting = createAndroidKv(bridge({ saveCas: () => JSON.stringify({ ok: false, current: 'x' }) }))
    const result = await conflicting.commitCas('k', null, 'v')
    expect(result.ok).toBe(false)
  })
})
