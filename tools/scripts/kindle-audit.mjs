/**
 * Kindle 版**全量**审计（真实 Chromium）：所有页面 × 所有玩法 × 横竖屏。
 *
 * 与另外两条脚本的分工：
 *   kindle-smoke.mjs   —— 冒烟：渲染出来了、没有报错（31 项）
 *   kindle-explore.mjs —— 探索：把 UI 点一遍，撞"点了没反应"这类缺陷
 *   kindle-audit.mjs   —— **本文**：穷举"每一屏 × 每一种屏幕方向"，逐项量尺寸
 *
 * 查的东西（每一项都是"能量出来"的，不靠肉眼）：
 *   1) 文案：缺键 ⟦key⟧ / 没替换的 {param}
 *   2) 滚动：整页出现滚动条（这个版本刻意不做滚动，出现即异常）
 *   3) 裁切：主内容 / 呈现区（棋盘・牌桌・对决）/ 页脚被切在视口外
 *   4) 触摸目标：可点元素小于 44×44（墨水瓶上点不准）
 *   5) 文字溢出：元素内容比容器宽（没有省略号就说明被切了）
 *   6) 玩法可玩：连续输入之后，局面必须**有推进**或**有明确拒绝提示**
 *
 * 用法：
 *   npm run build:kindle
 *   node tools/scripts/serve-kindle.mjs apps/kindle/dist 8791 &
 *   node tools/scripts/kindle-audit.mjs
 */
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(new URL('../../.toolchain/pw/', import.meta.url))
const { chromium } = require('playwright')

const BASE = process.env.KINDLE_URL ?? 'http://127.0.0.1:8791/'
const SHOTS = fileURLToPath(new URL('../../.kindle-shots/audit/', import.meta.url))
const ORIENTATIONS = [
  { name: '竖屏', width: 760, height: 1024 },
  { name: '横屏', width: 1024, height: 760 },
]

const problems = []
const note = (where, what) => problems.push({ where, what })
mkdirSync(SHOTS, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 760, height: 1024 }, hasTouch: true })
let jsErrors = []
page.on('pageerror', (e) => jsErrors.push(String(e.message)))
page.on('console', (m) => {
  if (m.type() === 'error') jsErrors.push(m.text())
})

/** 在页面里量一遍当前屏幕 */
async function measure() {
  return page.evaluate(() => {
    const vw = window.innerWidth
    const vh = window.innerHeight
    const text = document.body.textContent || ''
    const visible = (el) => {
      const r = el.getBoundingClientRect()
      return r.width > 0 && r.height > 0
    }
    const taps = []
    const all = document.querySelectorAll('button, [role="button"], a[href]')
    for (let i = 0; i < all.length; i++) {
      const el = all[i]
      if (!visible(el)) continue
      const r = el.getBoundingClientRect()
      taps.push({
        label: (el.textContent || '').trim().slice(0, 12) || el.getAttribute('aria-label') || '?',
        w: Math.round(r.width),
        h: Math.round(r.height),
        top: Math.round(r.top),
        bottom: Math.round(r.bottom),
        left: Math.round(r.left),
        right: Math.round(r.right),
      })
    }
    // 文字溢出：内容比容器宽，且没有省略号
    const overflowText = []
    const textNodes = document.querySelectorAll('.k-list__title, .k-topbar__title, .k-btn, .k-stat, .k-dialog__title')
    for (let i = 0; i < textNodes.length; i++) {
      const el = textNodes[i]
      if (!visible(el)) continue
      if (el.scrollWidth > el.clientWidth + 2) {
        const style = window.getComputedStyle(el)
        if (style.textOverflow !== 'ellipsis' && style.overflow !== 'hidden') {
          overflowText.push((el.textContent || '').trim().slice(0, 16))
        }
      }
    }
    const main = document.querySelector('.k-main')
    const surface = document.querySelector('.k-board, .k-cards, .k-piles, .k-duel')
    const footer = document.querySelector('.k-footer')
    const rect = (el) => {
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height), w: Math.round(r.width) }
    }
    return {
      vw,
      vh,
      missingKeys: Array.from(new Set(text.match(/⟦[^⟧]+⟧/g) || [])).slice(0, 3),
      unreplaced: Array.from(new Set(text.match(/\{[a-zA-Z_][a-zA-Z0-9_]*\}/g) || [])).slice(0, 3),
      scrollX: document.documentElement.scrollWidth > vw + 2,
      scrollY: document.documentElement.scrollHeight > vh + 2,
      main: rect(main),
      surface: rect(surface),
      footer: rect(footer),
      taps,
      overflowText,
    }
  })
}

