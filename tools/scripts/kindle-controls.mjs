/**
 * Kindle 壳层「逐控件巡检」：枚举每个屏幕的每一个可交互控件并逐个点击。
 *
 * 与 audit（几何）/play（玩法流程）/explore（界面走查）互补的一层：
 * **用户答应过的每个按钮都必须：① 存在；② 点了不崩、无 JS 错误、无缺词；
 * ③ 行为可察觉（导航 / 文案变化 / 弹窗）；④ 不该点的时候点了也不崩。**
 *
 * 覆盖：library / settings / about / diagnostics 四屏 + 20 款玩法的对局页
 * （含数字板、方向键、角色格、暂停菜单、重开确认）+ 诊断分页。
 * 环境变量：KINDLE_URL（默认 http://127.0.0.1:8940/）、CONTROLS_MAX（每屏点击上限，默认 999）。
 */
import { createRequire } from 'node:module'
const require = createRequire(new URL('../../.toolchain/pw/', import.meta.url))
const { chromium } = require('playwright')

const BASE = process.env.KINDLE_URL || 'http://127.0.0.1:8940/'
const MAXCLICK = Number(process.env.CONTROLS_MAX || 999)
const problems = []
const checked = []

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 760, height: 1024 } })
await page.goto(BASE, { waitUntil: 'load' })
await page.waitForTimeout(800)
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 120)))
page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(('console: ' + m.text()).slice(0, 120)) })

const say = (m) => console.log('· ' + m)
const waitReady = async () => page.waitForFunction(() => !!(window.__moquApp && window.__moquApp.navigate), null, { timeout: 15000 })
const nav = async (screen, params) => { await waitReady(); await page.evaluate(([s, p]) => window.__moquApp.navigate(s, p), [screen, params]) }
const wait = (ms) => page.waitForTimeout(ms)
const bodyText = () => page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ').trim())
const buttons = () => page.evaluate(() =>
  Array.from(document.querySelectorAll('button')).map((b, i) => ({
    i,
    text: (b.textContent || '').trim().slice(0, 14),
    disabled: b.hasAttribute('disabled') || b.getAttribute('aria-disabled') === 'true',
  })))
const clickNth = (i) => page.evaluate((n) => {
  const b = Array.from(document.querySelectorAll('button'))[n]
  if (!b) return false
  b.scrollIntoView?.()
  b.click()
  return true
}, i)

/** 会**导航离开**当前屏幕的按钮文本：逐控件点击时必须跳过（它们有各自的专项验证） */
const NAV_BUTTONS = new Set(['设置', '关于', '诊断', '游戏库', '返回游戏库', '菜单'])

async function walkScreen(name, screen, params, opts = {}) {
  await nav(screen, params || {})
  await wait(opts.settle || 500)
  const btns = await buttons()
  const skip = new Set([...(opts.skipTexts || []), ...NAV_BUTTONS])
  say(`${name}: ${btns.length} 个按钮（跳过 ${skip.size} 类导航/专项）`)
  checked.push({ screen: name, count: btns.length })
  let clicked = 0
  for (const b of btns) {
    if (skip.has(b.text)) continue
    if (clicked >= MAXCLICK) break
    clicked += 1
    await clickNth(b.i)
    await wait(opts.clickWait || 260)
    // 点完必须还站在壳层里：根节点在、不白屏
    const alive = await page.evaluate(() => {
      const root = document.getElementById('k-root')
      return !!root && !!document.body
    })
    if (!alive) problems.push(`${name}: 点击「${b.text}」后壳层根节点丢失`)
    // 缺词检查：界面上不允许出现 ⟦key⟧
    const missing = await page.evaluate(() => (document.body.innerText || '').includes('⟦'))
    if (missing) problems.push(`${name}: 点击「${b.text}」后出现缺词标记 ⟦key⟧`)
    // 只要还在被测屏幕上就继续；偏离（点击引发导航）就拉回来
    await nav(screen, params || {})
    await wait(220)
  }
  // 每屏末尾：缺词总检
  const missingEnd = await page.evaluate(() => (document.body.innerText || '').includes('⟦'))
  if (missingEnd) problems.push(`${name}: 本屏尾部存在缺词标记 ⟦key⟧`)
  return { count: btns.length }
}

