/**
 * 墨水屏「打击感」动图：场景绘制 + 逐帧导出。
 *
 * 三条硬约束决定了这里的画法（都来自 docs/refresh-adaptation.md 与 docs/eink-guidelines.md）：
 *   1. 纯黑白：整帧最后按亮度阈值二值化，不留任何抗锯齿灰（灰度在快刷下会被压平/起噪点）；
 *   2. 一个动图帧 = 面板一次刷新（≈250ms）：GIF 的帧就是面板的刷新槽，不画"中间帧"；
 *   3. 打击感只能来自「对比度 + 时间」：反色 / 位移 / 破碎 / 定格（重复同一帧，面板零刷新）。
 *
 * 因此每个场景都要回答一个问题：**这次冲击用掉几个刷新槽、每槽画什么**。
 * 定格槽在 GIF 里就是重复帧 —— 观感是"停住了"，代价是面板一次都不刷。
 */
;(function (root) {
  'use strict'

  const W = 440
  const H = 316
  const S = 2 // 输出 880×632，最近邻放大，仍是硬边 1-bit
  const BLACK = '#000000'
  const WHITE = '#ffffff'
  const FONT = '"WenQuanYi Zen Hei","Noto Sans CJK SC","Source Han Sans SC",sans-serif'
  const STAGE = { x: 12, y: 34, w: 416, h: 214 }
  const SLOT_MS = 250 // 面板一次快刷的乐观值（整屏全刷约 500ms）

  const canvas = document.createElement('canvas')
  canvas.width = W * S
  canvas.height = H * S
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.scale(S, S)

  // ---------- 绘制原语（一律整数坐标、硬边） ----------
  const fill = (x, y, w, h, color = BLACK) => {
    ctx.fillStyle = color
    ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h))
  }
  const box = (x, y, w, h, lw = 2, color = BLACK) => {
    ctx.strokeStyle = color
    ctx.lineWidth = lw
    ctx.strokeRect(x + lw / 2, y + lw / 2, w - lw, h - lw)
  }
  const line = (x1, y1, x2, y2, lw = 3) => {
    ctx.strokeStyle = BLACK
    ctx.lineWidth = lw
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()
  }
  const text = (s, x, y, o = {}) => {
    const { size = 12, weight = 700, align = 'left', color = BLACK } = o
    ctx.font = `${weight} ${size}px ${FONT}`
    ctx.fillStyle = color
    ctx.textAlign = align
    ctx.fillText(s, x, y)
    ctx.textAlign = 'left'
  }
  /** 区域反色：difference 与白色合成 = 逐像素取反，剪影/线宽全部保留 */
  const invert = (x, y, w, h) => {
    ctx.save()
    ctx.globalCompositeOperation = 'difference'
    ctx.fillStyle = WHITE
    ctx.fillRect(x, y, w, h)
    ctx.restore()
  }
  /** 抖动网点：1-bit 上表达"灰"的唯一办法 —— 残影、破碎块都用它 */
  const dither = (x, y, w, h, o = {}) => {
    const { step = 3, mode = 'checker' } = o
    ctx.fillStyle = BLACK
    for (let j = 0; j < h; j += step) {
      for (let i = 0; i < w; i += step) {
        const on = mode === 'checker' ? (i / step + j / step) % 2 === 0 : (i / step * 2 + j / step) % 3 === 0
        if (on) fill(x + i, y + j, Math.min(step, w - i), Math.min(step, h - j))
      }
    }
  }
  /** 冲击线：从中心向外的粗放射线 */
  const burst = (cx, cy, r0, r1, n = 10, lw = 5, color = BLACK) => {
    ctx.strokeStyle = color
    ctx.lineWidth = lw
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + 0.25
      ctx.beginPath()
      ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0)
      ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1)
      ctx.stroke()
    }
  }
  const diamond = (cx, cy, r) => {
    ctx.fillStyle = BLACK
    ctx.beginPath()
    ctx.moveTo(cx, cy - r)
    ctx.lineTo(cx + r, cy)
    ctx.lineTo(cx, cy + r)
    ctx.lineTo(cx - r, cy)
    ctx.closePath()
    ctx.fill()
  }
  const disc = (cx, cy, r, color = BLACK) => {
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fill()
  }
  const ring = (cx, cy, r, lw = 4) => {
    ctx.strokeStyle = BLACK
    ctx.lineWidth = lw
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.stroke()
  }
  const poly = (pts) => {
    ctx.fillStyle = BLACK
    ctx.beginPath()
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
    ctx.closePath()
    ctx.fill()
  }
  const hatch = (x, y, w, h) => {
    ctx.save()
    ctx.beginPath()
    ctx.rect(x, y, w, h)
    ctx.clip()
    ctx.strokeStyle = WHITE
    ctx.lineWidth = 2
    for (let i = -h; i < w; i += 6) {
      ctx.beginPath()
      ctx.moveTo(x + i, y + h)
      ctx.lineTo(x + i + h, y)
      ctx.stroke()
    }
    ctx.restore()
  }

  // ---------- 棋盘通用 ----------
  const cellOf = (b, c, r, inset = 0) => [b.x + c * b.cell + inset, b.y + r * b.cell + inset, b.cell - inset * 2, b.cell - inset * 2]
  const drawGrid = (b, lw = 2) => {
    for (let r = 0; r < b.rows; r++) for (let c = 0; c < b.cols; c++) box(b.x + c * b.cell, b.y + r * b.cell, b.cell, b.cell, lw)
  }
  const drawCells = (b, cells, inset = 3) => {
    for (const [c, r] of cells) {
      const [x, y, w, h] = cellOf(b, c, r, inset)
      fill(x, y, w, h)
    }
  }

  // ---------- ① 反色闪帧（贪吃蛇吃到食物） ----------
  const SB = { cols: 8, rows: 5, cell: 34, x: 84, y: 62 }
  const snakePanel = (o) => {
    text(`得分 ${o.score}`, 24, 52, { size: 13 })
    text(`长度 ${o.body.length}`, 416, 52, { size: 13, align: 'right' })
    drawGrid(SB)
    if (o.food) {
      const [x, y, w, h] = cellOf(SB, o.food[0], o.food[1], 6)
      diamond(x + w / 2, y + h / 2, w / 2)
    }
    if (o.burst) {
      const [x, y, w, h] = cellOf(SB, o.burst[0], o.burst[1], 0)
      burst(x + w / 2, y + h / 2, 12, 42, 8, 5)
    }
    drawCells(SB, o.body)
    if (o.plus === 'small') text('+1', 416, 74, { size: 18, weight: 800, align: 'right' })
    if (o.plus === 'big') text('+1', 416, 118, { size: 46, weight: 800, align: 'right' })
    if (o.invert) invert(STAGE.x, STAGE.y, STAGE.w, STAGE.h)
  }

  // ---------- ② 定格（俄罗斯方块消行） ----------
  const TB = { cols: 10, rows: 6, cell: 26, x: 90, y: 62 }
  const STACK = [
    [0, 4], [1, 4], [2, 4], [6, 4], [7, 4],
    [2, 3], [7, 3],
  ]
  const rowCells = (r) => Array.from({ length: TB.cols }, (_, c) => [c, r])
  const tetrisPanel = (o) => {
    text(`得分 ${o.score}`, 24, 52, { size: 13 })
    text(`消行 ${o.lines}`, 416, 52, { size: 13, align: 'right' })
    drawGrid(TB)
    drawCells(TB, o.cells)
    if (o.done) {
      // 满行本身就是一条黑带：文字直接写在黑带上（白字），不要再去反色那一格
      const rowY = TB.y + 5 * TB.cell
      const rowW = TB.cols * TB.cell
      text('消行 +800', TB.x + rowW / 2, rowY + 18, { size: 15, weight: 800, align: 'center', color: WHITE })
    }
    if (o.plus) text('+800', 416, 92, { size: 30, weight: 800, align: 'right' })
  }

  // ---------- ③ 震屏 + 冲击线（恶魔轮盘赌开枪） ----------
  const TARGET = { x: 300, y: 132 }
  const gunPanel = (o) => {
    // 枪：枪管朝右、转轮 + 握把 + 击锤（剪影要能一眼认出是枪，不然"开枪"这个事件就不成立）
    fill(40, 120, 152, 26) // 枪管
    fill(40, 104, 18, 18) // 击锤
    disc(92, 146, 22) // 转轮
    fill(82, 136, 7, 7, WHITE)
    fill(96, 142, 7, 7, WHITE)
    fill(86, 154, 7, 7, WHITE)
    poly([[66, 156], [112, 156], [98, 214], [50, 214]]) // 握把
    line(186, 114, 186, 152, 4) // 枪口
    line(194, 114, 194, 152, 4)
    // 靶
    ring(TARGET.x, TARGET.y, 58, 5)
    ring(TARGET.x, TARGET.y, 40, 5)
    ring(TARGET.x, TARGET.y, 22, 5)
    if (o.aim) {
      line(TARGET.x - 74, TARGET.y, TARGET.x - 46, TARGET.y, 2)
      line(TARGET.x + 46, TARGET.y, TARGET.x + 74, TARGET.y, 2)
      line(TARGET.x, TARGET.y - 74, TARGET.x, TARGET.y - 46, 2)
      line(TARGET.x, TARGET.y + 46, TARGET.x, TARGET.y + 74, 2)
    }
    if (o.hit) {
      burst(TARGET.x, TARGET.y, 26, o.spread, o.rays, o.lw)
      disc(TARGET.x, TARGET.y, o.hole)
      if (o.cracks) {
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2 + 0.4
          line(
            TARGET.x + Math.cos(a) * (o.hole + 4),
            TARGET.y + Math.sin(a) * (o.hole + 4),
            TARGET.x + Math.cos(a) * (o.hole + 34),
            TARGET.y + Math.sin(a) * (o.hole + 34),
            4,
          )
        }
      }
    }
    text(o.label, 24, 60, { size: o.labelSize ?? 14, weight: 800 })
    text(o.hint ?? '', 24, 82, { size: 12, weight: 400 })
  }

  // ---------- ④ 残影拖尾（贪吃蛇冲刺） ----------
  const GB = { cols: 10, rows: 5, cell: 34, x: 50, y: 62 }
  const ghostPanel = (o) => {
    text(o.caption, GB.x, 52, { size: 13 })
    text('长度 6', GB.x + GB.cols * GB.cell, 52, { size: 13, align: 'right' })
    drawGrid(GB)
    for (const [c, r] of o.ghosts || []) {
      const [x, y, w, h] = cellOf(GB, c, r, 3)
      dither(x, y, w, h, { step: 3, mode: 'checker' })
      box(x, y, w, h, 2)
    }
    drawCells(GB, o.body)
  }

  // ---------- ⑤ 整屏闪黑（大招） ----------
  const BOSS = { x: 300, y: 122 }
  const bossPanel = (o) => {
    // 血条
    box(30, 46, 380, 18, 3)
    fill(34, 50, Math.round(372 * o.hp), 10)
    if (o.hp === 0) {
      line(396, 50, 408, 62, 4)
      line(408, 50, 396, 62, 4)
    }
    if (o.tight) box(20, 42, 400, 200, 10)
    if (o.hit) burst(BOSS.x, BOSS.y, 44, 118, 10, 6) // 冲击线画在碎片**下面**，否则两层噪声叠一起看不清
    if (o.debris) {
      // 破碎：马赛克块（1-bit 上"半透明碎片"只能靠抖动表达）
      const blocks = [[250, 78, 26, 22], [286, 70, 30, 26], [326, 82, 22, 20], [262, 112, 30, 24], [306, 104, 34, 28], [352, 118, 24, 22], [276, 148, 26, 22], [320, 146, 30, 24], [360, 152, 18, 18]]
      for (const [x, y, w, h] of blocks) {
        dither(x, y, w, h, { step: 3, mode: 'checker' })
        box(x, y, w, h, 2)
      }
    } else {
      poly([[264, 96], [252, 60], [286, 84]]) // 左角
      poly([[336, 96], [348, 60], [314, 84]]) // 右角
      disc(BOSS.x, BOSS.y, 46)
      poly([[238, 232], [362, 232], [330, 164], [270, 164]])
      fill(276, 108, 16, 14, WHITE)
      fill(310, 108, 16, 14, WHITE)
      line(288, 146, 312, 146, 4)
    }
    if (o.hit) text('击破!', 30, 104, { size: 30, weight: 800 })
    if (o.label && !o.hit) text(o.label, 30, 96, { size: o.labelSize ?? 14, weight: 800 })
    if (o.damage) text(o.damage, 30, 150, { size: 34, weight: 800 })
    // 玩家剪影
    disc(78, 176, 12)
    poly([[56, 232], [100, 232], [94, 190], [62, 190]])
  }

  // ---------- ⑥ 对比（消消乐三连） ----------
  const CB = { cols: 5, rows: 4, cell: 28 }
  const BASE_TILES = [[0, 0], [3, 1], [4, 3], [0, 3]]
  const MATCH = [[1, 2], [2, 2], [3, 2]]
  const matchPanel = (boxRect, o) => {
    const b = { ...CB, x: boxRect.x + (boxRect.w - CB.cols * CB.cell) / 2, y: boxRect.y + 22 }
    drawGrid(b, 2)
    drawCells(b, BASE_TILES, 3)
    if (o.state === 'wait') drawCells(b, MATCH, 3)
    if (o.state === 'flash') {
      // 反色只盖住"这三格"：从第 1 格起横跨 3 格、只有一行高
      const [fx, fy] = cellOf(b, 1, 2, 0)
      invert(fx, fy, 3 * CB.cell, CB.cell)
      for (const [c, r] of MATCH) {
        const [tx, ty, tw, th] = cellOf(b, c, r, 3)
        box(tx, ty, tw, th, 3, WHITE) // 白描边：反色之后还要能看出"是哪三格"
      }
    }
    if (o.state === 'gone') {
      if (o.burst) burst(b.x + 2.5 * CB.cell, b.y + 2.5 * CB.cell, 16, 42, 8, 4)
      // 大数字写在棋盘下方那一行（写在棋盘右上会压住格子）
      if (o.big) text('+120', boxRect.x + boxRect.w / 2, boxRect.y + 212, { size: 22, weight: 800, align: 'center' })
      else if (o.score) text('得分 120', boxRect.x + 10, boxRect.y + 212, { size: 12, weight: 400 })
    }
    if (o.state !== 'gone' && o.score) text('得分 120', boxRect.x + 10, boxRect.y + 212, { size: 12, weight: 400 })
  }

  // ---------- 场景表 ----------
  const F = (tag, o) => ({ tag, delayMs: SLOT_MS, ...o })
  const N = (o = {}) => F('normal', o)
  const IMP = (o = {}) => F('impact', o)
  const HOLD = (o = {}) => F('hold', o)
  const FULL = (o = {}) => F('full', o)

  const scenes = [
    {
      id: 'invert-flash',
      file: '01-invert-flash.gif',
      title: '① 反色闪帧 · 吃食物',
      note: '整块棋盘黑白互换：1-bit 上能做出来的最大对比跳变。',
      frames: [
        N({ draw: () => snakePanel({ body: [[0, 2], [1, 2], [2, 2]], food: [3, 2], score: 12 }) }),
        IMP({ draw: () => snakePanel({ body: [[0, 2], [1, 2], [2, 2], [3, 2]], score: 13, plus: 'small' }) }),
        IMP({ draw: () => snakePanel({ body: [[0, 2], [1, 2], [2, 2], [3, 2]], score: 13, burst: [3, 2], invert: true }) }),
        HOLD({ draw: () => snakePanel({ body: [[0, 2], [1, 2], [2, 2], [3, 2]], score: 13, burst: [3, 2], invert: true }) }),
        IMP({ draw: () => snakePanel({ body: [[0, 2], [1, 2], [2, 2], [3, 2]], score: 13, burst: [3, 2], plus: 'big' }) }),
        N({ draw: () => snakePanel({ body: [[0, 2], [1, 2], [2, 2], [3, 2]], score: 13 }) }),
        N({ draw: () => snakePanel({ body: [[0, 2], [1, 2], [2, 2], [3, 2]], score: 13 }) }),
      ],
    },
    {
      id: 'hold',
      file: '02-hold.gif',
      title: '② 定格 · 消行',
      note: '撞击帧保持 3 格：面板一次都没刷，观感却是重击。',
      frames: [
        N({ draw: () => tetrisPanel({ cells: [...STACK, [9, 1], [9, 2], [9, 3], [9, 4]], score: 1200, lines: 3 }) }),
        IMP({ draw: () => tetrisPanel({ cells: [...STACK, ...rowCells(5), [9, 2], [9, 3], [9, 4], [9, 5]], score: 1200, lines: 3, done: true }) }),
        HOLD({ draw: () => tetrisPanel({ cells: [...STACK, ...rowCells(5), [9, 2], [9, 3], [9, 4], [9, 5]], score: 1200, lines: 3, done: true }) }),
        HOLD({ draw: () => tetrisPanel({ cells: [...STACK, ...rowCells(5), [9, 2], [9, 3], [9, 4], [9, 5]], score: 1200, lines: 3, done: true }) }),
        IMP({ draw: () => tetrisPanel({ cells: [[0, 5], [1, 5], [2, 5], [6, 5], [7, 5], [2, 4], [7, 4], [9, 3], [9, 4], [9, 5]], score: 2000, lines: 4, plus: true }) }),
        N({ draw: () => tetrisPanel({ cells: [[0, 5], [1, 5], [2, 5], [6, 5], [7, 5], [2, 4], [7, 4], [9, 3], [9, 4], [9, 5]], score: 2000, lines: 4 }) }),
        N({ draw: () => tetrisPanel({ cells: [[0, 5], [1, 5], [2, 5], [6, 5], [7, 5], [2, 4], [7, 4], [9, 3], [9, 4], [9, 5]], score: 2000, lines: 4 }) }),
      ],
    },
    {
      id: 'slam',
      file: '03-slam-burst.gif',
      title: '③ 震屏 + 冲击线 · 开枪',
      note: '±8px 位移占 2 格：位移本身就是打击感，不需要动画。',
      frames: [
        N({ draw: () => gunPanel({ aim: true, label: '瞄准' }) }),
        IMP({ offset: [8, 6], draw: () => gunPanel({ hit: true, hole: 28, spread: 150, rays: 12, lw: 7, label: '实弹', labelSize: 26 }) }),
        IMP({ offset: [-6, -4], draw: () => gunPanel({ hit: true, hole: 24, spread: 110, rays: 10, lw: 6, label: '实弹', labelSize: 26 }) }),
        IMP({ draw: () => gunPanel({ hit: true, hole: 30, cracks: true, spread: 76, rays: 8, lw: 5, label: '实弹', labelSize: 26 }) }),
        HOLD({ draw: () => gunPanel({ hit: true, hole: 30, cracks: true, spread: 76, rays: 8, lw: 5, label: '实弹', labelSize: 26 }) }),
        HOLD({ draw: () => gunPanel({ hit: true, hole: 30, cracks: true, spread: 76, rays: 8, lw: 5, label: '实弹', labelSize: 26 }) }),
      ],
    },
    {
      id: 'ghost-trail',
      file: '04-ghost-trail.gif',
      title: '④ 残影拖尾 · 冲刺',
      note: '残影清不干净就拿来当拖尾；每 4 格插一次全刷收干净。',
      frames: [
        N({ draw: () => ghostPanel({ body: [[1, 2], [2, 2], [3, 2]], ghosts: [], caption: '得分 240' }) }),
        IMP({ draw: () => ghostPanel({ body: [[2, 2], [3, 2], [4, 2]], ghosts: [[1, 2]], caption: '得分 240' }) }),
        IMP({ draw: () => ghostPanel({ body: [[3, 2], [4, 2], [5, 2]], ghosts: [[1, 2], [2, 2]], caption: '得分 240' }) }),
        IMP({ draw: () => ghostPanel({ body: [[4, 2], [5, 2], [6, 2]], ghosts: [[1, 2], [2, 2], [3, 2]], caption: '得分 240' }) }),
        HOLD({ draw: () => ghostPanel({ body: [[4, 2], [5, 2], [6, 2]], ghosts: [[1, 2], [2, 2], [3, 2]], caption: '得分 240' }) }),
        FULL({ fullCanvas: true, draw: () => {} }),
        N({ draw: () => ghostPanel({ body: [[4, 2], [5, 2], [6, 2]], ghosts: [], caption: '全刷后：残影已清' }) }),
        N({ draw: () => ghostPanel({ body: [[4, 2], [5, 2], [6, 2]], ghosts: [], caption: '全刷后：残影已清' }) }),
      ],
    },
    {
      id: 'black-flash',
      file: '05-black-flash.gif',
      title: '⑤ 整屏闪黑 · 大招',
      note: '整屏纯黑 1 格：面板能做的最响的一下，成本只是一次刷新。',
      frames: [
        N({ draw: () => bossPanel({ hp: 0.7, label: '对峙' }) }),
        N({ draw: () => bossPanel({ hp: 0.7, label: '蓄力', labelSize: 20, tight: true }) }),
        FULL({ fullCanvas: true, draw: () => {} }),
        IMP({ draw: () => { bossPanel({ hp: 0.7, debris: true, hit: true }); invert(STAGE.x, STAGE.y, STAGE.w, STAGE.h) } }),
        HOLD({ draw: () => { bossPanel({ hp: 0.7, debris: true, hit: true }); invert(STAGE.x, STAGE.y, STAGE.w, STAGE.h) } }),
        IMP({ draw: () => bossPanel({ hp: 0, debris: true, damage: '9999' }) }),
        HOLD({ draw: () => bossPanel({ hp: 0, debris: true, damage: '9999' }) }),
      ],
    },
    {
      id: 'compare',
      file: '06-compare.gif',
      title: '⑥ 对比 · 同一事件',
      note: '同一事件：左边一次状态变化就过去了，右边三层反馈。',
      custom: true,
      frames: [
        { tag: 'normal', delayMs: SLOT_MS },
        { tag: 'impact', delayMs: SLOT_MS },
        { tag: 'hold', delayMs: SLOT_MS },
        { tag: 'impact', delayMs: SLOT_MS },
        { tag: 'hold', delayMs: SLOT_MS },
        { tag: 'normal', delayMs: SLOT_MS },
      ],
      drawSide: (i, side) => {
        const A = { x: 12, y: 34, w: 202, h: 168 }
        const B = { x: 226, y: 34, w: 202, h: 168 }
        const rect = side === 'left' ? A : B
        if (side === 'left') {
          const o = i === 0 ? { state: 'wait' } : { state: 'gone', score: true }
          matchPanel(rect, o)
        } else {
          const map = [
            { state: 'wait' },
            { state: 'flash' },
            { state: 'flash' },
            { state: 'gone', burst: true, big: true, score: true },
            { state: 'gone', big: true, score: true },
            { state: 'gone', score: true },
          ]
          matchPanel(rect, map[i])
        }
      },
    },
  ]

  // ---------- 排版chrome：标题 / 舞台 / 标尺 / 图例 ----------
  function ruler(scene, i) {
    const n = scene.frames.length
    const gap = 2
    const w = Math.floor((STAGE.w - (n - 1) * gap) / n)
    const y = 256
    const h = 15
    for (let k = 0; k < n; k++) {
      const x = STAGE.x + k * (w + gap)
      const tag = scene.frames[k].tag
      if (tag === 'impact') fill(x, y, w, h)
      else if (tag === 'full') {
        fill(x, y, w, h)
        fill(x + w / 2 - 3, y + h / 2 - 3, 6, 6, WHITE)
      } else if (tag === 'hold') {
        fill(x, y, w, h)
        hatch(x, y, w, h)
      } else box(x, y, w, h, 2)
      if (k === i) fill(x, y + h + 3, w, 3)
    }
    // 标尺说明 + 图例：按实测文字宽度排版（中文宽度随字号变，按字符数估算就会叠字）
    const scale = '每格 = 面板一次快刷 ≈250ms'
    text(scale, STAGE.x, 292, { size: 11, weight: 400 })
    const sw = 12
    const items = [
      ['impact', '撞击'],
      ['hold', '定格'],
      ['full', '全刷'],
    ]
    ctx.font = `400 11px ${FONT}`
    const widths = items.map(([, s]) => sw + 4 + ctx.measureText(s).width)
    const gapX = 12
    let lx = W - 12 - (widths.reduce((a, b) => a + b, 0) + gapX * (items.length - 1))
    const lx0 = lx
    const ly = 283
    items.forEach(([kind, s], k) => {
      if (kind === 'hold') {
        fill(lx, ly, sw, 10)
        hatch(lx, ly, sw, 10)
      } else if (kind === 'full') {
        fill(lx, ly, sw, 10)
        fill(lx + 3, ly + 3, 6, 4, WHITE)
      } else fill(lx, ly, sw, 10)
      text(s, lx + sw + 4, ly + 10, { size: 11, weight: 400 })
      lx += widths[k] + gapX
    })
    const used = STAGE.x + ctx.measureText(scale).width
    if (used > lx0 - 8) throw new Error(`标尺说明与图例重叠：说明到 ${Math.round(used)}，图例从 ${Math.round(lx0)} 开始`)
  }

  function drawFrame(scene, i) {
    const f = scene.frames[i]
    fill(0, 0, W, H, WHITE)
    text(scene.title, 12, 25, { size: 18, weight: 800 })
    text('1 格 ≈ 250ms · 纯黑白', W - 12, 23, { size: 11, weight: 400, align: 'right' })
    if (scene.custom) {
      scene.drawSide(i, 'left')
      scene.drawSide(i, 'right')
      box(12, 34, 202, 168, 3)
      box(226, 34, 202, 168, 3)
      text('现在：变化即过', 12, 218, { size: 13, weight: 800 })
      text('打击感：闪 + 停 + 大数字', 226, 218, { size: 13, weight: 800 })
    } else {
      fill(STAGE.x, STAGE.y, STAGE.w, STAGE.h, WHITE)
      ctx.save()
      ctx.beginPath()
      ctx.rect(STAGE.x, STAGE.y, STAGE.w, STAGE.h)
      ctx.clip()
      const [ox, oy] = f.offset || [0, 0]
      ctx.translate(ox, oy)
      f.draw()
      ctx.restore()
      box(STAGE.x, STAGE.y, STAGE.w, STAGE.h, 3)
    }
    ruler(scene, i)
    text(scene.note, 12, 310, { size: 13, weight: 400 })
    if (f.fullCanvas) fill(0, 0, W, H, BLACK)
  }

  /** 渲染 + 二值化：阈值 140 让字与线更实（墨水屏上比"标准 128"好看） */
  function renderFrame(scene, i) {
    drawFrame(scene, i)
    const img = ctx.getImageData(0, 0, W * S, H * S)
    const d = img.data
    const px = new Uint8Array(W * S * H * S)
    for (let p = 0, k = 0; p < d.length; p += 4, k++) {
      const lum = (d[p] * 299 + d[p + 1] * 587 + d[p + 2] * 114) / 1000
      const black = lum < 140
      px[k] = black ? 1 : 0
      const v = black ? 0 : 255
      d[p] = v
      d[p + 1] = v
      d[p + 2] = v
      d[p + 3] = 255
    }
    ctx.putImageData(img, 0, 0)
    return px
  }

  /** 逐像素往返校验：编成 GIF → 用浏览器 ImageDecoder 解回来 → 比对 */
  async function verify(scene) {
    const source = scene.frames.map((_, i) => renderFrame(scene, i))
    const gif = root.GIFEncoder.encode({
      width: W * S,
      height: H * S,
      frames: scene.frames.map((f, i) => ({ pixels: source[i], delayMs: f.delayMs })),
    })
    const dec = new root.ImageDecoder({ data: gif, type: 'image/gif' })
    await dec.tracks.ready
    await dec.completed
    const track = dec.tracks.selectedTrack ?? dec.tracks[0]
    // 解码器可能把"连续相同帧"合并成一帧（时长相加）→ 先把源序列压成 run 再比
    const runs = []
    for (let i = 0; i < scene.frames.length; i++) {
      const last = runs[runs.length - 1]
      if (last && samePixels(source[i], last.pixels)) last.ms += scene.frames[i].delayMs
      else runs.push({ pixels: source[i], ms: scene.frames[i].delayMs })
    }
    const probe = document.createElement('canvas')
    probe.width = W * S
    probe.height = H * S
    const pctx = probe.getContext('2d', { willReadFrequently: true })
    const decoded = []
    for (let i = 0; i < track.frameCount; i++) {
      const { image } = await dec.decode({ frameIndex: i })
      pctx.clearRect(0, 0, probe.width, probe.height)
      pctx.drawImage(image, 0, 0)
      const d = pctx.getImageData(0, 0, probe.width, probe.height).data
      const px = new Uint8Array(probe.width * probe.height)
      for (let p = 0, k = 0; p < d.length; p += 4, k++) px[k] = d[p] < 128 ? 1 : 0
      decoded.push({ pixels: px, ms: Math.round((image.duration ?? 0) / 1000) })
    }
    const mismatches = []
    if (decoded.length !== runs.length) mismatches.push(`帧数 ${decoded.length} ≠ 期望 ${runs.length}`)
    for (let i = 0; i < Math.min(decoded.length, runs.length); i++) {
      if (!samePixels(decoded[i].pixels, runs[i].pixels)) mismatches.push(`第 ${i} 帧像素不一致`)
      if (Math.abs(decoded[i].ms - runs[i].ms) > 10) mismatches.push(`第 ${i} 帧时长 ${decoded[i].ms}ms ≠ ${runs[i].ms}ms`)
    }
    return { ok: mismatches.length === 0, mismatches, bytes: gif.length, frames: scene.frames.length, slots: decoded.length }
  }

  const samePixels = (a, b) => {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
    return true
  }

  root.__JUICE__ = {
    W: W * S,
    H: H * S,
    list: () =>
      scenes.map((s) => ({
        id: s.id,
        file: s.file,
        title: s.title,
        note: s.note,
        frames: s.frames.length,
        slots: s.frames.map((f) => ({ tag: f.tag, delayMs: f.delayMs })),
      })),
    render(sceneId) {
      const scene = scenes.find((s) => s.id === sceneId)
      const frames = scene.frames.map((f, i) => ({ pixels: renderFrame(scene, i), delayMs: f.delayMs }))
      const bytes = root.GIFEncoder.encode({ width: W * S, height: H * S, frames })
      let s = ''
      for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
      return root.btoa(s)
    },
    verify: (sceneId) => verify(scenes.find((s) => s.id === sceneId)),
    /** 单帧 PNG（已二值化）——只用于排障时肉眼看一帧 */
    png(sceneId, i) {
      renderFrame(scenes.find((s) => s.id === sceneId), i)
      return canvas.toDataURL('image/png')
    },
    /** 把第 i 格画到目标 canvas 上（真机实测页逐格推进用，最近邻放大保持硬边） */
    paint(sceneId, i, target) {
      renderFrame(scenes.find((s) => s.id === sceneId), i)
      const t = target.getContext('2d')
      t.imageSmoothingEnabled = false
      t.clearRect(0, 0, target.width, target.height)
      t.drawImage(canvas, 0, 0, target.width, target.height)
    },
  }
})(window)
