/**
 * 探索式缺陷探测（界面与交互）。
 *
 * 把「用户实际报过的缺陷类型」固化成可重复断言，主动去撞问题：
 *   横竖屏中途切换 / 暂停恢复 / 重开确认 / 退出后继续 / 真实通关 /
 *   菜单弹窗 / 难度切换 / 设置项切换（含字号）/ 键盘操作
 * 每一步都检查四类不变量：
 *   1) 没有不可达的按钮（可滚动容器里的除外）
 *   2) 固定页脚在屏内
 *   3) 没有缺键标记 ⟦key⟧
 *   4) 页面不溢出视口、棋盘不被裁切
 *
 * 用法：npm run build:web && npm run serve:web & 然后 npm run explore
 * 退出码非 0 表示发现缺陷（含任何页面 JS 错误）。
 */
/**
 * 探索式缺陷探测：把「用户报过的 bug 类型」做成可重复断言，主动撞问题。
 * 覆盖：横竖屏切换 / 暂停恢复 / 退出后继续 / 真实通关 / 难度切换 / 设置切换 /
 *       存档损坏恢复 / 键盘操作，并在每步检查四类不变量。
 */
import { createRequire } from 'node:module'

// playwright 装在 gitignored 的 .toolchain/pw（体积大，不进项目依赖）
const require = createRequire(new URL('../../.toolchain/pw/', import.meta.url))
const { chromium } = require('playwright')

const PAGE_URL = process.env.WEB_URL ?? 'http://127.0.0.1:8899/'
const results = []
const errors = []
const check = (n, ok, extra = '') => {
  results.push({ n, ok })
  console.log(`  ${ok ? '✓' : '✗'} ${n}${extra ? '  ' + extra : ''}`)
}

// 每步都要成立的四类不变量（都来自用户实际报过的缺陷）
async function invariants(page, label) {
  const r = await page.evaluate(() => {
    const vh = innerHeight, vw = innerWidth
    /** 元素是否在「可滚动容器」里 —— 这类屏外内容滚一下就能到，不算缺陷 */
    const reachableByScroll = (el) => {
      let n = el.parentElement
      while (n) {
        const cs = getComputedStyle(n)
        if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && n.scrollHeight > n.clientHeight + 1) {
          return true
        }
        n = n.parentElement
      }
      return false
    }
    const off = [...document.querySelectorAll('button')]
      .filter((b) => {
        const box = b.getBoundingClientRect()
        const outside = box.bottom > vh + 1 || box.right > vw + 1 || box.left < -1 || box.top < -1
        return outside && !reachableByScroll(b)
      })
      .map((b) => (b.getAttribute('aria-label') || b.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 8))
    // 固定页脚（若有）必须在屏内
    const footer = document.querySelector('.eink-footer')
    const board = document.querySelector('.eink-board')
    const area = document.querySelector('.eink-board-area')
    let clip = null
    if (board && area) {
      const br = board.getBoundingClientRect(), ar = area.getBoundingClientRect()
      clip = {
        top: Math.round(ar.top - br.top),
        bottom: Math.round(br.bottom - ar.bottom),
        left: Math.round(ar.left - br.left),
        right: Math.round(br.right - ar.right),
      }
    }
    return {
      off,
      footerOut: footer ? footer.getBoundingClientRect().bottom > vh + 1 : false,
      missing: document.body.innerText.includes('⟦'),
      scrollH: document.body.scrollHeight,
      vh,
      clip,
      cells: document.querySelectorAll('.eink-board__cell').length,
    }
  })
  check(`${label}：无不可达元素`, r.off.length === 0, r.off.join(','))
  check(`${label}：固定页脚在屏内`, !r.footerOut)
  check(`${label}：无缺键`, !r.missing)
  check(`${label}：页面不溢出视口`, r.scrollH <= r.vh + 1, `${r.scrollH}/${r.vh}`)
  if (r.clip) {
    const clipped = r.clip.top > 1 || r.clip.bottom > 1 || r.clip.left > 1 || r.clip.right > 1
    check(`${label}：棋盘未被裁切`, !clipped, JSON.stringify(r.clip))
  }
  return r
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 439, height: 847 }, locale: 'zh-CN' })
const page = await ctx.newPage()
page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)))
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 160)) })

const gotoLibrary = async () => {
  await page.goto(PAGE_URL, { waitUntil: 'networkidle' })
  await page.waitForSelector('text=墨水屏游戏盒子', { timeout: 15000 })
}
/**
 * 点击「最上层浮层」里的按钮。
 * 注意：顶栏的「暂停」在暂停后会变成「继续」，与浮层里的「继续游戏」同名 ——
 * 不限定作用域就会命中浮层后面那个（被遮挡，点击会被拦截）。
 */
