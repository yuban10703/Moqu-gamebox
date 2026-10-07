/**
 * 把 scenes.js 里的场景逐帧导出成 GIF（写到 docs/juice/）。
 *
 * 用法：node tools/juice/render.mjs [场景 id…]
 *   不带参数 = 全部场景。
 *
 * 每一步都先做**往返校验**（verify）：编出来的 GIF 用浏览器的 ImageDecoder 解回逐帧像素，
 * 与源帧比对（帧数 / 像素 / 每帧时长）。LZW 的码长增长时机只要差一位，画面就会整帧花掉，
 * 而花掉的 GIF 肉眼未必第一眼看得出来 —— 所以不靠眼睛，靠比对。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

// playwright 装在 gitignored 的 .toolchain/pw（与 tools/scripts/explore-*.mjs 同一份）
const require = createRequire(new URL('../../.toolchain/pw/', import.meta.url))
const { chromium } = require('playwright')

const OUT = fileURLToPath(new URL('../../docs/juice/', import.meta.url))
const read = (name) => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8')

mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage()
page.on('pageerror', (e) => {
  console.error('页面异常：', e.message)
  process.exitCode = 1
})
/*
 * 必须给页面一个**安全上下文**：往返校验用的是 WebCodecs 的 ImageDecoder，
 * 而它在 `setContent` 出来的 about:blank（不透明源）上不存在。
 * 用 route 拦一个假域名直接回页面内容，既离线又满足 secure context。
 */
await page.route('https://juice.local/**', (route) =>
  route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset="utf-8"><title>juice</title>' }),
)
await page.goto('https://juice.local/')
await page.addScriptTag({ content: read('encoder.js') })
await page.addScriptTag({ content: read('scenes.js') })
await page.evaluate(() => document.fonts.ready)

const pick = process.argv.slice(2)
const list = (await page.evaluate(() => window.__JUICE__.list())).filter((s) => !pick.length || pick.includes(s.id))
if (!list.length) throw new Error(`没有匹配的场景：${pick.join(', ')}`)

for (const s of list) {
  const check = await page.evaluate((id) => window.__JUICE__.verify(id), s.id)
  if (!check.ok) {
    console.error(`✗ ${s.id} 往返校验失败：${check.mismatches.join('；')}`)
    process.exitCode = 1
    continue
  }
  const b64 = await page.evaluate((id) => window.__JUICE__.render(id), s.id)
  const buf = Buffer.from(b64, 'base64')
  writeFileSync(`${OUT}${s.file}`, buf)
  console.log(
    `✓ ${s.file.padEnd(22)} ${String(s.frames).padStart(2)} 帧 → ${String(check.slots).padStart(2)} 槽（去重后）  ${(buf.length / 1024).toFixed(1)} KB`,
  )
}

if (process.env.JUICE_PNG) {
  for (const s of list) {
    for (let i = 0; i < s.frames; i++) {
      const url = await page.evaluate(([id, k]) => window.__JUICE__.png(id, k), [s.id, i])
      writeFileSync(`/tmp/juice-${s.id}-${i}.png`, Buffer.from(url.split(',')[1], 'base64'))
    }
  }
  console.log('已导出单帧 PNG 到 /tmp/juice-*.png')
}

/*
 * 真机实测页：把场景代码注入站点的占位符里，输出到 docs/juice/index.html。
 * 页面与 GIF 共用同一份 scenes.js —— 页面上逐格看到的图与动图必然一致，
 * 不会出现"动图改了、页面还是旧的"这种漂移。
 */
const site = read('site.html')
if (!site.includes('/*__SCENES__*/')) throw new Error('site.html 里找不到 /*__SCENES__*/ 占位符')
writeFileSync(`${OUT}index.html`, site.replace('/*__SCENES__*/', () => read('scenes.js')))
console.log(`✓ index.html（真机实测页，已注入 ${list.length} 个场景）`)

await browser.close()
