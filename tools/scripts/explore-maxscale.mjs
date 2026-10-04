/**
 * 按**最大字号档位**逐页逐游戏巡检。
 *
 * 由来：首页卡片在 1.5× 字号下会变高，默认档位看不出溢出（真实用户踩到了）。
 * 同样的风险存在于游戏页（棋盘 + 统计 + 控制区）与详情页，所以这里统一按最大档位验证。
 */
import { createRequire } from 'node:module'

const require = createRequire(new URL('../../.toolchain/pw/', import.meta.url))
const { chromium } = require('playwright')

const PAGE_URL = process.env.WEB_URL ?? 'http://127.0.0.1:8790/'

/*
 * 游戏主视区：格子玩法是 `.eink-board`，扑克类玩法（斗地主）用 `CardTable` 渲染 `.eink-cardtable`
 * —— 两者都占据 `.eink-board-area`，审计只关心"主视区有没有被裁切"，所以统一用这个选择器。
 */
const SURFACE = '.eink-board, .eink-cardtable'
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
    const board = document.querySelector('.eink-board, .eink-cardtable')
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
await page.waitForSelector('text=墨趣')
// 制造一份存档，让「继续」入口存在（更接近真实使用）
const click = async (re, optional = false) => {
  /*
   * 先点同名游戏方块：「继续」细栏的可访问名里含游戏名，按名字会先命中它。
   * 首页**会翻页**（游戏多了以后一页放不下）：只看当前页会漏掉后面的游戏，
   * 「逐款巡检」就退化成只查第一页 —— 新加的游戏等于没验。先回第 1 页再逐页往后找。
   */
  for (let back = 0; back < 12; back++) {
    const prev = page.locator('button[data-page="prev"]:not([disabled])').first()
    if (!(await prev.count())) break
    await prev.click(); await page.waitForTimeout(120)
  }
  for (let hop = 0; hop < 12; hop++) {
    const tile = page.locator('.eink-tile', { hasText: re }).first()
    if ((await tile.count()) > 0) { await tile.click(); await page.waitForTimeout(250); return true }
    const next = page.locator('button[data-page="next"]:not([disabled])').first()
    if (!(await next.count())) break
    await next.click(); await page.waitForTimeout(180)
  }
  const b = page.getByRole('button', { name: re }).first()
  if (!(await b.count())) { if (optional) return false; throw new Error(`找不到「${re}」：${(await page.evaluate(() => document.body.innerText)).replace(/\n+/g, ' ').slice(0, 70)}`) }
  await b.click(); await page.waitForTimeout(220); return true
}
const dialog = async (re) => { await page.locator('.eink-pausebar, .eink-dialog').last().getByRole('button', { name: new RegExp(re) }).first().click(); await page.waitForTimeout(220) }
await click(/推箱子/); await page.waitForSelector('text=玩法说明'); await click(/开始新游戏/); await page.waitForSelector('.eink-board')
await page.locator('button[aria-label="左"]').first().click(); await page.waitForTimeout(700)

// 切到最大字号档位
await page.goto(PAGE_URL, { waitUntil: 'networkidle' })
await page.waitForSelector('text=墨趣')
await page.evaluate(async () => {
  const p = window.__einkPlatform
  const s = await p.storage.loadSettings()
  await p.storage.saveSettings({ ...s, fontScale: 1.5 })
})
await page.reload({ waitUntil: 'networkidle' })
await page.waitForSelector('text=墨趣')
await page.waitForTimeout(500)
const rootFont = await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)
check('已切到最大字号档位', rootFont === '26px', rootFont)

console.log('\n[首页 · 最大字号]')
await audit('首页')

/*
 * 收集**全部**游戏标题：首页会翻页（12 款一页放不下），只取当前页会漏掉后面的游戏，
 * 「逐款巡检」就变成只查第一页。逐页翻到底再汇总。
 */
const collectTitles = async () => {
  const seen = []
  for (let hop = 0; hop < 12; hop++) {
    const batch = await page.evaluate(() => [...document.querySelectorAll('.eink-tile__title')].map((e) => e.textContent.trim()))
    for (const title of batch) if (!seen.includes(title)) seen.push(title)
    const next = page.locator('button[data-page="next"]:not([disabled])').first()
    if (!(await next.count())) break
    await next.click()
    await page.waitForTimeout(200)
  }
  return seen
}
const titles = await collectTitles()
console.log(`\n[逐款游戏 · 最大字号]（${titles.length} 款）`)
for (const title of titles) {
  await page.goto(PAGE_URL, { waitUntil: 'networkidle' })
  await page.waitForSelector('text=墨趣')
  await click(new RegExp(title))
  await page.waitForSelector('text=玩法说明', { timeout: 8000 })
  await audit(`${title}·详情`)
  await click(/继续/, true)
  await page.waitForSelector(SURFACE, { timeout: 3000 }).catch(() => {})
  if (!(await page.locator(SURFACE).count())) await click(/开始新游戏/)
  await page.waitForTimeout(300)
  if (await page.getByRole('button', { name: /替换并开始/ }).count()) await dialog('替换并开始')
  await page.waitForSelector(SURFACE, { timeout: 8000 })
  await audit(`${title}·游戏页`)
}

