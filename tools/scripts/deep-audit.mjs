/**
 * 深度巡检：逐款游戏在「真实浏览器 + 目标分辨率/字号」下跑一遍完整交互。
 *
 * 与既有的 explore-*.mjs 的区别：那些脚本查的是「页面长什么样」，
 * 这个脚本查的是「**玩起来对不对**」—— 每一步操作都要有可断言的局面变化，
 * 非法输入要有明确反馈，撤销要真的回到上一步，离局再进要接着上次的进度。
 *
 * 用法（先起一个自己的静态服务，见 README / verify-all.mjs）：
 *   WEB_URL=http://127.0.0.1:8912/ VIEWPORT=439x847 DSF=1.875 FONT_SCALE=1 \
 *     node tools/scripts/deep-audit.mjs
 *
 * 环境变量：
 *   WEB_URL     被测地址（**必须显式给**，避免静默测到别的工作区）
 *   VIEWPORT    WxH，缺省 439x847
 *   DSF         deviceScaleFactor，缺省 1
 *   FONT_SCALE  1 | 1.5（1.5 = 根字号 26px）
 *   GAMES       逗号分隔的游戏 id，缺省全部
 *   SHOT_DIR    截图目录
 *   REPORT      结果 JSON 输出路径
 */
import { createRequire } from 'node:module'
import { inflateSync } from 'node:zlib'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const require = createRequire(new URL('../../.toolchain/pw/', import.meta.url))
const { chromium } = require('playwright')

const WEB_URL = process.env.WEB_URL
if (!WEB_URL) throw new Error('必须显式设置 WEB_URL（避免静默测到别的工作区）')
const [VW, VH] = (process.env.VIEWPORT ?? '439x847').split('x').map(Number)
const DSF = Number(process.env.DSF ?? '1')
const FONT_SCALE = Number(process.env.FONT_SCALE ?? '1')
const ONLY = process.env.GAMES ? new Set(process.env.GAMES.split(',').map((s) => s.trim())) : null
const TAG = `${VW}x${VH}@${DSF}x-fs${FONT_SCALE}`
const SHOT_DIR = process.env.SHOT_DIR ?? `.toolchain/shots/deep-audit/${TAG}`
const REPORT = process.env.REPORT ?? `${SHOT_DIR}/report.json`
mkdirSync(SHOT_DIR, { recursive: true })

/** 点完等一会儿再读 DOM：真机上的一次整屏刷新约 500ms，探针抢读会误判 */
const SETTLE = Number(process.env.SETTLE ?? '1300')

const results = []
const consoleErrors = []
const record = (game, check, ok, detail) => {
  results.push({ game, check, ok, detail })
  const mark = ok === 'na' ? '·' : ok ? '✓' : '✗'
  console.log(`  ${mark} [${game}] ${check}${detail ? '  ' + detail : ''}`)
}

/* ------------------------------------------------------------------ *
 * 1-bit 像素统计：自己解 PNG（Chromium 截图是 8-bit RGB/RGBA，无隔行）
 * ------------------------------------------------------------------ */
function decodePng(path) {
  const data = readFileSync(path)
  if (data.readUInt32BE(0) !== 0x89504e47) throw new Error(`${path}: 不是 PNG`)
  let pos = 8
  let width = 0
  let height = 0
  let colorType = 0
  const idat = []
  while (pos < data.length) {
    const length = data.readUInt32BE(pos)
    const type = data.toString('latin1', pos + 4, pos + 8)
    const chunk = data.subarray(pos + 8, pos + 8 + length)
    if (type === 'IHDR') {
      width = chunk.readUInt32BE(0)
      height = chunk.readUInt32BE(4)
      if (chunk[8] !== 8) throw new Error(`bitDepth=${chunk[8]} 不支持`)
      colorType = chunk[9]
    } else if (type === 'IDAT') idat.push(chunk)
    else if (type === 'IEND') break
    pos += 12 + length
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0
  if (!channels) throw new Error(`colorType=${colorType} 不支持`)
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const out = Buffer.alloc(width * height * channels)
  let prev = Buffer.alloc(stride)
  let offset = 0
  for (let row = 0; row < height; row++) {
    const filter = raw[offset++]
    const line = Buffer.from(raw.subarray(offset, offset + stride))
    offset += stride
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels] : 0
      const b = prev[i]
      const c = i >= channels ? prev[i - channels] : 0
      if (filter === 1) line[i] = (line[i] + a) & 0xff
      else if (filter === 2) line[i] = (line[i] + b) & 0xff
      else if (filter === 3) line[i] = (line[i] + ((a + b) >> 1)) & 0xff
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        line[i] = (line[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff
      }
    }
    line.copy(out, row * stride)
    prev = line
  }
  return { width, height, channels, pixels: out }
}

