/**
 * IndexedDB 版 KvBackend。
 *
 * 关键点：
 * - `commitCas` 必须在**同一个 readwrite 事务**里完成「读-比对-写」，
 *   这样多标签页同时提交时只有一个能成功，另一个会拿到 conflict（对应 C03/E05）。
 * - IDB 事务在微任务队列清空且没有待处理请求时会自动提交，
 *   因此这里所有后续请求都放在 success 回调里发起，而不是 await 之后。
 */
import type { KvBackend } from '@eink/core'

const STORE = 'kv'

export interface IndexedDbOptions {
  dbName?: string
  version?: number
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('indexeddb request failed'))
  })
}

function openDb(dbName: string, version: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, version)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('indexeddb open failed'))
  })
}

export async function createIndexedDbKv(options: IndexedDbOptions = {}): Promise<KvBackend> {
  const dbName = options.dbName ?? 'eink-gamebox'
  const db = await openDb(dbName, options.version ?? 1)

  return {
    async get(key) {
      const value = await request<unknown>(db.transaction(STORE, 'readonly').objectStore(STORE).get(key))
      return typeof value === 'string' ? value : null
    },

    async del(key) {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(key)
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error ?? new Error('delete failed'))
        tx.onabort = () => reject(tx.error ?? new Error('delete aborted'))
      })
    },

    async keys(prefix) {
      const tx = db.transaction(STORE, 'readonly')
      const all = await request<IDBValidKey[]>(tx.objectStore(STORE).getAllKeys())
      return all
        .map((key) => String(key))
        .filter((key) => key.startsWith(prefix))
        .sort()
    },

    commitCas(key, expectedValue, newValue) {
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite')
        const store = tx.objectStore(STORE)
        const read = store.get(key)
        read.onerror = () => reject(read.error ?? new Error('cas read failed'))
        read.onsuccess = () => {
          const raw = read.result
          const current = typeof raw === 'string' ? raw : null
          if (current !== expectedValue) {
            // 没有写操作，事务随即自动提交
            resolve({ ok: false, current })
            return
          }
          store.put(newValue, key)
          tx.oncomplete = () => resolve({ ok: true })
          tx.onerror = () => reject(tx.error ?? new Error('cas write failed'))
          tx.onabort = () => reject(tx.error ?? new Error('cas aborted'))
        }
      })
    },

    async setMany(entries) {
      if (entries.length === 0) return
      const tx = db.transaction(STORE, 'readwrite')
      const store = tx.objectStore(STORE)
      for (const [key, value] of entries) store.put(value, key)
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error ?? new Error('setMany failed'))
        tx.onabort = () => reject(tx.error ?? new Error('setMany aborted'))
      })
    },
  }
}

export function hasIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined'
}