/** 对一次测量做全部断言 */
function assertMeasure(where, m) {
  if (m.missingKeys.length) note(where, `缺键 ⟦…⟧: ${m.missingKeys.join(', ')}`)
  if (m.unreplaced.length) note(where, `未替换参数: ${m.unreplaced.join(', ')}`)
  if (m.scrollX) note(where, '出现横向滚动')
  if (m.scrollY) note(where, '出现纵向滚动（本版本应为不滚动）')
  if (m.footer && m.footer.bottom > m.vh + 2) note(where, `页脚超出视口 ${m.footer.bottom} > ${m.vh}`)
  if (m.surface && m.surface.bottom > m.vh + 2) note(where, `呈现区超出视口 ${m.surface.bottom} > ${m.vh}`)
  if (m.main && m.surface && m.surface.bottom > m.main.bottom + 2) {
    note(where, `呈现区被 .k-main 裁切：${m.surface.bottom} > ${m.main.bottom}`)
  }
  /*
   * 页脚是**绝对定位**的：主内容一旦比可用带子高，就会钻到页脚底下被盖住。
   * 页面上不报错、也不滚动，只是底部那截看不见也点不到 ——
   * 这一条最初漏掉了，结果数织的棋盘最后 27px 正好藏在页脚下面。
   */
  if (m.footer && m.surface && m.surface.bottom > m.footer.top + 2) {
    note(where, `呈现区被页脚盖住：${m.surface.bottom} > 页脚顶 ${m.footer.top}`)
  }
  if (m.footer && m.main && m.main.bottom > m.footer.top + 2) {
    note(where, `主内容伸到页脚下面（底部内容看不见）：${m.main.bottom} > ${m.footer.top}`)
  }
  if (m.surface && m.surface.h > 0 && m.surface.h < 80) note(where, `呈现区只剩 ${m.surface.h}px 高（基本不可玩）`)
  for (const t of m.taps) {
    if (t.bottom > m.vh + 2) note(where, `按钮「${t.label}」在视口外（bottom=${t.bottom}）`)
    else if (t.w < 44 || t.h < 44) note(where, `触摸目标过小「${t.label}」${t.w}×${t.h}（下限 44×44）`)
  }
  for (const t of m.overflowText) note(where, `文字溢出容器：「${t}」`)
  if (jsErrors.length) {
    note(where, `JS 错误: ${jsErrors.slice(0, 2).join(' | ')}`)
    jsErrors = []
  }
}

await page.goto(BASE, { waitUntil: 'load' })
await page.waitForTimeout(900)
const gameIds = await page.evaluate(() => window.__moquApp.listGameIds())
console.log(`审计开始：${gameIds.length} 款玩法 × ${ORIENTATIONS.length} 种方向\n`)