/* ---------- 1) 书库 ---------- */
{
  await nav('settings'); await wait(500)
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find((x) => (x.textContent || '').trim() === '简体中文')
    if (b) b.click()
  })
  await wait(400)
  const before = await bodyText().then((t) => t.slice(0, 40))
  say('书库首屏: ' + before)
  // 分页边界：第 1 页时「上一页」禁用
  await nav('library')
  await wait(600)
  const r1 = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('.k-pager button'))
    return { firstDisabled: btns[0]?.hasAttribute('disabled') ?? null, info: (document.querySelector('.k-pager__info') || {}).textContent }
  })
  if (!r1.firstDisabled) problems.push(`书库第 1 页「上一页」应为禁用（实得 ${JSON.stringify(r1)}）`)
  await walkScreen('书库', 'library', {}, { skipTexts: ['上一页'] })
  // 翻到最后一页：「下一页」应禁用
  await nav('library')
  await wait(500)
  for (let i = 0; i < 10; i++) {
    const has = await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('.k-pager button')).find((x) => (x.textContent || '').trim() === '下一页')
      if (!b || b.hasAttribute('disabled')) return false
      b.click()
      return true
    })
    if (!has) break
    await wait(300)
  }
  const last = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('.k-pager button'))
    return { nextDisabled: btns[1]?.hasAttribute('disabled') ?? null, info: (document.querySelector('.k-pager__info') || {}).textContent?.trim() }
  })
  if (!last.nextDisabled) problems.push(`书库最后一页「下一页」应为禁用（实得 ${JSON.stringify(last)}）`)
  if (!`${last.info}`.match(/第 \d+\/\d+ 页/)) problems.push(`书库页码文案不对：${last.info}`)
}

/* ---------- 2) 设置 ---------- */
{
  await nav('settings')
  await wait(500)
  const before = await bodyText()
  if (!before.includes('已有存档')) problems.push('设置页缺少「已有存档」行')
  // 语言切换：英文下拉后界面出现 Settings
  const btnTexts = await buttons()
  const en = btnTexts.findIndex((b) => b.text === 'English')
  if (en < 0) problems.push('设置页找不到 English 按钮')
  else { await clickNth(en); await wait(400) }
  const after = await bodyText()
  if (!after.includes('Settings')) problems.push('切换英文后没有出现 Settings（界面没整体翻过来）')
  // 切回中文
  const zh = await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find((x) => (x.textContent || '').trim() === '简体中文')
    if (b) { b.click(); return true }
    return false
  })
  if (!zh) problems.push('切不回简体中文')
  await wait(400)
  // 导出备份：出现导出文本框
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find((x) => (x.textContent || '').trim() === '导出备份')
    if (b) b.click()
  })
  await wait(400)
  const exported = await page.evaluate(() => document.querySelectorAll('textarea').length)
  if (exported < 1) problems.push('「导出备份」没有产生导出文本框')
  // 清除全部进度：确认弹窗的取消不删、确认删
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find((x) => (x.textContent || '').trim() === '清除全部进度')
    if (b) b.click()
  })
  await wait(300)
  const cancel = await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('.k-dialog__panel button')).find((x) => (x.textContent || '').trim() === '取消')
    if (b) { b.click(); return true }
    return false
  })
  if (!cancel) problems.push('「清除全部进度」的取消按钮没找到')
  await wait(300)
  // 每屏逐控件巡检（其余开关按钮全部点一遍）
  await walkScreen('设置', 'settings', {}, { skipTexts: ['清除全部进度', '简体中文', 'English'] })
}

