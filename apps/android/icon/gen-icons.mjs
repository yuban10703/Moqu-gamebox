#!/usr/bin/env node
/**
 * 「墨趣」图标生成器（零新增依赖：复用 .toolchain/pw 的 Playwright Chromium 栅格化）。
 *
 * 为什么用浏览器栅格化而不是装 ImageMagick：SVG 由 Chromium 以**目标尺寸**直接渲染，
 * 小尺寸下的笔画取舍就是我们最终在设备上看到的样子。
 *
 * ── 设计 v2「白纸黑墨」（2026-10-04 重设计）─────────────────────────
 *   白底 = 纸，黑墨滴 = 墨。与 v1（纯黑底 + 白墨滴 + 白笔锋）正好反过来。
 *   结构（由外到内）：白纸 → **粗黑圆环**（= 印章边框，也就是图标的边界）→ 环心**黑墨滴**。
 *
 *   为什么用圆环而不是圆角方框：adaptive icon 的安全区是中心 66dp 的**圆**。
 *   圆环外径 = 66dp 时正好内切于安全圆，任何蒙版（圆形/方形/圆角方）下都完整；
 *   而同样粗细的圆角方框，四角会跑到安全圆外被蒙版切掉，出现断角。
 *
 *   为什么白底图标必须带这圈粗边：白底在浅色/纯白壁纸的桌面上会和背景连成一片，
 *   没有边界就"消失"。黑环带宽 = 画布 7.5%（≠ 细线；墨水屏上细线会糊掉），
 *   在纯白壁纸的桌面上依然一眼能看出图标范围（见 /tmp/v2-white-wallpaper.png 的对照）。
 *
 *   1-bit：整图只有 #000000 与 #ffffff，`shape-rendering="crispEdges"` 关闭抗锯齿；
 *   脚本末尾会重新解码每张 PNG 统计像素并断言**灰阶像素 = 0**（否则 exit 1）。
 *
 * 产物（全部由本文件单一事实来源生成，改图形只改这里）：
 *   Android  apps/android/app/src/main/res/...   传统 raster 兜底 + adaptive 背景/前景矢量
 *   Web      apps/web/public/...                 favicon 与 PWA 图标
 *
 * 运行：node apps/android/icon/gen-icons.mjs              （生成 + 逐张像素自检）
 *       node apps/android/icon/gen-icons.mjs --no-verify  （只生成）
 */
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const { chromium } = require(join(ROOT, '.toolchain/pw/node_modules/playwright'))

const ANDROID_RES = join(ROOT, 'apps/android/app/src/main/res')
const WEB_PUBLIC = join(ROOT, 'apps/web/public')

const BLACK = '#000000'
const WHITE = '#ffffff'

/* ------------------------------------------------------------------ *
 * 几何参数（以「画布边长 = 1」为单位；栅格化时再乘目标像素）
 * ------------------------------------------------------------------ */
/** 黑环外径 / 画布 */
const RING_OUTER = 0.88
/** 黑环带宽 / 画布 = 7.5%（要求 6%~8%，取中位；48px 下 ≈ 3.6px，192px 下 ≈ 14.4px） */
const RING_BAND = 0.075
/** 墨滴高度 / 画布。环内径 = 0.88-2×0.075 = 0.73 → 上下各留 0.145 画布宽的空白，
 *  48px 下 ≈ 7px，墨水屏上墨滴不会和环糊在一起 */
const DROP_H = 0.44
/** 圆角方图标的圆角半径 / 画布（沿用 v1 网页图标的 0.22，视觉延续） */
const CORNER = 0.22

/** 环内部比例（adaptive 图层只给环 66dp，用这两个比例换算，保证与栅格图完全同款） */
const BAND_OF_RING = RING_BAND / RING_OUTER // 0.0852
const DROP_OF_RING = DROP_H / RING_OUTER // 0.5