for (const o of ORIENTATIONS) {
  await page.setViewportSize({ width: o.width, height: o.height })
  await page.waitForTimeout(250)
  jsErrors = []

  // ---------- 静态页面 ----------
  for (const screen of ['library', 'settings', 'about', 'diagnostics']) {
    await page.evaluate((s) => window.__moquApp.navigate(s), screen)
    await page.waitForTimeout(320)
    assertMeasure(`${o.name}/${screen}`, await measure())
    if (screen === 'library') {
      // 翻到第 2 页（列表满页时的排版与第 1 页不同）
      const next = await page.$('.k-pager__btn:last-of-type, .k-pager button:last-of-type')
      if (next) {
        await next.click({ timeout: 2000 }).catch(() => {})
        await page.waitForTimeout(300)
        assertMeasure(`${o.name}/library·第2页`, await measure())
      }
    }
    await page.screenshot({ path: `${SHOTS}${o.name}-${screen}.png` })
  }

  // ---------- 详情页：逐款 ----------
  for (const id of gameIds) {
    await page.evaluate((g) => window.__moquApp.navigate('detail', { gameId: g }), id)
    await page.waitForTimeout(220)
    assertMeasure(`${o.name}/详情·${id}`, await measure())
  }

  // ---------- 对局页：逐款 ----------
  for (const id of gameIds) {
    await page.evaluate(
      (g) => window.__moquApp.navigate('game', { gameId: g, difficulty: 'starter', fresh: true }),
      id,
    )
    await page.waitForTimeout(420)
    assertMeasure(`${o.name}/对局·${id}`, await measure())

    /*
     * 倒 T 方向键的**几何对齐**：三列必须等宽，且上排的键要正对下排的键。
     *
     * 这一条只能靠真实浏览器量：jsdom 没有布局引擎。
     * 之前上排是 48/72/48、下排是 72/72/72 —— 因为角落的 ↶/↻ 带的是 .k-btn（下限 48），
     * 而方向键是 .k-dpad__btn（下限 72），样式表又是按浮动结构写的、渲染器输出的却是表格。
     * 结果「上」没有对在「下」正上方，↻ 还压在「上」的右边缘上。
     */
    const pad = await page.evaluate(() => {
      const tee = document.querySelector('.k-dpad--tee')
      if (!tee) return null
      const box = (el) => {
        const r = el.getBoundingClientRect()
        return { l: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height), cx: Math.round(r.left + r.width / 2) }
      }
      return {
        btns: Array.from(tee.querySelectorAll('.k-dpad__btn')).map(box),
        corners: Array.from(tee.querySelectorAll('.k-dpad__corner')).map(box),
      }
    })
    if (pad && pad.btns.length === 4 && pad.corners.length === 2) {
      const [up, left, down, right] = pad.btns
      const [cLeft, cRight] = pad.corners
      const widths = pad.btns.concat(pad.corners).map((b) => b.w)
      const heights = pad.btns.concat(pad.corners).map((b) => b.h)
      if (new Set(widths).size !== 1) note(`${o.name}/对局·${id}`, `方向键与角落按钮宽度不一致：${widths.join('/')}`)
      if (new Set(heights).size !== 1) note(`${o.name}/对局·${id}`, `方向键与角落按钮高度不一致：${heights.join('/')}`)
      if (Math.abs(up.cx - down.cx) > 2) note(`${o.name}/对局·${id}`, `「上」没有对在「下」正上方（${up.cx} vs ${down.cx}）`)
      if (Math.abs(cLeft.cx - left.cx) > 2) note(`${o.name}/对局·${id}`, `↶ 没有对在「左」正上方（${cLeft.cx} vs ${left.cx}）`)
      if (Math.abs(cRight.cx - right.cx) > 2) note(`${o.name}/对局·${id}`, `↻ 没有对在「右」正上方（${cRight.cx} vs ${right.cx}）`)
    }
    await page.screenshot({ path: `${SHOTS}${o.name}-game-${id}.png` })
  }

    /*
   * 提示出现**不能推动画面**。
   *
   * 提示条原先只在有内容时才插进文档流，一出现就把棋盘往下推 74px（实测），
   * 而且主内容高度是钉死的、棋盘还会跟着缩小 —— 墨水屏上等于"眼睛刚对准就换了一屏"。
   * 这条只能在真实浏览器里量：jsdom 没有布局引擎，量不出"动了多少"。
   * 用推箱子开局往右走（右边就是边框墙，必定被拒 → 必定出提示）。
   */
  {
    await page.evaluate(() =>
      window.__moquApp.navigate('game', { gameId: 'sokoban', difficulty: 'starter', fresh: true }),
    )
    await page.waitForTimeout(450)
    const before = await measure()
    await page.evaluate(() => {
      const right = Array.from(document.querySelectorAll('.k-dpad__btn')).find(
        (b) => (b.textContent || '').trim() === '右',
      )
      if (right) right.click()
    })
    await page.waitForTimeout(450)
    const after = await measure()
    const noticeShown = await page.evaluate(() => {
      const n = document.querySelector('.k-notice--band')
      return n ? (n.textContent || '').trim().length > 0 : false
    })
    if (!noticeShown) note(`${o.name}/提示`, '撞墙之后没有出现提示（测不到布局是否移动）')
    else if (before.surface && after.surface) {
      if (before.surface.top !== after.surface.top) {
        note(`${o.name}/提示`, `提示出现把棋盘推移了 ${after.surface.top - before.surface.top}px`)
      }
      if (before.surface.h !== after.surface.h) {
        note(`${o.name}/提示`, `提示出现让棋盘高度从 ${before.surface.h} 变成 ${after.surface.h}`)
      }
    }
  }

// ---------- 对话框 ----------
  await page.evaluate(() =>
    window.__moquApp.navigate('game', { gameId: 'sokoban', difficulty: 'starter', fresh: true }),
  )
  await page.waitForTimeout(400)
  const menu = await page.$('.k-topbar button:last-of-type')
  if (menu) {
    await menu.click({ timeout: 2000 }).catch(() => {})
    await page.waitForTimeout(300)
    assertMeasure(`${o.name}/暂停菜单`, await measure())
    await page.screenshot({ path: `${SHOTS}${o.name}-dialog-pause.png` })
    const close = await page.$('.k-dialog__panel button')
    if (close) await close.click({ timeout: 2000 }).catch(() => {})
    await page.waitForTimeout(250)
  } else {
    note(`${o.name}/暂停菜单`, '顶栏找不到「菜单」按钮')
  }
}

await browser.close()

// ---------- 汇总 ----------
if (problems.length === 0) {
  console.log('✅ 全量审计未发现问题')
  process.exit(0)
}
const grouped = new Map()
for (const p of problems) {
  if (!grouped.has(p.where)) grouped.set(p.where, new Set())
  grouped.get(p.where).add(p.what)
}
console.log(`❌ 共 ${problems.length} 处问题，分布在 ${grouped.size} 个位置：\n`)
let shown = 0
for (const [where, set] of grouped) {
  if (shown++ > 40) {
    console.log(`  …… 还有 ${grouped.size - 40} 个位置`)
    break
  }
  console.log(`  【${where}】`)
  for (const what of set) console.log(`     - ${what}`)
}
process.exit(1)
