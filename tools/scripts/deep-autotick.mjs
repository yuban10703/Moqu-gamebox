/**
 * 自动步进（贪吃蛇自动前进 / 俄罗斯方块自动下落）的浏览器实测。
 *
 * 为什么单独一个脚本：这两款玩法的"在动"是**时间行为**，
 * 和 deep-audit.mjs 的"点一下、看局面变没变"不是一回事。
 * 这里用真实时钟采样，量出：
 *   · 不按键时棋盘确实在自动变化，以及实测间隔；
 *   · 玩家输入之后计时被重置（输入到下一次自动步进 ≥ 一个完整间隔）；
 *   · 暂停面板打开期间棋盘**完全不动**，关掉后恢复；
 *   · 手动「下落」仍然即时生效。
 *
 * 用法：
 *   WEB_URL=http://127.0.0.1:8912/ VIEWPORT=439x847 DSF=1.875 FONT_SCALE=1 \
 *     node tools/scripts/deep-autotick.mjs
 */
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'

const require = createRequire(new URL('../../.toolchain/pw/', import.meta.url))
const { chromium } = require('playwright')

const WEB_URL = process.env.WEB_URL
if (!WEB_URL) throw new Error('必须显式设置 WEB_URL')
const [VW, VH] = (process.env.VIEWPORT ?? '439x847').split('x').map(Number)
const DSF = Number(process.env.DSF ?? '1')
const FONT_SCALE = Number(process.env.FONT_SCALE ?? '1')
const TAG = `${VW}x${VH}@${DSF}x-fs${FONT_SCALE}`
const OUT = process.env.REPORT ?? `.toolchain/shots/deep-autotick/${TAG}.json`
mkdirSync(OUT.slice(0, OUT.lastIndexOf('/')), { recursive: true })

const GAMES = [
  { id: 'snake', title: '贪吃蛇', dir: 'up' },
  { id: 'tetris', title: '俄罗斯方块', dir: 'left' },
]

const results = []
const errors = []
const record = (game, check, ok, detail) => {
  results.push({ game, check, ok, detail })
  console.log(`  ${ok === 'na' ? '·' : ok ? '✓' : '✗'} [${game}] ${check}${detail ? '  ' + detail : ''}`)
}

const browser = await chromium.launch()
const ctx = await browser.newContext({
  viewport: { width: VW, height: VH },
  deviceScaleFactor: DSF,
  locale: 'zh-CN',
  hasTouch: true,
})
const page = await ctx.newPage()
page.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 200)}`))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 200)}`)
})

const SNAP = () => {
  const cells = [...document.querySelectorAll('.eink-board__cell')].map((cell) => ({
    k: cell.dataset.kind ?? '',
    t: (cell.textContent ?? '').trim(),
  }))
  const screen = document.querySelector('.eink-screen--game')
  const stats = [...document.querySelectorAll('.eink-stats__item')].map(
    (item) => `${item.querySelector('dt')?.textContent ?? ''}=${item.querySelector('dd')?.textContent ?? ''}`,
  )
  return {
    sig: JSON.stringify(cells),
    stats,
    autoTick: screen?.dataset.autoTick ?? null,
    paused: screen?.dataset.paused ?? null,
    result: (document.querySelector('.eink-section--result h2')?.textContent ?? '').trim(),
    overlay: document.querySelector('.eink-pausebar') !== null,
  }
}
const snap = () => page.evaluate(SNAP)

async function gotoLibrary() {
  await page.goto(WEB_URL, { waitUntil: 'networkidle' })
  await page.waitForSelector('.eink-tile', { timeout: 15000 })
  await page.waitForTimeout(400)
}

async function startGame(title) {
  await gotoLibrary()
  for (let back = 0; back < 12; back++) {
    const prev = page.locator('button[data-page="prev"]:not([disabled])').first()
    if (!(await prev.count())) break
    await prev.click()
    await page.waitForTimeout(150)
  }
  for (let hop = 0; hop < 12; hop++) {
    const tile = page.locator('.eink-tile', { hasText: title }).first()
    if ((await tile.count()) > 0) { await tile.click(); break }
    const next = page.locator('button[data-page="next"]:not([disabled])').first()
    if (!(await next.count())) break
    await next.click()
    await page.waitForTimeout(200)
  }
  await page.waitForSelector('text=玩法说明', { timeout: 10000 })
  const start = page.getByRole('button', { name: '开始新游戏' }).first()
  if (await start.count()) { await start.click(); await page.waitForTimeout(500) }
  if (await page.getByRole('button', { name: '替换并开始' }).count()) {
    await page.getByRole('button', { name: '替换并开始' }).first().click()
    await page.waitForTimeout(600)
  }
  await page.waitForSelector('.eink-board', { timeout: 10000 })
  await page.waitForTimeout(700)
}

/** 每 step 毫秒采一次，采到 deadline 为止；返回变化时刻（相对起点，毫秒） */
async function sample(ms, step = 200) {
  const start = Date.now()
  const changes = []
  let last = (await snap()).sig
  let lastSnap = null
  while (Date.now() - start < ms) {
    await page.waitForTimeout(step)
    const now = await snap()
    lastSnap = now
    if (now.sig !== last) {
      changes.push(Date.now() - start)
      last = now.sig
    }
    if (now.result) break
  }
  return { changes, last: lastSnap }
}

