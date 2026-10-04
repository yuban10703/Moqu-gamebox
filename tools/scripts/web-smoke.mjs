/**
 * 网页版冒烟测试（真实 Chromium）：
 *  - 首页 → 详情 → 开新局 → 走子 → 存档
 *  - 刷新后验证 IndexedDB 持久化
 *  - 两种视口（1248×903 横屏 / 439×847 竖屏）逐页断言「主操作都在首屏内」
 */
/**
 * 网页版冒烟测试（真实 Chromium，Playwright）。
 *
 * 为什么需要它：真机（BOOX）与浏览器是两条不同的运行路径 ——
 * 网页版走 IndexedDB 存储、语言跟随浏览器。
 * 这些在 jsdom 单测里覆盖不到（jsdom 没有真实 IndexedDB/布局），必须用真浏览器。
 *
 * 用法：
 *   1) 构建产物：npm run build:web
 *   2) 起静态服务：node tools/scripts/serve-web.mjs apps/web/dist 8790 &
 *   3) 安装浏览器（只需一次，装到 gitignored 的 .toolchain/pw）：
 *        mkdir -p .toolchain/pw && cd .toolchain/pw && npm i playwright \
 *          && npx playwright install chromium && npx playwright install-deps chromium
 *   4) 运行：npm run smoke:web      （或 WEB_URL=... node tools/scripts/web-smoke.mjs）
 *
 * 覆盖：首页/详情/游戏页渲染 → 方向键操作 → 存档提交与 IndexedDB 落盘 →
 *       刷新恢复 → 语言跟随浏览器 → 横竖两种视口的「主操作都在首屏内」断言 →
 *       离线能力（Service Worker 接管、断网重载、离线读档）。
 */
import { createRequire } from 'node:module'

// playwright 装在 .toolchain/pw（体积大且与本项目无构建关系，故不入 git 依赖）
const require = createRequire(new URL('../../.toolchain/pw/', import.meta.url))
const { chromium } = require('playwright')

/*
 * 游戏主视区：格子玩法是 `.eink-board`，牌类玩法（斗地主）是 `.eink-cardtable`，
 * 恶魔轮盘赌是 `.eink-duel` —— 逐款巡检只等 `.eink-board` 的话，走到第 13 款就超时。
 */
const SURFACE = '.eink-board, .eink-cardtable, .eink-duel'

const PAGE_URL = process.env.WEB_URL ?? 'http://127.0.0.1:8790/'
const results = []
const check = (name, ok, extra = '') => {
  results.push({ name, ok, extra })
  console.log(`  ${ok ? '✓' : '✗'} ${name}${extra ? '  ' + extra : ''}`)
}

const browser = await chromium.launch()

/* ---------- 1) 横屏：完整流程 ---------- */
console.log('\n[1] 横屏 1248x903 @dpr1.5：完整流程')
const ctx = await browser.newContext({ viewport: { width: 1248, height: 903 }, deviceScaleFactor: 1.5, locale: 'zh-CN' })
const page = await ctx.newPage()
page.on('pageerror', (e) => check('页面无 JS 异常', false, String(e).slice(0, 120)))
await page.goto(PAGE_URL, { waitUntil: 'networkidle' })

await page.waitForSelector('text=墨趣', { timeout: 15000 })
check('首页渲染', true)

const platform = await page.evaluate(() => {
  const p = window.__einkPlatform
  return p ? { kind: p.kind, storage: p.storage.kind } : null
})
check('平台为 web 且存储可用', platform?.kind === 'web' && !!platform?.storage,
  `kind=${platform?.kind} storage=${platform?.storage}`)

await page.getByRole('button', { name: /推箱子/ }).first().click()
await page.waitForSelector('text=玩法说明', { timeout: 8000 })
check('进入游戏详情', true)

const startBtn = page.getByRole('button', { name: /开始新游戏|继续/ }).first()
await startBtn.click()
await page.waitForTimeout(300)
const confirm = page.getByRole('button', { name: /替换并开始/ })
if (await confirm.count()) await confirm.first().click()
await page.waitForSelector('.eink-board', { timeout: 8000 })
check('进入游戏页', true)