const clickOverlay = async (text) => {
  // 浮层有两种容器：暂停/结果为 .eink-overlay，菜单/确认为 .eink-dialog
  const overlay = page.locator('.eink-overlay, .eink-dialog').last()
  const btn = overlay.getByRole('button', { name: new RegExp(text) }).first()
  if (!(await btn.count())) {
    throw new Error(`浮层里找不到「${text}」：${(await overlay.innerText()).replace(/\n+/g, ' ').slice(0, 90)}`)
  }
  await btn.click()
  await page.waitForTimeout(250)
}

/** 点击失败必须立刻报错：静默跳过会让后续步骤在错误的页面上继续，掩盖真实缺陷 */
const clickText = async (text, { optional = false } = {}) => {
  const btn = page.getByRole('button', { name: new RegExp(text) }).first()
  if (!(await btn.count())) {
    if (optional) return false
    throw new Error(`找不到按钮「${text}」，当前页面：${(await page.evaluate(() => document.body.innerText)).replace(/\n+/g, ' ').slice(0, 90)}`)
  }
  await btn.click()
  await page.waitForTimeout(250)
  return true
}
const startGame = async (title) => {
  await clickText(title)
  await page.waitForSelector('text=玩法说明', { timeout: 8000 })
  await clickText('继续', { optional: true })
  if (!(await page.locator('.eink-board').count())) await clickText('开始新游戏')
  await page.waitForTimeout(300)
  if (await page.getByRole('button', { name: /替换并开始/ }).count()) await clickText('替换并开始')
  await page.waitForSelector('.eink-board', { timeout: 8000 })
}

/* ---------- 1) 横竖屏中途切换 ---------- */
console.log('\n[1] 游玩中切换横竖屏')
await gotoLibrary()
await startGame('数独')
await invariants(page, '竖屏游玩')
for (const [w, h, tag] of [[1248, 903, '切横屏'], [439, 847, '切回竖屏']]) {
  await page.setViewportSize({ width: w, height: h })
  await page.waitForTimeout(700)
  await invariants(page, tag)
}

/* ---------- 2) 暂停 / 恢复 / 重开确认 ---------- */
console.log('\n[2] 暂停、恢复、重开确认')
await clickText('暂停')
await page.waitForTimeout(300)
await invariants(page, '暂停遮罩')
await clickOverlay('继续')
await clickText('重新开始')
await page.waitForTimeout(300)
await invariants(page, '重开确认弹窗')
await clickOverlay('取消')
await page.waitForTimeout(300)

/* ---------- 3) 退出后从首页继续 ---------- */
console.log('\n[3] 退出 → 首页继续')
// 「返回游戏库」在暂停遮罩里（菜单弹窗只有全刷/导出备份/关闭）
await clickText('暂停')
await clickOverlay('返回游戏库')
await page.waitForTimeout(800)
await invariants(page, '首页')
const hasContinue = await page.locator('.eink-card--continue').count()
check('首页出现「继续上一局」', hasContinue > 0)
await clickText('继续')
await page.waitForTimeout(800)
const resumed = await page.locator('.eink-board__cell').count()
check('能恢复回到游戏页', resumed > 0, `${resumed} 格`)

console.log('\n[3b] 菜单弹窗')
await gotoLibrary()
await startGame('数独')
await clickText('菜单')
await page.waitForTimeout(300)
check('菜单弹窗可打开', (await page.locator('.eink-dialog').count()) > 0)
await invariants(page, '菜单弹窗')
await clickOverlay('关闭')

