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
 * * 用法：npm run build:web && npm run serve:web & 然后 npm run explore
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

const PAGE_URL = process.env.WEB_URL ?? 'http://127.0.0.1:8790/'
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
  await page.waitForSelector('text=墨趣', { timeout: 15000 })
}
/**
 * 点击「最上层浮层」里的按钮。
 * 注意：顶栏的「暂停」在暂停后会变成「继续」，与浮层里的「继续游戏」同名 ——
 * 不限定作用域就会命中浮层后面那个（被遮挡，点击会被拦截）。
 */
const clickOverlay = async (text) => {
  // 两种容器：暂停菜单为 .eink-pausebar（原地替换控制区，不再是整屏浮层），确认框为 .eink-dialog
  const overlay = page.locator('.eink-pausebar, .eink-dialog').last()
  const btn = overlay.getByRole('button', { name: new RegExp(text) }).first()
  if (!(await btn.count())) {
    throw new Error(`浮层里找不到「${text}」：${(await overlay.innerText()).replace(/\n+/g, ' ').slice(0, 90)}`)
  }
  await btn.click()
  await page.waitForTimeout(250)
}

/** 点击失败必须立刻报错：静默跳过会让后续步骤在错误的页面上继续，掩盖真实缺陷 */
/*
 * 点首页里的**游戏方块**：必须限定在 .eink-tile 内。
 * 「继续上一局」细栏的可访问名里也含游戏名（对无障碍是有意的），
 * 不限定就会先命中继续栏、直接进游戏而不是进说明页。
 */
const clickTile = async (text) => {
  /*
   * 首页现在是**翻页**而不是滚动（每页 6 款）：目标不在当前页时自动往后翻。
   * 另外「继续上一局」细栏的可访问名里也含游戏名（对无障碍是有意的），
   * 所以一律限定在 .eink-tile 内找，避免误点继续栏。
   */
  for (let hop = 0; hop < 6; hop++) {
    const tile = page.locator('.eink-tile', { hasText: text }).first()
    if ((await tile.count()) > 0) { await tile.click(); await page.waitForTimeout(250); return true }
    const next = page.locator('button[data-page="next"]:not([disabled])').first()
    if (!(await next.count())) break
    await next.click()
    await page.waitForTimeout(250)
  }
  return false
}

const clickText = async (text, { optional = false } = {}) => {
  /*
   * 先看首页有没有同名的**游戏方块**并点它。
   * 原因：「继续上一局」细栏的可访问名里也含游戏名（对无障碍是有意的），
   * 直接用 getByRole(name) 会在有存档时先命中继续栏 —— 于是"点游戏进说明页"
   * 变成了"直接继续游戏"，套件在多个步骤里都会卡住。
   */
  const tile = page.locator('.eink-tile', { hasText: text }).first()
  if ((await tile.count()) > 0) {
    await tile.click()
    await page.waitForTimeout(250)
    return true
  }
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
  // 点方块而不是按名字点：首页的「继续」细栏名字里也含游戏名，按名字会先命中它
  if (!(await clickTile(title))) await clickText(title)
  await page.waitForSelector('text=玩法说明', { timeout: 8000 })
  await clickText('继续', { optional: true })
  // 「继续」是异步读存档（IndexedDB），必须等棋盘真的挂载出来再决定是否新开一局，
  // 否则会误判成「没有存档」而点掉「开始新游戏」，把已有进度替换掉（测试里踩过）
  await page.waitForSelector('.eink-board', { timeout: 4000 }).catch(() => {})
  if (!(await page.locator('.eink-board').count())) await clickText('开始新游戏')
  await page.waitForTimeout(300)
  if (await page.getByRole('button', { name: /替换并开始/ }).count()) await clickText('替换并开始')
  await page.waitForSelector('.eink-board', { timeout: 8000 })
}

// 每次运行从干净状态开始：本套件会故意损坏存档来验证恢复入口，
// 若不清空，下一次运行会读到上一次留下的坏档（曾因此误判成「进度丢失」）
await page.goto(PAGE_URL, { waitUntil: 'networkidle' })
await page.waitForSelector('text=墨趣', { timeout: 15000 })
await page.evaluate(async () => { await window.__einkPlatform.storage.clearAll() })
await page.reload({ waitUntil: 'networkidle' })
await page.waitForSelector('text=墨趣', { timeout: 15000 })

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
await invariants(page, '暂停菜单')
await clickOverlay('继续')
await clickText('重新开始')
await page.waitForTimeout(300)
await invariants(page, '重开确认弹窗')
await clickOverlay('取消')
await page.waitForTimeout(300)

