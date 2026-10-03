/**
 * 文档与现实核对。
 *
 * 由来：交接文档（docs/handover.md）里的命令、路径、游戏数量、测试数量，
 * 一旦与现实不符就成了误导 —— 而这类漂移极难被人工发现（本会话已多次遇到"文档说 N 款/又说 M 款"）。
 * 这里把它变成可执行检查，接入 npm run verify，漂移即失败。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const doc = readFileSync(`${ROOT}docs/handover.md`, 'utf8')
const scripts = JSON.parse(readFileSync(`${ROOT}package.json`, 'utf8')).scripts
const problems = []

// 1) 文档提到的 npm 脚本必须都存在
for (const name of new Set([...doc.matchAll(/npm run ([a-z:-]+)/g)].map((m) => m[1]))) {
  if (!(name in scripts)) problems.push(`文档提到 npm run ${name}，但 package.json 里没有`)
}

// 2) 文档提到的仓库路径必须存在（跳过 <id> 这类占位符）
for (const raw of new Set([...doc.matchAll(/`((?:packages|tools|apps|docs)\/[^`]+)`/g)].map((m) => m[1]))) {
  const target = raw.split(/\s|（/)[0]
  if (target.includes('<')) continue
  if (!existsSync(`${ROOT}${target}`)) problems.push(`文档提到路径 ${target}，但仓库里没有`)
}

// 3) 游戏数量必须与实际包数一致
const games = readdirSync(`${ROOT}packages/games`, { withFileTypes: true }).filter((e) => e.isDirectory()).length
const claimed = doc.match(/\| 游戏 \| \*\*(\d+) 款\*\* \|/)
if (!claimed) problems.push('检查点里找不到「游戏 | **N 款**」这一行')
else if (Number(claimed[1]) !== games) problems.push(`检查点说 ${claimed[1]} 款游戏，实际 ${games} 个包`)

if (problems.length > 0) {
  console.error('[check-docs] 文档与现实不一致：')
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}
console.log(`[check-docs] 一致：${games} 款游戏、命令与路径均有效`)
