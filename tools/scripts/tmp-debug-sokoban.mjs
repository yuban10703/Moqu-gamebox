/** 临时调试脚本：把推箱子的每一步棋盘/统计/提示打出来 */
import { createRequire } from 'node:module'
const require = createRequire(new URL('../../.toolchain/pw/', import.meta.url))
const { chromium } = require('playwright')

const URL_ = process.env.WEB_URL
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 439, height: 847 }, deviceScaleFactor: 1.875, locale: 'zh-CN', hasTouch: true })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 200)))
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 200)) })

const board = () => page.evaluate(() => {
  const cells = [...document.querySelectorAll('.eink-board__cell')]
  const cols = Number(document.querySelector('.eink-board')?.getAttribute('aria-colcount') ?? 0)
  const rows = []
  for (let i = 0; i < cells.length; i += cols) {
    rows.push(cells.slice(i, i + cols).map((c) => (c.dataset.kind ?? '?').slice(0, 4).padEnd(4)).join('|'))
  }
  const stats = [...document.querySelectorAll('.eink-stats__item')].map((it) => `${it.querySelector('dt')?.textContent}=${it.querySelector('dd')?.textContent}`).join(' ')
  return {
    grid: rows.join('\n'),
    stats,
    notice: document.querySelector('[data-testid=notice]')?.textContent ?? null,
    statusStrip: document.querySelector('.eink-statusstrip')?.outerHTML?.slice(0, 300) ?? null,
    result: document.querySelector('.eink-section--result h2')?.textContent ?? null,
    undoDisabled: (() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '撤销'); return b ? b.disabled : 'none' })(),
  }
})

const press = async (dir) => {
  const sel = { up: '.eink-dpad__up', down: '.eink-dpad__down', left: '.eink-dpad__left', right: '.eink-dpad__right' }[dir]
  await page.locator(sel).first().click()
  await page.waitForTimeout(1400)
}
const show = async (label) => {
  const b = await board()
  console.log(`\n--- ${label} ---`)
  console.log(b.grid)
  console.log('stats:', b.stats, '| notice:', JSON.stringify(b.notice), '| undoDisabled:', b.undoDisabled, '| result:', b.result)
}

await page.goto(URL_, { waitUntil: 'networkidle' })
await page.waitForSelector('text=墨趣')
await page.locator('.eink-tile', { hasText: '推箱子' }).first().click()
await page.waitForTimeout(600)
await page.getByRole('button', { name: '开始新游戏' }).first().click()
await page.waitForTimeout(600)
if (await page.getByRole('button', { name: '替换并开始' }).count()) { await page.getByRole('button', { name: '替换并开始' }).first().click(); await page.waitForTimeout(700) }
await page.waitForSelector('.eink-board')
await page.waitForTimeout(900)
await show('进入')

for (const dir of ['up', 'down', 'left', 'right']) { await press(dir); await show('按 ' + dir) }

await press('right'); await show('按 right（应撞墙）')
await press('right'); await show('再按 right（应撞墙）')

console.log('\n=== 重新开始 ===')
await page.getByRole('button', { name: '重新开始' }).first().click()
await page.waitForTimeout(600)
const dialogs = await page.locator('.eink-dialog').count()
console.log('对话框数:', dialogs, '内容:', (await page.locator('.eink-dialog').last().innerText().catch(() => '?')).replace(/\n/g, ' / '))
await page.locator('.eink-dialog').last().getByRole('button', { name: '重新开始' }).click()
await page.waitForTimeout(1500)
await show('重开后')

await browser.close()
