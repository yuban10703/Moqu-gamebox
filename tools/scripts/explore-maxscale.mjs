/**
 * 按**最大字号档位**逐页逐游戏巡检。
 *
 * 由来：首页卡片在 1.5× 字号下会变高，默认档位看不出溢出（真实用户踩到了）。
 * 同样的风险存在于游戏页（棋盘 + 统计 + 控制区）与详情页，所以这里统一按最大档位验证。
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
const ctx = await browser.newContext({ viewport: { width: 439, height: 847 }, locale: 'zh-CN' })
const page = await ctx.newPage()
page.on('pageerror', (e) => errors.push(String(e).slice(0, 180)))
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 180)) })

const audit = async (label) => {
  const r = await page.evaluate(() => {
    // 与 explore-ui 保持一致：可滚动容器内的元素算「可达」。
    // 游戏数量增长后首页在大字号档下必须滚动，「屏外」不等于「缺陷」（第 18 轮定下的标准）。
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
    /*
     * 统计栏截断：26px 档下统计栏是固定列宽（3 列 = 每项 136px），
     * 曾装不下最长的「标签 + 数值」组合，被省略号截成「最少… 1…」「剩余雷… 10」。
     * 这里守住"标签与数值都不许被截断"（玩家要读「最少步数」，不能切）。
     */
    const cut = (e) => e && e.scrollWidth > e.clientWidth + 1
    const statsClip = [...document.querySelectorAll('.eink-stats__item')]
      .filter((it) => cut(it.querySelector('dt')) || cut(it.querySelector('dd')))
      .map((it) => (it.textContent || '').replace(/\s+/g, ' ').trim())
    return {
      off,
      clip,
      statsClip,
      missing: document.body.innerText.includes('⟦'),
      footerOut: footer ? footer.getBoundingClientRect().bottom > innerHeight + 1 : false,
      scrollable: (() => { const c = document.querySelector('.eink-screen__content'); return c ? c.scrollHeight > c.clientHeight + 1 : false })(),
    }
  })
  // 可滚动内容区里的按钮算可达；游戏页（无内容滚动区）则必须全部在屏内
  check(`${label}：无不可达按钮`, r.off.length === 0, r.off.join(',') + (r.scrollable ? '（内容可滚动）' : ''))
  check(`${label}：固定页脚在屏内`, !r.footerOut)
  check(`${label}：无缺键`, !r.missing)
  if (r.clip) check(`${label}：棋盘未被裁切`, r.clip.t <= 1 && r.clip.b <= 1, JSON.stringify(r.clip))
  check(`${label}：统计栏无截断`, r.statsClip.length === 0, r.statsClip.join(' | '))
}

await page.goto(PAGE_URL, { waitUntil: 'networkidle' })
await page.waitForSelector('text=墨水屏游戏盒子')
// 制造一份存档，让「继续」入口存在（更接近真实使用）
const click = async (re, optional = false) => {
  // 先点同名游戏方块：「继续」细栏的可访问名里含游戏名，按名字会先命中它
  {
    const tile = page.locator('.eink-tile', { hasText: re }).first()
    if ((await tile.count()) > 0) { await tile.click(); await page.waitForTimeout(250); return true }
  }
  const b = page.getByRole('button', { name: re }).first()
  if (!(await b.count())) { if (optional) return false; throw new Error(`找不到「${re}」：${(await page.evaluate(() => document.body.innerText)).replace(/\n+/g, ' ').slice(0, 70)}`) }
  await b.click(); await page.waitForTimeout(220); return true
}
const dialog = async (re) => { await page.locator('.eink-overlay, .eink-dialog').last().getByRole('button', { name: new RegExp(re) }).first().click(); await page.waitForTimeout(220) }
await click(/推箱子/); await page.waitForSelector('text=玩法说明'); await click(/开始新游戏/); await page.waitForSelector('.eink-board')
await page.locator('button[aria-label="左"]').first().click(); await page.waitForTimeout(700)

// 切到最大字号档位
await page.goto(PAGE_URL, { waitUntil: 'networkidle' })
await page.waitForSelector('text=墨水屏游戏盒子')
await page.evaluate(async () => {
  const p = window.__einkPlatform
  const s = await p.storage.loadSettings()
  await p.storage.saveSettings({ ...s, fontScale: 1.5 })
})
await page.reload({ waitUntil: 'networkidle' })
await page.waitForSelector('text=墨水屏游戏盒子')
await page.waitForTimeout(500)
const rootFont = await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)
check('已切到最大字号档位', rootFont === '26px', rootFont)

console.log('\n[首页 · 最大字号]')
await audit('首页')

const titles = await page.evaluate(() => [...document.querySelectorAll('.eink-tile__title')].map((e) => e.textContent.trim()))
console.log(`\n[逐款游戏 · 最大字号]（${titles.length} 款）`)
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

console.log(`\n=== 页面错误：${errors.length} ===`)
for (const e of errors.slice(0, 5)) console.log('  ! ' + e)
const failed = results.filter((r) => !r.ok)
console.log(`=== 小结：${results.length - failed.length}/${results.length} 通过 ===`)
for (const f of failed) console.log('  ✗ ' + f.n)
await browser.close()
process.exit(failed.length || errors.length ? 1 : 0)
