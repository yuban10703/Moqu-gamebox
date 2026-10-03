/**
 * 按**极矮横屏**逐页逐游戏巡检（实测 BOOX P6Plus 强制横屏为 879×407）。
 *
 * 由来：真机上 3 款带方向盘的游戏（推箱子 / 数字华容道 / 2048）的「下」按钮落在屏幕外，
 * 玩家无法向下移动 —— 竖屏测过完全看不出来。横屏可用高度远小于竖屏，
 * 「顶栏 + 统计 + 状态条 + 控制区」很容易吃掉全部高度，而棋盘区是唯一会先被压到 0 的
 * （它不报错，只是默默把按钮挤出去）。
 */
import { createRequire } from 'node:module'

const require = createRequire(new URL('../../.toolchain/pw/', import.meta.url))
const { chromium } = require('playwright')

const PAGE_URL = process.env.WEB_URL ?? 'http://127.0.0.1:8899/'
const results = []
const errors = []
const check = (n, ok, extra = '') => {
  results.push({ n, ok })
  console.log(`  ${ok ? '✓' : '✗'} ${n}${extra ? '  ' + extra : ''}`)
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 879, height: 407 }, locale: 'zh-CN' })
const page = await ctx.newPage()
page.on('pageerror', (e) => errors.push(String(e).slice(0, 180)))
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 180)) })

const audit = async (label) => {
  const r = await page.evaluate(() => {
    const reachable = (el) => {
      let n = el.parentElement
      while (n) {
        const cs = getComputedStyle(n)
        if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && n.scrollHeight > n.clientHeight + 1) return true
        n = n.parentElement
      }
      return false
    }
    const off = [...document.querySelectorAll('button')]
      .filter((b) => b.getBoundingClientRect().bottom > innerHeight + 1 && !reachable(b))
      .map((b) => (b.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 10))
    const board = document.querySelector('.eink-board')
    const area = document.querySelector('.eink-board-area')
    let clip = null
    if (board && area) {
      const br = board.getBoundingClientRect(), ar = area.getBoundingClientRect()
      clip = { t: Math.round(ar.top - br.top), b: Math.round(br.bottom - ar.bottom) }
    }
    const footer = document.querySelector('.eink-footer')
    return {
      off,
      clip,
      missing: document.body.innerText.includes('⟦'),
      footerOut: footer ? footer.getBoundingClientRect().bottom > innerHeight + 1 : false,
      scrollable: (() => { const c = document.querySelector('.eink-screen__content'); return c ? c.scrollHeight > c.clientHeight + 1 : false })(),
    }
  })
  // 可滚动内容区里的按钮算可达；游戏页（无内容滚动区）则必须全部在屏内
  check(`${label}：无不可达按钮`, r.off.length === 0, r.off.join(',') + (r.scrollable ? '（内容可滚动）' : ''))
  check(`${label}：固定页脚在屏内`, !r.footerOut)
  check(`${label}：无缺键`, !r.missing)
  /*
   * 这里**不检查棋盘裁切**：Chromium 与 Android WebView 在同一视口下的可用高度差很多
   * （浏览器实测裁 25~73px，设备上棋盘区几乎为 0、裁切量完全不同），
   * 因此该指标在浏览器里没有参考价值 —— 只能靠真机判断（见 docs/eink-guidelines.md）。
   * 本套件保留可信的三项：按钮可达性、固定页脚、缺键。
   */
  void r.clip
}

await page.goto(PAGE_URL, { waitUntil: 'networkidle' })
await page.waitForSelector('text=墨水屏游戏盒子')
// 制造一份存档，让「继续」入口存在（更接近真实使用）
const click = async (re, optional = false) => {
  /*
   * 先点同名游戏方块：「继续」细栏的可访问名里含游戏名，按名字会先命中它。
   *
   * 首页**可能分页**（横屏 + 存在「继续」细栏时每页更少），目标不一定在第 1 页 ——
   * 之前只看当前页，于是"有存档"时偶发找不到游戏（实测复跑就好、再跑又坏）。
   * 这里先回第 1 页，再逐页往后找。
   */
  for (let back = 0; back < 8; back++) {
    const prev = page.locator('button[data-page="prev"]:not([disabled])').first()
    if (!(await prev.count())) break
    await prev.click()
    await page.waitForTimeout(120)
  }
  for (let hop = 0; hop < 8; hop++) {
    const tile = page.locator('.eink-tile', { hasText: re }).first()
    if ((await tile.count()) > 0) { await tile.click(); await page.waitForTimeout(250); return true }
    const next = page.locator('button[data-page="next"]:not([disabled])').first()
    if (!(await next.count())) break
    await next.click()
    await page.waitForTimeout(150)
  }
  const b = page.getByRole('button', { name: re }).first()
  if (!(await b.count())) { if (optional) return false; throw new Error(`找不到「${re}」：${(await page.evaluate(() => document.body.innerText)).replace(/\n+/g, ' ').slice(0, 70)}`) }
  await b.click(); await page.waitForTimeout(220); return true
}
const dialog = async (re) => { await page.locator('.eink-overlay, .eink-dialog').last().getByRole('button', { name: new RegExp(re) }).first().click(); await page.waitForTimeout(220) }
await click(/推箱子/); await page.waitForSelector('text=玩法说明'); await click(/开始新游戏/); await page.waitForSelector('.eink-board')
await page.locator('button[aria-label="左"]').first().click(); await page.waitForTimeout(700)

