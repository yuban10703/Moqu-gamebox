/**
 * Kindle 版探索式缺陷探测（真实 Chromium）。
 *
 * 与 kindle-smoke.mjs 的分工：smoke 只验"渲染出来了、没有报错"；
 * 这个脚本**真的去点**——每一款玩法都走一遍
 *   详情页 → 开始 → 点棋盘/控件/方向键 → 开菜单 → 撤销/重开，
 * 每一步都查一组不变量，把"点了没反应""点了报错""界面自相矛盾"撞出来。
 *
 * 不变量（每一步都查）：
 *   1) 没有未捕获的 JS 错误
 *   2) 没有缺键标记 ⟦key⟧
 *   3) 没有没被替换的 {param}
 *   4) 页脚主操作在视口内（墨水屏上跑到屏幕外 = 够不着）
 *   5) 整页不滚动（这个版本刻意不做滚动）
 *   6) 没有空标签的按钮（看不见字的按钮等于没有）
 *
 * 用法：npm run build:kindle && node tools/scripts/serve-kindle.mjs apps/kindle/dist 8791 &
 *      node tools/scripts/kindle-explore.mjs
 */
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(new URL('../../.toolchain/pw/', import.meta.url))
const { chromium } = require('playwright')

const BASE = process.env.KINDLE_URL ?? 'http://127.0.0.1:8791/'
const SHOTS = fileURLToPath(new URL('../../.kindle-shots/explore/', import.meta.url))
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null

const problems = []
const note = (where, what) => problems.push({ where, what })

mkdirSync(SHOTS, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 760, height: 1024 } })
const jsErrors = []
page.on('pageerror', (e) => jsErrors.push(String(e.message)))
page.on('console', (m) => {
  if (m.type() === 'error') jsErrors.push(m.text())
})

/** 每一步都查的那组不变量 */
async function invariants(where) {
  const state = await page.evaluate(() => {
    const text = document.body.textContent || ''
    const footer = document.querySelector('.k-footer')
    const buttons = Array.from(document.querySelectorAll('button'))
    return {
      missingKeys: (text.match(/⟦[^⟧]+⟧/g) || []).slice(0, 4),
      unreplaced: Array.from(new Set(text.match(/\{[a-zA-Z_][a-zA-Z0-9_]*\}/g) || [])).slice(0, 4),
      footerBottom: footer ? Math.round(footer.getBoundingClientRect().bottom) : null,
      viewportH: window.innerHeight,
      scrollOverflow: document.documentElement.scrollHeight > window.innerHeight + 4,
      emptyButtons: buttons.filter((b) => !(b.textContent || '').trim() && !b.getAttribute('aria-label')).length,
      buttonCount: buttons.length,
    }
  })
  if (state.missingKeys.length) note(where, `缺键 ⟦…⟧: ${state.missingKeys.join(', ')}`)
  if (state.unreplaced.length) note(where, `未替换参数: ${state.unreplaced.join(', ')}`)
  if (state.footerBottom !== null && state.footerBottom > state.viewportH + 2) {
    note(where, `页脚超出视口（bottom=${state.footerBottom} > ${state.viewportH}）`)
  }
  if (state.scrollOverflow) note(where, '页面出现滚动（本版本应为不滚动）')
  if (state.emptyButtons > 0) note(where, `有 ${state.emptyButtons} 个无文字/无 aria-label 的按钮`)
  const errors = jsErrors.splice(0)
  if (errors.length) note(where, `JS 错误: ${errors.slice(0, 2).join(' | ')}`)
  return state
}

/**
 * 取一份"界面快照"：棋盘 + 统计 + 提示。
 * 用来判断一次操作**到底有没有反应** —— 这是"点了没反应"这类缺陷唯一可靠的判据：
 * 被规则拒绝但给了文字提示 = 正常；棋盘和提示都纹丝不动 = 缺陷。
 */
