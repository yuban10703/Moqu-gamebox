/**
 * 当前状态一览：游戏数、测试数、探索套件、真机入口、未结项、最近提交。
 * 用途：每轮开始时花几秒确认"现在是什么状态"，不必手工 grep 文档与 git。
 */
import { execSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const sh = (cmd) => execSync(cmd, { cwd: ROOT, encoding: 'utf8' }).trim()
const games = readdirSync(`${ROOT}packages/games`, { withFileTypes: true }).filter((e) => e.isDirectory()).length
const suites = readdirSync(`${ROOT}tools/scripts`).filter((f) => f.startsWith('explore-') && f.endsWith('.mjs')).length
const pkg = JSON.parse(readFileSync(`${ROOT}package.json`, 'utf8'))
const doc = readFileSync(`${ROOT}docs/handover.md`, 'utf8')
const checkpoint = doc.match(/\| 游戏 \| \*\*(\d+) 款\*\*[\s\S]*?\| 单元测试 \| \*\*(\d+)\*\*/)

console.log('=== 墨水屏游戏盒子 · 状态 ===')
console.log(`游戏          ${games} 款`)
console.log(`单元测试      ${checkpoint ? checkpoint[2] : '?'}（文档检查点；以 npm run check 实际输出为准）`)
console.log(`探索套件      ${suites} 个（npm run explore）`)
console.log(`一键验证      npm run check / npm run verify`)
console.log(`真机验收      tools/device/verify-device.sh <设备地址> [端口]`)
console.log(`元检查        check:docs（文档与现实）/ check:games（接入完整性）`)
console.log(`工作区        ${sh('git status --short').split('\n').filter(Boolean).length === 0 ? '干净' : '有未提交改动'}`)
console.log(`最近提交      ${sh('git log --oneline -3').split('\n').join('\n              ')}`)
