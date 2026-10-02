import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'

const root = process.argv[2] ?? 'apps/web/dist'
const port = Number(process.argv[3] ?? 8899)
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
server.listen(port, HOST, () => {
  console.log(`serving ${root} on http://${HOST}:${port}`)
})
