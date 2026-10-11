/**
 * Kindle 版冒烟测试（真实 Chromium，Playwright）。
 *
 * 为什么必须有它：jsdom 里的三条守卫（ES5 纯度 / 产物启动 / 壳层行为）都**没有真实布局**——
 * 而 Kindle 版最特别的地方恰恰是布局：容器查询、grid、现代 flex 全不可用，
 * 格子边长是 JS 按可用宽高算出来的，页面**不能滚动**（内容放不下就是真的够不着）。
 * 这些只有在真浏览器里才看得出来。这条脚本已经逮住过两个：
 *   · 游戏库按"每行 56px"猜分页 → 实际行高约 93px，第一页直接溢出到看不见分页器；
 *   · `shell.library.page` 需要 {index}，代码里传的是 {page} → 屏幕上印着字面的 `{index}`。
 *
 * 用法（与 smoke:web 同一套约定）：
 *   1) npm run build:kindle
 *   2) node tools/scripts/serve-kindle.mjs apps/kindle/dist 8791 &
 *   3) npm run smoke:kindle
 * 浏览器装在 gitignored 的 .toolchain/pw（体积大，不进项目依赖）。
 */
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(new URL('../../.toolchain/pw/', import.meta.url))
const { chromium } = require('playwright')

const BASE = process.env.KINDLE_URL ?? 'http://127.0.0.1:8791/'
const SHOTS = fileURLToPath(new URL('../../.kindle-shots/', import.meta.url))

const results = []
const check = function check(name, ok, extra) {
  results.push({ name, ok, extra: extra ?? '' })
}

/** 逐款玩法要看的呈现面：格子棋盘 / 牌桌 / 对决面板 */
const CASES = [
  { id: 'klotski', expect: 'board', min: 20 },
  { id: 'sudoku', expect: 'board', min: 81 },
  { id: 'xiangqi', expect: 'board', min: 90 },
  { id: 'snake', expect: 'board', min: 100 },
  { id: 'doudizhu', expect: 'cards', min: 20 },
  { id: 'klondike', expect: 'cards', min: 50 },
  { id: 'buckshot', expect: 'duel', min: 2 },
]

mkdirSync(SHOTS, { recursive: true })

const browser = await chromium.launch()
// 6" 阅读器的等效视口（竖屏），与真机最接近的一档
const page = await browser.newPage({ viewport: { width: 760, height: 1024 } })
const pageErrors = []
page.on('pageerror', (error) => pageErrors.push('pageerror: ' + error.message))
page.on('console', (message) => {
  if (message.type() === 'error') pageErrors.push('console: ' + message.text())
})

await page.goto(BASE, { waitUntil: 'load' })
await page.waitForTimeout(1000)

// ---------- 1. 启动链路 ----------
const boot = await page.evaluate(() => {
  const amd = window.__MOQU_AMD__
  return { modules: amd ? amd.count() : -1, pending: amd ? amd.pending() : -1 }
})
check('AMD 模块全部执行（无挂起依赖）', boot.modules > 100 && boot.pending === 0, `modules=${boot.modules} pending=${boot.pending}`)

// ---------- 2. 游戏库 ----------
const library = await page.evaluate(() => {
  const text = document.body.textContent || ''
  return {
    items: document.querySelectorAll('.k-list__item').length,
    hasPager: !!document.querySelector('.k-pager'),
    // 零 JS 占位还在 = 壳层没挂载成功
    bootHintGone: !document.getElementById('k-boot-hint'),
    // 没有替换的 i18n 参数会以 {name} 的形式印在屏幕上
    unreplaced: (text.match(/\{[a-zA-Z_][a-zA-Z0-9_]*\}/g) || []).length,
    missingKeys: (text.match(/⟦[^⟧]+⟧/g) || []).length,
    // 不滚动：内容超出视口就是"够不着"
    overflowY: document.documentElement.scrollHeight > window.innerHeight + 4,
    firstTitle: (document.querySelector('.k-list__title') || {}).textContent || '',
  }
})
check('游戏库渲染出列表', library.items > 0, `items=${library.items} first=${library.firstTitle}`)
check('零 JS 占位已被壳层替换', library.bootHintGone)
check('有翻页控件', library.hasPager)
check('没有未替换的 i18n 参数', library.unreplaced === 0, `count=${library.unreplaced}`)
check('没有缺键标记 ⟦key⟧', library.missingKeys === 0, `count=${library.missingKeys}`)
check('整页不滚动（内容在首屏内）', !library.overflowY)
await page.screenshot({ path: SHOTS + '/01-library.png' })

