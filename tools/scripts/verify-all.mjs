#!/usr/bin/env node
/**
 * 一条命令跑完全部验证：类型检查 + 单元测试 + i18n + 构建 + 4 个探索套件。
 *
 * 为什么要它：单测全绿不等于真机能用 —— 本项目历史上「用户报出来」的缺陷
 * （首页溢出、棋盘被裁、存档打不开、翻页键无反应）全都是单测抓不到、
 * 由探索套件（真实浏览器 + 真实交互）发现的。这条命令把它们串起来，
 * 并在结束时给出一张汇总表。
 *
 * 用法：npm run verify
 */
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'

// 必须用 fileURLToPath：中文目录名经 URL.pathname 会变成 %E5%A2%A8…，cwd 立刻不存在
const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const PORT = Number(process.env.VERIFY_PORT ?? 8899)
const URL_ = process.env.WEB_URL ?? `http://127.0.0.1:${PORT}/`
const rows = []

function run(title, command, args = []) {
  process.stdout.write(`\n▶ ${title}\n`)
  // npm/npx 在本机是 shell 脚本，必须经 shell 调用，否则 spawn 直接失败且没有任何输出
  const r = spawnSync(command, args, { cwd: ROOT, stdio: 'inherit', shell: true, env: process.env })
  rows.push({ title, ok: r.status === 0 })
  return r.status === 0
}

let server = null
try {
  if (!run('类型检查 + 单元测试 + i18n + 构建（npm run check）', 'npm', ['run', 'check'])) throw new Error('check')

  // 探索套件需要静态服务：这里自己起一个，并在结束时关掉（此前需要人工先起服务）
  process.stdout.write(`\n▶ 启动静态服务 :${PORT}\n`)
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