async function snapshot() {
  return page.evaluate(() => {
    const board = document.querySelector('.k-board, .k-cards, .k-duel')
    const stats = document.querySelector('.k-stats')
    const notice = document.querySelector('.k-notice')
    return [
      // 用 outerHTML 而不是 textContent：**"选中"这类反馈只改样式与 data 属性、不改文字**，
      // 用文字做快照会把"点了有反应"误判成"没反应"（第一版就踩了这个坑）。
      board ? board.outerHTML : '',
      stats ? stats.outerHTML : '',
      notice ? notice.textContent : '',
    ].join('|')
  })
}

/** 点一个元素；返回是否点到了 */
async function tap(selector, index = 0) {
  const handles = await page.$$(selector)
  if (handles.length <= index) return false
  try {
    await handles[index].click({ timeout: 3000 })
    await page.waitForTimeout(120)
    return true
  } catch {
    return false
  }
}

await page.goto(BASE, { waitUntil: 'load' })
await page.waitForTimeout(900)

const games = await page.evaluate(() =>
  (window.__moquApp ? window.__moquApp.status() : { games: 0 }).games,
)
const ids = await page.evaluate(() => {
  // 通过诊断页的自检拿到全部玩法 id（这是壳层里最省事的枚举入口）
  const app = window.__moquApp
  if (!app) return []
  return app.listGameIds ? app.listGameIds() : []
})
console.log(`玩法数量: ${games}，枚举到 id: ${ids.length}`)

