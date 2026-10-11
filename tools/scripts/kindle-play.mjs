/**
 * Kindle 版**玩法**实测（真实 Chromium）：20 款玩法 × 横竖屏，逐款真的玩一遍。
 *
 * 与 kindle-audit.mjs 的分工：audit 量的是**排版**（谁被裁了、谁点不到），
 * 这个脚本量的是**玩法能不能推进**：
 *
 *   1) 连续输入之后局面有没有**推进**（不是"点了不报错"就算数）
 *   2) 撤销：能不能退回上一步
 *   3) 重开：能不能回到本局初始局面（自动步进的玩法跳过这一条 —— 它本来就在动）
 *   4) 全程无未捕获异常、无缺键、无未替换参数
 *
 * 用法：npm run build:kindle && node tools/scripts/serve-kindle.mjs apps/kindle/dist 8791 &
 *      node tools/scripts/kindle-play.mjs
 */
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { mkdirSync } from 'node:fs'

const require = createRequire(new URL('../../.toolchain/pw/', import.meta.url))
const { chromium } = require('playwright')

const BASE = process.env.KINDLE_URL ?? 'http://127.0.0.1:8791/'
const SHOTS = fileURLToPath(new URL('../../.kindle-shots/play/', import.meta.url))
const ORIENTATIONS = [
  { name: '竖屏', width: 760, height: 1024 },
  { name: '横屏', width: 1024, height: 760 },
]
/** 每款玩法在一个方向上的输入次数 */
const INPUTS = 18

mkdirSync(SHOTS, { recursive: true })
const rows = []
const problems = []
const note = (where, what) => problems.push({ where, what })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 760, height: 1024 }, hasTouch: true })
let jsErrors = []
page.on('pageerror', (e) => jsErrors.push(String(e.message)))
page.on('console', (m) => { if (m.type() === 'error') jsErrors.push(m.text()) })

const snap = () =>
  page.evaluate(() => {
    const surface = document.querySelector('.k-board, .k-cards, .k-piles, .k-duel')
    const stats = document.querySelector('.k-stats')
    return (surface ? surface.outerHTML : '') + '||' + (stats ? stats.textContent : '')
  })

const readState = () =>
  page.evaluate(() => {
    const text = document.body.textContent || ''
    return {
      missingKeys: (text.match(/⟦[^⟧]+⟧/g) || []).length,
      unreplaced: (text.match(/\{[a-zA-Z_][a-zA-Z0-9_]*\}/g) || []).length,
      notice: (document.querySelector('.k-notice') || {}).textContent || '',
      error: text.indexOf('screen error') >= 0,
      dialog: !!document.querySelector('.k-dialog__panel'),
    }
  })

/**
 * 做一次"有意义的输入"。
 *
 * 按呈现面类型选目标，**而不是一律点棋盘格子** —— 牌桌与对决面板里根本没有
 * `.k-board__cell`，早先的版本在那里一直点无关的按钮，于是把"我的探针不会玩"
 * 报成了"游戏没推进"。
 *
 * 同时**排除 ↶ / ↻**（撤销 / 重开）：它们是壳层动作，混进随机输入里会让
 * "局面有没有推进"这个判断失真（点完右再点撤销，快照就回到原样了）。
 */
