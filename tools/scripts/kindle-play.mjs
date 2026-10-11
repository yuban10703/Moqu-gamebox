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
    // .k-dpad__btn 恰好就是方向键本身；角落的 ↶ / ↻ 是 .k-btn（借用倒 T 上排两侧的空格）
    const dpad = pick(Array.from(document.querySelectorAll('.k-dpad__btn')))
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
    // 同样只取玩法自己的动作按钮：.k-controls 整条里还含着方向键与 ↶/↻
    const controls = pick(Array.from(document.querySelectorAll('.k-controls__actions button')))
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

    /*
     * 重开。两条要点：
     *   1. 现在会先弹确认框（正文是玩法自己的 `<ns>.rules.restart`），得点掉它；
     *   2. **无关卡玩法重开就该换一局** —— 扫雷换雷图、记忆重洗、数织换题。
     *      所以"回到初始局面"只对关卡制成立，无关卡玩法反过来要断言"变了"。
     */
    let restart = 'n/a'
    if (await clickShellAction('↻')) {
      await page.waitForTimeout(250)
      const confirmed = await page.evaluate(() => {
        const panel = document.querySelector('.k-dialog__panel')
        const btn = panel && Array.from(panel.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === '重新开始')
        if (!btn) return false
        btn.click()
        return true
      })
      await page.waitForTimeout(400)
      if (!confirmed) restart = 'no-confirm'
      else if (autoTick) restart = 'skipped(auto)'
      else {
        const hasLevels = /\d+\s*\/\s*\d+\s*关/.test(
          await page.evaluate(() => (document.querySelector('.k-topbar__title') || {}).textContent || ''),
        )
        const same = (await snap()) === initial
        restart = hasLevels ? (same ? 'ok(本关)' : 'not-initial') : same ? 'not-new-game' : 'ok(新一局)'
      }
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
    if (restart === 'not-initial') note(`${o.name}/${id}`, '关卡制玩法点了重开但没回到本关初始局面')
    if (restart === 'not-new-game') note(`${o.name}/${id}`, '无关卡玩法点了重开却还是同一局')
    if (restart === 'no-confirm') note(`${o.name}/${id}`, '点了 ↻ 但没有出现确认框')
    if (jsErrors.length) note(`${o.name}/${id}`, `JS 错误: ${jsErrors.slice(0, 2).join(' | ')}`)
    await page.screenshot({ path: `${SHOTS}${o.name}-${id}.png` })
  }
}
// ---------- 终局路径：横竖屏各打一局到结束 ----------
/*
 * 前面 40 组只验到"能推进"，**终局那条路一次都没走**：
 * onFinished → 记录战绩 → 弹结果面板 → 写进 localStorage。
 * 井字棋 3×3、对手会应手，是最快能走到终局的一款，两个方向各打一局。
 */
