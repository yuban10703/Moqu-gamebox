/**
 * 探索式缺陷探测（数据完整性）。
 *   备份导出（下载 + JSON 结构 + 校验和）/ 导入非法备份 /
 *   存档被截断后的恢复入口 / 多游戏进度 / 「继续上一局」指向 / 清空全部进度
 *
 * 用法同 explore-ui：npm run explore（两个套件一起跑）。
 */
/**
 * 探索式缺陷探测（二）：数据完整性。
 * 备份导出/导入、存档损坏恢复、清空进度、多游戏存档、离线后写入。
 */
import { createRequire } from 'node:module'

// playwright 装在 gitignored 的 .toolchain/pw（体积大，不进项目依赖）
const require = createRequire(new URL('../../.toolchain/pw/', import.meta.url))
const { chromium } = require('playwright')
import { readFileSync, existsSync } from 'node:fs'

/*
 * 必须和其余四个套件一样尊重 WEB_URL：这里原先硬编码 8899，
 * 而 verify-all 的端口是可用 VERIFY_PORT 改的 —— 一旦改端口（或多份工作区并存），
 * 本套件会**静默地去测另一个服务**，结论完全无效（本轮实际踩到：测到了另一棵工作区的旧构建）。
 */
const PAGE_URL = process.env.WEB_URL ?? 'http://127.0.0.1:8899/'
const results = []
const errors = []
const check = (n, ok, extra = '') => {
  results.push({ n, ok })
  console.log(`  ${ok ? '✓' : '✗'} ${n}${extra ? '  ' + extra : ''}`)
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 439, height: 847 }, locale: 'zh-CN', acceptDownloads: true })
const page = await ctx.newPage()
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)))
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)) })
const clickText = async (text, { optional = false } = {}) => {
  // 首页是翻页而非滚动（每页 6 款），目标不在当前页时自动往后翻；限定 .eink-tile 以免误点「继续」细栏
  for (let hop = 0; hop < 6; hop++) {
    const tile = page.locator('.eink-tile', { hasText: text }).first()
    if ((await tile.count()) > 0) { await tile.click(); await page.waitForTimeout(250); return true }
    const next = page.locator('button[data-page="next"]:not([disabled])').first()
    if (!(await next.count())) break
    await next.click()
    await page.waitForTimeout(250)
  }
  const btn = page.getByRole('button', { name: new RegExp(text) }).first()
  if (!(await btn.count())) {
    if (optional) return false
    throw new Error(`找不到按钮「${text}」：${(await page.evaluate(() => document.body.innerText)).replace(/\n+/g, ' ').slice(0, 90)}`)
  }
  await btn.click(); await page.waitForTimeout(250); return true
}
const clickDialog = async (text) => {
  const d = page.locator('.eink-overlay, .eink-dialog').last()
  await d.getByRole('button', { name: new RegExp(text) }).first().click()
  await page.waitForTimeout(250)
}
const gotoLibrary = async () => {
  await page.goto(PAGE_URL, { waitUntil: 'networkidle' })
  await page.waitForSelector('text=墨水屏游戏盒子', { timeout: 15000 })
}
const play = async (title, moves = 1) => {
  /*
   * 进对局的入口必须**确定**，不再用"按名字找按钮"：
   *  1) 首页的「继续上一局」细栏可访问名里也含游戏名（对无障碍是有意的），按名字会先命中它；
   *  2) 首页可能翻页，目标方块不一定在当前页。
   * 所以：限定 .eink-tile 找方块（必要时翻页），进说明页后再在**说明页内**找按钮。
   */
  await gotoLibrary()
  let opened = false
  for (let hop = 0; hop < 8 && !opened; hop++) {
    const tile = page.locator('.eink-tile', { hasText: title }).first()
    if (await tile.count()) { await tile.click(); opened = true; break }
    const next = page.locator('button[data-page="next"]:not([disabled])').first()
    if (!(await next.count())) break
    await next.click(); await page.waitForTimeout(200)
  }
  if (!opened) throw new Error(`首页找不到游戏方块「${title}」`)
  await page.waitForSelector('text=玩法说明', { timeout: 8000 })

  const detail = page.locator('.eink-screen')
  const resume = detail.getByRole('button', { name: /^继续$/ }).first()
  if (await resume.count()) {
    await resume.click()
  } else {
    const start = detail.getByRole('button', { name: /开始新游戏/ }).first()
    if (!(await start.count())) throw new Error(`「${title}」说明页既没有继续也没有开始新游戏`)
    await start.click()
  }
  await page.waitForTimeout(400)
  if (await page.getByRole('button', { name: /替换并开始/ }).count()) await clickDialog('替换并开始')
  if (!(await page.locator('.eink-board').count())) {
    await page.waitForSelector('.eink-board', { timeout: 8000 })
  }
  /*
   * 至少走一步 —— 存档是在**第一次动作**时落盘的（本项目"立即提交"策略），
   * 一步不走就等于没有存档，后续"继续上一局"相关断言会全部失败。
   * 2048 这类靠**方向盘**操作的玩法点棋盘格是无效的，所以优先按方向盘。
   */
  for (let i = 0; i < Math.max(1, moves); i++) {
    const dpad = page.locator('.eink-dpad button').first()
    if (await dpad.count()) {
      await dpad.click()
    } else {
      const cell = page.locator('.eink-board__cell').nth(i)
      if (await cell.count()) await cell.click()
    }
    await page.waitForTimeout(240)
  }
}

