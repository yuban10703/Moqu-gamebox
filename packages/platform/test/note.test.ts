// @vitest-environment jsdom
/**
 * 「我的信息」（关于页）的本机存储契约：
 * 保存后能读回、超长被截断、写失败返回 false 而不是抛异常，
 * 并且**「清除全部进度」不会删掉它**（那是用户的个人资料，不是游戏进度）。
 */
import { describe, expect, it } from 'vitest'
import { createMemoryKv, type KvBackend } from '@eink/core'
import { NOTE_MAX_LENGTH, createAppStorage } from '../src/appStorage.js'

async function storageWith(kv: KvBackend = createMemoryKv()) {
  const storage = await createAppStorage({ kv, kind: 'indexeddb' })
  return { storage, kv }
}

describe('「我的信息」存储', () => {
  it('默认是空串，保存后能原样读回', async () => {
    const { storage } = await storageWith()
    expect(await storage.loadNote()).toBe('')
    expect(await storage.saveNote('我的信息 hello')).toBe(true)
    expect(await storage.loadNote()).toBe('我的信息 hello')
  })

  it('超过上限的内容被截断（不会把本机存储写爆）', async () => {
    const { storage } = await storageWith()
    const long = 'x'.repeat(NOTE_MAX_LENGTH + 500)
    expect(await storage.saveNote(long)).toBe(true)
    expect((await storage.loadNote()).length).toBe(NOTE_MAX_LENGTH)
  })

  it('清除全部进度不会删掉「我的信息」', async () => {
    const { storage } = await storageWith()
    await storage.saveNote('保留我')
    await storage.clearAll()
    expect(await storage.loadNote()).toBe('保留我')
  })

  it('写入失败时返回 false，不抛异常', async () => {
    const kv = createMemoryKv()
    const broken: KvBackend = {
      ...kv,
      setMany: async () => {
        throw new Error('boom')
      },
    }
    const { storage } = await storageWith(broken)
    expect(await storage.saveNote('x')).toBe(false)
  })
})
