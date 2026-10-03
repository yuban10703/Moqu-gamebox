/**
 * 汇总 deep-audit.mjs 的报告：把每个分辨率档位的 report.json 合成一张覆盖矩阵。
 *
 * 用法：node tools/scripts/deep-report.mjs
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs'

const ROOT = '.toolchain/shots/deep-audit'
if (!existsSync(ROOT)) throw new Error(`没有找到 ${ROOT}（先跑 deep-audit.mjs）`)

const CHECK_ORDER = [
  '能进对局（格子数 > 0）',
  '棋盘完整落在棋盘区内（四边溢出量不为正）',
  '棋盘在屏内',
  '无屏外按钮',
  '无缺键 ⟦',
  '统计栏无截断',
  '无动画/过渡',
  '1-bit：无灰阶块',
  '至少 3 次有效操作且局面真的变化',
  '非法输入有明确反馈且局面不变',
  '无方向键玩法按方向键不弹假提示',
  '撤销按钮由 disabled 变可用',
  '撤销后逐格 + 统计回到上一步',
  '重新开始留在同一关',
  '重新开始回到本关初始局面',
  '重新开始换了题目（棋盘内容不同）',
  '重新开始后「本关用时」从 0 起算',
  '重新开始后新局立即落盘',
  '重新开始换了种子（存档 seed 变化）',
  '离局再进进度还在',
  '离局再进进度还在（不是从头开始）',
  '无控制台错误 / pageerror',
]

const files = []
for (const dir of readdirSync(ROOT, { withFileTypes: true })) {
  if (!dir.isDirectory()) continue
  const path = `${ROOT}/${dir.name}/report.json`
  if (existsSync(path)) files.push(path)
}
for (const extra of readdirSync(ROOT).filter((f) => f.endsWith('.json'))) files.push(`${ROOT}/${extra}`)
if (!files.length) throw new Error('没有找到任何 report.json')

const reports = files.map((f) => JSON.parse(readFileSync(f, 'utf8')))
const tags = reports.map((r) => r.tag)
console.log(`档位：${tags.join(' | ')}\n`)

const games = []
for (const r of reports) {
  for (const item of r.results) {
    if (item.game === 'library' || item.game === 'console') continue
    if (!games.includes(item.game)) games.push(item.game)
  }
}

const mark = (ok) => (ok === true ? '✓' : ok === 'na' ? '·' : ok === false ? '✗' : '—')
console.log('| 检查项 | ' + games.join(' | ') + ' |')
console.log('|' + '---|'.repeat(games.length + 1))
const tally = { pass: 0, fail: 0, na: 0, miss: 0 }
for (const check of CHECK_ORDER) {
  const row = games.map((game) => {
    const hits = reports
      .flatMap((r) => r.results)
      .filter((item) => item.game === game && item.check === check)
    if (!hits.length) {
      tally.miss++
      return '—'
    }
    const worst = hits.some((h) => h.ok === false) ? false : hits.some((h) => h.ok === true) ? true : 'na'
    if (worst === true) tally.pass++
    else if (worst === false) tally.fail++
    else tally.na++
    return mark(worst)
  })
  console.log(`| ${check} | ${row.join(' | ')} |`)
}
console.log(`\n合计：✓ ${tally.pass} / ✗ ${tally.fail} / · ${tally.na} / 未覆盖 ${tally.miss}`)

const failures = reports.flatMap((r) =>
  r.results.filter((item) => item.ok === false).map((item) => `[${r.tag}] [${item.game}] ${item.check}  ${item.detail ?? ''}`),
)
console.log(`\n所有档位下的失败项（${failures.length}）：`)
for (const f of failures) console.log('  ' + f)

const home = reports.map((r) => {
  const hit = r.results.find((item) => item.game === 'library')
  return `${r.tag}: ${hit ? (hit.ok ? '不滚动' : '滚动') + ' ' + (hit.detail ?? '') : '未测'}`
})
console.log('\n首页滚动（26px 档要求）：')
for (const h of home) console.log('  ' + h)

const errors = reports.flatMap((r) => r.consoleErrors ?? [])
console.log(`\n控制台错误总数：${errors.length}`)
for (const e of errors.slice(0, 10)) console.log('  ! ' + e)
