#!/usr/bin/env node
/**
 * 一条命令跑完全部验证：类型检查 + 单元测试 + i18n + 构建 + 4 个探索套件。
 *
 * 为什么要它：单测全绿不等于真机能用 —— 本项目历史上「用户报出来」的缺陷
 * （首页溢出、棋盘被裁、存档打不开、翻页键无反应）全都是单测抓不到、
 * 由探索套件（真实浏览器 + 真实交互）发现的。这条命令把它们串起来，
 * 并在结束时给出一张汇总表。
 *
 * 端口策略（本文件 2026-10-04 改）：**默认不再固定占用某个端口** ——
 * 从 DEFAULT_PORT（8790）起找第一个空闲端口，跑完自动关掉。
 * 起因：以前固定 8899，而本机同时有多个会话/多棵工作区时，
 * 谁先占了谁就被测到（曾经 explore-data 测到另一棵工作区的旧构建），
 * 而且那个端口上的服务跑完就消失，很容易被误当成「长期预览地址」。
 * 需要固定端口时：`VERIFY_PORT=8801 npm run verify`；
 * 想长期预览最新构建：`npm run preview:web`（见 docs/verification.md）。
 *
 * 用法：npm run verify
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'

// 必须用 fileURLToPath：中文目录名经 URL.pathname 会变成 %E5%A2%A8…，cwd 立刻不存在
const ROOT = fileURLToPath(new URL('../../', import.meta.url))
/** 临时服务的起始端口；被占用就往后找（见 findFreePort） */
const DEFAULT_PORT = 8790

/**
 * 从 start 起找第一个空闲端口。
 * 用「绑定 0.0.0.0 再立刻释放」探测：与 serve-web.mjs 的监听方式一致，
 * 因此 127.0.0.1 被别的进程占着也能探测出来。
 */
async function findFreePort(start, tries = 50) {
  for (let port = start; port < start + tries; port++) {
    const free = await new Promise((resolve) => {
      const probe = createServer()
      probe.once('error', () => resolve(false))
      probe.once('listening', () => probe.close(() => resolve(true)))
      probe.listen(port, '0.0.0.0')
    })
    if (free) return port
  }
  throw new Error(`从 ${start} 起连续 ${tries} 个端口都被占用`)
}

const PORT = process.env.VERIFY_PORT ? Number(process.env.VERIFY_PORT) : await findFreePort(DEFAULT_PORT)
const URL_ = process.env.WEB_URL ?? `http://127.0.0.1:${PORT}/`
const rows = []

function run(title, command, args = []) {
  process.stdout.write(`\n▶ ${title}\n`)
  // npm/npx 在本机是 shell 脚本，必须经 shell 调用，否则 spawn 直接失败且没有任何输出
  // WEB_URL 显式下发：套件的兜底默认端口与本文件的 DEFAULT_PORT 一致（8790），
  // 但本文件可能自动换了端口，因此必须显式传，否则会静默去测另一个服务
  // （踩过：explore-data 测到了另一棵工作区的旧构建）
  const r = spawnSync(command, args, { cwd: ROOT, stdio: 'inherit', shell: true, env: { ...process.env, WEB_URL: URL_ } })
  rows.push({ title, ok: r.status === 0 })
  return r.status === 0
}

/*
 * 前置检查：探索套件用的 Playwright 装在 gitignored 的 .toolchain/pw，
 * 新克隆的仓库里没有 —— 缺了只会报 ERR_MODULE_NOT_FOUND，很难定位。
 * 这里提前给出可直接执行的安装步骤。
 */
const playwrightDir = fileURLToPath(new URL('../../.toolchain/pw/node_modules/playwright', import.meta.url))
if (!existsSync(playwrightDir)) {
  console.error(
    [
      '',
      '缺少探索套件依赖（Playwright，装在 gitignored 的 .toolchain/pw）。一次即可：',
      '',
      '  mkdir -p .toolchain/pw && cd .toolchain/pw && npm init -y && npm i playwright',
      '  npx playwright install chromium && npx playwright install-deps chromium',
      '',
      '（需要 sudo/root 安装系统库；仅首次需要，之后 npm run verify 可直接跑。）',
      '',
    ].join('\n'),
  )
  process.exit(1)
}

let server = null
try {
  if (!run('类型检查 + 单元测试 + i18n + 构建 + 文档核对（npm run check）', 'npm', ['run', 'check'])) throw new Error('check')

  // 探索套件需要静态服务：这里自己起一个，并在结束时关掉（此前需要人工先起服务）
  process.stdout.write(
    `\n▶ 启动静态服务 :${PORT}${process.env.VERIFY_PORT ? '（VERIFY_PORT 指定）' : '（自动挑的空闲端口）'}\n`,
  )
  server = spawn('node', ['tools/scripts/serve-web.mjs', 'apps/web/dist', String(PORT)], { cwd: ROOT, stdio: 'ignore' })
  let up = false
  for (let i = 0; i < 30 && !up; i++) {
    await sleep(200)
    try {
      const res = await fetch(URL_)
      up = res.ok
    } catch {
      up = false
    }
  }
  if (!up) throw new Error('静态服务未就绪')
  process.stdout.write('  服务就绪\n')

  const suites = [
    ['探索套件 1/5：界面与交互', 'tools/scripts/explore-ui.mjs'],
    ['探索套件 2/5：数据完整性', 'tools/scripts/explore-data.mjs'],
    ['探索套件 3/5：完整流程', 'tools/scripts/explore-flows.mjs'],
    ['探索套件 4/5：最大字号档位巡检', 'tools/scripts/explore-maxscale.mjs'],
    ['探索套件 5/5：极矮横屏巡检', 'tools/scripts/explore-landscape.mjs'],
  ]
  for (const [title, script] of suites) {
    if (!run(title, 'node', [script])) throw new Error(title)
  }
} catch (error) {
  rows.push({ title: `中断：${String(error.message ?? error)}`, ok: false })
} finally {
  if (server) server.kill()
}

console.log('\n================ 汇总 ================')
for (const row of rows) console.log(`${row.ok ? '✓' : '✗'} ${row.title}`)
const failed = rows.filter((r) => !r.ok).length
console.log(`\n${failed === 0 ? '全部通过' : `${failed} 项失败`}`)
process.exit(failed === 0 ? 0 : 1)