/* ---------- 3) 退出后从首页继续 ---------- */
console.log('\n[3] 退出 → 首页继续')
// 「返回游戏库」在暂停菜单里（暂停时控制区原地换成：继续/重新开始/[方向键开关]/返回游戏库）
await clickText('暂停')
await clickOverlay('返回游戏库')
await page.waitForTimeout(800)
await invariants(page, '首页')
const hasContinue = await page.locator('.eink-continue').count()
check('首页出现「继续上一局」', hasContinue > 0)
await clickText('继续')
await page.waitForTimeout(800)
const resumed = await page.locator('.eink-board__cell').count()
check('能恢复回到游戏页', resumed > 0, `${resumed} 格`)

console.log('\n[3b] 暂停面板（菜单已移除：暂停与菜单功能重复，菜单整块删掉）')
await gotoLibrary()
await startGame('数独')
await clickText('暂停')
await page.waitForTimeout(300)
check('暂停菜单可打开（原地替换控制区）', (await page.locator('.eink-pausebar').count()) > 0)
check('对局页不再有「菜单」按钮', (await page.locator('button', { hasText: '菜单' }).count()) === 0)
await invariants(page, '暂停面板')
await clickOverlay('继续')

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
// 卡片上的进度行已按用户要求删除；进度信息改由「继续上一局」细栏承载（关卡 N）
check('首页不再显示卡片进度，进度改由继续栏体现', !/进度\s*\d+\/\d+/.test(progressText) && /继续上一局/.test(progressText), progressText.slice(0, 80))

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
// 刷新档位整节（含系统「应用优化/刷新模式」指引）已从设置页删除，这里守住它不再回来
const settingsText = await page.evaluate(() => document.body.innerText.replace(/\n+/g, ' '))
check('设置页不再展示刷新档位与系统刷新指引', !/刷新/.test(settingsText), settingsText.slice(0, 60))
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

// 字号档位会放大卡片高度：必须按**最大档位**验证首页，否则默认档看不出问题
await clickText('特大')
await clickText('返回')
await page.waitForTimeout(800)
const maxScale = await page.evaluate(() => {
  // 游戏数量增加后，「一屏全塞下」不再是合理目标（继续压小卡片会牺牲可读性）。
  // 这一档要求的是：**内容可滚动、页脚固定、没有不可达的按钮**。
  const reachable = (el) => {
    let n = el.parentElement
    while (n) {
      const cs = getComputedStyle(n)
      if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && n.scrollHeight > n.clientHeight + 1) return true
      n = n.parentElement
    }
    return false
  }
  const content = document.querySelector('.eink-screen__content')
  return {
    root: getComputedStyle(document.documentElement).fontSize,
    游戏数: document.querySelectorAll('.eink-tile').length,
    不可达: [...document.querySelectorAll('button')]
      .filter((b) => b.getBoundingClientRect().bottom > innerHeight + 1 && !reachable(b)).length,
    可滚动: content ? content.scrollHeight > content.clientHeight + 1 : false,
    页脚在屏内: (() => { const f = document.querySelector('.eink-footer'); return f ? f.getBoundingClientRect().bottom <= innerHeight + 1 : true })(),
  }
})
check('最大字号档位下首页无不可达按钮且页脚固定',
  maxScale.不可达 === 0 && maxScale.页脚在屏内,
  `根字号 ${maxScale.root}、${maxScale.游戏数} 款、不可达 ${maxScale.不可达}、可滚动 ${maxScale.可滚动}`)
await invariants(page, '首页·最大字号')

/*
 * [6a] 首页左右滑动翻页（用户要求）。
 *
 * 为什么单独开一个 `hasTouch` 上下文：`touch-action: pan-y` **只对触摸输入生效**，
 * 用 page.mouse 拖动走的是另一条路径（浏览器不会因 pan-y 取消手势），等于没测；
 * 而在主上下文上打开 hasTouch 会改变 `pointer: coarse` 之类的媒体查询，
 * 可能影响本套件其它布局断言 —— 所以隔离成一次性上下文，测完就关。
 */
