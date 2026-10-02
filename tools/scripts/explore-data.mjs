/**
 * 探索式缺陷探测（数据完整性）。
 *   备份导出（下载 + JSON 结构 + 校验和）/ 导入非法备份 /
 *   存档被截断后的恢复入口 / 多游戏进度 / 「继续上一局」指向 / 清空全部进度
 *
 * 用法同 explore-ui：npm run explore（两个套件一起跑）。
 */
/**
 * 探索式缺陷探测（二）：数据完整性。
 * 备份导出/导入、存档损坏恢复、清空进度、多游戏存档、离线后写入。
 */
import { createRequire } from 'node:module'

// playwright 装在 gitignored 的 .toolchain/pw（体积大，不进项目依赖）
const require = createRequire(new URL('../../.toolchain/pw/', import.meta.url))
const { chromium } = require('playwright')
import { readFileSync, existsSync } from 'node:fs'

const PAGE_URL = 'http://127.0.0.1:8899/'
const results = []
const errors = []
const check = (n, ok, extra = '') => {
  results.push({ n, ok })
  console.log(`  ${ok ? '✓' : '✗'} ${n}${extra ? '  ' + extra : ''}`)
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 439, height: 847 }, locale: 'zh-CN', acceptDownloads: true })
const page = await ctx.newPage()
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)))
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)) })
const clickText = async (text, { optional = false } = {}) => {
  const btn = page.getByRole('button', { name: new RegExp(text) }).first()
  if (!(await btn.count())) {
    if (optional) return false
    throw new Error(`找不到按钮「${text}」：${(await page.evaluate(() => document.body.innerText)).replace(/\n+/g, ' ').slice(0, 90)}`)
  }
  await btn.click(); await page.waitForTimeout(250); return true
}
const clickDialog = async (text) => {
  const d = page.locator('.eink-overlay, .eink-dialog').last()
  await d.getByRole('button', { name: new RegExp(text) }).first().click()
  await page.waitForTimeout(250)
}
const gotoLibrary = async () => {
  await page.goto(PAGE_URL, { waitUntil: 'networkidle' })
  await page.waitForSelector('text=墨水屏游戏盒子', { timeout: 15000 })
}
const play = async (title, moves = 1) => {
  await gotoLibrary()
  await clickText(title)
  await page.waitForSelector('text=玩法说明', { timeout: 8000 })
  await clickText('继续', { optional: true })
  if (!(await page.locator('.eink-board').count())) await clickText('开始新游戏')
  await page.waitForTimeout(300)
  if (await page.getByRole('button', { name: /替换并开始/ }).count()) await clickDialog('替换并开始')
  await page.waitForSelector('.eink-board', { timeout: 8000 })
  for (let i = 0; i < moves; i++) {
    const btn = page.locator('button[aria-label="左"]')
    if (await btn.count()) await btn.first().click()
    else { await page.evaluate(() => document.querySelector('.eink-board__cell')?.click()) }
    await page.waitForTimeout(150)
  }
  await page.waitForTimeout(600)
}

/* ---------- 1) 备份导出 ---------- */
console.log('\n[1] 备份导出')
await play('推箱子', 2)
await clickText('暂停')
await clickDialog('返回游戏库')
await clickText('设置')
await page.waitForSelector('text=备份', { timeout: 8000 })
let downloaded = null
page.once('download', async (d) => { downloaded = { name: d.suggestedFilename(), path: await d.path() } })
await clickText('导出备份')
await page.waitForTimeout(1500)
check('导出备份触发下载', downloaded !== null, downloaded ? downloaded.name : '无下载')
if (downloaded?.path && existsSync(downloaded.path)) {
  const text = readFileSync(downloaded.path, 'utf8')
  let parsed = null
  try { parsed = JSON.parse(text) } catch {}
  check('备份是可解析的 JSON', parsed !== null, `${text.length} 字节`)
  check('备份含存档与版本字段', !!parsed?.saves && !!parsed?.schema && !!parsed?.appVersion && !!parsed?.checksum, JSON.stringify(Object.keys(parsed ?? {})))
} else {
  check('备份文件可读', false, '拿不到下载文件')
}

/* ---------- 2) 导入非法备份 ---------- */
console.log('\n[2] 导入非法备份')
let sawError = false
page.once('dialog', async (d) => { await d.dismiss() })
const fileInput = page.locator('input[type=file]')
if (await fileInput.count()) {
  await fileInput.setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('this is not a backup') })
  await page.waitForTimeout(1200)
  const text = await page.evaluate(() => document.body.innerText)
  sawError = /失败|无效|错误|无法/.test(text)
  check('非法备份给出明确提示而不是崩溃', sawError, text.replace(/\n+/g, ' ').slice(-70))
} else {
  check('页面提供导入入口（file input）', false, '未找到 input[type=file]')
}

/* ---------- 3) 存档损坏 ---------- */
console.log('\n[3] 存档损坏恢复')
// 真实损坏场景：把已提交的存档**截断**（模拟写入中断 / 掉电），
// 此时连 meta 都解析不出来 —— 最容易出现「静默丢档」
await page.evaluate(async () => {
  const raw = await window.__einkPlatform.storage.saves.rawAll()
  const item = raw.find((r) => r.key.startsWith('save:1:committed:'))
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open('eink-gamebox')
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  const tx = db.transaction(['kv'], 'readwrite')
  tx.objectStore('kv').put(item.text.slice(0, 40), item.key)
  await new Promise((r) => { tx.oncomplete = r; tx.onerror = r })
  db.close()
})
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(1200)
const corruptText = await page.evaluate(() => document.body.innerText)
check('损坏存档被识别（给出恢复入口而非崩溃）', /损坏|无法读取|恢复/.test(corruptText), corruptText.replace(/\n+/g, ' ').slice(0, 110))

/* ---------- 4) 多个游戏各有存档 ---------- */
console.log('\n[4] 多游戏存档')
await play('数独', 0)
await play('扫雷', 0)
await play('2048', 1)
await gotoLibrary()
const tiles = await page.evaluate(() => [...document.querySelectorAll('.eink-tile')].map((t) => t.innerText.replace(/\n+/g, ' ')))
check('每款游戏的进度都能显示', tiles.length >= 5 && tiles.every((t) => t.length > 0), `${tiles.length} 款：${tiles.join(' | ').slice(0, 110)}`)
const cont = await page.evaluate(() => document.querySelector('.eink-card--continue')?.innerText.replace(/\n+/g, ' ') ?? '')
check('继续卡片指向最近玩的游戏', /2048/.test(cont), cont.slice(0, 60))

/* ---------- 5) 清空全部进度 ---------- */
console.log('\n[5] 清空全部进度')
await clickText('设置')
await page.waitForSelector('text=备份', { timeout: 8000 })
await clickText('清除全部进度')
await page.waitForTimeout(300)
await clickDialog('清除')
await page.waitForTimeout(1200)
await gotoLibrary()
const after = await page.evaluate(() => document.body.innerText.replace(/\n+/g, ' '))
check('清空后首页无继续卡片', !/继续上一局/.test(after), after.slice(0, 70))
check('清空后进度归零', /进度 0\/16/.test(after), after.slice(0, 90))

console.log(`\n=== 页面错误：${errors.length} ===`)
for (const e of errors.slice(0, 5)) console.log('  ! ' + e)
const failed = results.filter((r) => !r.ok)
console.log(`=== 小结：${results.length - failed.length}/${results.length} 通过 ===`)
for (const f of failed) console.log('  ✗ ' + f.n)
await browser.close()
process.exit(failed.length || errors.length ? 1 : 0)