const endgame = []
for (const o of ORIENTATIONS) {
  await page.setViewportSize({ width: o.width, height: o.height })
  await page.evaluate(() => window.__moquApp.navigate('game', { gameId: 'tictactoe', difficulty: 'starter', fresh: true }))
  await page.waitForTimeout(500)
  let finished = false
  for (let i = 0; i < 12 && !finished; i++) {
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
  const dialogText = await page.evaluate(
    () => ((document.querySelector('.k-dialog__panel') || {}).textContent || '').trim(),
  )
  const saved = await page.evaluate(() => {
    // 战绩里 gameId 记在 history 里、completed 里只记内容 id ——
    // 所以判"有没有落盘"要看整段 JSON，而不是找 gameId 出现在 completed 里
    return window.localStorage.getItem('moqu:1:progress') || ''
  })
  if (process.env.DEBUG_PROGRESS) {
    console.log(`  [debug] ${o.name} 对话框=「${dialogText.replace(/\s+/g, ' ').slice(0, 80)}」`)
    console.log(`  [debug] ${o.name} 统计=${await page.evaluate(() => ((document.querySelector('.k-stats') || {}).textContent || '').slice(0, 60))}`)
  }
  endgame.push({ where: `${o.name}/井字棋终局`, finished, dialogLen: dialogText.length, saved: saved.indexOf('tictactoe') >= 0 })
  if (!finished) note(`${o.name}/井字棋终局`, '走到没有空格也没出结果面板')
  if (finished && dialogText.length === 0) note(`${o.name}/井字棋终局`, '结果面板是空的')
  if (!saved.includes('tictactoe')) note(`${o.name}/井字棋终局`, '对局结束了但战绩没落盘')
  await page.screenshot({ path: `${SHOTS}${o.name}-result.png` })
}

// ---------- 种子：开新局换一局，重开也要换 ----------
/*
 * 这一轮的真实缺陷来源：会话里四处都写死 `game.create(0, difficulty)`，
 * 于是扫雷雷区、记忆洗牌、2048 出块、斗地主牌、轮盘赌装填**每局完全一样**；
 * 而 core 的 mulberry32 里 `state = (seed >>> 0) || 0x9e3779b9` 让"种子 0"
 * 落到固定常量上 —— 那是"唯一那一局"，不是"某一局"。
 */
const seedPhase = []
{
  const readSave = (id) =>
    page.evaluate((g) => {
      const raw = window.localStorage.getItem('moqu:1:save:' + g)
      return raw ? JSON.parse(raw) : null
    }, id)
  const clickDialog = (label) =>
    page.evaluate((t) => {
      const panel = document.querySelector('.k-dialog__panel')
      const btn = panel && Array.from(panel.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === t)
      if (!btn) return false
      btn.click()
      return true
    }, label)

  await page.setViewportSize({ width: ORIENTATIONS[0].width, height: ORIENTATIONS[0].height })
  // 开三次新局：种子与局面都必须各不相同
  const seeds = []
  const states = []
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => window.__moquApp.navigate('game', { gameId: 'minesweeper', difficulty: 'starter', fresh: true }))
    await page.waitForTimeout(400)
    await page.evaluate(() => document.querySelector('.k-board__cell').click())
    await page.waitForTimeout(400)
    const env = await readSave('minesweeper')
    seeds.push(env && env.seed)
    states.push(env && JSON.stringify(env.state))
  }
  seedPhase.push({ where: '开三次新局', ok: new Set(seeds).size === 3 && new Set(states).size === 3, detail: `种子 ${seeds.join(',')}` })
  if (new Set(seeds).size !== 3 || new Set(states).size !== 3) {
    note('种子/开新局', `三次新局的种子或局面重复：${seeds.join(',')}`)
  }

  // 重开：无关卡玩法必须换一局
  const before = await readSave('minesweeper')
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find((x) => (x.textContent || '').trim() === '菜单')
    if (b) b.click()
  })
  await page.waitForTimeout(250)
  await clickDialog('重新开始')
  await page.waitForTimeout(250)
  await clickDialog('重新开始')
  await page.waitForTimeout(500)
  const after = await readSave('minesweeper')
  const changed = !!(before && after && before.seed !== after.seed)
  seedPhase.push({ where: '扫雷重开', ok: changed, detail: changed ? '换了新一局' : `仍是 ${before && before.seed}` })
  if (!changed) note('种子/重开', '无关卡玩法点了重开却还是同一局')

  // 重开：有关卡玩法必须仍在本关
  await page.evaluate(() => window.__moquApp.navigate('game', { gameId: 'sokoban', difficulty: 'starter', fresh: true }))
  await page.waitForTimeout(450)
  const levelBefore = await page.evaluate(() => ({
    title: (document.querySelector('.k-topbar__title') || {}).textContent || '',
    board: (document.querySelector('.k-board') || {}).outerHTML || '',
  }))
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find((x) => (x.textContent || '').trim() === '菜单')
    if (b) b.click()
  })
  await page.waitForTimeout(250)
  await clickDialog('重新开始')
  await page.waitForTimeout(250)
  await clickDialog('重新开始')
  await page.waitForTimeout(500)
  const levelAfter = await page.evaluate(() => ({
    title: (document.querySelector('.k-topbar__title') || {}).textContent || '',
    board: (document.querySelector('.k-board') || {}).outerHTML || '',
  }))
  const stayed = levelBefore.title === levelAfter.title && levelBefore.board === levelAfter.board
  seedPhase.push({ where: '推箱子重开', ok: stayed, detail: stayed ? '仍在本关初始局面' : '换了关或换了局面' })
  if (!stayed) note('种子/重开', '有关卡玩法点了重开却没回到本关初始局面')
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
console.log('\n种子（每局必须是不一样的局）：\n')
for (const s of seedPhase) console.log(`  ${s.where.padEnd(14)} ${s.ok ? '✅' : '❌'}  ${s.detail}`)

console.log('\n终局路径（打到结束 → 结果面板 → 战绩落盘）：\n')
for (const e of endgame) {
  console.log(`  ${e.where.padEnd(22)} 结束=${e.finished ? '是' : '否'}  结果面板=${e.dialogLen}字  战绩落盘=${e.saved ? '是' : '否'}`)
}
const bad = rows.filter(
  (r) =>
    r.advanced === 'NO' ||
    r.undo === 'no-change' ||
    r.restart === 'not-initial' ||
    r.restart === 'not-new-game' ||
    r.restart === 'no-confirm',
)
console.log(`\n统计：${rows.length} 组（${gameIds.length} 款 × ${ORIENTATIONS.length} 方向），异常 ${bad.length} 组`)
if (problems.length === 0) {
  console.log('\n✅ 玩法实测未发现问题')
  process.exit(0)
}
console.log(`\n❌ 共 ${problems.length} 处问题：`)
for (const p of problems) console.log(`   【${p.where}】${p.what}`)
process.exit(1)