/** 纯黑 / 纯白 / 中间灰占比 + 「灰阶块」检测（16×16 块里 ≥90% 是中间灰 = 灰底块，不是字体抗锯齿） */
function pixelStats(path) {
  const { width, height, channels, pixels } = decodePng(path)
  let black = 0
  let white = 0
  let gray = 0
  const block = 16
  let grayBlocks = 0
  let worstBlock = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels
      const value = (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3
      if (value <= 8) black++
      else if (value >= 247) white++
      else gray++
    }
  }
  for (let by = 0; by + block <= height; by += block) {
    for (let bx = 0; bx + block <= width; bx += block) {
      let g = 0
      for (let y = by; y < by + block; y++) {
        for (let x = bx; x < bx + block; x++) {
          const i = (y * width + x) * channels
          const value = (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3
          if (value > 8 && value < 247) g++
        }
      }
      const ratio = g / (block * block)
      if (ratio > worstBlock) worstBlock = ratio
      if (ratio >= 0.9) grayBlocks++
    }
  }
  const total = width * height || 1
  return {
    size: `${width}x${height}`,
    black: black / total,
    white: white / total,
    gray: gray / total,
    grayBlocks,
    worstBlock,
  }
}

/* ------------------------------------------------------------------ *
 * 页面侧工具
 * ------------------------------------------------------------------ */
const SNAP_FN = () => {
  const cells = [...document.querySelectorAll('.eink-board__cell')].map((cell) => ({
    k: cell.dataset.kind ?? '',
    t: (cell.textContent ?? '').trim(),
    s: cell.dataset.selected === 'yes',
    w: cell.dataset.wrong === 'yes',
  }))
  const stats = [...document.querySelectorAll('.eink-stats__item')].map(
    (item) =>
      `${(item.querySelector('dt')?.textContent ?? '').trim()}=${(item.querySelector('dd')?.textContent ?? '').trim()}`,
  )
  const buttons = [...document.querySelectorAll('.eink-screen button')].map((b) => ({
    text: (b.textContent ?? '').replace(/\s+/g, ' ').trim(),
    disabled: b.disabled === true,
    cls: b.className,
  }))
  const screen = document.querySelector('.eink-screen--game')
  const grid = document.querySelector('.eink-board')
  return {
    cells,
    stats,
    buttons,
    cols: Number(grid?.getAttribute('aria-colcount') ?? 0),
    rows: Number(grid?.getAttribute('aria-rowcount') ?? 0),
    notice: (document.querySelector('[data-testid=notice]')?.textContent ?? '').trim(),
    title: (document.querySelector('.eink-topbar__title h1')?.textContent ?? '').trim(),
    autoTick: screen?.dataset.autoTick ?? null,
    paused: screen?.dataset.paused ?? null,
    result: (document.querySelector('.eink-section--result h2')?.textContent ?? '').trim(),
    missing: document.body.innerText.includes('⟦'),
  }
}
/**
 * 局面签名 = 逐格（kind/文字/选中/错误标记）+ 统计数字。
 *
 * **计时器不算局面**：它每秒都在涨，把它算进去会让「撤销回到上一步」这类断言
 * 永远失败（第一轮实测就踩到了）。计时器单独用 `timerOf()` 检查。
 *
 * `contentSig` 再去掉「选中」：需求里的"局面变化"指的是**格子 kind/文字/统计数字**，
 * 选中态是光标而不是局面（华容道与消消乐的规则层都明确"撤销不撤回选中"）。
 */
const TIMER_LABELS = ['用时', '时间', 'Time', 'Elapsed']
const signature = (snap) =>
  JSON.stringify([
    snap.cells,
    snap.stats.filter((s) => !TIMER_LABELS.some((label) => s.startsWith(label + '='))),
  ])
const contentSig = (snap) =>
  JSON.stringify([
    snap.cells.map((c) => [c.k, c.t, c.w]),
    snap.stats.filter((s) => !TIMER_LABELS.some((label) => s.startsWith(label + '='))),
  ])
const selectedOf = (snap) => snap.cells.map((c) => (c.s ? 1 : 0)).join('')
const timerOf = (snap) => {
  const hit = snap.stats.find((s) => TIMER_LABELS.some((label) => s.startsWith(label + '=')))
  if (!hit) return null
  const [, value] = hit.split('=')
  const [m, s] = value.split(':').map(Number)
  return (m || 0) * 60 + (s || 0)
}