async function interact(index, cellSelectable) {
  return page.evaluate(
    ([i, selectable]) => {
    const isShellAction = (el) => {
      const t = (el.textContent || '').trim()
      return t === '↶' || t === '↻'
    }
    /*
     * 只点**真的可用**的元素。对决面板里两侧各 8 个道具位是常驻的，
     * 空位也有类名（`--empty` / `--locked`），但点了什么都不会发生 ——
     * 渲染器把"能不能点"暴露在 `data-selectable` / `data-stealable` 上，用它们筛。
     */
    const alive = (el) => {
      if (el.hasAttribute('disabled')) return false
      const cls = el.className || ''
      if (cls.indexOf('--locked') >= 0 || cls.indexOf('--empty') >= 0) return false
      if (cls.indexOf('k-duel__item') >= 0) {
        return el.getAttribute('data-selectable') === 'yes' || el.getAttribute('data-stealable') === 'yes'
      }
      return true
    }
    const pick = (list) => list.filter((el) => !isShellAction(el) && alive(el))
    /*
     * 关键：**只有"点格子可操作"的玩法才点格子**。
     * 推箱子 / 2048 也有棋盘，但它们没有 selectAction —— 点格子什么都没发生，
     * 该按方向键。早先在这里点格子，于是把"探针不会玩"报成了"游戏没推进"。
     */
    const boards = selectable ? pick(Array.from(document.querySelectorAll('.k-board__cell'))) : []
    if (boards.length > 0) {
      /*
       * 轮着点**还没点过的**格子。
       *
       * 不要"优先点空格"：数字华容道的空格就是那个点不动的空位（要点的是数字块），
       * 而扫雷/数织的未翻开格又是 `hidden` 而不是 `empty` —— 这条启发式两头都不讨好。
       * 把整块盘点一遍最稳：能动的那些格自然会动。
       */
      const store = window.__kProbeClicked || (window.__kProbeClicked = {})
      const fresh = boards.filter((c, idx) => !store[idx])
      const pool = fresh.length > 0 ? fresh : boards
      if (fresh.length === 0) { for (const k in store) delete store[k] }
      const chosen = pool[i % pool.length]
      const pos = boards.indexOf(chosen)
      store[pos >= 0 ? pos : i] = true
      chosen.click()
      return 'board'
    }
    const cards = pick(Array.from(document.querySelectorAll('.k-card, .k-pile')))
    if (cards.length > 0) {
      cards[i % cards.length].click()
      return 'cards'
    }
    const dpad = pick(Array.from(document.querySelectorAll('.k-dpad button')))
    if (dpad.length > 0) {
      dpad[i % dpad.length].click()
      return 'dpad'
    }
    /*
     * 对决面板：先试着用道具，**道具都用不了时去点控制区的按钮**
     * （恶魔轮盘赌开局是"装填"阶段，得先点「开始」才轮到玩家操作）。
     */
    const items = pick(Array.from(document.querySelectorAll('.k-duel__item')))
    if (items.length > 0) {
      items[i % items.length].click()
      return 'duel'
    }
    const controls = pick(Array.from(document.querySelectorAll('.k-controls button')))
    if (controls.length > 0) {
      controls[i % controls.length].click()
      return 'control'
    }
    return null
    },
    [index, cellSelectable],
  )
}

/** 按**标签**找壳层按钮（↶ 撤销 / ↻ 重开）。按位置找是错的：
 *  DOM 顺序是 ↶、上、↻、左、下、右，"最后一个"其实是"右方向"。 */
async function clickShellAction(label) {
  return page.evaluate((text) => {
    const btn = Array.from(document.querySelectorAll('button')).find(
      (b) => (b.textContent || '').trim() === text && !b.hasAttribute('disabled'),
    )
    if (!btn) return false
    btn.click()
    return true
  }, label)
}

await page.goto(BASE, { waitUntil: 'load' })
await page.waitForTimeout(900)
const gameIds = await page.evaluate(() => window.__moquApp.listGameIds())

