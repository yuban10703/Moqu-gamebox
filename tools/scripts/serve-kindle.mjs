/**
 * 给 Kindle 用的局域网静态服务。
 *
 * 与 serve-web.mjs 的关键差别：**绑定 0.0.0.0 并打印局域网地址**。
 * Kindle 要通过 WiFi 访问，绑在 127.0.0.1 上它永远连不上 —— 这是最常踩的一次坑。
 *
 * 用法：node tools/scripts/serve-kindle.mjs [目录] [端口]
 *   默认 apps/kindle/dist + 8791。
 */
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { networkInterfaces } from 'node:os'
import { extname, join, normalize } from 'node:path'

const root = process.argv[2] ?? 'apps/kindle/dist'
const port = Number(process.argv[3] ?? process.env.PORT ?? 8791)

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
}

/** 找出本机的局域网 IPv4（Kindle 要用的就是它） */
function lanAddresses() {
  const out = []
  const interfaces = networkInterfaces()
  for (const name of Object.keys(interfaces)) {
    for (const info of interfaces[name] ?? []) {
      if (info.family === 'IPv4' && !info.internal) out.push({ name, address: info.address })
    }
  }
  return out
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  let path = join(root, normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, ''))
  try {
    const info = await stat(path)
    if (info.isDirectory()) path = join(path, 'index.html')
    const body = await readFile(path)
    res.writeHead(200, {
      'content-type': types[extname(path)] ?? 'application/octet-stream',
      /*
       * 明确禁掉缓存：这台服务器是给"改完立刻在设备上看"用的，
       * 缓存住旧产物会让人以为是代码没生效（老 Kindle 浏览器连强刷都难按）。
       */
      'cache-control': 'no-store, must-revalidate',
    })
    res.end(body)
  } catch (error) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('404 ' + url.pathname)
  }
})

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`端口 ${port} 被占用了：换一个，例如 node tools/scripts/serve-kindle.mjs ${root} ${port + 1}`)
    process.exit(1)
  }
  throw error
})

server.listen(port, '0.0.0.0', () => {
  console.log(`墨趣 Kindle 版已就绪（目录 ${root}）\n`)
  console.log(`  本机：      http://127.0.0.1:${port}/`)
  const addresses = lanAddresses()
  if (addresses.length === 0) {
    console.log('  局域网：    没有找到非回环地址（Kindle 需要和这台电脑在同一个 WiFi 下）')
  } else {
    for (const item of addresses) {
      console.log(`  局域网(${item.name})： http://${item.address}:${port}/`)
    }
    console.log('\n  在 Kindle 自带浏览器里打开上面的「局域网」地址即可。')
  }
  console.log(`  设备自检页：http://<上面的地址>/check.html`)
  console.log('\n  Ctrl+C 停止')
})