const LAYOUT_FN = () => {
  const rect = (el) => {
    const r = el.getBoundingClientRect()
    return { t: r.top, l: r.left, r: r.right, b: r.bottom, w: r.width, h: r.height }
  }
  const board = document.querySelector('.eink-board')
  const area = document.querySelector('.eink-board-area')
  const reachable = (el) => {
    let n = el.parentElement
    while (n) {
      const cs = getComputedStyle(n)
      if (
        (cs.overflowY === 'auto' || cs.overflowY === 'scroll') &&
        n.scrollHeight > n.clientHeight + 1
      )
        return true
      n = n.parentElement
    }
    return false
  }
  const offButtons = [...document.querySelectorAll('.eink-screen button')]
    .filter((b) => {
      const r = b.getBoundingClientRect()
      return (r.bottom > innerHeight + 1 || r.top < -1) && !reachable(b)
    })
    .map((b) => (b.textContent ?? '').trim().slice(0, 12))
  // 横向越界单列：竖屏下棋盘/按钮被挤出左右边界也是很现实的缺陷
  const offX = [...document.querySelectorAll('.eink-screen button')]
    .filter((b) => {
      const r = b.getBoundingClientRect()
      return r.right > innerWidth + 1 || r.left < -1
    })
    .map((b) => (b.textContent ?? '').trim().slice(0, 12))
  const clipped = [...document.querySelectorAll('.eink-stats__item')]
    .filter((item) => {
      const dt = item.querySelector('dt')
      const dd = item.querySelector('dd')
      return (
        (dt && dt.scrollWidth > dt.clientWidth + 1) || (dd && dd.scrollWidth > dd.clientWidth + 1)
      )
    })
    .map((item) => (item.textContent ?? '').replace(/\s+/g, ' ').trim())
  const areaRect = area ? rect(area) : null
  const boardRect = board ? rect(board) : null
  let margins = null
  if (areaRect && boardRect) {
    margins = {
      top: Math.round(areaRect.t - boardRect.t),
      bottom: Math.round(boardRect.b - areaRect.b),
      left: Math.round(areaRect.l - boardRect.l),
      right: Math.round(boardRect.r - areaRect.r),
    }
  }
  const content = document.querySelector('.eink-screen__content')
  const cell = document.querySelector('.eink-board__cell')
  return {
    cellCount: document.querySelectorAll('.eink-board__cell').length,
    boardRect,
    areaRect,
    margins,
    cellSize: cell ? Math.round(cell.getBoundingClientRect().width * 10) / 10 : 0,
    offButtons,
    offX,
    clipped,
    docScroll: document.documentElement.scrollHeight - document.documentElement.clientHeight,
    contentScroll: content ? content.scrollHeight - content.clientHeight : null,
    animations: document.getAnimations().length,
    animated: [...document.querySelectorAll('*')].filter((el) => {
      const cs = getComputedStyle(el)
      const dur = cs.transitionDuration.split(',').map((v) => parseFloat(v) || 0)
      const name = cs.animationName
      return dur.some((v) => v > 0) || (name && name !== 'none')
    }).length,
    missing: document.body.innerText.includes('⟦'),
  }
}

/* ------------------------------------------------------------------ *
 * 每款游戏的「怎么走一步」与「怎么走一步非法的」
 * ------------------------------------------------------------------ */
const dirs = ['up', 'down', 'left', 'right']
const dpadCells = { up: 1, down: 7, left: 3, right: 5 }
const dpadSel = {
  up: '.eink-dpad__up',
  down: '.eink-dpad__down',
  left: '.eink-dpad__left',
  right: '.eink-dpad__right',
}
const cellText = (snap, i) => snap.cells[i]?.t ?? ''
const cellKind = (snap, i) => snap.cells[i]?.k ?? ''

/** 数独：读成 9×9 数表（given/tile 都有文字） */
function sudokuGrid(snap) {
  return snap.cells.map((c) => (c.t ? Number(c.t.replace(/[^0-9]/g, '')) || 0 : 0))
}
function sudokuPeers(index) {
  const row = Math.floor(index / 9)
  const col = index % 9
  const out = new Set()
  for (let i = 0; i < 9; i++) {
    out.add(row * 9 + i)
    out.add(i * 9 + col)
  }
  const br = Math.floor(row / 3) * 3
  const bc = Math.floor(col / 3) * 3
  for (let r = br; r < br + 3; r++) for (let c = bc; c < bc + 3; c++) out.add(r * 9 + c)
  out.delete(index)
  return [...out]
}

/** 消消乐：找一对相邻交换后能连成三连的格子（规则层只认这种交换） */
function match3Swap(snap, cols, rows) {
  const board = snap.cells.map((c) => c.t)
  const line = (b) => {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c + 2 < cols; c++) {
        const v = b[r * cols + c]
        if (v && v === b[r * cols + c + 1] && v === b[r * cols + c + 2]) return true
      }
    }
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r + 2 < rows; r++) {
        const v = b[r * cols + c]
        if (v && v === b[(r + 1) * cols + c] && v === b[(r + 2) * cols + c]) return true
      }
    }
    return false
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c
      for (const [dr, dc] of [
        [0, 1],
        [1, 0],
      ]) {
        const r2 = r + dr
        const c2 = c + dc
        if (r2 >= rows || c2 >= cols) continue
        const j = r2 * cols + c2
        const next = board.slice()
        ;[next[i], next[j]] = [next[j], next[i]]
        // 交换后两边都不能立刻还原（否则等于没换），且有新三连
        if (line(next) && next[i] !== board[i]) return [i, j]
      }
    }
  }
  return null
}