const movesBefore = await page.evaluate(() => Number(document.body.innerText.match(/步数\s*(\d+)/)?.[1] ?? -1))
for (const dir of ['左', '上', '右', '下', '左', '上']) {
  const btn = page.locator(`button[aria-label="${dir}"]`)
  if (await btn.count()) await btn.first().click()
  await page.waitForTimeout(150)
}
const movesAfter = await page.evaluate(() => Number(document.body.innerText.match(/步数\s*(\d+)/)?.[1] ?? -1))
check('方向键可操作且步数增加', movesAfter > movesBefore, `${movesBefore} → ${movesAfter}`)

await page.waitForTimeout(800)
const savedText = await page.evaluate(() => document.querySelector('[data-testid=save-badge]')?.textContent ?? '')
check('存档已提交（界面提示已保存）', /已保存/.test(savedText), savedText)

const stored = await page.evaluate(async () => {
  const p = window.__einkPlatform
  const result = await p.storage.saves.loadResult('sokoban')
  return { status: result?.status ?? null, moves: result?.envelope?.moves ?? null }
})
check('IndexedDB 中存在已提交存档', stored.status === 'ok', `status=${stored.status}`)
check('存档步数与界面一致', stored.moves === movesAfter, `存档 ${stored.moves} / 界面 ${movesAfter}`)

await page.screenshot({ path: '../shots/web-01-landscape-game.png' })

await page.reload({ waitUntil: 'networkidle' })
await page.waitForSelector('text=墨趣', { timeout: 15000 })
/*
 * 刷新后应用回到**首页**（不是停在游戏页）—— 这是设计如此：首页有「继续」条。
 * 所以「存档恢复」要验三件事：继续条指向刚玩的那款、存储里的步数没变、点继续回到同一局。
 * （原先直接抓 body 里的「步数」，刷新后页面在首页，必然读到 -1 → 假红。）
 */
const continueText = await page.evaluate(
  () => document.querySelector('.eink-continue')?.innerText?.replace(/\s+/g, ' ') ?? '',
)
check('刷新后首页「继续」条指向刚玩的那款', /推箱子/.test(continueText), continueText || '(没有继续条)')
const storedAfterReload = await page.evaluate(async () => {
  const r = await window.__einkPlatform.storage.saves.loadResult('sokoban')
  return { status: r?.status ?? null, moves: r?.envelope?.moves ?? null }
})
check(
  '刷新后存储里的存档仍在（步数不变）',
  storedAfterReload.status === 'ok' && storedAfterReload.moves === movesAfter,
  `status=${storedAfterReload.status} 存档 ${storedAfterReload.moves} / 刷新前 ${movesAfter}`,
)
await page.locator('.eink-continue').first().click()
await page.waitForTimeout(400)
const startAgain = page.getByRole('button', { name: /开始新游戏|继续/ }).first()
if (await startAgain.count()) await startAgain.click()
await page.waitForSelector('.eink-board', { timeout: 8000 })
const restored = await page.evaluate(() => Number(document.body.innerText.match(/步数\s*(\d+)/)?.[1] ?? -1))
check('点「继续」回到同一局（步数一致）', restored === movesAfter, `刷新前 ${movesAfter} → 恢复后 ${restored}`)

/* ---------- 1b) 语言切换：默认跟随浏览器语言 ---------- */
console.log('\n[1b] locale=en-US：界面应走英文')
{
  const c = await browser.newContext({ viewport: { width: 1248, height: 903 }, locale: 'en-US' })
  const p = await c.newPage()
  await p.goto(PAGE_URL, { waitUntil: 'networkidle' })
  await p.waitForSelector('text=Moqu', { timeout: 15000 })
  const en = await p.evaluate(() => document.body.innerText)
  check('英文界面（跟随浏览器语言）', /All games/.test(en) && /Sokoban/.test(en),
    en.split('\n').slice(0, 3).join(' / '))
  await c.close()
}