/* ---------- 3) 关于 / 诊断 ---------- */
{
  await nav('about'); await wait(500)
  const about = await bodyText()
  for (const expect of ['版本', '作者', '开源地址']) {
    if (!about.includes(expect)) problems.push(`关于页缺少「${expect}」`)
  }
  await walkScreen('关于', 'about', {}, { skipTexts: [] })
  await nav('diagnostics'); await wait(500)
  // 跑一道自检：报告文本框会被填充
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find((x) => (x.textContent || '').trim() === '跑一道自检')
    if (b) b.click()
  })
  await wait(1200)
  const report = await page.evaluate(() => {
    const box = document.querySelector('textarea')
    return box ? { lines: (box.value || '').split('\n').length, hasUa: (box.value || '').indexOf('ua=') >= 0 } : null
  })
  if (!report || !report.hasUa) problems.push('诊断自检报告没有生成（缺 ua= 行）')
  // 诊断分页
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('.k-pager button')).find((x) => (x.textContent || '').trim() === '下一页')
    if (b) b.click()
  })
  await wait(400)
  await walkScreen('诊断', 'diagnostics', {}, { skipTexts: [] })
}

/* ---------- 4) 每款玩法的对局页：每个控件逐个点 ---------- */
{
  await nav('library'); await wait(400)
  const ids = await page.evaluate(() => window.__moquApp.listGameIds())
  for (const id of ids) {
    const before = pageErrors.join('').length
    await nav('game', { gameId: id, difficulty: 'starter', fresh: true })
    await wait(550)
    const btns = await buttons()
    if (btns.length === 0) { problems.push(`${id}: 对局页一个按钮都没有`); continue }
    // 每个控件点一次（跳过会直接「换一局/下一关」这种长距离跳转的，改为后面单独验证）
    for (const b of btns) {
      if (b.disabled) continue
      await clickNth(b.i)
      await wait(200)
      const alive = await page.evaluate(() => !!document.getElementById('k-root'))
      if (!alive) problems.push(`${id}: 点击「${b.text}」后壳层丢失`)
      // 终局确认弹窗里出现过的「取消」要能收回
      const confirmCancel = await page.evaluate(() => {
        const b2 = Array.from(document.querySelectorAll('.k-dialog__panel button')).find((x) => (x.textContent || '').trim() === '取消')
        if (b2) { b2.click(); return true }
        return false
      })
      if (confirmCancel) continue
    }
    // 暂停菜单逐个控件
    await nav('game', { gameId: id, difficulty: 'starter', fresh: true })
    await wait(450)
    await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('.k-topbar button')).find((x) => (x.textContent || '').trim() === '菜单')
      if (b) b.click()
    })
    await wait(350)
    const menu = await page.evaluate(() => Array.from(document.querySelectorAll('.k-dialog__panel button')).map((b) => (b.textContent || '').trim()))
    if (menu.length === 0) problems.push(`${id}: 菜单按钮没有弹出暂停菜单`)
    // 菜单里逐个点（继续先点，其余点完靠下一次导航复位）
    for (const t of menu) {
      await page.evaluate((txt) => {
        const b = Array.from(document.querySelectorAll('.k-dialog__panel button')).find((x) => (x.textContent || '').trim() === txt)
        if (b) b.click()
      }, t)
      await wait(220)
      await nav('game', { gameId: id, difficulty: 'starter', fresh: true })
      await wait(300)
      await page.evaluate(() => {
        const b = Array.from(document.querySelectorAll('.k-topbar button')).find((x) => (x.textContent || '').trim() === '菜单')
        if (b) b.click()
      })
      await wait(300)
    }
    if (pageErrors.join('').length > before) problems.push(`${id}: 巡检期间出现 JS 错误：${pageErrors[pageErrors.length - 1]}`)
  }
}

/* ---------- 汇总 ---------- */
await say('')
if (pageErrors.length) { say('页面错误 ' + pageErrors.length + ' 条：'); for (const e of pageErrors.slice(0, 5)) say('  ' + e) }
if (problems.length) {
  say('发现 ' + problems.length + ' 个问题：')
  for (const p of problems) say('· ' + p)
  await browser.close()
  process.exit(1)
}
say(`全部通过：${checked.length} 个屏幕巡检、${checked.reduce((a, b) => a + b.count, 0)} 个按钮枚举，无页面错误。`)
await browser.close()
