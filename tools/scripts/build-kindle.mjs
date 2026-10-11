/**
 * Kindle 版构建：tsc 降到 ES5 → 复制静态资源 → **机械校验 ES5 纯净** → 报告体积。
 *
 * 为什么不走 Vite：Vite 8 的打包器是 rolldown，它**明确不支持 ES2015 以下**
 * （实测报错：`Invalid target 'es5'. Rolldown only supports ES2015 (ES6) and later.`）。
 * 所以 Kindle 这条线单独走 `tsc --target ES5 --module AMD --outFile` + 一个 60 行的 AMD shim。
 *
 * 产物（apps/kindle/dist/，纯静态、可直接丢到任意托管）：
 *   index.html     入口（经典脚本，不是 module）
 *   check.html     设备自检页（零依赖，主应用跑不起来时用它排障）
 *   kindle.css     老 WebKit 能认的样式（无变量 / 无 grid / 无 calc）
 *   polyfills.js   ES2015+ 运行时方法补齐
 *   amd-shim.js    AMD 执行器
 *   kindle.js      core + 全部玩法 + 壳层（ES5）
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { checkFiles } from './check-es5.mjs'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const APP = `${ROOT}apps/kindle/`
const DIST = `${APP}dist/`

function sizeOf(path) {
  return statSync(path).size
}

function kb(bytes) {
  return `${(bytes / 1024).toFixed(0)} KB`
}

console.log('▶ Kindle 构建开始\n')

// ---------- 1. 清空产物目录 ----------
rmSync(DIST, { recursive: true, force: true })
mkdirSync(DIST, { recursive: true })

// ---------- 2. tsc：整个应用降到 ES5（含 core 与 20 款玩法） ----------
console.log('· tsc --target ES5 --module AMD --outFile')
let tscOk = true
try {
  execFileSync(`${ROOT}node_modules/.bin/tsc`, ['-p', `${APP}tsconfig.json`], {
    cwd: ROOT,
    stdio: 'pipe',
    encoding: 'utf8',
  })
} catch (error) {
  tscOk = false
  const output = `${error.stdout ?? ''}${error.stderr ?? ''}`
  console.error('❌ 类型检查 / 编译失败：\n' + output.trim())
}

if (!existsSync(`${DIST}kindle.js`)) {
  console.error('\n❌ 没有产出 dist/kindle.js，构建中止')
  process.exit(1)
}
if (!tscOk) {
  console.error('\n❌ tsc 报了错误（产物不完整），构建中止')
  process.exit(1)
}

// ---------- 3. 复制静态资源 ----------
const assets = [
  ['public/polyfills.js', 'polyfills.js'],
  ['public/amd-shim.js', 'amd-shim.js'],
  ['src/styles/kindle.css', 'kindle.css'],
  ['index.html', 'index.html'],
  ['check.html', 'check.html'],
]
for (const [from, to] of assets) {
  const source = `${APP}${from}`
  if (!existsSync(source)) {
    console.error(`❌ 缺少资源 ${from}`)
    process.exit(1)
  }
  copyFileSync(source, `${DIST}${to}`)
}
console.log(`· 复制 ${assets.length} 个静态资源`)

// ---------- 4. ES5 语法守卫（产物必须逐字节干净） ----------
console.log('· ES5 语法守卫')
const jsFiles = readdirSync(DIST)
  .filter((name) => name.endsWith('.js'))
  .map((name) => `${DIST}${name}`)
const problems = checkFiles(jsFiles)
if (problems.size > 0) {
  for (const [file, violations] of problems) {
    console.error(`\n❌ ${file} 有 ${violations.length} 处 ES5 之后的语法：`)
    for (const violation of violations.slice(0, 15)) {
      console.error(`   - 第 ${violation.line} 行 [${violation.kind}] ${violation.snippet}`)
    }
  }
  console.error('\n❌ 产物不是纯 ES5：Kindle 上会整段脚本不执行（白屏）。构建中止。')
  process.exit(1)
}
console.log(`   ✓ ${jsFiles.length} 个 JS 文件全部为纯 ES5`)

// ---------- 5. 体积报告 ----------
const report = []
let total = 0
for (const name of readdirSync(DIST).sort()) {
  const bytes = sizeOf(`${DIST}${name}`)
  total += bytes
  report.push(`   ${name.padEnd(16)} ${kb(bytes).padStart(9)}`)
}
console.log('\n· 产物体积')
console.log(report.join('\n'))
console.log(`   ${'合计'.padEnd(15)} ${kb(total).padStart(9)}`)

// 首次打开必须下载的部分（不含 check.html）：Kindle 的 WiFi 与解析都慢，这个数字要盯住
const firstLoad = ['index.html', 'kindle.css', 'polyfills.js', 'amd-shim.js', 'kindle.js']
  .map((name) => sizeOf(`${DIST}${name}`))
  .reduce((a, b) => a + b, 0)
console.log(`   首屏需要下载：${kb(firstLoad)}（gzip 后通常约为 1/4）`)

// ---------- 6. 构建信息 ----------
const stamp = new Date().toISOString()
writeFileSync(
  `${DIST}build-info.json`,
  JSON.stringify({ builtAt: stamp, firstLoadBytes: firstLoad, totalBytes: total }, null, 2) + '\n',
  'utf8',
)

console.log(`\n✅ Kindle 产物就绪：apps/kindle/dist/（${stamp}）`)
console.log('   本地起服务：npm run serve:kindle')