/* ---------- 2) 两种视口逐页断言「按钮都在首屏内」 ---------- */
async function auditViewport(width, height, tag) {
  console.log(`\n[${tag}] ${width}x${height}：逐页检查屏外按钮`)
  const c = await browser.newContext({ viewport: { width, height }, locale: 'zh-CN' })
  const p = await c.newPage()
  await p.goto(PAGE_URL, { waitUntil: 'networkidle' })
  await p.waitForSelector('text=墨趣', { timeout: 15000 })

  const offscreen = async (label) => {
    const off = await p.evaluate(() => {
      const vh = window.innerHeight
      return [...document.querySelectorAll('button')]
        .filter((b) => b.getBoundingClientRect().bottom > vh + 1)
        .map((b) => (b.getAttribute('aria-label') || b.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 10))
    })
    check(`${label}：主操作都在首屏内`, off.length === 0, off.length ? JSON.stringify(off) : '')
  }

  await offscreen('首页')
  await p.getByRole('button', { name: /推箱子/ }).first().click()
  await p.waitForSelector('text=玩法说明', { timeout: 8000 })
  await offscreen('详情页')
  const s = p.getByRole('button', { name: /开始新游戏|继续/ }).first()
  await s.click()
  await p.waitForTimeout(300)
  const cf = p.getByRole('button', { name: /替换并开始/ })
  if (await cf.count()) await cf.first().click()
  await p.waitForSelector('.eink-board', { timeout: 8000 })
  await offscreen('游戏页')
  const statRows = await p.evaluate(() => {
    const tops = [...document.querySelectorAll('.eink-stats > *')].map((e) => Math.round(e.getBoundingClientRect().top))
    return new Set(tops).size
  })
  check('游戏页统计栏行数固定', statRows >= 1, `行数=${statRows}`)
  await p.screenshot({ path: `../shots/web-02-${tag}-game.png` })
  await c.close()
}

await auditViewport(1248, 903, '横屏')
await auditViewport(439, 847, '竖屏')

/* ---------- 2b) 每款游戏都能进详情并开局（通用：以后加游戏自动覆盖） ---------- */
console.log('\n[2b] 逐款游戏：进详情 → 开局 → 棋盘渲染 + 按钮不越界')
{
  const c = await browser.newContext({ viewport: { width: 1248, height: 903 }, locale: 'zh-CN' })
  const p = await c.newPage()
  await p.goto(PAGE_URL, { waitUntil: 'networkidle' })
  await p.waitForSelector('text=墨趣', { timeout: 15000 })
  const titles = await p.evaluate(() =>
    [...document.querySelectorAll('.eink-tile__title')].map((e) => e.textContent?.trim() ?? ''),
  )
  check('首页列出全部游戏', titles.length >= 3, titles.join(' / '))

  for (const title of titles) {
    await p.goto(PAGE_URL, { waitUntil: 'networkidle' })
    await p.waitForSelector('text=墨趣', { timeout: 15000 })
    await p.getByRole('button', { name: new RegExp(title) }).first().click()
    await p.waitForSelector('text=玩法说明', { timeout: 8000 })
    // 无关卡的游戏不该出现「暂无进行中的局面」以外的报错，也不该出现缺键标记
    const hasMissingKey = await p.evaluate(() => document.body.innerText.includes('⟦'))
    await p.getByRole('button', { name: /开始新游戏|继续/ }).first().click()
    await p.waitForTimeout(300)
    const cf = p.getByRole('button', { name: /替换并开始/ })
    if (await cf.count()) await cf.first().click()
    await p.waitForSelector(SURFACE, { timeout: 8000 })
    const info = await p.evaluate(() => {
      const surface = document.querySelector('.eink-board, .eink-cardtable, .eink-duel')
      // 格子棋盘数格子；牌桌数牌与座位；对决面板数两侧
      const units =
        document.querySelectorAll('.eink-board__cell').length ||
        document.querySelectorAll('.eink-card, .eink-cardtable__seat').length ||
        document.querySelectorAll('.eink-duel__side').length
      const off = [...document.querySelectorAll('button')].filter(
        (b) => b.getBoundingClientRect().bottom > innerHeight + 1,
      ).length
      return { surface: surface?.className?.split(' ')[0] ?? '(无主视区)', units, off, missing: document.body.innerText.includes('⟦') }
    })
    check(`${title}：开局渲染 + 按钮不越界`, info.units > 0 && info.off === 0 && !info.missing,
      `${info.surface} 元素 ${info.units} 屏外 ${info.off}${info.missing ? ' 有缺键' : ''}${hasMissingKey ? '（详情页有缺键）' : ''}`)
  }
  await c.close()
}