async function run(game) {
  console.log(`\n=== ${game.title}（${game.id}） ===`)
  await startGame(game.title)
  const s0 = await snap()
  const tick = Number(s0.autoTick)
  record(game.id, '声明了自动步进间隔（data-auto-tick）', Number.isFinite(tick) && tick > 0, `data-auto-tick=${s0.autoTick}`)
  if (!Number.isFinite(tick) || tick <= 0) return

  // ---- 1) 不按键，棋盘自己在动 ----
  const idle = await sample(Math.max(5600, tick * 5.2), 200)
  const gaps = idle.changes.slice(1).map((t, i) => t - idle.changes[i])
  record(
    game.id,
    '不按键时棋盘确实在自动变化（≥5 个采样点里有 ≥3 次变化）',
    idle.changes.length >= 3,
    `变化时刻 ${idle.changes.join(', ')}ms；间隔 ${gaps.join(', ')}ms（声明 ${tick}ms）`,
  )
  const gapOk = gaps.length > 0 && gaps.every((g) => Math.abs(g - tick) <= Math.max(300, tick * 0.35))
  record(game.id, '实测自动间隔与声明一致（±35%）', gapOk, `实测 ${gaps.join(', ')}ms / 声明 ${tick}ms`)

  // ---- 2) 玩家输入后计时被重置 ----
  {
    const before = await snap()
    await page.locator({ up: '.eink-dpad__up', left: '.eink-dpad__left', right: '.eink-dpad__right', down: '.eink-dpad__down' }[game.dir]).first().click()
    const t0 = Date.now()
    const after = await sample(tick + 1400, 120)
    const firstChange = after.changes[0] ?? null
    record(
      game.id,
      '玩家输入后计时被重置（下次自动步进 ≥ 一个完整间隔）',
      firstChange !== null && firstChange >= tick - 220,
      `输入到下一次自动变化 ${firstChange === null ? '（期间没有变化）' : firstChange + 'ms'}，声明间隔 ${tick}ms`,
    )
    void before
  }

  // ---- 3) 暂停面板：3 秒完全不动 ----
  {
    await page.getByRole('button', { name: '暂停', exact: true }).first().click()
    await page.waitForTimeout(400)
    const paused = await snap()
    const frozen = await sample(3000, 200)
    record(
      game.id,
      '暂停面板打开后棋盘 3 秒完全不动',
      paused.paused === 'yes' && paused.overlay && frozen.changes.length === 0,
      `data-paused=${paused.paused}，面板=${paused.overlay}，3s 内变化次数=${frozen.changes.length}`,
    )
    /*
     * 关闭暂停层：必须**限定在遮罩内**点「继续」。
     * 顶栏那个按钮的可访问名也是「继续」，DOM 里排在前面，`.first()` 会命中它 ——
     * 而它被遮罩盖住，Playwright 等可点击性会一直等到超时（实测踩到）。
     */
    await page.locator('.eink-pausebar').getByRole('button', { name: '继续', exact: true }).first().click()
    await page.waitForTimeout(300)
    const resumed = await sample(tick + 1600, 150)
    record(
      game.id,
      '关闭暂停面板后恢复自动步进',
      resumed.changes.length > 0,
      `恢复后 ${(tick + 1600)}ms 内变化 ${resumed.changes.length} 次（${resumed.changes.join(', ')}ms）`,
    )
  }

  // ---- 4) 手动下落/移动仍然即时 ----
  {
    const before = await snap()
    const dir = game.id === 'tetris' ? 'down' : 'up'
    const sel = { up: '.eink-dpad__up', down: '.eink-dpad__down', left: '.eink-dpad__left', right: '.eink-dpad__right' }[dir]
    const t0 = Date.now()
    await page.locator(sel).first().click()
    let changed = null
    while (Date.now() - t0 < 900) {
      await page.waitForTimeout(80)
      const now = await snap()
      if (now.sig !== before.sig) { changed = Date.now() - t0; break }
    }
    /*
     * 两款玩法的"手动操作"语义不同，判据也必须不同：
     * · 俄罗斯方块的「下落」是**立即**把方块下移一格 → 点击到变化必须短于一个间隔；
     * · 贪吃蛇的「转向」按规则层设计只写入单槽缓冲，**下一个自动步进才生效**
     *   （规则层注释与测试都写明了），因此它的期望是"一次间隔之内生效"，而不是"立即"。
     */
    const immediate = game.id === 'tetris'
    const ok = changed !== null && (immediate ? changed < tick : changed <= tick + 400)
    record(
      game.id,
      immediate
        ? `手动「下落」即时生效（< 一个自动间隔 ${tick}ms）`
        : `转向在下一个自动步进生效（≤ 一个间隔 ${tick}ms + 400ms）`,
      ok,
      `点击到局面变化 ${changed === null ? '（900ms 内无变化）' : changed + 'ms'}`,
    )
  }
}

for (const game of GAMES) {
  try {
    await run(game)
  } catch (error) {
    record(game.id, '自动步进巡检未抛错', false, String(error).slice(0, 200))
  }
}

record('console', '无控制台错误 / pageerror', errors.length === 0, errors.slice(0, 3).join(' | '))
const failed = results.filter((r) => r.ok === false)
console.log(`\n=== [${TAG}] 小结：${results.filter((r) => r.ok === true).length} 通过 / ${failed.length} 失败 ===`)
writeFileSync(OUT, JSON.stringify({ tag: TAG, url: WEB_URL, results, errors, at: new Date().toISOString() }, null, 2))
console.log(`报告：${OUT}`)
await browser.close()
process.exit(0)