/**
 * 墨滴路径：尖顶 + 圆体的标准水滴，外接盒 宽:高 = 0.72:1。
 * 顶点 (cx, cy-h/2)，底部圆心在顶点下方 0.64h、r = 0.36h；从顶点作两条切线，
 * 切点 (±0.29782h, cy-0.0625h)，下方接大弧（large-arc=1, sweep=1）闭合。
 */
function dropPath(cx, cy, h) {
  const apex = cy - h / 2
  const r = 0.36 * h
  const tx = 0.29782 * h
  const ty = cy - 0.0625 * h
  return `M${cx} ${apex}L${cx + tx} ${ty}A${r} ${r} 0 1 1 ${cx - tx} ${ty}Z`
}

/** 给定环外径（像素）→ 环路径半径、带宽、墨滴高；比例对栅格与矢量完全一致 */
function ringGeometry(outer) {
  return {
    pathR: (outer * (1 - BAND_OF_RING)) / 2, // 描边中径
    band: outer * BAND_OF_RING,
    dropH: outer * DROP_OF_RING,
  }
}

const SVG_OPEN = (size) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" shape-rendering="crispEdges">`

/** 白纸 + 粗黑环 + 黑墨滴；ringOuter 为环外径（像素） */
function inkLayer(size, ringOuter) {
  const { pathR, band, dropH } = ringGeometry(ringOuter)
  return `<circle cx="${size / 2}" cy="${size / 2}" r="${pathR.toFixed(3)}" fill="none" stroke="${BLACK}" stroke-width="${band.toFixed(3)}"/>
<path d="${dropPath(size / 2, size / 2, dropH)}" fill="${BLACK}"/>`
}

/** 圆角方图（网页 / PWA / 传统 Android raster 兜底） */
function squareSvg(size, corner = CORNER) {
  const rx = corner > 0 ? ` rx="${(size * corner).toFixed(3)}" ry="${(size * corner).toFixed(3)}"` : ''
  return `${SVG_OPEN(size)}
<rect width="${size}" height="${size}"${rx} fill="${WHITE}"/>
${inkLayer(size, size * RING_OUTER)}
</svg>`
}

/** 圆形图（传统 Android round 兜底）：四角透明 + 白圆 + 黑环 + 黑墨滴 */
function roundSvg(size) {
  return `${SVG_OPEN(size)}
<circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="${WHITE}"/>
${inkLayer(size, size * RING_OUTER)}
</svg>`
}

/** maskable：白底满幅（蒙版裁成任何形状底色都是白的），图形整体收进中心 80% 安全圆 */
function maskableSvg(size) {
  return `${SVG_OPEN(size)}
<rect width="${size}" height="${size}" fill="${WHITE}"/>
${inkLayer(size, size * 0.8)}
</svg>`
}

/* ---------------------------------- 渲染 --------------------------------- */

const browser = await chromium.launch()
const page = await browser.newPage({ deviceScaleFactor: 1, viewport: { width: 640, height: 640 } })
await page.setContent('<body style="margin:0;background:transparent"></body>')

/** 以精确像素尺寸渲染 SVG 并截图（保留透明底） */
async function png(svg, size) {
  const handle = await page.evaluateHandle(
    ({ html, size }) => {
      const host = document.createElement('div')
      host.style.cssText = `width:${size}px;height:${size}px;overflow:hidden`
      host.innerHTML = html
      document.body.appendChild(host)
      return host
    },
    { html: svg, size },
  )
  const el = handle.asElement()
  const buf = await el.screenshot({ omitBackground: true })
  await el.evaluate((node) => node.remove())
  return buf
}

const written = []
function emit(path, data) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, data)
  written.push({ path: path.slice(ROOT.length + 1), bytes: Buffer.byteLength(data) })
}