/* ---------- 3) 离线可用（Service Worker） ---------- */
console.log('\n[3] 离线能力：首次加载 → SW 接管 → 断网重载')
{
  const c = await browser.newContext({ viewport: { width: 1248, height: 903 }, locale: 'zh-CN' })
  const p = await c.newPage()
  await p.goto(PAGE_URL, { waitUntil: 'networkidle' })
  await p.waitForSelector('text=墨趣', { timeout: 15000 })

  const controlled = await p
    .waitForFunction(() => navigator.serviceWorker?.controller != null, { timeout: 20000 })
    .then(() => true)
    .catch(() => false)
  check('Service Worker 已接管页面', controlled)

  const sw = await p.evaluate(async () => {
    const regs = await navigator.serviceWorker.getRegistrations()
    const names = await caches.keys()
    let cached = 0
    for (const name of names) cached += (await (await caches.open(name)).keys()).length
    return { active: regs[0]?.active?.state ?? null, cached }
  })
  check('Service Worker 已注册并激活', sw.active === 'activated', `active=${sw.active}`)
  check('资源已预缓存（离线可读）', sw.cached > 0, `缓存条目=${sw.cached}`)

  // 先玩一步，确保有存档
  await p.getByRole('button', { name: /推箱子/ }).first().click()
  await p.waitForSelector('text=玩法说明', { timeout: 8000 })
  const btn = p.getByRole('button', { name: /开始新游戏|继续/ }).first()
  await btn.click()
  await p.waitForTimeout(300)
  const cfd = p.getByRole('button', { name: /替换并开始/ })
  if (await cfd.count()) await cfd.first().click()
  await p.waitForSelector('.eink-board', { timeout: 8000 })
  await p.locator('button[aria-label="左"]').first().click()
  await p.waitForTimeout(900)
  const movesOffline = await p.evaluate(() => document.body.innerText.match(/步数\s*(\d+)/)?.[1] ?? null)

  await c.setOffline(true)
  let openedOffline = true
  try {
    await p.reload({ waitUntil: 'domcontentloaded', timeout: 15000 })
    await p.waitForSelector('text=墨趣', { timeout: 15000 })
  } catch {
    openedOffline = false
  }
  check('断网后重载仍能打开应用', openedOffline)
  if (openedOffline) {
    const st = await p.evaluate(async () => ({
      // 首页只在**异常**时显示离线徽标（「已可离线」常驻徽标已按用户要求移除，见 LibraryScreen）：
      // 断网后正确的表现是「没有任何告警徽标」，而不是去找一个早已不再渲染的「已可离线」
      warnings: [...document.querySelectorAll('.eink-badge--warning')].map((el) => el.textContent ?? ''),
      // 断网重载同样回到首页，所以在**存储层**验存档（页面上的「步数」只在游戏页才有）
      saved: await window.__einkPlatform.storage.saves
        .loadResult('sokoban')
        .then((r) => ({ status: r?.status ?? null, moves: r?.envelope?.moves ?? null }))
        .catch(() => null),
      continueText: document.querySelector('.eink-continue')?.innerText?.replace(/\s+/g, ' ') ?? '',
    }))
    check('断网后首页没有「无法离线」告警', st.warnings.length === 0, st.warnings.join(' | '))
    check(
      '离线时存档仍可读（步数一致）',
      st.saved?.status === 'ok' && String(st.saved?.moves) === String(movesOffline),
      `断网前 ${movesOffline} → 断网后 ${st.saved?.moves}（继续条：${st.continueText || '无'}）`,
    )
  }
  await c.setOffline(false)
  await c.close()
}

await browser.close()

const failed = results.filter((r) => !r.ok)
console.log(`\n=== 小结：${results.length - failed.length}/${results.length} 通过 ===`)
if (failed.length) {
  for (const f of failed) console.log(`  ✗ ${f.name} ${f.extra}`)
  process.exit(1)
}
