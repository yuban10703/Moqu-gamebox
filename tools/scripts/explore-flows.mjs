/**
 * 探索式缺陷探测（三）：完整流程与状态一致性。
 *   1) 完整一局的覆盖见 explore-ui（推箱子真实通关）
 *   2) 撤销一整回合（玩家 + 对方）
 *   3) 计时器：暂停期间必须停止；重载后必须从已保存用时继续
 *   4) 多游戏存档互不干扰
 *   5) 损坏存档的「清除」入口真的可用
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

/** 精简不变量：无缺键、页面不溢出视口、无不可达按钮 */
async function invariants(page, label) {
  const r = await page.evaluate(() => ({
    missing: document.body.innerText.includes('⟦'),
    overflow: document.body.scrollHeight > innerHeight + 1,
    off: [...document.querySelectorAll('button')].filter((b) => b.getBoundingClientRect().bottom > innerHeight + 1).length,
  }))
  check(`${label}：无缺键`, !r.missing)
  check(`${label}：页面不溢出视口`, !r.overflow)
  check(`${label}：无不可达按钮`, r.off === 0, `${r.off} 个`)
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 439, height: 847 }, locale: 'zh-CN' })
const page = await ctx.newPage()
page.on('pageerror', (e) => errors.push(String(e).slice(0, 180)))
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 180)) })

const clickText = async (text, { optional = false } = {}) => {
  const btn = page.getByRole('button', { name: new RegExp(text) }).first()
  if (!(await btn.count())) {
    if (optional) return false
    throw new Error(`找不到按钮「${text}」：${(await page.evaluate(() => document.body.innerText)).replace(/\n+/g, ' ').slice(0, 90)}`)
  }
  await btn.click(); await page.waitForTimeout(220); return true
}
const clickDialog = async (text) => {
  await page.locator('.eink-overlay, .eink-dialog').last()
    .getByRole('button', { name: new RegExp(text) }).first().click()
  await page.waitForTimeout(220)
}
const gotoLibrary = async () => {
  await page.goto(PAGE_URL, { waitUntil: 'networkidle' })
  await page.waitForSelector('text=墨水屏游戏盒子', { timeout: 15000 })
}
const startGame = async (title, attempt = 1) => {
  await gotoLibrary()
  await clickText(title)
  try {
    await page.waitForSelector('text=玩法说明', { timeout: 6000 })
  } catch {
    if (attempt >= 2) throw new Error(`点「${title}」后没进入详情页：${(await page.evaluate(() => document.body.innerText)).replace(/\n+/g, ' ').slice(0, 80)}`)
    return startGame(title, attempt + 1)
  }
  await clickText('继续', { optional: true })
  // 「继续」是异步读存档（IndexedDB），必须等棋盘真的挂载出来再决定是否新开一局，
  // 否则会误判成「没有存档」而点掉「开始新游戏」，把已有进度替换掉（测试里踩过）
  await page.waitForSelector('.eink-board', { timeout: 4000 }).catch(() => {})
  if (!(await page.locator('.eink-board').count())) await clickText('开始新游戏')
  await page.waitForTimeout(300)
  if (await page.getByRole('button', { name: /替换并开始/ }).count()) await clickDialog('替换并开始')
  await page.waitForSelector('.eink-board', { timeout: 8000 })
}
/** 恢复到的存档可能已经结束（结果显示面板），需要先重开才能继续测 */
const ensurePlaying = async () => {
  if ((await page.locator('.eink-section--result').count()) > 0) {
    await clickText('再来一次')
    await page.waitForTimeout(300)
    if (await page.locator('.eink-overlay, .eink-dialog').count()) await clickDialog('确定|重新开始')
    await page.waitForTimeout(600)
  }
}

/** 直接读存档内容做断言：界面文案会受「恢复到哪一局/何时读」影响，数据不会骗人 */
const readSave = (gameId) =>
  page.evaluate(async (id) => {
    const r = await window.__einkPlatform.storage.saves.loadResult(id)
    if (r.status !== 'ok') return { status: r.status }
    return {
      status: 'ok',
      moves: r.envelope.moves,
      commitId: r.envelope.commitId,
      elapsedMs: r.envelope.session.elapsedMs,
      filled: Array.isArray(r.envelope.state?.filled)
        ? r.envelope.state.filled.filter((v) => v !== 0).length
        : null,
    }
  }, gameId)