// 1) Android 传统 raster 兜底：mdpi 48 / hdpi 72 / xhdpi 96 / xxhdpi 144 / xxxhdpi 192
for (const [dpi, size] of [
  ['mdpi', 48],
  ['hdpi', 72],
  ['xhdpi', 96],
  ['xxhdpi', 144],
  ['xxxhdpi', 192],
]) {
  emit(join(ANDROID_RES, `mipmap-${dpi}/ic_launcher.png`), await png(squareSvg(size), size))
  emit(join(ANDROID_RES, `mipmap-${dpi}/ic_launcher_round.png`), await png(roundSvg(size), size))
}

// 2) Web：favicon / apple-touch / PWA（白底圆角方 + 黑环 + 黑墨滴）
for (const [name, size] of [
  ['favicon-32.png', 32],
  ['apple-touch-icon.png', 180],
  ['icon-192.png', 192],
  ['icon-512.png', 512],
]) {
  emit(join(WEB_PUBLIC, name), await png(squareSvg(size), size))
}
// 16px 单独一套：环带宽只有 1.2px，1-bit 下会时断时续/糊成一团，
// 改用「小尺寸光学补偿」参数（环略缩、边略细、墨滴略小），16× 放大目视挑选
const TINY = { ring: 0.78, band: 0.115, drop: 0.36 }
function tinySvg(size) {
  const { pathR, band, dropH } = {
    pathR: (size * TINY.ring * (1 - TINY.band / TINY.ring)) / 2,
    band: size * TINY.band,
    dropH: size * TINY.drop,
  }
  return `${SVG_OPEN(size)}
<rect width="${size}" height="${size}" rx="${(size * CORNER).toFixed(3)}" fill="${WHITE}"/>
<circle cx="${size / 2}" cy="${size / 2}" r="${pathR.toFixed(3)}" fill="none" stroke="${BLACK}" stroke-width="${band.toFixed(3)}"/>
<path d="${dropPath(size / 2, size / 2, dropH)}" fill="${BLACK}"/>
</svg>`
}
emit(join(WEB_PUBLIC, 'favicon-16.png'), await png(tinySvg(16), 16))
emit(join(WEB_PUBLIC, 'icon-maskable-512.png'), await png(maskableSvg(512), 512))

// 3) favicon 矢量版（index.html 首选；与各尺寸 PNG 同源同参数）
emit(join(WEB_PUBLIC, 'icon.svg'), `${squareSvg(128)}\n`)

// 4) adaptive icon 前景矢量：视口 108dp，黑环 + 黑墨滴全部落在中心 66dp 安全圆内
//    环外径 66dp（= 安全圆直径），带宽 66×0.0852 ≈ 5.62dp，墨滴高 33dp，圆心 (54,54)
const FP = ringGeometry(66)
const fpTop = 54 - FP.pathR
const fpBottom = 54 + FP.pathR
emit(
  join(ANDROID_RES, 'drawable/ic_launcher_foreground.xml'),
  `<?xml version="1.0" encoding="utf-8"?>
<!-- 由 apps/android/icon/gen-icons.mjs 生成，请勿手改。
     白纸黑墨 v2：粗黑圆环（印章边框）+ 黑墨滴。
     环外径 66dp = 安全圆直径，带宽 ${FP.band.toFixed(2)}dp，墨滴高 ${FP.dropH.toFixed(2)}dp；
     图形全部落在中心 66dp 安全圆内，任何蒙版（圆/方/圆角方）下都完整、不会被切边。 -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <path
        android:fillColor="#00000000"
        android:strokeColor="#FF000000"
        android:strokeWidth="${FP.band.toFixed(3)}"
        android:pathData="M54,${fpTop.toFixed(3)} A${FP.pathR.toFixed(3)},${FP.pathR.toFixed(3)} 0 1 0 54,${fpBottom.toFixed(3)} A${FP.pathR.toFixed(3)},${FP.pathR.toFixed(3)} 0 1 0 54,${fpTop.toFixed(3)} Z" />
    <path
        android:fillColor="#FF000000"
        android:pathData="${dropPath(54, 54, FP.dropH)}" />
</vector>
`,
)