const DRIVERS = {
  sokoban: {
    title: '推箱子',
    level: true,
    valid: (snap, step) => dirs.map((dir) => ({ t: 'dpad', dir })).slice(step % 4).concat(dirs.map((dir) => ({ t: 'dpad', dir }))),
    // 走不通的方向：引擎自己挑一个不改局面的方向盘方向（非法输入必须有提示）
    invalid: 'auto-dpad',
  },
  klotski: {
    title: '华容道',
    level: true,
    valid: (snap) => {
      /*
       * 华容道：点棋子选中 → 点**相邻**空格滑一格（规则层只认相邻的一步）。
       * 先只枚举「空格 + 它的上下左右邻居里的棋子」，否则 10 块 × 13 空格 = 130 个候选，
       * 每个候选两次点击，一轮下来要几分钟。
       */
      const cols = snap.cols
      const out = []
      snap.cells.forEach((cell, e) => {
        if (cell.k !== 'empty' && cell.k !== 'goal') return
        const col = e % cols
        for (const n of [e - cols, e + cols, col > 0 ? e - 1 : -1, col < cols - 1 ? e + 1 : -1]) {
          if (n < 0 || n >= snap.cells.length) continue
          if (snap.cells[n].k !== 'tile') continue
          out.push({ t: 'seq', steps: [{ t: 'cell', i: n }, { t: 'cell', i: e }] })
        }
      })
      return out
    },
    invalid: (snap) => {
      /*
       * 先选中一块棋子，再点一个**够不着**的空格：规则层不会产生动作，
       * 期望壳层给出「这一步滑不过去」而不是静默。
       * 空格要挑得远一点（相隔两行以上），否则可能真的能滑过去。
       */
      const cols = snap.cols
      const tile = snap.cells.findIndex((c) => c.k === 'tile')
      if (tile < 0) return null
      const tileRow = Math.floor(tile / cols)
      const far = snap.cells.findIndex(
        (c, i) => (c.k === 'empty' || c.k === 'goal') && Math.abs(Math.floor(i / cols) - tileRow) >= 2,
      )
      if (far < 0) return null
      return { t: 'seq', steps: [{ t: 'cell', i: tile }, { t: 'cell', i: far }] }
    },
  },
  sudoku: {
    title: '数独',
    undoHidden: '数独按产品要求隐藏撤销按钮（registry.hideShellControls = [undo]）',
    valid: (snap) => {
      const grid = sudokuGrid(snap)
      const empty = grid.findIndex((v, i) => v === 0 && snap.cells[i]?.k === 'empty')
      if (empty < 0) return []
      return Array.from({ length: 9 }, (_, d) => ({
        t: 'seq',
        steps: [
          { t: 'cell', i: empty },
          { t: 'btn', text: String(d + 1) },
        ],
      }))
    },
    invalid: (snap) => {
      // 与同行/列/宫已填数字冲突的一步：规则层必须拒绝并给出「这一步填不了」
      const grid = sudokuGrid(snap)
      for (let i = 0; i < grid.length; i++) {
        if (grid[i] !== 0 || snap.cells[i]?.k !== 'empty') continue
        for (const p of sudokuPeers(i)) {
          if (grid[p] !== 0) {
            return {
              t: 'seq',
              steps: [
                { t: 'cell', i },
                { t: 'btn', text: String(grid[p]) },
              ],
            }
          }
        }
      }
      return null
    },
  },
  minesweeper: {
    title: '扫雷',
    valid: (snap, step) => {
      const hidden = snap.cells.map((c, i) => (c.k === 'hidden' ? i : -1)).filter((i) => i >= 0)
      if (!hidden.length) return []
      const flagBtn = snap.buttons.find((b) => b.text.startsWith('标记模式'))
      // 第一步揭示（首点必安全），之后用标记模式插旗 —— 插旗不会踩雷，稳定可复现
      if (step === 0) return hidden.slice(0, 12).map((i) => ({ t: 'cell', i }))
      const turningOn = flagBtn && flagBtn.text.includes('关')
      const out = []
      for (const i of hidden.slice(0, 8)) {
        out.push(
          turningOn
            ? { t: 'seq', steps: [{ t: 'btn', text: flagBtn.text }, { t: 'cell', i }] }
            : { t: 'cell', i },
        )
      }
      return out
    },
    invalid: (snap) => {
      // 已翻开的格子：无论哪种模式都点不动 —— 期望有文字反馈而不是静默
      const revealed = snap.cells.findIndex((c) => c.k === 'number' || c.k === 'empty' || c.k === 'mine')
      if (revealed < 0) return null
      return { t: 'cell', i: revealed }
    },
  },
  lightsout: {
    title: '关灯游戏',
    // 每一格都能翻转、翻了必然改变局面：按格子顺序轮着点即可（不用看亮灭）
    valid: (snap, step) => {
      const all = snap.cells.map((_, i) => i)
      const offset = (step * 3) % Math.max(1, all.length)
      return all.slice(offset).concat(all.slice(0, offset)).slice(0, 6).map((i) => ({ t: 'cell', i }))
    },
    // 每一格都可以翻转：这一款不存在「非法输入」
    invalid: () => null,
    invalidNa: '关灯游戏每一格都可以翻转，规则层不存在非法动作（已用单测覆盖未知动作报错）',
  },
  memory: {
    title: '记忆配对',
    // 规则层：一次尝试 = 两张牌（撤销时按日志奇偶退回 1 或 2 张），因此撤销前要走满两张
    undoClicks: 2,
    valid: (snap) => {
      const down = snap.cells.map((c, i) => (c.k === 'hidden' ? i : -1)).filter((i) => i >= 0)
      return down.slice(0, 6).map((i) => ({ t: 'cell', i }))
    },
    invalid: (snap) => {
      // 已配对的牌 / 正面朝上的牌：规则层明确报错，UI 却先返回 null
      // 正面朝上 / 已配对的牌（memory 用 kind='tile' 表示翻开）
      const done = snap.cells.findIndex((c) => c.k === 'tile' && c.t !== '')
      if (done < 0) return null
      return { t: 'cell', i: done }
    },
  },
  gomoku: {
    title: '五子棋',
    valid: (snap, step) => {
      const empty = snap.cells.map((c, i) => (c.k === 'empty' ? i : -1)).filter((i) => i >= 0)
      const mid = Math.floor(empty.length / 2)
      const rotated = empty.slice(mid).concat(empty.slice(0, mid))
      return rotated.slice(step % 3, (step % 3) + 3).map((i) => ({ t: 'cell', i }))
    },
    invalid: (snap) => {
      // 已有棋子的交叉点（kind 为 tile，符号在文字里）
      const occupied = snap.cells.findIndex((c) => c.k === 'tile')
      if (occupied < 0) return null
      return { t: 'cell', i: occupied }
    },
  },
  fifteen: {
    title: '数字华容道',
    valid: (snap, step) => {
      const taps = snap.cells.map((c, i) => (c.t ? i : -1)).filter((i) => i >= 0)
      const shuffled = taps.slice(step % 5).concat(taps.slice(0, step % 5))
      return shuffled
        .slice(0, 4)
        .map((i) => ({ t: 'cell', i }))
        .concat(dirs.map((dir) => ({ t: 'dpad', dir })))
    },
    invalid: 'auto-dpad',
  },
  2048: {
    title: '2048',
    valid: (snap, step) => dirs.slice(step % 4).concat(dirs.slice(0, step % 4)).map((dir) => ({ t: 'dpad', dir })),
    invalid: 'auto-dpad',
  },
  match3: {
    title: '消消乐',
    valid: (snap) => {
      const cols = snap.cols
      const rows = snap.rows
      const swap = match3Swap(snap, cols, rows)
      if (!swap) return []
      return [{ t: 'seq', steps: [{ t: 'cell', i: swap[0] }, { t: 'cell', i: swap[1] }] }]
    },
    invalid: (snap) => {
      // 换不出三连的相邻交换：规则层必须拒绝并提示
      const cols = snap.cols
      const rows = snap.rows
      const good = match3Swap(snap, cols, rows)
      const board = snap.cells.map((c) => c.t)
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c + 1 < cols; c++) {
          const i = r * cols + c
          const j = i + 1
          if (board[i] === board[j]) continue
          if (good && (good[0] === i || good[0] === j)) continue
          const next = board.slice()
          ;[next[i], next[j]] = [next[j], next[i]]
          const makes = (() => {
            const line = (b) => {
              for (let rr = 0; rr < rows; rr++)
                for (let cc = 0; cc + 2 < cols; cc++) {
                  const v = b[rr * cols + cc]
                  if (v && v === b[rr * cols + cc + 1] && v === b[rr * cols + cc + 2]) return true
                }
              for (let cc = 0; cc < cols; cc++)
                for (let rr = 0; rr + 2 < rows; rr++) {
                  const v = b[rr * cols + cc]
                  if (v && v === b[(rr + 1) * cols + cc] && v === b[(rr + 2) * cols + cc]) return true
                }
              return false
            }
            return line(next)
          })()
          if (!makes) return { t: 'seq', steps: [{ t: 'cell', i }, { t: 'cell', i: j }] }
        }
      }
      return null
    },
  },
  snake: { title: '贪吃蛇', valid: () => [], invalid: () => null },
  tetris: { title: '俄罗斯方块', valid: () => [], invalid: () => null },
}

