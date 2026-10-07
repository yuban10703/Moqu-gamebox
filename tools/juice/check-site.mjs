/**
 * 真机实测页（docs/juice/index.html）的自动巡检。
 *
 * 判据直接沿用项目自己的那几条 —— 这个页面要在墨水屏上"打开就看"，所以：
 *   1) 首屏不滚动（scrollHeight ≤ 视口高）；
 *   2) 没有屏外按钮（按钮 bottom/right 超出视口且不在可滚动容器里）；
 *   3) 触摸目标 ≥ 44px；
 *   4) 逐格推进真的换了画面（canvas 像素必须变）；
 *   5) 两个"整屏"效果必须**自己收回**（反色/闪黑不能留在页面上）；
 *   6) 全程 0 个页面 JS 错误。
 *
 * 用法：node tools/juice/check-site.mjs [url]
 *   默认 http://127.0.0.1:8795/（先 npm run juice 生成页面、再起静态服务）。
 */
import { createRequire } from 'node:module'

const require = createRequire(new URL('../../.toolchain/pw/', import.meta.url))
const { chromium } = require('playwright')

const URL_ = process.argv[2] ?? 'http://127.0.0.1:8795/'
/** 真机视口：前两组是 WebView 基线，后两组是**实测到的 Chrome 视口**
 *  （BOOX 上 Chrome 报的是 517×931 / 744×455，跟 App 的 WebView 不是一回事，
 *   所以两套都要过 —— 页面会被 p6 的 Chrome 或 Moqu 的 WebView 打开）。 */
const VIEWPORTS = [
  ['P6Plus WebView 439×847', 439, 847],
  ['NoteX2 WebView 1248×903', 1248, 903],
  ['P6Plus Chrome 517×931', 517, 931],
  ['NoteX2 Chrome 744×455', 744, 455],
  ['P6Plus 极矮横屏 879×407', 879, 407],
]

let failed = 0
const check = (name, ok, extra = '') => {
  if (!ok) failed++
  console.log(`    ${ok ? '✓' : '✗'} ${name}${extra ? `  ${extra}` : ''}`)
}

const browser = await chromium.launch()
for (const [label, width, height] of VIEWPORTS) {
  console.log(`\n${label}`)
  const page = await browser.newPage({ viewport: { width, height } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await page.goto(URL_, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__JUICE__ && document.querySelectorAll('#tabs button').length > 0)

  const geo = await page.evaluate(() => {
    const vh = innerHeight
    const vw = innerWidth
    const scrolled = (el) => {
      for (let n = el.parentElement; n; n = n.parentElement) {
        const cs = getComputedStyle(n)
        if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && n.scrollHeight > n.clientHeight + 1) return true
      }
      return false
    }
    const off = [...document.querySelectorAll('button')].filter((b) => {
      const r = b.getBoundingClientRect()
      return (r.bottom > vh + 1 || r.right > vw + 1 || r.top < -1 || r.left < -1) && !scrolled(b)
    }).length
    const small = [...document.querySelectorAll('button')].filter((b) => b.getBoundingClientRect().height < 44).length
    const cv = document.getElementById('cv').getBoundingClientRect()
    return {
      docH: document.documentElement.scrollHeight,
      vh,
      off,
      small,
      tabs: document.querySelectorAll('#tabs button').length,
      cvW: Math.round(cv.width),
      cvH: Math.round(cv.height),
    }
  })
  check('首屏不滚动', geo.docH <= geo.vh + 1, `文档 ${geo.docH} / 视口 ${geo.vh}`)
  check('屏外按钮 = 0', geo.off === 0, `off=${geo.off}`)
  check('触摸目标 ≥44px', geo.small === 0, `过小=${geo.small}`)
  check('六个场景都在', geo.tabs === 6, `tabs=${geo.tabs}`)
  // 同一行的按钮必须等宽（真机截图上"第三个标签看着更宽"曾让我怀疑溢出，实测是等宽的）
  const widths = await page.evaluate(() => ({
    tabs: [...document.querySelectorAll('#tabs button')].map((b) => Math.round(b.getBoundingClientRect().width)),
    slots: [...document.querySelectorAll('#slots button')].map((b) => Math.round(b.getBoundingClientRect().width)),
  }))
  const spread = (xs) => Math.max(...xs) - Math.min(...xs)
  check('标签等宽', spread(widths.tabs) <= 2, `${Math.min(...widths.tabs)}~${Math.max(...widths.tabs)}`)
  check('格按钮等宽', spread(widths.slots) <= 2, `${Math.min(...widths.slots)}~${Math.max(...widths.slots)}`)
  // 画布必须保住 880:632 的宽高比 —— max-width/max-height 双约束下被压扁过一次
  const ratio = geo.cvW / geo.cvH
  check('画布宽高比正确', Math.abs(ratio - 880 / 632) < 0.02, `${geo.cvW}×${geo.cvH} = ${ratio.toFixed(3)}（应 ${(880 / 632).toFixed(3)}）`)

  // 画布真的画了东西 + 逐格推进换了画面
  const ink = () =>
    page.evaluate(() => {
      const c = document.getElementById('cv')
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
      let black = 0
      let sum = 0
      for (let i = 0; i < d.length; i += 4) {
        if (d[i] < 128) black++
        sum += d[i]
      }
      return { black, sum }
    })
  const a = await ink()
  check('画布已绘制', a.black > 5000, `黑像素 ${a.black}`)
  await page.click('#next')
  const b = await ink()
  check('「下一格」换了画面', b.sum !== a.sum, `sum ${a.sum} → ${b.sum}`)
  await page.click('#prev')
  const c = await ink()
  check('「上一格」能退回', c.sum === a.sum)

  // 切场景 + 定格的语义（第 2/3 格应完全相同 —— 这正是要演示的东西）
  await page.click('#tabs button:nth-child(2)')
  const s2 = await page.evaluate(() => document.getElementById('statusMain').textContent)
  check('切到场景 ②', s2.includes('定格') || s2.includes('1/7'), s2)

  const shot = async (i) => {
    await page.evaluate((k) => document.querySelectorAll('#slots button')[k].click(), i)
    return ink()
  }
  const f1 = await shot(1)
  const f2 = await shot(2)
  check('定格格画面完全相同（撞击帧保持）', f1.sum === f2.sum, `sum ${f1.sum} vs ${f2.sum}`)

  // 整屏效果必须自己收回
  await page.click('#tryInvert')
  const invOn = await page.evaluate(() => document.documentElement.classList.contains('inverted'))
  await page.waitForTimeout(420)
  const invOff = await page.evaluate(() => document.documentElement.classList.contains('inverted'))
  check('整页反色：立刻生效并自动收回', invOn && !invOff, `on=${invOn} off=${invOff}`)

  await page.click('#tryBlack')
  const blkOn = await page.evaluate(() => !!document.getElementById('blackout'))
  await page.waitForTimeout(420)
  const blkOff = await page.evaluate(() => !!document.getElementById('blackout'))
  check('整屏闪黑：立刻生效并自动收回', blkOn && !blkOff, `on=${blkOn} off=${blkOff}`)

  check('页面 0 个 JS 错误', errors.length === 0, errors.slice(0, 2).join(' | '))
  await page.close()
}

await browser.close()
console.log(failed === 0 ? `\n[check-site] ${VIEWPORTS.length} 档视口（含两台真机 Chrome 实测视口）全部通过` : `\n[check-site] ${failed} 项失败`)
process.exit(failed === 0 ? 0 : 1)