/* ---------- 4) 真实通关（推箱子第 1 关，用已知见证步） ---------- */
console.log('\n[4] 真实通关并检查结果面板')
await gotoLibrary()
await startGame('推箱子')
const WITNESS = ['左', '上', '上', '左', '上', '左', '左', '下', '右', '上', '右', '右']
for (const dir of WITNESS) {
  const btn = page.locator(`button[aria-label="${dir}"]`)
  if (await btn.count()) await btn.first().click()
  await page.waitForTimeout(120)
}
await page.waitForTimeout(900)
const solvedText = await page.evaluate(() => document.body.innerText)
check('通关判定生效', /过关|完成|下一关/.test(solvedText), solvedText.replace(/\n+/g, ' ').slice(0, 60))
await invariants(page, '结果面板')
{
  // 「下一关」由游戏声明（id: next-level）。此处就地验证，避免先离开结果面板
  const nextBtn = page.getByRole('button', { name: /下一关/ })
  check('关卡制游戏的结果面板有「下一关」', (await nextBtn.count()) > 0)
  const dupNext = await page.evaluate(
    () => [...document.querySelectorAll('.eink-controls button')].filter((b) => /下一关/.test(b.innerText)).length,
  )
  check('控制区不重复出现「下一关」', dupNext === 0, `控制区里有 ${dupNext} 个`)
  if (await nextBtn.count()) {
    const disabled = await nextBtn.first().isDisabled()
    check('「下一关」不是永远禁用（曾经的缺陷）', !disabled)
    if (!disabled) {
      await nextBtn.first().click()
      await page.waitForTimeout(1200)
      const title = await page.evaluate(() => document.querySelector('.eink-topbar__title h1')?.textContent ?? '')
      check('点下一关确实进入下一关', /第 2\//.test(title), title)
      await invariants(page, '下一关')
    }
  }
}
// 点过「下一关」后已经在新的关卡里，结果面板消失了 —— 从暂停遮罩回游戏库
await clickText('暂停')
await clickOverlay('返回游戏库')
await page.waitForTimeout(900)
const progressText = await page.evaluate(() => document.body.innerText.replace(/\n+/g, ' '))
check('首页进度已更新', /1\/16/.test(progressText), progressText.slice(0, 80))

/* ---------- 4c) 失败也要有终局结果面板 ---------- */
console.log('\n[4c] 踩雷失败后的终局反馈')
{
  await gotoLibrary()
  await startGame('扫雷')
  let lost = false
  for (let i = 0; i < 40 && !lost; i++) {
    await page.evaluate(() => {
      const c = [...document.querySelectorAll('.eink-board__cell[data-kind="hidden"]')][0]
      c?.click()
    })
    await page.waitForTimeout(120)
    lost = (await page.locator('.eink-section--result').count()) > 0
  }
  check('踩雷后出现终局结果面板（曾经完全没有）', lost)
  const resultTitle = await page.evaluate(
    () => document.querySelector('.eink-section--result h2')?.textContent ?? '',
  )
  check('终局结果有标题', resultTitle.length > 0, resultTitle)
  await invariants(page, '失败结果面板')
  check('失败后可以再来一次', (await page.getByRole('button', { name: /再来一次/ }).count()) > 0)
}

/* ---------- 5) 难度切换 ---------- */
console.log('\n[5] 切换难度后开局')
await gotoLibrary()
await clickText('扫雷')
await page.waitForSelector('text=玩法说明')
await clickText('挑战')
await clickText('开始新游戏')
await page.waitForTimeout(300)
if (await page.getByRole('button', { name: /替换并开始/ }).count()) await clickText('替换并开始')
await page.waitForSelector('.eink-board')
await page.waitForTimeout(500)
const cells = await page.locator('.eink-board__cell').count()
check('挑战难度为 16×16（256 格）', cells === 256, `${cells} 格`)
await invariants(page, '扫雷挑战')

/* ---------- 6) 设置切换 ---------- */
console.log('\n[6] 设置项切换后各页仍放得下')
// 直接用首页进入设置：盲点两次「返回」会依赖当前所在页面，脆弱
await gotoLibrary()
await clickText('设置')
await page.waitForSelector('text=设置', { timeout: 8000 })
for (const label of ['加粗线条', '显示方向按钮']) {
  await clickText(label)
  await invariants(page, `设置·${label}`)
}
// 字号切到「大」再切回「标准」：字号变化最容易把按钮顶出屏幕
for (const size of ['大', '特大']) {
  await clickText(size)
  await invariants(page, `设置·字号${size}`)
}
await clickText('标准')
await invariants(page, '设置·字号标准')
await clickText('返回'); await page.waitForTimeout(800)
const backState = await page.evaluate(() => ({
  home: /全部游戏/.test(document.body.innerText),
  text: document.body.innerText.replace(/\n+/g, ' ').slice(0, 60),
}))
check('从设置返回确实回到首页', backState.home, backState.text)
await invariants(page, '设置返回后首页')

/* ---------- 7) 键盘操作 ---------- */
console.log('\n[7] 键盘方向键')
await gotoLibrary()
await startGame('推箱子')
const before = await page.evaluate(() => document.body.innerText.match(/步数\s*(\d+)/)?.[1])
let after = before
for (const key of ['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown']) {
  await page.keyboard.press(key)
  await page.waitForTimeout(300)
  after = await page.evaluate(() => document.body.innerText.match(/步数\s*(\d+)/)?.[1])
  if (Number(after) > Number(before)) break
}
check('键盘方向键能操作（四个方向里至少一个可走）', Number(after) > Number(before), `${before} → ${after}`)

console.log(`\n=== 页面错误：${errors.length} ===`)
for (const e of errors.slice(0, 6)) console.log('  ! ' + e)
const failed = results.filter((r) => !r.ok)
console.log(`=== 小结：${results.length - failed.length}/${results.length} 通过 ===`)
for (const f of failed) console.log('  ✗ ' + f.n)
await browser.close()
process.exit(failed.length || errors.length ? 1 : 0)