// 5) adaptive icon 背景矢量：白纸满幅（108dp 全铺，任何蒙版下底色都是白的）
emit(
  join(ANDROID_RES, 'drawable/ic_launcher_background.xml'),
  `<?xml version="1.0" encoding="utf-8"?>
<!-- 由 apps/android/icon/gen-icons.mjs 生成，请勿手改：白纸满幅（白纸黑墨 v2 的"纸"） -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <path
        android:fillColor="#FFFFFFFF"
        android:pathData="M0,0h108v108h-108z" />
</vector>
`,
)

// 6) adaptive icon 描述（背景白纸 + 前景黑环墨滴）；方/圆两个入口同款
for (const name of ['ic_launcher', 'ic_launcher_round']) {
  emit(
    join(ANDROID_RES, `mipmap-anydpi-v26/${name}.xml`),
    `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@drawable/ic_launcher_background" />
    <foreground android:drawable="@drawable/ic_launcher_foreground" />
</adaptive-icon>
`,
  )
}

/* ------------------------------ 像素自检 ------------------------------ *
 * 重新解码刚写出的 PNG，统计 纯黑 / 纯白 / 灰（0<v<255）/ 透明 像素占比，
 * 并量出顶边黑带厚度（= 环带宽）。1-bit 审美要求灰 = 0。
 * ------------------------------------------------------------------- */
async function verifyPng(file) {
  const b64 = readFileSync(file).toString('base64')
  return page.evaluate(async (dataUrl) => {
    const img = new Image()
    img.src = dataUrl
    await img.decode()
    const c = document.createElement('canvas')
    c.width = img.naturalWidth
    c.height = img.naturalHeight
    const ctx = c.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(img, 0, 0)
    const { data } = ctx.getImageData(0, 0, c.width, c.height)
    const w = c.width
    const h = c.height
    let black = 0
    let white = 0
    let gray = 0
    let clear = 0
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i]
      const a = data[i + 3]
      if (a === 0) {
        clear++
        continue
      }
      if (r !== data[i + 1] || r !== data[i + 2]) throw new Error(`非灰阶像素 @${i / 4}`)
      if (r === 0) black++
      else if (r === 255) white++
      else gray++
    }
    // 顶边中心列：跳过外侧白边后，量第一段黑带的厚度（= 环带宽实测）
    const cx = w >> 1
    const at = (y) => ({ v: data[(y * w + cx) * 4], a: data[(y * w + cx) * 4 + 3] })
    let y = 0
    while (y < h && !(at(y).a > 0 && at(y).v < 128)) y++
    let band = 0
    while (y < h && at(y).a > 0 && at(y).v < 128) {
      band++
      y++
    }
    return { size: `${w}×${h}`, total: w * h, black, white, gray, clear, band }
  }, `data:image/png;base64,${b64}`)
}

if (!process.argv.includes('--no-verify')) {
  const rows = []
  let bad = 0
  for (const { path } of written) {
    if (!path.endsWith('.png')) continue
    const s = await verifyPng(join(ROOT, path))
    const pct = (n) => ((n / s.total) * 100).toFixed(2).padStart(6)
    if (s.gray !== 0) bad++
    rows.push(
      `  ${path.padEnd(58)} ${s.size.padStart(9)}  黑 ${pct(s.black)}%  白 ${pct(s.white)}%  ` +
        `透明 ${pct(s.clear)}%  **灰 ${pct(s.gray)}%**  环带宽 ${s.band}px`,
    )
  }
  console.log('[gen-icons] PNG 像素统计（灰 = 0 才算通过）：')
  for (const r of rows) console.log(r)
  console.log(
    bad === 0
      ? '[gen-icons] ✓ 全部 PNG 纯黑/纯白，灰阶像素 0 个'
      : `[gen-icons] ✗ ${bad} 张 PNG 含灰阶像素`,
  )
  if (bad > 0) process.exitCode = 1
}

await browser.close()
console.log(`[gen-icons] 已生成 ${written.length} 个文件：`)
for (const w of written) console.log(`  ${w.path}  ${w.bytes}B`)