const targets = ONLY ?? ids
for (const id of targets) {
  const where = id
  // ---- 详情页 ----
  await page.evaluate((g) => window.__moquApp.navigate('detail', { gameId: g }), id)
  await page.waitForTimeout(250)
  await invariants(`${where}/详情`)

  // ---- 进入对局 ----
  const started = await page.evaluate((g) => {
    window.__moquApp.navigate('game', { gameId: g, difficulty: 'starter', fresh: true })
    return true
  }, id)
  if (!started) { note(where, '无法进入对局'); continue }
  await page.waitForTimeout(500)
  const before = await invariants(`${where}/开局`)

  // ---- 点棋盘：跨步采样覆盖整块盘（只点前几格会漏掉"合法着法在后面"的玩法）----
  // 只有**本来就支持点棋盘**的玩法才要求有反应：推箱子/2048/贪吃蛇/俄罗斯方块
  // 是方向键驱动，点棋盘没反应是设计如此。
  const selectable = await page.evaluate((g) => window.__moquApp.isCellSelectable(g), id)
  const cellCount = selectable ? (await page.$$('.k-board__cell')).length : 0
  if (cellCount > 0) {
    const before = await snapshot()
    let reacted = false
    const sample = Math.min(cellCount, 40)
    const stride = Math.max(1, Math.floor(cellCount / sample))
    for (let i = 0; i < cellCount && i / stride < sample; i += stride) {
      await tap('.k-board__cell', i)
      if ((await snapshot()) !== before) { reacted = true; break }
    }
    const after = await snapshot()
    // 允许"改了又改回来"（例如翻牌翻回原样），所以 reacted 与快照不等二者取或
    if (!reacted && after === before) {
      const notice = await page.evaluate(() => {
        const n = document.querySelector('.k-notice')
        return n ? n.textContent : ''
      })
      if (!notice) {
        note(where, `点了 ${sample} 格棋盘，界面毫无反应、也没有任何文字提示（既没变化也没说明）`)
      }
    }
  }
  await invariants(`${where}/点棋盘`)

  // ---- 点普通控件（跳过结果面板里的）----
  const controls = await page.$$('.k-controls button')
  for (let i = 0; i < controls.length; i++) {
    await tap('.k-controls button', i)
    await invariants(`${where}/控件#${i}`)
  }

  // ---- 方向键：同样要求"点了要有反应"（移动 / 转向 / 至少一句提示）----
  const dpad = await page.$$('.k-dpad button')
  if (dpad.length > 0) {
    const before = await snapshot()
    for (let i = 0; i < dpad.length; i++) {
      await tap('.k-dpad button', i)
      if ((await snapshot()) !== before) break
    }
    if ((await snapshot()) === before) {
      const notice = await page.evaluate(() => {
        const n = document.querySelector('.k-notice')
        return n ? n.textContent : ''
      })
      if (!notice) note(where, `点了 ${dpad.length} 个方向键，界面毫无反应、也没有任何文字提示`)
    }
  }
  await invariants(`${where}/方向键`)

  // ---- 撤销 / 重开：这两个入口在壳层里被重新接线过，必须真的生效 ----
  {
    const afterMoves = await snapshot()
    const undoBtn = await page.$$('.k-dpad button')
    // 倒 T 的左上角是「撤销」、右上角是「重开」（controls.ts 把两者放进同一张表）
    const labels = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.k-dpad button, .k-controls button')).map((b) =>
        (b.textContent || '').trim(),
      ),
    )
    if (labels.join('').indexOf('↶') >= 0) {
      await tap('.k-dpad button', 0) // 左上角 = 撤销
      const afterUndo = await snapshot()
      if (afterUndo === afterMoves) {
        // 撤销不可用（没有可撤销的动作）时不算缺陷，只有"有得撤却没反应"才算
        const disabled = await page.evaluate(() => {
          const b = document.querySelector('.k-dpad button')
          return !b || b.hasAttribute('disabled') || b.getAttribute('aria-disabled') === 'true'
        })
        if (!disabled) note(where, '点了「撤销」，界面毫无变化（也没有提示）')
      }
    }
    void undoBtn
  }

  // ---- 暂停菜单 ----
  const menuOpened = await tap('.k-topbar button:last-of-type')
  if (menuOpened) {
    await page.waitForTimeout(200)
    const dialog = await page.$('.k-dialog__panel')
    if (!dialog) {
      note(where, '点了「菜单」但没弹出对话框')
    } else {
      await invariants(`${where}/暂停菜单`)
      const dialogText = await page.evaluate(() => (document.querySelector('.k-dialog__panel') || {}).textContent || '')
      if (!dialogText.trim()) note(where, '暂停菜单是空的')
      // 关闭：点第一个按钮（继续）
      await tap('.k-dialog__panel button', 0)
      await page.waitForTimeout(200)
      const stillOpen = await page.$('.k-dialog__panel')
      if (stillOpen) note(where, '暂停菜单点了「继续」之后没关掉')
      await invariants(`${where}/关菜单`)
    }
  } else {
    note(where, '顶栏找不到「菜单」按钮')
  }

  await page.screenshot({ path: `${SHOTS}${id}.png` })
}

