/**
 * 最小的静态文件服务（给探索套件与人工预览用）。
 *
 * 用法：node tools/scripts/serve-web.mjs [目录] [端口]
 *   默认 apps/web/dist + 8790（与 verify-all 的起始端口一致，见 docs/verification.md）。
 *   端口被占用时会直接告你换一个，而不是抛一堆栈。
 */
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'

const root = process.argv[2] ?? 'apps/web/dist'
const port = Number(process.argv[3] ?? process.env.PORT ?? 8790)
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  let path = join(root, normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, ''))
  try {
    const info = await stat(path)
    if (info.isDirectory()) path = join(path, 'index.html')
    const body = await readFile(path)
    res.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('not found')
  }
})
// 绑定所有网卡：只监听 127.0.0.1 时，容器外的浏览器会「拒绝连接」
const HOST = process.env.HOST ?? '0.0.0.0'
// 端口被占用时给一句能照做的提示（以前是未处理的 'error' 事件 + 一屏堆栈）
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`[serve-web] 端口 ${port} 已被占用：换一个，例如\n  node tools/scripts/serve-web.mjs ${root} ${port + 1}`)
  } else {
    console.error(`[serve-web] 启动失败：${error.message}`)
  }
  process.exit(1)
})
server.listen(port, HOST, () => {
  console.log(`serving ${root} on http://${HOST}:${port}`)
})