console.log('\n[6a] 首页左右滑动翻页（真实触摸）')
{
  /*
   * 用**横屏 879×407**：竖屏 439×847 上 12 款一页就放得下（三档字号都是 1 页），
   * 没有分页可翻 —— 分页正是横屏/极矮屏才会出现的东西，滑动翻页也是为它加的。
   */
  const touchCtx = await browser.newContext({
    viewport: { width: 879, height: 407 },
    locale: 'zh-CN',
    hasTouch: true,
  })
  const touchPage = await touchCtx.newPage()
  touchPage.on('pageerror', (e) => errors.push('touch: ' + String(e).slice(0, 160)))
  await touchPage.goto(PAGE_URL, { waitUntil: 'networkidle' })
  await touchPage.waitForSelector('text=墨趣', { timeout: 15000 })
  await touchPage.waitForTimeout(600)

  const cdp = await touchCtx.newCDPSession(touchPage)
  /**
   * 真实触摸滑动：分 6 步移动，模拟手指而不是瞬移。
   * `where` 选起手区域：卡片上起手时，**小于阈值的位移会（正确地）当成点击卡片**，
   * 所以「小位移不翻页」那条要在非交互区（标题栏）上测。
   */
  const swipeTouch = async (dx, dy = 0, where = 'grid') => {
    const box = await touchPage.evaluate((w) => {
      const sel = w === 'header' ? '.eink-screen__header' : '.eink-screen--library'
      const r = document.querySelector(sel).getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    }, where)
    const x0 = box.x - dx / 2
    const y0 = box.y - dy / 2
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] })
    for (let i = 1; i <= 6; i++) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: x0 + (dx * i) / 6, y: y0 + (dy * i) / 6 }],
      })
      await touchPage.waitForTimeout(16)
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await touchPage.waitForTimeout(350)
  }
  const pagerInfo = () =>
    touchPage.evaluate(() => document.querySelector('.eink-pager__info')?.textContent?.trim() ?? '（无分页）')
  const firstTiles = () =>
    touchPage.evaluate(() => [...document.querySelectorAll('.eink-tile__title')].map((e) => e.textContent.trim()))

  const first = await pagerInfo()
  check('横屏首页有多页（滑动的前提）', /1\/[2-9]/.test(first), first)
  const firstPageTiles = await firstTiles()
  await swipeTouch(-150)
  const second = await pagerInfo()
  check('左滑翻到下一页', second !== first, `${first} → ${second}`)
  check('翻页后卡片确实换了', JSON.stringify(await firstTiles()) !== JSON.stringify(firstPageTiles))
  await swipeTouch(-150)
  await swipeTouch(-150)
  await swipeTouch(-150)
  const last = await pagerInfo()
  check('最后一页继续左滑不越界', last === (await pagerInfo()) && last !== first, last)
  await swipeTouch(150)
  check('右滑回到上一页', (await pagerInfo()) !== last, `${last} → ${await pagerInfo()}`)
  // 回到第 1 页，再验证不翻页的两种情况
  for (let i = 0; i < 4; i++) {
    if ((await pagerInfo()).startsWith('第 1/') || (await pagerInfo()).includes('1/')) break
    await swipeTouch(150)
  }
  const backToFirst = await pagerInfo()
  await swipeTouch(-150, 200)
  check('纵向为主的拖动不翻页（那是滚动）', (await pagerInfo()) === backToFirst, await pagerInfo())
  await swipeTouch(-14, 0, 'header')
  check('小位移不翻页（那是点击）', (await pagerInfo()) === backToFirst, await pagerInfo())
  // 点卡片仍要能进详情页：滑动判定不许把点击吃掉
  await touchPage.locator('.eink-tile').first().tap()
  await touchPage.waitForSelector('text=玩法说明', { timeout: 8000 }).catch(() => {})
  check('滑动判定不影响点卡片进详情', (await touchPage.locator('text=玩法说明').count()) > 0)
  await touchCtx.close()
}
// 上一步（最大档位断言）已经回到首页，这里容忍「没有返回可点」
await clickText('返回', { optional: true })
await page.waitForTimeout(800)
const backState = await page.evaluate(() => ({
  home: /全部游戏/.test(document.body.innerText),
  text: document.body.innerText.replace(/\n+/g, ' ').slice(0, 60),
}))
check('从设置返回确实回到首页', backState.home, backState.text)
await invariants(page, '设置返回后首页')

/* ---------- 7) 键盘操作 ---------- */
/* ---------- 6b) 帮助页与诊断页（此前自动化套件从未覆盖） ---------- */
{
  console.log('\n[6b] 帮助页与诊断页')
  await gotoLibrary()
  await clickText('帮助')
  await page.waitForTimeout(600)
  await invariants(page, '帮助页')
  const helpText = await page.evaluate(() => document.body.innerText)
  check('帮助页有实质内容', helpText.length > 120, `${helpText.length} 字`)

  const toDiag = page.getByRole('button', { name: /诊断/ })
  if (await toDiag.count()) await toDiag.first().click()
  else {
    await clickText('返回', { optional: true })
    await gotoLibrary()
    await clickText('诊断')
  }
  await page.waitForTimeout(800)
  // 诊断页的原始转储已移入可滚动内容区（此前放在页脚里，把页脚撑到 504px），
  // 所以这里恢复完整不变量检查：页脚应当很矮且在屏内。
  const diagInvariants = await page.evaluate(() => {
    const f = document.querySelector('.eink-footer')
    return {
      missing: document.body.innerText.includes('⟦'),
      off: [...document.querySelectorAll('button')].filter((b) => b.getBoundingClientRect().bottom > innerHeight + 1).length,
      footerHeight: f ? Math.round(f.getBoundingClientRect().height) : null,
      footerOut: f ? f.getBoundingClientRect().bottom > innerHeight + 1 : false,
    }
  })
  check('诊断页：无缺键', !diagInvariants.missing)
  check('诊断页：无不可达按钮', diagInvariants.off === 0, `${diagInvariants.off} 个`)
  check('诊断页：固定页脚在屏内', !diagInvariants.footerOut, `页脚高 ${diagInvariants.footerHeight}px`)
  check(
    '诊断页：页脚不再被原始转储撑大',
    (diagInvariants.footerHeight ?? 0) < 150,
    `${diagInvariants.footerHeight}px`,
  )
  const diag = await page.evaluate(() => document.body.innerText.replace(/\n+/g, ' '))
  // 诊断页要如实反映运行环境（网页版曾据此确认「不谎报 BOOX 能力」）
  check('诊断页给出平台与存储信息', /存储|IndexedDB|安卓|Android|BOOX/i.test(diag), diag.slice(0, 70))
  // 刷新能力一栏与「连续运动测试」入口已整块删除（SDK 不再打进 APK，测也测不到）
  check('诊断页不再展示刷新能力与连续运动测试', !/刷新|连续运动/.test(diag), diag.slice(0, 70))
}

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