const statValue = (label) =>
  page.evaluate((l) => {
    const item = [...document.querySelectorAll('.eink-stats__item')].find((e) => e.textContent.includes(l))
    return item?.textContent.replace(l, '').trim() ?? null
  }, label)

// 每次运行从干净状态开始：本套件会故意损坏存档来验证恢复入口，
// 若不清空，下一次运行会读到上一次留下的坏档（曾因此误判成「进度丢失」）
await page.goto(PAGE_URL, { waitUntil: 'networkidle' })
await page.waitForSelector('text=墨水屏游戏盒子', { timeout: 15000 })
await page.evaluate(async () => { await window.__einkPlatform.storage.clearAll() })
await page.reload({ waitUntil: 'networkidle' })
await page.waitForSelector('text=墨水屏游戏盒子', { timeout: 15000 })

/* ---------- 1) 与 2) 原先用「黑白棋」做完整一局与整回合撤销 ----------
 * 该玩法已按用户要求移除，这两段的覆盖改由 explore-ui 承担：
 * 它用**推箱子**走完真实通关流程（结果面板、下一关按钮）并覆盖撤销/重开。
 */
/* ---------- 3) 计时器 ---------- */
console.log('\n[3] 计时器：暂停停止 / 重载延续')
await startGame('推箱子')
await ensurePlaying()
// 先真的走一步：0 步的局面不会持久化，而且某个方向可能被墙挡住
for (const dir of ['下', '左', '右', '上']) {
  const btn = page.locator(`button[aria-label="${dir}"]`)
  if (await btn.count()) await btn.first().click()
  await page.waitForTimeout(300)
  if ((await statValue('步数')) !== '0') break
}
await page.waitForTimeout(2200)
const t1 = await statValue('用时')
await clickText('暂停')
await page.waitForTimeout(3500)
const t2 = await statValue('用时')
await clickDialog('继续')
await page.waitForTimeout(1200)
const t3 = await statValue('用时')
const secs = (t) => { const [m, s] = String(t).split(':').map(Number); return (m ?? 0) * 60 + (s ?? 0) }
check('暂停期间计时停止', secs(t2) === secs(t1), `${t1} → 暂停 3.5s → ${t2}`)
check('恢复后继续计时', secs(t3) >= secs(t2), `${t2} → ${t3}`)
const savedElapsed = (await readSave('sokoban')).elapsedMs
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(600)
await clickText('继续', { optional: true })
await page.waitForSelector('.eink-board', { timeout: 5000 }).catch(() => {})
if (!(await page.locator('.eink-board').count())) await clickText('开始新游戏')
await page.waitForSelector('.eink-board', { timeout: 8000 })
await page.waitForTimeout(800)
// 以存档为准：重载不得清掉已累计用时（恢复后界面从该值继续）
const afterReload = await readSave('sokoban')
const t4 = await statValue('用时')
// 注意：用时是「按最后一次落盘时刻」记录的（只有操作才会落盘），
// 因此这里断言的是「重载不会让已落盘的用时倒退」，而不是「等于界面显示值」。
check(
  '重载后存档里的累计用时不会倒退',
  afterReload.status === 'ok' && afterReload.elapsedMs >= savedElapsed,
  `存档 ${savedElapsed}ms → ${afterReload.elapsedMs}ms；界面 ${t3} → ${t4}`,
)
check('恢复后界面用时不是从 0 重新计（≥ 存档秒数 - 1）', secs(t4) >= Math.floor(savedElapsed / 1000) - 1, `${t4}`)

