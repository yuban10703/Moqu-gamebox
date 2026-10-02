#!/usr/bin/env node
/**
 * 生成 Service Worker（构建后置步骤）。
 *
 * 为什么自己写而不用插件：离线协议要和界面「已可离线」的状态显示对齐，
 * 需要明确的握手消息；自己写只有 60 行，依赖为零，行为可读可审。
 *
 * 协议：
 *   - 安装阶段预缓存构建产物列表，完成后向所有客户端广播 { type: 'eink:precache', cache }
 *   - 页面可以发送 { type: 'eink:query' } 主动询问，SW 回同样一条消息
 *   - 只缓存同源 GET；导航请求回落到 index.html
 */
import { readdirSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, relative, sep } from 'node:path'

const dist = process.argv[2] ?? 'apps/web/dist'

/** @type {string[]} */
const files = []
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const stat = statSync(full)
    if (stat.isDirectory()) walk(full)
    else files.push(relative(dist, full).split(sep).join('/'))
  }
}
walk(dist)

const assets = files.filter((file) => file !== 'sw.js').sort()
if (assets.length === 0) {
  console.error(`[generate-sw] ${dist} 里没有产物，先执行 npm run build:web`)
  process.exit(1)
}

const fingerprint = createHash('sha1')
  .update(assets.map((file) => `${file}:${statSync(join(dist, file)).size}`).join('|'))
  .digest('hex')
  .slice(0, 10)

const source = `/* 自动生成，请勿手工编辑：npm run build:web（由 tools/scripts/generate-sw.mjs 产出） */
const CACHE = 'eink-gamebox-${fingerprint}'
const ASSETS = ${JSON.stringify(assets, null, 2)}

async function broadcast() {
  const clients = await self.clients.matchAll({ includeUncontrolled: true })
  for (const client of clients) {
    client.postMessage({ type: 'eink:precache', cache: CACHE, files: ASSETS.length })
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE)
    await cache.addAll(ASSETS.map((path) => new URL(path, self.registration.scope).toString()))
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys()
    await Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name)))
    await self.clients.claim()
    await broadcast()
  })())
})

self.addEventListener('message', (event) => {
  const data = event.data
  if (data && data.type === 'eink:query') event.waitUntil(broadcast())
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  event.respondWith((async () => {
    const cache = await caches.open(CACHE)
    const cached = await cache.match(request, { ignoreSearch: true })
    if (cached) return cached
    try {
      const response = await fetch(request)
      if (response && response.ok && response.type === 'basic') {
        cache.put(request, response.clone())
      }
      return response
    } catch (error) {
      const fallback = await cache.match('index.html')
      if (fallback) return fallback
      throw error
    }
  })())
})
`

writeFileSync(join(dist, 'sw.js'), source, 'utf8')
console.log(`[generate-sw] sw.js 已生成：缓存 ${assets.length} 个文件，版本 ${fingerprint}`)