// 每次运行从干净状态开始：本套件会故意损坏存档来验证恢复入口，
// 若不清空，下一次运行会读到上一次留下的坏档（曾因此误判成「进度丢失」）
await page.goto(PAGE_URL, { waitUntil: 'networkidle' })
await page.waitForSelector('text=墨水屏游戏盒子', { timeout: 15000 })
await page.evaluate(async () => { await window.__einkPlatform.storage.clearAll() })
await page.reload({ waitUntil: 'networkidle' })
await page.waitForSelector('text=墨水屏游戏盒子', { timeout: 15000 })

/* ---------- 1) 备份导出 ---------- */
console.log('\n[1] 备份导出')
await play('推箱子', 2)
await clickText('暂停')
await clickDialog('返回游戏库')
await clickText('设置')
await page.waitForSelector('text=备份', { timeout: 8000 })
let downloaded = null
page.once('download', async (d) => { downloaded = { name: d.suggestedFilename(), path: await d.path() } })
await clickText('导出备份')
await page.waitForTimeout(1500)
check('导出备份触发下载', downloaded !== null, downloaded ? downloaded.name : '无下载')
if (downloaded?.path && existsSync(downloaded.path)) {
  const text = readFileSync(downloaded.path, 'utf8')
  let parsed = null
  try { parsed = JSON.parse(text) } catch {}
  check('备份是可解析的 JSON', parsed !== null, `${text.length} 字节`)
  check('备份含存档与版本字段', !!parsed?.saves && !!parsed?.schema && !!parsed?.appVersion && !!parsed?.checksum, JSON.stringify(Object.keys(parsed ?? {})))
} else {
  check('备份文件可读', false, '拿不到下载文件')
}

/* ---------- 1b) 导出 → 再导入 的闭环 ---------- */
console.log('\n[1b] 备份闭环：把刚导出的文件再导入回去')
if (downloaded?.path && existsSync(downloaded.path)) {
  // 只比 committed 键：导入会先留一份 save:1:backup:* 旧档，那是刻意的安全设计，不算变化
  const keysOf = async (kind) =>
    page.evaluate(async (k) => {
      const all = await window.__einkPlatform.storage.saves.rawAll()
      return all.map((r) => r.key).filter((key) => key.includes(k)).sort()
    }, kind)
  const beforeKeys = await keysOf('committed')
  const input = page.locator('input[type=file]')
  if ((await input.count()) > 0) {
    await input.setInputFiles(downloaded.path)
    await page.waitForTimeout(1500)
    const text = await page.evaluate(() => document.body.innerText)
    // 导入自己的备份不应该失败；允许出现冲突策略提示，但不允许"导入失败"
    check('导入自己导出的备份不报错', !/导入失败/.test(text), text.replace(/\n+/g, ' ').slice(-60))
    const afterKeys = await keysOf('committed')
    check('闭环导入后 committed 存档集合不变', JSON.stringify(beforeKeys) === JSON.stringify(afterKeys),
      `${beforeKeys.length} → ${afterKeys.length}`)
    const backups = await keysOf('backup')
    check('导入前保留了旧档备份（覆盖前的安全网）', backups.length >= 1, `${backups.length} 份`)
    const ok = await page.evaluate(async () => {
      const r = await window.__einkPlatform.storage.saves.loadResult('sokoban')
      return r.status === 'ok' ? r.envelope.moves : r.status
    })
    check('闭环导入后存档内容仍可读', typeof ok === 'number', `sokoban moves=${ok}`)
  } else {
    check('页面提供导入入口（file input）', false, '未找到 input[type=file]')
  }
} else {
  check('上一节拿到了导出文件（供闭环使用）', false, '没有下载文件')
}