// 这一档只关心横屏高度，不改字号；但要先回到首页再开始巡检
await page.goto(PAGE_URL, { waitUntil: 'networkidle' })
await page.waitForSelector('text=墨水屏游戏盒子')
await page.waitForTimeout(400)
const vp = await page.evaluate(() => `${innerWidth}x${innerHeight}`)
check('视口为极矮横屏', vp === '879x407', vp)

console.log('\n[首页 · 极矮横屏]')
await audit('首页')

const titles = await page.evaluate(() => [...document.querySelectorAll('.eink-tile__title')].map((e) => e.textContent.trim()))
console.log(`\n[逐款游戏 · 极矮横屏]（${titles.length} 款）`)
for (const title of titles) {
  await page.goto(PAGE_URL, { waitUntil: 'networkidle' })
  await page.waitForSelector('text=墨水屏游戏盒子')
  await click(new RegExp(title))
  await page.waitForSelector('text=玩法说明', { timeout: 8000 })
  await audit(`${title}·详情`)
  await click(/继续/, true)
  await page.waitForSelector('.eink-board', { timeout: 3000 }).catch(() => {})
  if (!(await page.locator('.eink-board').count())) await click(/开始新游戏/)
  await page.waitForTimeout(300)
  if (await page.getByRole('button', { name: /替换并开始/ }).count()) await dialog('替换并开始')
  await page.waitForSelector('.eink-board', { timeout: 8000 })
  await audit(`${title}·游戏页`)
}

/*
 * 第二遍：**极矮横屏 + 最大字号** 的最受限组合。
 * 此前两个套件各测一个维度（landscape 用默认字号、maxscale 用 439×847），
 * 这个组合从没被测过 —— 而它恰恰是最容易出问题的一档。
 */
console.log('\n[第二遍] 极矮横屏 + 最大字号（最受限组合）')
await page.evaluate(async () => {
  const p = window.__einkPlatform
  const s = await p.storage.loadSettings()
  await p.storage.saveSettings({ ...s, fontScale: 1.5 })
})
await page.reload({ waitUntil: 'networkidle' })
await page.waitForSelector('text=墨水屏游戏盒子')
await page.waitForTimeout(600)
const rootFont = await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)
check('已切到最大字号', rootFont === '26px', rootFont)
await audit('首页·1.5×')

for (const title of titles) {
  await page.goto(PAGE_URL, { waitUntil: 'networkidle' })
  await page.waitForSelector('text=墨水屏游戏盒子')
  await click(new RegExp(title))
  await page.waitForSelector('text=玩法说明', { timeout: 8000 })
  await audit(`${title}·详情·1.5×`)
  await click(/继续/, true)
  await page.waitForSelector('.eink-board', { timeout: 3000 }).catch(() => {})
  if (!(await page.locator('.eink-board').count())) await click(/开始新游戏/)
  await page.waitForTimeout(300)
  if (await page.getByRole('button', { name: /替换并开始/ }).count()) await dialog('替换并开始')
  await page.waitForSelector('.eink-board', { timeout: 8000 })
  const cell = await page.evaluate(() => {
    const c = document.querySelector('.eink-board__cell')
    return c ? Math.round(c.getBoundingClientRect().width) : null
  })
  check(`${title}·游戏页·1.5×：格子不低于绝对下限`, cell === null || cell >= 12, `${cell}px`)
  await audit(`${title}·游戏页·1.5×`)
}

console.log(`\n=== 页面错误：${errors.length} ===`)
for (const e of errors.slice(0, 5)) console.log('  ! ' + e)
const failed = results.filter((r) => !r.ok)
console.log(`=== 小结：${results.length - failed.length}/${results.length} 通过 ===`)
for (const f of failed) console.log('  ✗ ' + f.n)
await browser.close()
process.exit(failed.length || errors.length ? 1 : 0)
