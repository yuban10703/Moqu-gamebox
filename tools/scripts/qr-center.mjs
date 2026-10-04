/**
 * 打赏码中心标记同步：把 `apps/web/public/icon.svg` 里的标记画进两张打赏码的中心孔。
 *
 * 用法：node tools/scripts/qr-center.mjs [文件…]      # 缺省就是下面这两张
 * 幂等：重复运行结果相同（每次都从当前文件读、只重画孔内，孔外逐像素保持）。
 *
 * 当前状态：孔里是 **v3「墨滴手柄」**（与 App 图标同源）。历史：v3 之前是 v2 墨滴，
 * 更早是用户自己的猫照片 —— 三种都遵循同一套硬约束，所以这个脚本对「孔里放什么」是通用的：
 * 换图标 → 改 apps/web/public/icon.svg → 重跑本脚本。
 *
 * 硬约束（与上一轮一致，也是本文件的全部自检）：
 *   1) 只改**方框内部**：框线与孔外 QR 模块逐像素不动（写回后再解码比对，差异必须为 0）；
 *   2) 输出必须纯 1-bit：内部与标记都不许出现灰阶（渲染用 crispEdges，再逐像素卡一遍）；
 *   3) 标记必须完全落在内部、且与框线留 ≥2px 余量（贴到框线会让 logo 和框糊成一块）；
 *   4) 标记黑像素数不得多于原来（只减不增：孔内遮挡不因换标记变严重）。
 *
 * 标记几何**直接取自 icon.svg 的 path**（不手抄坐标）：该 path 是「墨滴外轮廓 + 挖空的
 * 十字键与两颗圆键」，fill-rule: evenodd。若将来图标再改，换成新 svg 即可，本脚本不用改。
 */
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
// 必须用 fileURLToPath：中文目录名经 URL.pathname 会变成 %E5%A2%A8…，路径立刻不存在
const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const require = createRequire(ROOT)
// Playwright 装在 gitignored 的 .toolchain/pw（与探索套件同一份浏览器）
const { chromium } = require(join(ROOT, '.toolchain/pw/node_modules/playwright'))

/** 标记外接方框边长 / 内部短边。0.78 让墨滴占内部约 61%，且黑像素不超过上一版 v2 标记
 * （0.80 时实测多 3.7%：v3 墨滴更胖 —— 自检「遮挡只减不增」就是靠这个定尺寸的） */
const BOX_RATIO = 0.78
/** 与框线的最小余量（像素） */
const MIN_MARGIN = 2

const svgSource = readFileSync('apps/web/public/icon.svg', 'utf8')
const pathMatch = svgSource.match(/<path[^>]*\sd="([^"]+)"/)
if (!pathMatch) throw new Error('icon.svg 里找不到 <path d="...">')
const MARK_PATH = pathMatch[1]
const viewBox = (svgSource.match(/viewBox="0 0 (\d+) (\d+)"/) ?? []).slice(1).map(Number)
const VB = viewBox.length === 2 ? viewBox : [128, 128]

const browser = await chromium.launch()
const page = await browser.newPage()
await page.setContent('<body style="margin:0"></body>')