/* ------------------------------------------------------------------ *
 * 运行器
 * ------------------------------------------------------------------ */
const browser = await chromium.launch()
const ctx = await browser.newContext({
  viewport: { width: VW, height: VH },
  deviceScaleFactor: DSF,
  locale: 'zh-CN',
  hasTouch: true,
})
const page = await ctx.newPage()
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${String(e).slice(0, 200)}`))
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(`console: ${m.text().slice(0, 200)}`)
})

const snap = () => page.evaluate(SNAP_FN)
const layout = () => page.evaluate(LAYOUT_FN)

async function clickAction(action) {
  if (action.t === 'seq') {
    for (const step of action.steps) await clickAction(step)
    return
  }
  if (action.t === 'cell') {
    const cell = page.locator('.eink-board__cell').nth(action.i)
    await cell.scrollIntoViewIfNeeded().catch(() => {})
    await cell.click({ timeout: 4000 })
    await page.waitForTimeout(SETTLE)
    return
  }
  if (action.t === 'dpad') {
    const btn = page.locator(dpadSel[action.dir]).first()
    await btn.click({ timeout: 4000 })
    await page.waitForTimeout(SETTLE)
    return
  }
  if (action.t === 'btn') {
    const btn = page.getByRole('button', { name: action.text, exact: true }).first()
    await btn.click({ timeout: 4000 })
    await page.waitForTimeout(SETTLE)
  }
}

async function gotoLibrary() {
  await page.goto(WEB_URL, { waitUntil: 'networkidle' })
  // 首页标题可能被改（别的 agent 正在改首页 UI）：等游戏格子出现，别等具体文案
  await page.waitForSelector('.eink-tile', { timeout: 15000 })
  await page.waitForTimeout(400)
}

async function openTile(title) {
  for (let back = 0; back < 12; back++) {
    const prev = page.locator('button[data-page="prev"]:not([disabled])').first()
    if (!(await prev.count())) break
    await prev.click()
    await page.waitForTimeout(150)
  }
  for (let hop = 0; hop < 12; hop++) {
    const tile = page.locator('.eink-tile', { hasText: title }).first()
    if ((await tile.count()) > 0) {
      await tile.click()
      await page.waitForTimeout(600)
      return true
    }
    const next = page.locator('button[data-page="next"]:not([disabled])').first()
    if (!(await next.count())) break
    await next.click()
    await page.waitForTimeout(200)
  }
  return false
}

/** 从首页进详情 → 开局（必要时确认替换） */
async function startGame(title, { fresh = false } = {}) {
  await gotoLibrary()
  if (!(await openTile(title))) throw new Error(`首页找不到「${title}」`)
  await page.waitForSelector('text=玩法说明', { timeout: 10000 })
  if (fresh) {
    const start = page.getByRole('button', { name: '开始新游戏' }).first()
    if (await start.count()) {
      await start.click()
      await page.waitForTimeout(500)
    }
  } else {
    const resume = page.getByRole('button', { name: '继续', exact: true }).first()
    if (await resume.count()) {
      await resume.click()
      await page.waitForTimeout(700)
    }
  }
  if (await page.getByRole('button', { name: '替换并开始' }).count()) {
    await page.getByRole('button', { name: '替换并开始' }).first().click()
    await page.waitForTimeout(700)
  }
  await page.waitForSelector('.eink-board', { timeout: 10000 })
  await page.waitForTimeout(800)
}

const undoButton = () => page.locator('.eink-screen--game button', { hasText: '撤销' }).first()

/** 读存档里的种子：用来判定「重新开始」到底有没有换题目（结构事实，不是看文案） */
async function readSeed() {
  return page.evaluate(async () => {
    const id = document.querySelector('.eink-screen--game')?.dataset.game
    if (!id) return null
    const result = await window.__einkPlatform.storage.saves.loadResult(id)
    return result.status === 'ok' ? (result.envelope.seed ?? null) : null
  })
}

async function clickUndo() {
  const btn = undoButton()
  if (!(await btn.count())) return false
  await btn.click()
  await page.waitForTimeout(SETTLE)
  return true
}

async function confirmRestart() {
  const btn = page.getByRole('button', { name: '重新开始' }).first()
  await btn.click()
  await page.waitForTimeout(500)
  const dialog = page.locator('.eink-dialog').last()
  await dialog.getByRole('button', { name: '重新开始' }).click()
  await page.waitForTimeout(SETTLE)
}

async function backToLibrary() {
  let guard = 0
  while (guard++ < 6) {
    if (await page.locator('.eink-tile').count()) return
    const back = page.locator('.eink-button--back').first()
    if (!(await back.count())) break
    await back.click()
    await page.waitForTimeout(700)
  }
}

/** 在某个游戏里找一步**有效**操作（候选里第一个真的改变局面的） */
async function playValidMove(driver, before, step) {
  if (driver.invalid === undefined) return null
  const candidates = (driver.valid(before, step) ?? []).slice(0, 40)
  for (const action of candidates) {
    await clickAction(action)
    const after = await snap()
    if (contentSig(after) !== contentSig(before)) return { action, after }
  }
  return null
}

/**
 * 「走不通的方向」：方向盘游戏用它做非法输入。
 *
 * 每个方向都从**同一局面**试：走通了就撤销回来（顺带验证撤销的精确性），
 * 四个方向都能走就随便走一步再来一轮 —— 不改变局面地试是撞不到墙的。
 */
async function findBlockedDir() {
  for (let round = 0; round < 8; round++) {
    for (const dir of dirs) {
      const before = await snap()
      await clickAction({ t: 'dpad', dir })
      const after = await snap()
      if (contentSig(after) === contentSig(before)) {
        console.log(`    · 第 ${round + 1} 轮方向 ${dir}：走不通，提示「${after.notice}」`)
        return { dir, before, after }
      }
      await clickUndo()
      const back = await snap()
      if (contentSig(back) !== contentSig(before)) {
        console.log(`    · 撤销 ${dir} 后局面与走之前不一致（撤销不精确？）`)
      }
    }
    await clickAction({ t: 'dpad', dir: dirs[round % 4] })
  }
  return null
}

async function runGame(id, driver) {
  console.log(`\n=== ${driver.title}（${id}） ===`)
  const shot = (name) => `${SHOT_DIR}/${id}-${name}.png`

  await startGame(driver.title, { fresh: true })
  let initial = await snap()
  const L = await layout()
  record(id, '能进对局（格子数 > 0）', L.cellCount > 0, `格子 ${L.cellCount}，尺寸 ${L.cellSize}px`)
  record(
    id,
    '棋盘完整落在棋盘区内（四边溢出量不为正）',
    L.margins !== null && L.margins.top <= 1 && L.margins.bottom <= 1 && L.margins.left <= 1 && L.margins.right <= 1,
    `溢出量 ${JSON.stringify(L.margins)}（负数=棋盘在区内）`,
  )
  record(id, '棋盘在屏内', L.boardRect.t >= -1 && L.boardRect.b <= VH + 1 && L.boardRect.l >= -1 && L.boardRect.r <= VW + 1, `board=${JSON.stringify(L.boardRect)}`)
  record(id, '无屏外按钮', L.offButtons.length === 0 && L.offX.length === 0, [...L.offButtons, ...L.offX].join(','))
  record(id, '无缺键 ⟦', !L.missing)
  record(id, '统计栏无截断', L.clipped.length === 0, L.clipped.join(' | '))
  record(id, '无动画/过渡', L.animations === 0 && L.animated === 0, `getAnimations=${L.animations}，带过渡元素=${L.animated}`)

  const clip = L.areaRect
    ? {
        x: Math.max(0, L.areaRect.l),
        y: Math.max(0, L.areaRect.t),
        width: Math.max(1, Math.min(L.areaRect.w, VW - Math.max(0, L.areaRect.l))),
        height: Math.max(1, Math.min(L.areaRect.h, VH - Math.max(0, L.areaRect.t))),
      }
    : undefined
  await page.screenshot({ path: shot('board'), ...(clip ? { clip } : {}) })
  const px = pixelStats(shot('board'))
  record(id, '1-bit：无灰阶块', px.grayBlocks === 0 && px.gray < 0.25, `黑 ${(px.black * 100).toFixed(1)}% 白 ${(px.white * 100).toFixed(1)}% 灰 ${(px.gray * 100).toFixed(2)}% 灰块 ${px.grayBlocks}（最灰块 ${(px.worstBlock * 100).toFixed(0)}%）`)

  // ---- 真的能玩：3 次有效操作 ----
  const moves = []
  let cursor = initial
  for (let step = 0; step < 5 && moves.length < 3; step++) {
    const played = await playValidMove(driver, cursor, step)
    if (!played) break
    moves.push(played)
    cursor = played.after
    if (played.after.result) {
      // 不小心过关了：对关卡制游戏回到本关起点，继续测剩下的检查
      await confirmRestart()
      cursor = await snap()
      initial = cursor
    }
  }
  record(id, '至少 3 次有效操作且局面真的变化', moves.length >= 3, `有效操作 ${moves.length} 次`)

  // ---- 非法输入：明确反馈 + 局面不变 ----
  if (driver.invalid === 'auto-dpad' || driver.invalid === undefined) {
    // 方向盘：四向里总有一个走不通（推箱子/数字华容道/2048）
    const blocked = await findBlockedDir()
    if (!blocked) {
      record(id, '非法输入有明确反馈且局面不变', false, '四个方向全部可走，找不到非法输入')
    } else {
      const after = await snap()
      record(
        id,
        '非法输入有明确反馈且局面不变',
        after.notice.length > 0 && contentSig(after) === contentSig(blocked.before),
        `方向 ${blocked.dir}：提示「${after.notice}」，局面${contentSig(after) === contentSig(blocked.before) ? '未变' : '变了'}`,
      )
    }
  } else if (typeof driver.invalid === 'function') {
    const before = await snap()
    const action = driver.invalid(before)
    if (!action) {
      record(id, '非法输入有明确反馈且局面不变', 'na', '当前局面找不到可构造的非法输入')
    } else {
      await clickAction(action)
      const after = await snap()
      const sameContent = contentSig(after) === contentSig(before)
      const sameSelection = selectedOf(after) === selectedOf(before)
      record(
        id,
        '非法输入有明确反馈且局面不变',
        after.notice.length > 0 && sameContent,
        `提示「${after.notice || '（无）'}」，局面${sameContent ? '未变' : '变了'}` +
          (sameContent && !sameSelection ? '（只有选中态移动，属光标不算局面）' : ''),
      )
    }
  } else {
    record(id, '非法输入有明确反馈且局面不变', 'na', driver.invalidNa ?? '该玩法不存在非法输入')
  }

  // ---- 键盘方向键：没有方向键的玩法不该弹出假错误 ----
  {
    const hasDpad = (await page.locator('.eink-dpad').count()) > 0
    if (!hasDpad) {
      const before = await snap()
      await page.keyboard.press('ArrowLeft')
      await page.waitForTimeout(SETTLE)
      const after = await snap()
      record(
        id,
        '无方向键玩法按方向键不弹假提示',
        after.notice.length === 0 && contentSig(after) === contentSig(before),
        `提示「${after.notice || '（无）'}」`,
      )
    }
  }

  // ---- 撤销 ----
  if (driver.undoHidden) {
    record(id, '撤销按钮由 disabled 变可用', 'na', driver.undoHidden)
    record(id, '撤销后逐格 + 统计回到上一步', 'na', driver.undoHidden)
  } else {
    const before = await snap()
    /*
     * 一次「撤销」= 一次尝试：记忆配对的一次尝试是**两张牌**（规则层如此定义，
     * 单张时撤销只退回那一张），所以它要先走两步再撤。
     */
    let cursor = before
    let ok = true
    for (let k = 0; k < (driver.undoClicks ?? 1); k++) {
      const played = await playValidMove(driver, cursor, k)
      if (!played) { ok = false; break }
      cursor = played.after
    }
    if (!ok) {
      record(id, '撤销按钮由 disabled 变可用', false, '找不到可撤销的有效操作')
    } else {
      const btn = undoButton()
      const enabled = (await btn.count()) > 0 && !(await btn.first().isDisabled())
      record(id, '撤销按钮由 disabled 变可用', enabled, (await btn.count()) ? '' : '找不到撤销按钮')
      if (enabled) {
        await clickUndo()
        const back = await snap()
        const sameContent = contentSig(back) === contentSig(before)
        const sameSelection = selectedOf(back) === selectedOf(before)
        record(
          id,
          '撤销后逐格 + 统计回到上一步',
          sameContent,
          sameContent
            ? sameSelection ? '' : '（选中态留在原处，规则层明确「撤销不撤回选中」）'
            : `期望 ${contentSig(before).slice(0, 160)}… 实得 ${contentSig(back).slice(0, 160)}…`,
        )
      } else {
        record(id, '撤销后逐格 + 统计回到上一步', false, '撤销按钮不可用，无法验证')
      }
    }
  }

  // ---- 重新开始 ----
  {
    const beforeRestart = await snap()
    const played = await playValidMove(driver, beforeRestart, 1)
    const movedSnap = played ? played.after : beforeRestart
    const timerBefore = timerOf(movedSnap)
    const seedBefore = await readSeed()
    await confirmRestart()
    const after = await snap()
    const seedAfter = await readSeed()
    if (driver.level) {
      const sameLevel = after.title === initial.title
      record(id, '重新开始留在同一关', sameLevel, `${initial.title} → ${after.title}`)
      record(
        id,
        '重新开始回到本关初始局面',
        contentSig(after) === contentSig(initial),
        contentSig(after) === contentSig(initial) ? '' : '局面与进入本关时不一致',
      )
      /*
       * 本关用时：重开 = 本关重新开始，计时也应当从 0 起算。
       * 这里只记录实测数字（不直接判失败），因为「用时是否跨重开累计」是产品口径问题，
       * 但重开后显示 0:09（=重开前的总时长）与「本关用时」这个标签是矛盾的。
       */
      const timerAfter = timerOf(after)
      if (timerAfter !== null && timerBefore !== null) {
        record(
          id,
          '重新开始后「本关用时」从 0 起算',
          timerAfter <= 3,
          `重开前 ${timerBefore}s → 重开后 ${timerAfter}s（标签为「本关用时」）`,
        )
      }
    } else {
      const changed = contentSig(after) !== contentSig(movedSnap)
      record(id, '重新开始换了题目（棋盘内容不同）', changed, changed ? '' : '重开后棋盘与重开前完全相同')
      const seedChanged = seedBefore !== null && seedAfter !== null && seedBefore !== seedAfter
      record(
        id,
        '重新开始换了种子（存档 seed 变化）',
        seedChanged,
        `seed ${seedBefore} → ${seedAfter}`,
      )
    }
  }

  // ---- 离局再进（存档） ----
  {
    const played = await playValidMove(driver, await snap(), 1)
    const before = played ? played.after : await snap()
    await backToLibrary()
    await startGame(driver.title, { fresh: false })
    const after = await snap()
    record(
      id,
      '离局再进进度还在',
      contentSig(after) === contentSig(before),
      contentSig(after) === contentSig(before)
        ? ''
        : `离开前 ${contentSig(before).slice(0, 160)}… 回来 ${contentSig(after).slice(0, 160)}…`,
    )
  }
}

/* ---------------- 主流程 ---------------- */
await gotoLibrary()
await page.evaluate(async (scale) => {
  const p = window.__einkPlatform
  const s = await p.storage.loadSettings()
  await p.storage.saveSettings({ ...s, fontScale: scale })
}, FONT_SCALE)
await page.reload({ waitUntil: 'networkidle' })
await page.waitForSelector('.eink-tile', { timeout: 15000 })
await page.waitForTimeout(600)
const rootFont = await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)
console.log(`[${TAG}] 根字号 ${rootFont}，地址 ${WEB_URL}`)

// 首页不滚动（26px 档的要求之一）
{
  const home = await page.evaluate(() => {
    const content = document.querySelector('.eink-screen__content')
    return {
      doc: document.documentElement.scrollHeight - document.documentElement.clientHeight,
      content: content ? content.scrollHeight - content.clientHeight : null,
      tiles: document.querySelectorAll('.eink-tile').length,
    }
  })
  record('library', `首页不滚动（根字号 ${rootFont}）`, home.doc <= 1 && (home.content === null || home.content <= 1), JSON.stringify(home))
}

const ids = Object.keys(DRIVERS).filter((id) => (ONLY ? ONLY.has(id) : true))
for (const id of ids) {
  try {
    await runGame(id, DRIVERS[id])
  } catch (error) {
    record(id, '巡检流程未抛错', false, String(error).slice(0, 200))
  }
}

console.log(`\n=== 控制台错误：${consoleErrors.length} ===`)
for (const e of consoleErrors.slice(0, 8)) console.log('  ! ' + e)
record('console', '无控制台错误 / pageerror', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))

const failed = results.filter((r) => r.ok === false)
console.log(`\n=== [${TAG}] 小结：${results.filter((r) => r.ok === true).length} 通过 / ${failed.length} 失败 / ${results.filter((r) => r.ok === 'na').length} 不适用 ===`)
for (const f of failed) console.log(`  ✗ [${f.game}] ${f.check}  ${f.detail ?? ''}`)

writeFileSync(
  REPORT,
  JSON.stringify({ tag: TAG, url: WEB_URL, rootFont, results, consoleErrors, at: new Date().toISOString() }, null, 2),
)
console.log(`报告：${REPORT}`)
await browser.close()
process.exit(0)