// ---------- 第二轮：触摸滑动（界面承诺了就必须真的能用）----------
/*
 * 详情页会对"方向键驱动"的玩法显示「…用滑动操作」。提示写了却不能用，
 * 比没有提示更糟 —— 用户会一直滑，然后认为设备卡了。
 * 判据与壳层一致：有方向键、且没有 selectAction 的玩法才该接管滑动；
 * 点格子的玩法**绝不能**接管（墨水屏触摸抖动会把轻点吃成滑动）。
 */
{
  const swipeSnap = () =>
    page.evaluate(() => {
      const b = document.querySelector('.k-board')
      return b ? b.outerHTML : ''
    })
  const ids = await page.evaluate(() => window.__moquApp.listGameIds())
  for (const id of ids) {
    const caps = await page.evaluate(
      (g) => ({ selectable: window.__moquApp.isCellSelectable(g) }),
      id,
    )
    await page.evaluate(
      (g) => window.__moquApp.navigate('game', { gameId: g, difficulty: 'starter', fresh: true }),
      id,
    )
    await page.waitForTimeout(400)
    const box = await (await page.$('.k-board'))?.boundingBox()
    const hasDpad = (await page.$$('.k-dpad button')).length > 0
    if (!box) continue
    const shouldSwipe = !caps.selectable && hasDpad
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2
    const before = await swipeSnap()
    await page.evaluate(
      ([sx, sy, ex, ey]) => {
        const el = document.querySelector('.k-board')
        const mk = (type, x, y) => {
          const t = new Touch({ identifier: 1, target: el, clientX: x, clientY: y })
          return new TouchEvent(type, {
            touches: type === 'touchend' ? [] : [t],
            targetTouches: type === 'touchend' ? [] : [t],
            changedTouches: [t],
            bubbles: true,
            cancelable: true,
          })
        }
        el.dispatchEvent(mk('touchstart', sx, sy))
        el.dispatchEvent(mk('touchmove', (sx + ex) / 2, (sy + ey) / 2))
        el.dispatchEvent(mk('touchend', ex, ey))
      },
      [cx, cy, cx - 120, cy],
    )
    await page.waitForTimeout(350)
    const changed = (await swipeSnap()) !== before
    if (shouldSwipe && !changed) {
      note(`${id}/滑动`, '详情页承诺可以滑动，但滑了棋盘毫无变化')
    }
    if (!shouldSwipe && changed && !caps.selectable) {
      note(`${id}/滑动`, '不支持滑动的玩法却对滑动有反应（可能误触）')
    }
  }
}

// ---------- 第三轮：视口矩阵（横竖屏 / 小屏）下的裁切 ----------
/*
 * 这个版本**刻意不做滚动**（.k-main 是 overflow:hidden）——好处是不会出现
 * "滑半天滑不到"，代价是**内容放不下就被静静裁掉**：棋盘矮一截、按钮看不见，
 * 而页面上不会有任何报错。所以"有没有被裁"必须每次换视口都实测。
 */
const VIEWPORTS = [
  { name: '竖屏 760×1024', width: 760, height: 1024 },
  { name: '横屏 1024×760', width: 1024, height: 760 },
  { name: '小屏 600×800', width: 600, height: 800 },
  { name: '极矮横屏 900×520', width: 900, height: 520 },
]
const SAMPLE = ['sudoku', 'doudizhu', 'buckshot', 'sokoban']
for (const vp of VIEWPORTS) {
  await page.setViewportSize({ width: vp.width, height: vp.height })
  await page.waitForTimeout(200)
  for (const id of SAMPLE) {
    await page.evaluate(
      (g) => window.__moquApp.navigate('game', { gameId: g, difficulty: 'starter', fresh: true }),
      id,
    )
    await page.waitForTimeout(400)
    const geom = await page.evaluate(() => {
      const main = document.querySelector('.k-main')
      const surface = document.querySelector('.k-board, .k-cards, .k-duel')
      const footer = document.querySelector('.k-footer')
      const r = (el) => (el ? el.getBoundingClientRect() : null)
      const m = r(main)
      const s = r(surface)
      const f = r(footer)
      const mainEl = document.querySelector('.k-main')
      const mainScrollable =
        !!mainEl &&
        mainEl.scrollHeight > mainEl.clientHeight + 2 &&
        window.getComputedStyle(mainEl).overflowY === 'auto'
      return {
        mainScrollable: mainScrollable,
        main: m && { top: Math.round(m.top), bottom: Math.round(m.bottom), h: Math.round(m.height) },
        surface: s && { top: Math.round(s.top), bottom: Math.round(s.bottom), h: Math.round(s.height), w: Math.round(s.width) },
        footer: f && { top: Math.round(f.top), bottom: Math.round(f.bottom) },
        vh: window.innerHeight,
        vw: window.innerWidth,
        scrollX: document.documentElement.scrollWidth > window.innerWidth + 4,
      }
    })
    const where = `${vp.name}/${id}`
    if (!geom.surface || geom.surface.h < 20) {
      note(where, `呈现区高度只剩 ${geom.surface ? geom.surface.h : 0}px（基本不可玩）`)
    }
    /*
     * 被 .k-main 裁掉 = 玩家看不到 / 点不到。
     * 例外：**极矮屏幕上壳层会主动开滚动保底**（放不下时宁可滚一下，也不让按钮够不着），
     * 那种情况下内容仍可达，不算缺陷 —— 但要看它是不是真的滚得动。
     */
    if (geom.main && geom.surface && geom.surface.bottom > geom.main.bottom + 2 && !geom.mainScrollable) {
      note(where, `呈现区被裁且无法滚动：bottom=${geom.surface.bottom} 超出 .k-main 底边 ${geom.main.bottom}`)
    }
    if (geom.surface && geom.surface.w > geom.vw + 2) {
      note(where, `呈现区超宽：${geom.surface.w} > 视口 ${geom.vw}`)
    }
    if (geom.footer && geom.footer.bottom > geom.vh + 2) {
      note(where, `页脚超出视口：${geom.footer.bottom} > ${geom.vh}`)
    }
    if (geom.scrollX) note(where, '出现横向滚动')
    await invariants(where)
  }
}
await page.setViewportSize({ width: 760, height: 1024 })