// ---------- 3. 逐款玩法 ----------
for (const item of CASES) {
  await page.evaluate(
    (payload) => window.__moquApp.navigate('game', { gameId: payload.id, difficulty: 'starter', fresh: true }),
    { id: item.id },
  )
  await page.waitForTimeout(600)
  const probe = await page.evaluate(() => {
    const text = document.body.textContent || ''
    const main = document.querySelector('.k-main')
    const footer = document.querySelector('.k-footer')
    return {
      error: text.indexOf('screen error') >= 0,
      board: document.querySelectorAll('.k-board__cell').length,
      cards: document.querySelectorAll('.k-card').length,
      piles: document.querySelectorAll('.k-pile').length,
      duel: document.querySelectorAll('.k-duel__side').length,
      missingKeys: (text.match(/⟦[^⟧]+⟧/g) || []).length,
      unreplaced: (text.match(/\{[a-zA-Z_][a-zA-Z0-9_]*\}/g) || []).length,
      // 页脚（主操作）必须在视口内：墨水屏上按钮跑到屏幕外等于没有
      footerVisible: footer ? footer.getBoundingClientRect().bottom <= window.innerHeight + 2 : false,
      mainOverflow: main ? main.scrollHeight > main.clientHeight + 4 : false,
    }
  })
  const count = item.expect === 'board' ? probe.board : item.expect === 'cards' ? probe.cards : probe.duel
  check(`${item.id}：渲染出 ${item.expect}（≥${item.min}）`, !probe.error && count >= item.min, `count=${count}`)
  check(`${item.id}：无缺键、无未替换参数`, probe.missingKeys === 0 && probe.unreplaced === 0, `keys=${probe.missingKeys} params=${probe.unreplaced}`)
  check(`${item.id}：页脚主操作在视口内`, probe.footerVisible)
  await page.screenshot({ path: `${SHOTS}/game-${item.id}.png` })
}

// ---------- 4. 自检页（零依赖，主应用跑不起来时也要能用）----------
await page.goto(BASE + 'check.html', { waitUntil: 'load' })
await page.waitForTimeout(600)
const checkPage = await page.evaluate(() => {
  const text = document.body.textContent || ''
  return {
    marks: (text.match(/[★☆]/g) || []).length,
    hasReport: (document.getElementById('report') || {}).value ? true : false,
    // 报告里必须能读到 UA：真机反馈全靠它
    reportHasUa: ((document.getElementById('report') || {}).value || '').indexOf('ua=') >= 0,
  }
})
check('自检页给出逐项结论', checkPage.marks >= 20, `marks=${checkPage.marks}`)
check('自检页生成报告（含 UA）', checkPage.hasReport && checkPage.reportHasUa)
await page.screenshot({ path: SHOTS + '/02-check.png' })

check('全过程没有未捕获的 JS 错误', pageErrors.length === 0, pageErrors.join(' | '))

await browser.close()

// ---------- 汇总 ----------
const failed = results.filter((r) => !r.ok)
for (const r of results) {
  console.log(`${r.ok ? '✓' : '✗'} ${r.name}${r.extra ? '  (' + r.extra + ')' : ''}`)
}
console.log(`\n截图目录：.kindle-shots/`)
if (failed.length > 0) {
  console.error(`\n❌ ${failed.length}/${results.length} 项未通过`)
  process.exit(1)
}
console.log(`\n✅ ${results.length} 项全部通过`)