/* ---------- 自由选关：关卡行是可点按钮，点第 N 关就进第 N 关 ---------- */
console.log('\n[选关] 关卡行可点 + 点第 3 关进第 3 关')
await gotoLibrary()
await clickTile('华容道')
await page.waitForSelector('text=玩法说明', { timeout: 8000 })
const levelRows = await page.evaluate(() => {
  const items = [...document.querySelectorAll('.eink-levels__item')]
  return {
    rows: items.length,
    withButton: items.filter((li) => li.querySelector('button')).length,
    allEnabled: items.every((li) => {
      const button = li.querySelector('button')
      return button instanceof HTMLButtonElement && !button.disabled
    }),
    names: items.map((li) => {
      const button = li.querySelector('button')
      return (button?.getAttribute('aria-label') || button?.innerText || '').replace(/\s+/g, ' ').trim()
    }),
  }
})
check(
  '华容道·详情：每条关卡都是可聚焦的 <button>',
  levelRows.rows > 1 && levelRows.withButton === levelRows.rows && levelRows.allEnabled && levelRows.names.every((n) => n.length > 0),
  `${levelRows.rows} 行 / ${levelRows.withButton} 个按钮 / 名称=${levelRows.names.join(' | ').slice(0, 60)}`,
)
// 点第 3 关（行序号从 1 开始；非当前关才算真的"跳关"）
await page.locator('.eink-levels__item button').nth(2).click()
await page.waitForTimeout(400)
if (await page.getByRole('button', { name: /替换并开始/ }).count()) {
  await clickOverlay('替换并开始')
}
await page.waitForSelector('.eink-board', { timeout: 8000 })
await page.waitForTimeout(400)
const picked = await page.evaluate(() => ({
  title: (document.querySelector('.eink-topbar')?.innerText ?? '').replace(/\s+/g, ' ').trim(),
  stats: [...document.querySelectorAll('.eink-stats__item')].map((el) => el.innerText.replace(/\s+/g, ' ').trim()),
  body: document.body.innerText.replace(/\n+/g, ' '),
}))
check(
  '点第 3 关后标题显示第 3 关',
  /第\s*3\s*\//.test(picked.title),
  picked.title.slice(0, 60),
)
check(
  '点第 3 关后统计显示关卡 3/N',
  picked.stats.some((item) => /关卡\s*3\s*\//.test(item)),
  picked.stats.join(' | ').slice(0, 60),
)
check('选关后的对局页无缺键', !picked.body.includes('⟦'))

// 无关卡玩法不应有关卡行（该区已换成历史记录）
await gotoLibrary()
await clickTile('数独')
await page.waitForSelector('text=玩法说明', { timeout: 8000 })
const sudokuSections = await page.evaluate(() => ({
  levelRows: document.querySelectorAll('.eink-levels__item').length,
  headings: [...document.querySelectorAll('.eink-section h2')].map((h) => (h.textContent ?? '').trim()),
}))
check(
  '数独·详情：无关卡行、仍是历史记录',
  sudokuSections.levelRows === 0 && sudokuSections.headings.includes('历史记录') && !sudokuSections.headings.includes('关卡'),
  `分区=${sudokuSections.headings.join('/')}`,
)

console.log(`\n=== 页面错误：${errors.length} ===`)
for (const e of errors.slice(0, 6)) console.log('  ! ' + e)
const failed = results.filter((r) => !r.ok)
console.log(`=== 小结：${results.length - failed.length}/${results.length} 通过 ===`)
for (const f of failed) console.log('  ✗ ' + f.n)
await browser.close()
process.exit(failed.length || errors.length ? 1 : 0)