/* ---------- 4) 多游戏存档隔离 ---------- */
console.log('\n[4] 多游戏存档互不干扰')
await startGame('数独')
await ensurePlaying()
await page.evaluate(() => { const c = [...document.querySelectorAll('.eink-board__cell[data-kind="empty"]')][0]; c?.click() })
for (const v of ['1', '2', '3', '4', '5', '6', '7', '8', '9']) {
  await clickText(v)
  if ((await page.locator('.eink-board__cell[data-kind="tile"]').count()) > 0) break
}
const sudokuFilled = await page.locator('.eink-board__cell[data-kind="tile"]').count()
const sudokuSaveBefore = await readSave('sudoku')
const sudokuFillSaved = sudokuSaveBefore.filled
console.log(`    [诊断] 数独存档（切走前）: ${JSON.stringify(sudokuSaveBefore)}`)
await startGame('推箱子')
await ensurePlaying()
await page.locator('button[aria-label="左"]').first().click()
await page.waitForTimeout(600)
await startGame('数独')
await ensurePlaying()
const sudokuSaveAfter = await readSave('sudoku')
const sudokuBack = await page.locator('.eink-board__cell[data-kind="tile"]').count()
console.log(`    [诊断] 数独存档（回来后）: ${JSON.stringify(sudokuSaveAfter)}；界面填入 ${sudokuBack} 格`)
check('切到别的游戏不会动到本局存档', sudokuFillSaved === sudokuSaveAfter.filled && sudokuSaveAfter.status === 'ok',
  `存档 ${sudokuFillSaved} → ${sudokuSaveAfter.filled}`)
check('切回来能看到本局进度', sudokuBack === sudokuFilled && sudokuFilled > 0, `${sudokuFilled} → ${sudokuBack}`)

/* ---------- 5) 损坏存档的清除入口 ---------- */
console.log('\n[5] 损坏存档可清除')
await page.evaluate(async () => {
  const raw = await window.__einkPlatform.storage.saves.rawAll()
  const item = raw.find((r) => r.key.startsWith('save:1:committed:'))
  if (!item) return
  const db = await new Promise((res, rej) => { const r = indexedDB.open('eink-gamebox'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
  const tx = db.transaction(['kv'], 'readwrite')
  tx.objectStore('kv').put(item.text.slice(0, 30), item.key)
  await new Promise((r) => { tx.oncomplete = r }); db.close()
})
await gotoLibrary()
await page.waitForTimeout(900)
const alertShown = await page.evaluate(() => /存档已损坏/.test(document.body.innerText))
check('首页出现损坏提示', alertShown)
if (alertShown) {
  // 首页的入口是「<游戏名> · 存档自检」，点进去应看到恢复操作（导出备份 / 重新开始）
  await clickText('存档自检')
  await page.waitForTimeout(800)
  const detail = await page.evaluate(() => document.body.innerText.replace(/\n+/g, ' '))
  check('损坏条目的入口能打开且给出恢复操作', /导出备份/.test(detail) && /存档已损坏|读不出来/.test(detail), detail.slice(0, 80))
  await invariants(page, '损坏存档恢复页')
}

/* ---------- 6) 耐久性：落子后「立刻」硬重载，最后一步不能丢 ---------- */
console.log('\n[6] 落子后立刻硬重载（模拟 WebView 崩溃自愈）')
{
  await startGame('数独')
  await ensurePlaying()
  const before = await page.locator('.eink-board__cell[data-kind="tile"]').count()
  await page.evaluate(() => { const c = [...document.querySelectorAll('.eink-board__cell[data-kind="empty"]')][0]; c?.click() })
  for (const v of ['1', '2', '3', '4', '5', '6', '7', '8', '9']) {
    await clickText(v)
    if ((await page.locator('.eink-board__cell[data-kind="tile"]').count()) > before) break
  }
  const filled = await page.locator('.eink-board__cell[data-kind="tile"]').count()
  check('已填入一格', filled > before, `${before} → ${filled}`)
  // 不等待：立刻重载（旧实现有 500ms 防抖窗口，这一步就会丢）
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(500)
  await clickText('继续', { optional: true })
  await page.waitForSelector('.eink-board', { timeout: 5000 }).catch(() => {})
  if (!(await page.locator('.eink-board').count())) await clickText('开始新游戏')
  await page.waitForSelector('.eink-board', { timeout: 8000 })
  const after = await page.locator('.eink-board__cell[data-kind="tile"]').count()
  check('重载后最后一步仍在（防抖窗口已消除）', after === filled, `${filled} → ${after}`)
}

console.log(`\n=== 页面错误：${errors.length} ===`)
for (const e of errors.slice(0, 5)) console.log('  ! ' + e)
const failed = results.filter((r) => !r.ok)
console.log(`=== 小结：${results.length - failed.length}/${results.length} 通过 ===`)
for (const f of failed) console.log('  ✗ ' + f.n)
await browser.close()
process.exit(failed.length || errors.length ? 1 : 0)