// ---------- 第四轮：把一局真的打到结束（结果面板 + 战绩落盘）----------
/*
 * 前面所有检查都只走到"点几下"为止，**终局这条路径一次都没跑过**：
 * onFinished → 记录战绩 → 弹结果面板。
 * 井字棋 3×3、对手会应手，是最快能走到终局的一款。
 */
{
  await page.evaluate(() =>
    window.__moquApp.navigate('game', { gameId: 'tictactoe', difficulty: 'starter', fresh: true }),
  )
  await page.waitForTimeout(500)
  let finished = false
  for (let i = 0; i < 12 && !finished; i++) {
    // 点**空格**：固定点第 i 格会一直点在已被对手占掉的格子上，
    // 那样永远走不到终局，还会把"探针写错了"误报成"游戏走不完"。
    const clicked = await page.evaluate(() => {
      const empty = Array.from(document.querySelectorAll('.k-board__cell')).find(
        (c) => c.getAttribute('data-kind') === 'empty',
      )
      if (!empty) return false
      empty.click()
      return true
    })
    if (!clicked) break
    await page.waitForTimeout(1100)
    finished = (await page.$('.k-dialog__panel')) !== null
  }
  if (finished) {
    await invariants('tictactoe/结果面板')
    const dialog = await page.evaluate(
      () => (document.querySelector('.k-dialog__panel') || {}).textContent || '',
    )
    if (!dialog.trim()) note('tictactoe/结果面板', '结果面板是空的')
    const saves = await page.evaluate(() => {
      const out = []
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i)
        if (k && k.indexOf('moqu:1:progress') === 0) out.push(window.localStorage.getItem(k) || '')
      }
      return out.join('')
    })
    if (saves.indexOf('tictactoe') < 0) {
      note('tictactoe/结果面板', '对局结束了但战绩没落盘（progress 里没有 tictactoe）')
    }
    await page.screenshot({ path: `${SHOTS}result-tictactoe.png` })
  } else {
    // 走不到终局本身不一定是缺陷（可能点不到合法格），但值得记一笔
    note('tictactoe/终局', '点了 14 次仍未走到终局（结果面板没出现）')
  }
}

await browser.close()

// ---------- 汇总 ----------
if (problems.length === 0) {
  console.log('\n✅ 未发现问题')
  process.exit(0)
}
const grouped = new Map()
for (const p of problems) {
  if (!grouped.has(p.where)) grouped.set(p.where, [])
  grouped.get(p.where).push(p.what)
}
console.log(`\n❌ 共 ${problems.length} 处问题，分布在 ${grouped.size} 个位置：\n`)
for (const [where, list] of grouped) {
  console.log(`  【${where}】`)
  for (const what of Array.from(new Set(list))) console.log(`     - ${what}`)
}
process.exit(1)