async function rebuild(file) {
  const b64 = readFileSync(file).toString('base64')
  return page.evaluate(
    async ({ dataUrl, markPath, vb, boxRatio, minMargin }) => {
      const img = new Image()
      img.src = dataUrl
      await img.decode()
      const w = img.naturalWidth
      const h = img.naturalHeight
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      ctx.drawImage(img, 0, 0)
      const image = ctx.getImageData(0, 0, w, h)
      const data = image.data
      const dark = (x, y) => data[(y * w + x) * 4] < 128

      // 1) 纯 1-bit 才动
      let gray = 0
      for (let i = 0; i < data.length; i += 4) if (data[i] !== 0 && data[i] !== 255) gray++
      if (gray !== 0) throw new Error(`原图含灰阶像素 ${gray} 个，拒绝修改`)

      // 2) 找方框四条带（最长连续黑段的极大值），推出内部矩形
      const longestCol = new Array(w).fill(0)
      const longestRow = new Array(h).fill(0)
      for (let x = 0; x < w; x++) {
        let run = 0
        for (let y = 0; y < h; y++) {
          run = dark(x, y) ? run + 1 : 0
          if (run > longestCol[x]) longestCol[x] = run
        }
      }
      for (let y = 0; y < h; y++) {
        let run = 0
        for (let x = 0; x < w; x++) {
          run = dark(x, y) ? run + 1 : 0
          if (run > longestRow[y]) longestRow[y] = run
        }
      }
      const bestRun = (counts, from, to) => {
        let best = -1
        let at = -1
        for (let i = from; i < to; i++)
          if (counts[i] > best) {
            best = counts[i]
            at = i
          }
        let s = at
        let e = at
        while (s - 1 >= 0 && counts[s - 1] === best) s--
        while (e + 1 < counts.length && counts[e + 1] === best) e++
        return { start: s, end: e, thickness: e - s + 1, count: best }
      }
      const left = bestRun(longestCol, Math.floor(w * 0.25), Math.floor(w * 0.5))
      const right = bestRun(longestCol, Math.ceil(w * 0.5), Math.floor(w * 0.75))
      const top = bestRun(longestRow, Math.floor(h * 0.25), Math.floor(h * 0.5))
      const bottom = bestRun(longestRow, Math.ceil(h * 0.5), Math.floor(h * 0.75))
      const bands = [left, right, top, bottom]
      if (bands.some((b) => b.thickness < 2 || b.thickness > 24))
        throw new Error(`方框带厚度异常：${bands.map((b) => b.thickness).join(',')}`)
      if (left.thickness !== right.thickness || top.thickness !== bottom.thickness)
        throw new Error('方框左右/上下带厚度不一致，可能不是矩形环')
      for (let y = top.start; y <= bottom.end; y++) {
        for (let x = left.start; x <= left.end; x++) if (!dark(x, y)) throw new Error(`左框带在 (${x},${y}) 断开`)
        for (let x = right.start; x <= right.end; x++) if (!dark(x, y)) throw new Error(`右框带在 (${x},${y}) 断开`)
      }
      for (let x = left.start; x <= right.end; x++) {
        for (let y = top.start; y <= top.end; y++) if (!dark(x, y)) throw new Error(`上框带在 (${x},${y}) 断开`)
        for (let y = bottom.start; y <= bottom.end; y++) if (!dark(x, y)) throw new Error(`下框带在 (${x},${y}) 断开`)
      }
      const x0 = left.end + 1
      const y0 = top.end + 1
      const x1 = right.start - 1
      const y1 = bottom.start - 1
      const iw = x1 - x0 + 1
      const ih = y1 - y0 + 1
      if (iw < 24 || ih < 24) throw new Error(`内部区域太小：${iw}×${ih}`)

      // 3) 渲染 v3 标记（crispEdges → 只出纯黑/纯白；标记方框居中，边长取 BOX_RATIO × 短边）
      const box = Math.round(Math.min(iw, ih) * boxRatio)
      const ox = Math.round((iw - box) / 2)
      const oy = Math.round((ih - box) / 2)
      const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${box}" height="${box}" viewBox="0 0 ${vb[0]} ${vb[1]}" ` +
        `shape-rendering="crispEdges"><path fill="#000000" fill-rule="evenodd" d="${markPath}"/></svg>`
      const overlay = new Image()
      overlay.src = 'data:image/svg+xml;base64,' + btoa(svg)
      await overlay.decode()
      const oc = document.createElement('canvas')
      oc.width = box
      oc.height = box
      const octx = oc.getContext('2d', { willReadFrequently: true })
      octx.drawImage(overlay, 0, 0)
      const od = octx.getImageData(0, 0, box, box).data
      const overlayGray = (() => {
        let n = 0
        for (let i = 0; i < od.length; i += 4) if (od[i + 3] > 0 && od[i] !== 0 && od[i] !== 255) n++
        return n
      })()
      if (overlayGray !== 0) throw new Error(`标记渲染出 ${overlayGray} 个灰阶像素（crispEdges 未生效）`)

      // 标记的黑色外接框（用于余量检查：不许贴到框线）
      let bx0 = box
      let by0 = box
      let bx1 = -1
      let by1 = -1
      let markBlack = 0
      for (let y = 0; y < box; y++)
        for (let x = 0; x < box; x++) {
          const i = (y * box + x) * 4
          if (od[i + 3] > 128 && od[i] < 128) {
            markBlack++
            if (x < bx0) bx0 = x
            if (y < by0) by0 = y
            if (x > bx1) bx1 = x
            if (y > by1) by1 = y
          }
        }
      if (markBlack === 0) throw new Error('标记渲染为空白')
      const margin = Math.min(bx0, by0, box - 1 - bx1, box - 1 - by1) + Math.min(ox, oy)
      if (margin < minMargin) throw new Error(`标记距内部边缘只剩 ${margin}px（< ${minMargin}），可能与框线粘连`)

      // 4) 合成：内部整体重画（白底 + 标记），框线与孔外模块一个像素都不碰
      let beforeBlack = 0
      let afterBlack = 0
      for (let y = 0; y < ih; y++)
        for (let x = 0; x < iw; x++) {
          const gi = ((y0 + y) * w + (x0 + x)) * 4
          if (data[gi] < 128) beforeBlack++
          let black = false
          if (x >= ox && x < ox + box && y >= oy && y < oy + box) {
            const oi = ((y - oy) * box + (x - ox)) * 4
            black = od[oi + 3] > 128 && od[oi] < 128
          }
          const v = black ? 0 : 255
          data[gi] = v
          data[gi + 1] = v
          data[gi + 2] = v
          data[gi + 3] = 255
          if (black) afterBlack++
        }
      if (afterBlack > beforeBlack)
        throw new Error(`新标记黑像素 ${afterBlack} > 原标记 ${beforeBlack}：遮挡变多，拒绝写入`)
      ctx.putImageData(image, 0, 0)
      return {
        w,
        h,
        gray,
        frame: { left, right, top, bottom },
        interior: { x0, y0, x1, y1, iw, ih },
        box,
        margin,
        markBlack,
        beforeBlack,
        afterBlack,
        origB64: dataUrl,
        out: canvas.toDataURL('image/png'),
      }
    },
    { dataUrl: `data:image/png;base64,${b64}`, markPath: MARK_PATH, vb: VB, boxRatio: BOX_RATIO, minMargin: MIN_MARGIN },
  )
}