for (const o of ORIENTATIONS) {
  await page.setViewportSize({ width: o.width, height: o.height })
  await page.waitForTimeout(200)
  for (const id of gameIds) {
    jsErrors = []
    await page.evaluate((g) => window.__moquApp.navigate('game', { gameId: g, difficulty: 'starter', fresh: true }), id)
    await page.waitForTimeout(450)

    await page.evaluate(() => { window.__kProbeClicked = {} })
    const initial = await snap()
    // 自动步进的玩法（贪吃蛇/俄罗斯方块/对手回合）不动也会自己变
    await page.waitForTimeout(1300)
    const autoTick = (await snap()) !== initial

    const selectable = await page.evaluate((g) => window.__moquApp.isCellSelectable(g), id)
    const hasDpad = (await page.$$('.k-dpad button')).length > 0
    let inputs = 0
    let advanced = autoTick
    for (let i = 0; i < INPUTS; i++) {
      const what = await interact(i, selectable)
      if (what === null) break
      inputs++
      await page.waitForTimeout(110)
      // **逐次比较**：只看首尾的话，"右再撤销"这类会让快照回到原样，
      // 于是把"其实玩得动"误报成"完全没推进"
      if (!advanced && (await snap()) !== initial) advanced = true
    }
    await page.waitForTimeout(350)

    const afterInputs = await snap()
    const state = await readState()

    // 撤销（按标签找 ↶，只有"有东西可撤"且局面确实变过时才算数）
    let undo = 'n/a'
    if (await clickShellAction('↶')) {
      await page.waitForTimeout(280)
      const afterUndo = await snap()
      undo = afterUndo !== afterInputs ? 'ok' : advanced ? 'no-change' : 'nothing-to-undo'
    }

    // 重开（按标签找 ↻）
    let restart = 'n/a'
    if (await clickShellAction('↻')) {
      await page.waitForTimeout(320)
      if (autoTick) restart = 'skipped(auto)'
      else restart = (await snap()) === initial ? 'ok' : 'not-initial'
    }

    const finalState = await readState()
    rows.push({
      where: `${o.name}/${id}`,
      inputs,
      advanced: advanced || autoTick ? 'yes' : 'NO',
      autoTick: autoTick ? 'auto' : '',
      undo,
      restart,
      notice: state.notice ? 'yes' : '',
      keys: finalState.missingKeys + finalState.unreplaced,
    })

    /*
     * 口径必须和下面统计行一致：**输入过却不推进就是问题**（哪怕每次都有提示）。
     * 早先这里多加了 `&& !state.notice`，于是数字华容道"点了 18 次只有提示、从不推进"
     * 被放过了，而统计行又把它算成异常 —— 同一份数据两个结论，等于没有结论。
     */
    if (!advanced && !autoTick && inputs > 0) {
      note(
        `${o.name}/${id}`,
        `${inputs} 次输入之后局面毫无推进${state.notice ? '（只有提示、没有进展）' : '、也没有任何提示'}`,
      )
    }
    if (state.error) note(`${o.name}/${id}`, '进入了错误页（screen error）')
    if (finalState.missingKeys || finalState.unreplaced) note(`${o.name}/${id}`, '有缺键或未替换参数')
    if (undo === 'no-change') note(`${o.name}/${id}`, '局面推进过，但点撤销后没回到上一步')
    if (restart === 'not-initial') note(`${o.name}/${id}`, '点了重开但没回到初始局面')
    if (jsErrors.length) note(`${o.name}/${id}`, `JS 错误: ${jsErrors.slice(0, 2).join(' | ')}`)
    await page.screenshot({ path: `${SHOTS}${o.name}-${id}.png` })
  }
}
await browser.close()

// ---------- 报告 ----------
console.log('\n玩法实测（inputs=输入次数，advanced=局面是否推进）：\n')
console.log('  ' + '位置'.padEnd(22) + 'inputs  advanced  undo        restart      提示')
for (const r of rows) {
  console.log(
    '  ' +
      r.where.padEnd(20) +
      String(r.inputs).padStart(5) +
      '  ' +
      r.advanced.padEnd(9) +
      ' ' +
      r.undo.padEnd(11) +
      ' ' +
      r.restart.padEnd(12) +
      ' ' +
      r.notice,
  )
}
const bad = rows.filter((r) => r.advanced === 'NO' || r.undo === 'no-change' || r.restart === 'not-initial')
console.log(`\n统计：${rows.length} 组（${gameIds.length} 款 × ${ORIENTATIONS.length} 方向），异常 ${bad.length} 组`)
if (problems.length === 0) {
  console.log('\n✅ 玩法实测未发现问题')
  process.exit(0)
}
console.log(`\n❌ 共 ${problems.length} 处问题：`)
for (const p of problems) console.log(`   【${p.where}】${p.what}`)
process.exit(1)