/* ---------- 1c) 备份在界面上可见（安全网要能被用户看到） ---------- */
console.log('\n[1c] 设置页的备份列表')
{
  // 导入动作就发生在设置页，这里不需要再导航（多按一次「设置」会找不到按钮）
  await page.waitForTimeout(500)
  const list = await page.evaluate(() => {
    const items = document.querySelectorAll('.eink-backups li, .eink-backups .eink-list__item')
    return { count: items.length, text: [...items].map((e) => e.textContent.replace(/\s+/g, ' ').trim().slice(0, 30)) }
  })
  check('设置页列出至少一份备份（导入前的旧档）', list.count >= 1, `${list.count} 份：${list.text.join(' / ').slice(0, 80)}`)
  // 每个备份条目都要有可点的恢复按钮（当前文案是「继续」，动作是 restoreBackup）
  const actions = await page.evaluate(
    () => document.querySelectorAll('.eink-backups button').length,
  )
  check('每个备份条目都带恢复按钮', actions >= list.count, `${actions} 个按钮 / ${list.count} 份备份`)
  // 注意：这里**不要**离开设置页 —— 下一节（导入非法备份）依赖本页的 file input
}

/* ---------- 2) 导入非法备份 ---------- */
console.log('\n[2] 导入非法备份')
let sawError = false
page.once('dialog', async (d) => { await d.dismiss() })
const fileInput = page.locator('input[type=file]')
if (await fileInput.count()) {
  await fileInput.setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('this is not a backup') })
  await page.waitForTimeout(1200)
  const text = await page.evaluate(() => document.body.innerText)
  sawError = /失败|无效|错误|无法/.test(text)
  check('非法备份给出明确提示而不是崩溃', sawError, text.replace(/\n+/g, ' ').slice(-70))
} else {
  check('页面提供导入入口（file input）', false, '未找到 input[type=file]')
}

/* ---------- 3) 存档损坏 ---------- */
console.log('\n[3] 存档损坏恢复')
// 真实损坏场景：把已提交的存档**截断**（模拟写入中断 / 掉电），
// 此时连 meta 都解析不出来 —— 最容易出现「静默丢档」
await page.evaluate(async () => {
  const raw = await window.__einkPlatform.storage.saves.rawAll()
  const item = raw.find((r) => r.key.startsWith('save:1:committed:'))
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open('eink-gamebox')
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  const tx = db.transaction(['kv'], 'readwrite')
  tx.objectStore('kv').put(item.text.slice(0, 40), item.key)
  await new Promise((r) => { tx.oncomplete = r; tx.onerror = r })
  db.close()
})
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(1200)
const corruptText = await page.evaluate(() => document.body.innerText)
check('损坏存档被识别（给出恢复入口而非崩溃）', /损坏|无法读取|恢复/.test(corruptText), corruptText.replace(/\n+/g, ' ').slice(0, 110))

/* ---------- 4) 多个游戏各有存档 ---------- */
console.log('\n[4] 多游戏存档')
await play('数独', 0)
await play('扫雷', 0)
await play('2048', 1)
await gotoLibrary()
const tiles = await page.evaluate(() => [...document.querySelectorAll('.eink-tile')].map((t) => t.innerText.replace(/\n+/g, ' ')))
check('每款游戏的进度都能显示', tiles.length >= 5 && tiles.every((t) => t.length > 0), `${tiles.length} 款：${tiles.join(' | ').slice(0, 110)}`)
/*
 * 断言"继续"是否指向**最近玩过**的那一款：不匹配细栏文字（文字可能为空），
 * 而是**点它、看打开了哪款游戏** —— 行为验证比文本匹配更强，也不依赖具体排版。
 */
const contExists = (await page.locator('.eink-continue').count()) > 0
if (contExists) await page.locator('.eink-continue').first().click()
await page.waitForTimeout(900)
const resumedTitle = await page.evaluate(() => document.querySelector('.eink-topbar')?.textContent ?? '')
check(
  '「继续上一局」打开的是最近玩过的那款',
  contExists && /2048/.test(resumedTitle),
  `细栏存在=${contExists}，打开后标题=${resumedTitle.replace(/\s+/g, ' ').slice(0, 40)}`,
)
await gotoLibrary()