/** 写回后重新解码：内部之外逐像素等于原图、内部无灰阶 */
async function verify(origUrl, newUrl, interior) {
  return page.evaluate(
    async ({ a, b, box }) => {
      const load = async (src) => {
        const img = new Image()
        img.src = src
        await img.decode()
        const c = document.createElement('canvas')
        c.width = img.naturalWidth
        c.height = img.naturalHeight
        const ctx = c.getContext('2d', { willReadFrequently: true })
        ctx.drawImage(img, 0, 0)
        return { d: ctx.getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height }
      }
      const A = await load(a)
      const B = await load(b)
      if (A.w !== B.w || A.h !== B.h) return { error: '尺寸不一致' }
      let outsideDiff = 0
      let insideGray = 0
      for (let y = 0; y < A.h; y++)
        for (let x = 0; x < A.w; x++) {
          const i = (y * A.w + x) * 4
          const inside = x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1
          if (!inside) {
            if (A.d[i] !== B.d[i] || A.d[i + 3] !== B.d[i + 3]) outsideDiff++
          } else if (B.d[i] !== 0 && B.d[i] !== 255) insideGray++
        }
      return { outsideDiff, insideGray, size: `${B.w}×${B.h}` }
    },
    { a: origUrl, b: newUrl, box: interior },
  )
}

const DEFAULT_FILES = ['apps/web/public/about/donate.png', 'apps/web/public/about/donate-512.png']
const files_ = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_FILES
let failed = 0
for (const file of files_) {
  const r = await rebuild(file)
  const check = await verify(r.origB64, r.out, r.interior)
  const bytes = Buffer.from(r.out.split(',')[1], 'base64')
  const ok = check.outsideDiff === 0 && check.insideGray === 0
  console.log(`\n${file}  ${r.w}×${r.h}`)
  console.log(
    `  框带 左 ${r.frame.left.start}~${r.frame.left.end}(${r.frame.left.thickness}) ` +
      `右 ${r.frame.right.start}~${r.frame.right.end} 上 ${r.frame.top.start}~${r.frame.top.end} ` +
      `下 ${r.frame.bottom.start}~${r.frame.bottom.end}`,
  )
  console.log(
    `  内部 ${r.interior.iw}×${r.interior.ih}（x ${r.interior.x0}~${r.interior.x1}, y ${r.interior.y0}~${r.interior.y1}）` +
      ` 标记方框 ${r.box}px · 距边 ${r.margin}px`,
  )
  console.log(
    `  黑像素 内部 ${r.beforeBlack} → ${r.afterBlack}（标记本体 ${r.markBlack}；${r.afterBlack <= r.beforeBlack ? '未增加 ✓' : '增加 ✗'}）`,
  )
  console.log(
    `  写回自检：孔外差异 ${check.outsideDiff} 像素（须 0）· 内部灰阶 ${check.insideGray}（须 0）· 新文件 ${bytes.length}B ${ok ? '✓' : '✗'}`,
  )
  if (!ok) failed++
  else writeFileSync(file, bytes)
}
await browser.close()
if (failed) {
  console.error(`\n[qrc-v3] ✗ ${failed} 个文件未通过自检，已保持原样`)
  process.exit(1)
}
console.log('\n[qrc-v3] ✓ 全部通过：框线与孔外模块逐像素未变，中心已换为 v3「墨滴手柄」')