/*
 * 提示条容量 —— 用户报过的真实缺陷：竖屏 + 最大字号下，贪吃蛇的提示
 * 「这一步走不通（不能原地掉头，或本局已经结束）」在状态条里被**静默截成半句**
 * （`.eink-notice` 是 nowrap + overflow:hidden，放不下的字直接切掉）。
 *
 * 两侧各守一半：
 *   - 文案侧：`packages/ui/test/notice-budget.test.ts` 按 `NOTICE_BUDGET` 卡每条提示的字宽；
 *   - 布局侧（这里）：真实提示不许截断，且**预算大小的全角探针**要放得下 ——
 *     谁把状态条改窄、字号放大、或者让保存指示器又挤回来，都会在这里红。
 */
console.log('\n[提示条容量 · 最大字号]')
const openSnake = async () => {
  await page.goto(PAGE_URL, { waitUntil: 'networkidle' })
  await page.waitForSelector('text=墨趣')
  await click(/贪吃蛇/)
  await page.waitForSelector('text=玩法说明', { timeout: 8000 })
  // 强制新开一局：新局蛇头朝右，点「左」必定是非法动作（存档局的方向不确定）
  await click(/开始新游戏/)
  if (await page.getByRole('button', { name: /替换并开始/ }).count()) await dialog('替换并开始')
  await page.waitForSelector('.eink-board', { timeout: 8000 })
  await page.waitForTimeout(250)
}
await openSnake()
// 蛇头朝右时「左」必为原地掉头 → 触发提示（按钮此时是变暗的，仍然可点）
await page.locator('button[aria-label="左"]').first().click()
await page.waitForTimeout(300)
const noticeFit = await page.evaluate((probeLen) => {
  const n = document.querySelector('.eink-notice')
  if (!n) return { error: '没有出现提示条（非法动作没触发提示？）' }
  // 同时看保存指示器是否让位（有提示时它必须 display:none，否则提示少 68px）
  const save = document.querySelector('.eink-save')
  const saveHidden = !save || save.getBoundingClientRect().width === 0
  /*
   * 余量要相对**可用宽度上限**算，不能拿 clientWidth 比 —— 提示元素是
   * flex: 0 1 auto，放得下时它会缩到内容宽度，clientWidth - scrollWidth 恒为 0，
   * 那个 0 看起来像"刚好放得下"，其实什么也没说明。
   */
  const strip = n.parentElement
  const scs = getComputedStyle(strip)
  const ncs = getComputedStyle(n)
  const cap =
    strip.clientWidth -
    (Number.parseFloat(scs.columnGap) || 0) -
    Number.parseFloat(scs.paddingLeft || '0') -
    Number.parseFloat(scs.paddingRight || '0')
  const measure = (text) => {
    n.textContent = text
    return {
      text,
      clipped: n.scrollWidth > n.clientWidth + 1,
      margin: Math.round(cap - n.getBoundingClientRect().width),
      width: Math.round(n.getBoundingClientRect().width),
    }
  }
  const original = n.textContent
  const real = measure(original)
  const probe = measure('提'.repeat(probeLen)) // 全角探针：宽度正好等于预算上限
  n.textContent = original
  n.textContent = original
  return { real, probe, saveHidden }
}, 14) // 与 packages/core/src/noticeBudget.ts 的 NOTICE_BUDGET 保持一致（改那里也要改这里）
if (noticeFit.error) {
  check('提示条容量：非法动作能触发提示', false, noticeFit.error)
} else {
  check(
    '提示条容量：真实提示未被截断',
    !noticeFit.real.clipped,
    `宽 ${noticeFit.real.width}px · 距上限 ${noticeFit.real.margin}px「${noticeFit.real.text}」`,
  )
  check('提示条容量：14 字预算放得下', !noticeFit.probe.clipped, `宽 ${noticeFit.probe.width}px · 距上限 ${noticeFit.probe.margin}px`)
  check('提示条容量：有提示时保存指示器让位', noticeFit.saveHidden)
}

console.log(`\n=== 页面错误：${errors.length} ===`)
for (const e of errors.slice(0, 5)) console.log('  ! ' + e)
const failed = results.filter((r) => !r.ok)
console.log(`=== 小结：${results.length - failed.length}/${results.length} 通过 ===`)
for (const f of failed) console.log('  ✗ ' + f.n)
await browser.close()
process.exit(failed.length || errors.length ? 1 : 0)