/* ---------- 5) 清空全部进度 ---------- */
console.log('\n[5] 清空全部进度')
await clickText('设置')
await page.waitForSelector('text=备份', { timeout: 8000 })
await clickText('清除全部进度')
await page.waitForTimeout(300)
await clickDialog('清除')
await page.waitForTimeout(1200)
await gotoLibrary()
const after = await page.evaluate(() => document.body.innerText.replace(/\n+/g, ' '))
check('清空后首页无继续卡片', !/继续上一局/.test(after), after.slice(0, 70))
// 卡片上的进度行已按要求删除，因此这里改为断言：清空后「继续上一局」细栏消失、游戏方块仍在
check(
  '清空后继续入口消失、游戏列表仍完整',
  (await page.locator('.eink-continue').count()) === 0 && (await page.locator('.eink-tile').count()) >= 5,
  after.slice(0, 90),
)

/* ---------- 6) 详情页：无关卡玩法显示「历史记录」，有关卡玩法仍有「关卡」 ---------- */
console.log('\n[6] 详情页：关卡 → 历史记录')

/** 打开某款游戏的详情页（限定 .eink-tile，必要时翻页），返回各分区标题 */
const openDetail = async (title) => {
  await gotoLibrary()
  let opened = false
  for (let hop = 0; hop < 8 && !opened; hop++) {
    const tile = page.locator('.eink-tile', { hasText: title }).first()
    if (await tile.count()) {
      await tile.click()
      opened = true
      break
    }
    const next = page.locator('button[data-page="next"]:not([disabled])').first()
    if (!(await next.count())) break
    await next.click()
    await page.waitForTimeout(200)
  }
  if (!opened) throw new Error(`详情页打不开：${title}`)
  await page.waitForSelector('.eink-rules', { timeout: 8000 })
  await page.waitForTimeout(200)
  return page.evaluate(() => ({
    headings: [...document.querySelectorAll('.eink-section h2')].map((h) => (h.textContent ?? '').trim()),
    historyRows: document.querySelectorAll('.eink-history__item').length,
    text: (document.body.innerText || '').replace(/\n+/g, ' '),
  }))
}

// 只有难度选择、没有关卡的玩法：不应出现「关卡」，应出现「历史记录」
// 新增的无关卡玩法（贪吃蛇 / 俄罗斯方块 / 消消乐）也必须在名单里，否则等于没验
for (const title of ['数独', '扫雷', '关灯游戏', '记忆配对', '五子棋', '数字华容道', '2048', '贪吃蛇', '俄罗斯方块', '消消乐']) {
  const info = await openDetail(title)
  const hasLevels = info.headings.includes('关卡')
  const hasHistory = info.headings.includes('历史记录')
  check(
    `${title}·详情：无「关卡」、有「历史记录」`,
    !hasLevels && hasHistory,
    `分区=${info.headings.join('/')} 记录=${info.historyRows} 行`,
  )
  check(
    `${title}·详情：历史区有内容或空态文案，且无缺键`,
    !info.text.includes('⟦') && (info.historyRows > 0 || info.text.includes('暂无记录')),
    info.historyRows > 0 ? `${info.historyRows} 条记录` : '空态',
  )
}

// 有关卡的玩法（推箱子 / 华容道）：保持原样，不能出现「历史记录」
for (const title of ['推箱子', '华容道']) {
  const info = await openDetail(title)
  check(
    `${title}·详情：仍有关卡、无「历史记录」`,
    info.headings.includes('关卡') && !info.headings.includes('历史记录'),
    `分区=${info.headings.join('/')}`,
  )
}

// 无关卡玩法的历史记录不该把固定页脚顶出屏幕
await openDetail('数独')
const footerInside = await page.evaluate(() => {
  const footer = document.querySelector('.eink-footer')
  return footer ? footer.getBoundingClientRect().bottom <= innerHeight + 1 : null
})
check('历史记录页：固定页脚仍在屏内', footerInside === true, String(footerInside))
await gotoLibrary()

console.log(`\n=== 页面错误：${errors.length} ===`)
for (const e of errors.slice(0, 5)) console.log('  ! ' + e)
const failed = results.filter((r) => !r.ok)
console.log(`=== 小结：${results.length - failed.length}/${results.length} 通过 ===`)
for (const f of failed) console.log('  ✗ ' + f.n)
await browser.close()
process.exit(failed.length || errors.length ? 1 : 0)
