/**
 * 牌桌渲染器（CardTableView → DOM，ES5 目标）。
 *
 * 与 React 版（packages/ui/src/CardTable.tsx）的关系：**语义逐条对齐**，只有布局手段不同。
 *   - 同样的两套布局，由 `table.piles` 选：给了且非空走牌堆布局（空当接龙），
 *     不给就走手牌布局（斗地主）——「缺省行为不变」这条保证照旧；
 *   - 同样按 `cards.length + hidden` 算一堆有几张（slots）；空堆给了 `id` 时，
 *     空位本身是**可点按钮**（「把 K 放到空列」「把 A 放进空基础堆」的唯一入口）；
 *   - 同样「数组第一张在最上层」（z-index = 槽位数 − i），所以牌列顶端那张明牌完整可见、可点；
 *   - 牌背只画斜纹、不用字符冒充；hidden 那几张没有 id、点不动，且 pointer-events:none，
 *     不挡住底下可点的牌。
 *
 * 布局为什么长这样：老 WebKit 没有 grid、没有现代 flex、没有 CSS 变量、没有容器查询，
 * 所以 React 版交给 CSS 的几何这里全部由 JS 按 ctx.width / ctx.height 算成 px：
 *   - 外层四行（左家 / 中央 / 右家 → 各家出的牌 / 提示 / 自家出的牌 → 手牌）用 <table> 排，
 *     这是这张引擎上唯一能保证「三列对齐、行高一致、不错行」的原语（与 board.ts 同一个理由）；
 *   - 手牌、一排小牌、牌堆里的牌都用 inline-block + 绝对定位，宽度逐张算好。
 * 公式与 React 版 CSS 一一对应，注释里给出出处，改的时候两边一起改。
 *
 * 语法约束：产物要能在老 WebKit 上直接跑，源码就按 ES5 写 —— 一律 var / function、
 * 字符串拼接、显式循环（不用 let / const / 箭头函数 / 模板字符串 / 展开 / 解构）。
 * 尤其注意：ES5 没有块级作用域，循环里的事件回调一律用 `cardClick()` 工厂按值捕获，
 * 不能让闭包共享同一个 var 绑定。
 *
 * 1-bit 约定（照抄 React 版的注释，**不要**改成颜色）：
 *   - 花色：黑桃 ♠ / 梅花 ♣ 实心、红桃 ♡ / 方块 ♢ 空心 —— 没有颜色，两对花色只能靠实心 / 空心分；
 *   - 王：★（大）/ ☆（小）；
 *   - 牌背是斜纹（黑白条纹），不是字符；
 *   - 选中的手牌抬高一截（位置直接变，没有动画）；正在出牌的那家头像框加粗；
 *   - 选中的牌堆靠线型 / 线宽 / 反白，不靠灰度。全篇没有任何灰度。
 */
import type { CardFace, CardPileView, CardTableSeat, CardTableView } from '@eink/core'
import { clear, el } from '../dom.js'
import type { RenderCtx } from './types.js'
import { shape, svg, svgSupported } from './svg.js'

/* ------------------------------------------------------------------ 常量与工具 */

/** 花色字形：黑桃 / 梅花实心，红桃 / 方块空心（1-bit 上没有颜色可用） */
var SUIT_GLYPHS: Record<string, string | undefined> = {
  spade: '♠',
  club: '♣',
  heart: '♡',
  diamond: '♢',
}

/**
 * 牌背斜纹：与 React 版 `.eink-card--back` 同一条纹（45°、2px 黑 4px 白，纯黑白）。
 * 老 WebKit 只认 `-webkit-` 前缀那份，两份都写上；后写的在现代引擎里胜出。
 */
var BACK_HATCH =
  'background-image:-webkit-repeating-linear-gradient(45deg,#000 0,#000 2px,#fff 2px,#fff 6px);' +
  'background-image:repeating-linear-gradient(45deg,#000 0,#000 2px,#fff 2px,#fff 6px);'

/** 触摸下限（规范：可点目标 ≥48px，放得下时才用） */
var TAP = 48
/** 手牌宽度上限：10 寸屏上按比例会放到 160px 以上，牌大得不像牌（React: 120px） */
var MAX_HAND_CARD = 120
/** 桌面小牌上限（React: --small-w … 56px） */
var MAX_SMALL_CARD = 56
/** 牌堆里的牌上限（React: 84px） */
var MAX_PILE_CARD = 84
/** 牌堆之间的缝（React: --pile-gap = min(6px, 1.3cqw)） */
var PILE_GAP = 4
/** 提示行常驻高度：没有提示时也占着 —— 提示出现 / 消失时下面两排不会跳一下（墨水屏上跳动很显眼） */
var HINT_H = 20

function px(value: number): string {
  return Math.round(value) + 'px'
}

function clamp(min: number, value: number, max: number): number {
  if (value < min) return min
  if (value > max) return max
  return value
}

/** 可用宽：ctx 没给时按 480 兜底（不为 0 除，也不算出负数宽度） */
function widthOf(ctx: RenderCtx): number {
  return ctx.width > 0 ? Math.round(ctx.width) : 480
}

/** 可用高：ctx 没给时按 0 处理（退化成「只看宽度」，高度自己撑） */
function heightOf(ctx: RenderCtx): number {
  return ctx.height > 0 ? Math.round(ctx.height) : 0
}

/** 字号基准（React: `.eink-cardtable { font-size: min(1em, 3.6cqh) }`） */
function baseFont(height: number): number {
  var byHeight = height > 0 ? Math.round(height * 0.036) : 15
  return clamp(11, byHeight, 16)
}

function fontOf(base: number, factor: number): string {
  return Math.max(9, Math.round(base * factor)) + 'px'
}

/**
 * 点牌回调：用工厂函数把 id 按值捕获。
 * 循环里若直接写 `function () { ctx.onCard(card.id) }`，var 只有一个绑定，
 * 所有回调都会拿到最后一张牌 —— ES5 没有块级作用域，必须这样包一层。
 */
function cardClick(ctx: RenderCtx, id: number): EventListener {
  return function onClick(): void {
    ctx.onCard(id)
  }
}

/**
 * 张数文案：React 版走 `i18n.plural('shell.cards.count', n)`（英文有 __one / __other，
 * 中文只有 __other）。RenderCtx 只给 t()，于是这里自己挑后缀：单数先试 __one，
 * 缺词时 t() 会返回 ⟦key⟧（见 types.ts 的契约），据此回落到 __other。
 */
function countText(ctx: RenderCtx, count: number): string {
  if (count === 1) {
    var one = ctx.t('shell.cards.count__one', { count: count })
    if (one.charAt(0) !== '⟦') return one
  }
  return ctx.t('shell.cards.count__other', { count: count })
}

/** 牌的读屏名（React 的 useCardLabel）：王只有「大王 / 小王」，其余是「花色 点数」 */
function cardLabel(ctx: RenderCtx, card: CardFace): string {
  if (card.joker) return ctx.t(card.joker === 'big' ? 'shell.cards.jokerBig' : 'shell.cards.jokerSmall')
  var suit = card.suit ? ctx.t('shell.cards.suit.' + card.suit) : ''
  return (suit + ' ' + card.rank).trim()
}

/* ------------------------------------------------------------------ 牌面与头像 */

/**
 * 牌面：左上角竖排「点数 + 花色」（对应 React 的 Face）。
 * 尺寸由外层牌决定，这里只收一个字号；王用 ★ / ☆ 区分大小。
 */
function faceNode(ctx: RenderCtx, card: CardFace, size: number): HTMLElement {
  var corner = el('span', { class: 'k-card__corner', style: 'display:block;padding:1px 0 0 2px;' })
  corner.setAttribute('aria-hidden', 'true')
  if (card.joker) {
    corner.appendChild(
      el(
        'span',
        {
          class: 'k-card__rank k-card__rank--joker',
          style: 'display:block;line-height:1.05;font-size:' + px(size * 0.9) + ';',
        },
        ctx.t('shell.cards.joker'),
      ),
    )
    corner.appendChild(
      el(
        'span',
        { class: 'k-card__suit', style: 'display:block;line-height:1.05;' },
        card.joker === 'big' ? '★' : '☆',
      ),
    )
    return corner
  }
  corner.appendChild(el('span', { class: 'k-card__rank', style: 'display:block;line-height:1.05;' }, card.rank))
  var glyph = card.suit ? SUIT_GLYPHS[card.suit] : undefined
  corner.appendChild(el('span', { class: 'k-card__suit', style: 'display:block;line-height:1.05;' }, glyph ? glyph : ''))
  return corner
}

/**
 * 1-bit 头像（自绘线条，不用位图）：编号奇数戴帽子、偶数戴兜帽。
 * 只为区分「这是哪一家」，不承载任何状态（React 的 Avatar，路径原样搬过来）。
 */
function avatarNode(variant: number, size: number): SVGElement {
  var node = svg({ viewBox: '0 0 48 48', width: size, height: size })
  node.setAttribute('style', 'display:block;')
  if (variant % 2 === 1) {
    node.appendChild(
      shape('path', { d: 'M8 47c1.5-9 8-13.5 16-13.5S38.5 38 40 47', fill: 'none', stroke: '#000', 'stroke-width': 2.4 }),
    )
    node.appendChild(shape('circle', { cx: 24, cy: 23, r: 10, fill: '#fff', stroke: '#000', 'stroke-width': 2.4 }))
    node.appendChild(shape('path', { d: 'M13 20a11 9.5 0 0 1 22 0z', fill: '#000' }))
    node.appendChild(shape('rect', { x: 11, y: 18.5, width: 26, height: 3, fill: '#000' }))
    node.appendChild(shape('circle', { cx: 20, cy: 25, r: 1.7, fill: '#000' }))
    node.appendChild(shape('circle', { cx: 28, cy: 25, r: 1.7, fill: '#000' }))
  } else {
    node.appendChild(shape('path', { d: 'M6 47c1-12 8-18 18-18s17 6 18 18z', fill: '#000' }))
    node.appendChild(shape('path', { d: 'M11 30c0-11 5.5-18 13-18s13 7 13 18z', fill: '#000' }))
    node.appendChild(shape('circle', { cx: 24, cy: 25, r: 8.5, fill: '#fff' }))
    node.appendChild(shape('circle', { cx: 20.5, cy: 25, r: 1.6, fill: '#000' }))
    node.appendChild(shape('circle', { cx: 27.5, cy: 25, r: 1.6, fill: '#000' }))
    node.appendChild(shape('path', { d: 'M15 31h18v3H15z', fill: '#fff' }))
  }
  return node
}

/* ------------------------------------------------------------------ 尺寸 */

/** 手牌布局用到的像素尺寸（一次算好，整棵子树共享） */
interface TableGeometry {
  base: number
  smallW: number
  smallH: number
  smallOverlap: number
  handW: number
  handH: number
  handOverlap: number
  avatar: number
  seatColW: number
}

/**
 * 手牌布局的尺寸：公式逐条对应 React 版的 CSS（注释里给出出处）。
 *   --small-w: min(10cqw, 8.5cqh, 56px)，高 = 宽 × 1.4
 *   --hand-w:  min(100cqw / (0.5 × (每排张数 − 1) + 1), 17cqh, 120px)，高 = 宽 × 1.4
 *   --avatar:  min(15cqw, 11cqh, 72px)
 *   列宽：grid-template-columns 是 1fr / 1.2fr / 1fr → 两侧各 31.25%、中间 37.5%
 */
function tableGeometry(ctx: RenderCtx, handCount: number): TableGeometry {
  var width = widthOf(ctx)
  var height = heightOf(ctx)

  var smallW = Math.min(Math.round(width * 0.1), MAX_SMALL_CARD)
  if (height > 0) smallW = Math.min(smallW, Math.round(height * 0.085))
  smallW = Math.max(14, smallW)

  var perRow = handCount <= 10 ? Math.max(1, handCount) : Math.ceil(handCount / 2)
  var handW = Math.floor((width - 4) / (0.5 * (perRow - 1) + 1))
  if (height > 0) handW = Math.min(handW, Math.round(height * 0.17))
  handW = clamp(26, handW, MAX_HAND_CARD)

  var avatar = Math.min(Math.round(width * 0.15), 72)
  if (height > 0) avatar = Math.min(avatar, Math.round(height * 0.11))
  avatar = Math.max(24, avatar)

  return {
    base: baseFont(height),
    smallW: smallW,
    smallH: Math.round(smallW * 1.4),
    smallOverlap: Math.round(smallW * 0.45),
    handW: handW,
    handH: Math.round(handW * 1.4),
    handOverlap: Math.round(handW * 0.5),
    avatar: avatar,
    seatColW: Math.round(width * 0.3125),
  }
}

/* ------------------------------------------------------------------ 座位 / 出的牌 */

/** 一家（React 的 SeatBlock）：头像（含身份角标）→ 名字 → 剩余张数 */
function seatBlock(ctx: RenderCtx, seat: CardTableSeat, geom: TableGeometry): HTMLElement {
  var cls = 'k-seat k-seat--' + seat.position
  if (seat.active) cls += ' k-seat--active'
  var node = el('div', { class: cls, style: 'display:block;text-align:center;' })
  node.setAttribute('data-position', seat.position)
  node.setAttribute('data-active', seat.active ? 'yes' : 'no')
  if (seat.active) node.setAttribute('aria-current', 'true')

  // 头像外框：正在出牌那家框加粗一倍（线宽区分，不用灰度）；SVG 不可用时它就是一个空相框
  var av = geom.avatar
  var frame = el('span', {
    class: 'k-seat__avatar',
    style:
      'position:relative;display:inline-block;box-sizing:border-box;vertical-align:top;' +
      'width:' + px(av) + ';height:' + px(av) + ';background:#fff;border-radius:6px;' +
      'border:' + (seat.active ? 4 : 2) + 'px solid #000;',
  })
  if (svgSupported()) frame.appendChild(avatarNode(seat.avatar, av - 8))
  if (seat.badgeKey) {
    frame.appendChild(
      el(
        'span',
        {
          class: 'k-seat__badge',
          style:
            'position:absolute;top:-8px;right:-10px;background:#000;color:#fff;font-weight:700;line-height:1;' +
            'font-size:' + fontOf(geom.base, 0.7) + ';padding:3px 5px;white-space:nowrap;',
        },
        ctx.t(seat.badgeKey),
      ),
    )
  }
  node.appendChild(frame)

  node.appendChild(
    el(
      'span',
      {
        class: 'k-seat__name',
        style:
          'display:block;font-size:' + fontOf(geom.base, 0.85) + ';font-weight:700;line-height:1.2;' +
          'white-space:nowrap;overflow:hidden;',
      },
      ctx.t(seat.nameKey),
    ),
  )
  if (seat.count !== null) {
    node.appendChild(
      el(
        'span',
        {
          class: 'k-seat__count',
          style:
            'display:inline-block;font-size:' + fontOf(geom.base, 0.8) + ';line-height:1.2;' +
            'border:1.5px solid #000;border-radius:999px;padding:1px 8px;white-space:nowrap;',
        },
        countText(ctx, seat.count),
      ),
    )
  }
  return node
}

/**
 * 桌面上的小牌一排（React 的 CardRow）：互相叠压（每张露出 55%），可折行。
 * 负边距由整排的左内边距抵消 —— 折行时每一行的第一张也照样对齐（与 React 的 flex 版同理）。
 */
function cardRow(ctx: RenderCtx, cards: readonly CardFace[], hidden: number, geom: TableGeometry): HTMLElement {
  var w = geom.smallW
  var h = geom.smallH
  var overlap = geom.smallOverlap
  var size = Math.round(w * 0.4)
  var row = el('span', {
    class: 'k-cardrow',
    style: 'display:inline-block;padding-left:' + px(overlap) + ';text-align:left;',
  })
  var i: number

  for (i = 0; i < cards.length; i++) {
    var card = cards[i]
    var node = el(
      'span',
      {
        class: 'k-card k-card--small',
        style:
          'position:relative;display:inline-block;box-sizing:border-box;vertical-align:top;overflow:hidden;' +
          'margin-left:' + px(-overlap) + ';width:' + px(w) + ';height:' + px(h) + ';' +
          'border:2px solid #000;border-radius:4px;background:#fff;color:#000;font-weight:700;line-height:1;' +
          'font-size:' + px(size) + ';',
      },
      faceNode(ctx, card, size),
    )
    node.setAttribute('role', 'img')
    node.setAttribute('aria-label', cardLabel(ctx, card))
    if (card.joker) node.setAttribute('data-joker', card.joker)
    row.appendChild(node)
  }

  // 还没公开的底牌：只有斜纹牌背，没有 id、点不动（这里是 span，本来也没有事件）
  for (i = 0; i < hidden; i++) {
    var back = el('span', {
      class: 'k-card k-card--small k-card--down',
      style:
        'position:relative;display:inline-block;box-sizing:border-box;vertical-align:top;' +
        'margin-left:' + px(-overlap) + ';width:' + px(w) + ';height:' + px(h) + ';' +
        'border:2px solid #000;border-radius:4px;' + BACK_HATCH,
    })
    back.setAttribute('role', 'img')
    back.setAttribute('aria-label', ctx.t('shell.cards.hidden'))
    row.appendChild(back)
  }
  return row
}

/** 某一家本轮出的牌，或文字状态（不出 / 不叫 / 2 分）—— React 的 Played */
function playedBlock(ctx: RenderCtx, seat: CardTableSeat, geom: TableGeometry): HTMLElement {
  var node = el('div', { class: 'k-seat__played k-seat__played--' + seat.position, style: 'display:block;' })
  node.setAttribute('data-position', seat.position)

  // 自己那一行没有头像，用「名字 · 身份」的小字代替（与 React 一致）
  if (seat.position === 'bottom' && seat.badgeKey) {
    node.appendChild(
      el(
        'span',
        {
          class: 'k-seat__selftag',
          style:
            'display:inline-block;vertical-align:middle;margin-right:4px;white-space:nowrap;' +
            'font-size:' + fontOf(geom.base, 0.8) + ';',
        },
        ctx.t(seat.nameKey) + ' · ' + ctx.t(seat.badgeKey),
      ),
    )
  }
  if (seat.played) node.appendChild(cardRow(ctx, seat.played, 0, geom))
  if (seat.statusKey) {
    node.appendChild(
      el(
        'span',
        {
          class: 'k-seat__status',
          style:
            'display:inline-block;vertical-align:middle;border:2px solid #000;padding:2px 8px;' +
            'font-size:' + fontOf(geom.base, 0.9) + ';line-height:1.3;white-space:nowrap;',
        },
        ctx.t(seat.statusKey, seat.statusParams),
      ),
    )
  }
  return node
}

/** 桌面中央的一行提示（你的回合 / 请叫分…）：常驻占位，内容为空时高度也不塌 */
function bannerSlot(ctx: RenderCtx, table: CardTableView, geom: TableGeometry): HTMLElement {
  var slot = el('div', { class: 'k-cards__banner-slot', style: 'display:block;text-align:center;' })
  if (table.bannerKey) {
    var banner = el(
      'span',
      {
        class: 'k-cards__banner',
        style:
          'display:inline-block;border:2px solid #000;border-right-width:4px;border-bottom-width:4px;' +
          'background:#fff;padding:4px 12px;font-weight:700;white-space:nowrap;' +
          'font-size:' + fontOf(geom.base, 1) + ';',
      },
      ctx.t(table.bannerKey, table.bannerParams),
    )
    banner.setAttribute('role', 'status')
    slot.appendChild(banner)
  }
  return slot
}

/* ------------------------------------------------------------------ 手牌布局 */

function findSeat(table: CardTableView, position: string): CardTableSeat | null {
  var i: number
  for (i = 0; i < table.seats.length; i++) {
    if (table.seats[i].position === position) return table.seats[i]
  }
  return null
}

function cell(inner: HTMLElement | null, extraStyle?: string): HTMLElement {
  var td = el('td', {
    class: 'k-cards__cell',
    style: 'padding:0;vertical-align:top;' + (extraStyle ? extraStyle : ''),
  })
  if (inner) td.appendChild(inner)
  return td
}

/**
 * 手牌布局（斗地主等）：[左家][底牌][右家] / [左家出的牌][提示][右家出的牌] /
 * [自己出的牌] / [手牌]，与 React 版的 grid-template-areas 一一对应（这里用 table 排）。
 */
function renderHandLayout(container: HTMLElement, table: CardTableView, ctx: RenderCtx): void {
  var geom = tableGeometry(ctx, table.hand.length)
  var left = findSeat(table, 'left')
  var right = findSeat(table, 'right')
  var self = findSeat(table, 'bottom')

  var tableNode = el('table', {
    class: 'k-cards',
    cellspacing: '0',
    cellpadding: '0',
    style: 'width:100%;table-layout:fixed;border-collapse:collapse;',
  })
  if (table.hand.length > 10) tableNode.setAttribute('data-hand-rows', '2')

  // 第一行：左家 / 中央的底牌 / 右家
  var row1 = el('tr', {})
  row1.appendChild(cell(left ? seatBlock(ctx, left, geom) : null, 'width:' + px(geom.seatColW) + ';'))
  var center = el('div', { class: 'k-cards__center', style: 'display:block;text-align:center;' })
  if (table.center) center.appendChild(cardRow(ctx, table.center.cards, table.center.hidden, geom))
  row1.appendChild(cell(center))
  row1.appendChild(cell(right ? seatBlock(ctx, right, geom) : null, 'width:' + px(geom.seatColW) + ';'))
  tableNode.appendChild(row1)

  // 第二行：左家出的牌 / 提示 / 右家出的牌（各家朝自己那一侧对齐，与 React 的 grid 一致）
  var row2 = el('tr', {})
  row2.appendChild(cell(left ? playedBlock(ctx, left, geom) : null, 'text-align:left;'))
  row2.appendChild(cell(bannerSlot(ctx, table, geom), 'vertical-align:middle;'))
  row2.appendChild(cell(right ? playedBlock(ctx, right, geom) : null, 'text-align:right;'))
  tableNode.appendChild(row2)

  // 第三行：自己出的牌 / 状态（没有 bottom 座位时也占着这一行，与 React 一致）
  var row3 = el('tr', {})
  var selfCell = cell(self ? playedBlock(ctx, self, geom) : null, 'text-align:center;')
  selfCell.setAttribute('colspan', '3')
  if (!self) {
    var placeholder = el('div', { class: 'k-seat__played k-seat__played--bottom', style: 'display:block;' })
    placeholder.setAttribute('data-position', 'bottom')
    selfCell.appendChild(placeholder)
  }
  row3.appendChild(selfCell)
  tableNode.appendChild(row3)

  // 第四行：手牌
  var row4 = el('tr', {})
  var handCell = cell(null)
  handCell.setAttribute('colspan', '3')
  handCell.appendChild(handBlock(ctx, table.hand, geom))
  row4.appendChild(handCell)
  tableNode.appendChild(row4)

  container.appendChild(tableNode)
}

/**
 * 手牌：超过 10 张分两排（前一排是大牌），两排叠压 ——
 * 上一排露出点数与花色那一截，下一排的选中牌抬高后也不会压住上一排
 * （叠压量从 42% 减到 16%，让出抬高的 22%，再留 6% 空隙；React 的注释里有实测由来）。
 */
function handBlock(ctx: RenderCtx, hand: CardFace[], geom: TableGeometry): HTMLElement {
  var block = el('div', { class: 'k-cards__hand', style: 'display:block;' })
  block.setAttribute('role', 'group')
  block.setAttribute('aria-label', ctx.t('shell.cards.hand'))

  var twoRows = hand.length > 10
  var perRow = twoRows ? Math.ceil(hand.length / 2) : Math.max(1, hand.length)
  var rowCount = twoRows ? 2 : 1
  var size = Math.round(geom.handW * 0.36)
  var r: number
  var i: number

  for (r = 0; r < rowCount; r++) {
    var rowNode = el('div', {
      class: 'k-cards__handrow',
      style:
        'display:block;text-align:center;padding-left:' + px(geom.handOverlap) + ';' +
        // 第一排上面给抬高的选中牌留出位置（不压住上面「自己出的牌」那一行）；
        // 两排之间只叠 16%（React：data-hand-rows=2 时的口径），抬高的 22% 才不会盖住上一排
        (r === 0 ? 'padding-top:' + px(geom.handH * 0.22) + ';' : 'margin-top:' + px(-geom.handH * 0.16) + ';'),
    })
    var from = r * perRow
    var to = Math.min(hand.length, from + perRow)
    for (i = from; i < to; i++) {
      var card = hand[i]
      var cls = 'k-card k-card--hand'
      if (card.selected) cls += ' k-card--selected'
      var node = el(
        'button',
        {
          type: 'button',
          class: cls,
          style:
            'position:relative;display:inline-block;box-sizing:border-box;vertical-align:top;overflow:hidden;' +
            'margin-left:' + px(-geom.handOverlap) + ';width:' + px(geom.handW) + ';height:' + px(geom.handH) + ';' +
            'border:2px solid #000;border-radius:4px;background:#fff;color:#000;font-weight:700;line-height:1;' +
            'font-size:' + px(size) + ';' +
            // 选中：整张抬高 22% 牌高（位置直接变，没有过渡）—— 抬起来的那张压住邻牌，正是要的效果
            (card.selected ? 'top:' + px(-geom.handH * 0.22) + ';' : ''),
          onclick: cardClick(ctx, card.id),
        },
        faceNode(ctx, card, size),
      )
      node.setAttribute('data-selected', card.selected ? 'yes' : 'no')
      if (card.joker) node.setAttribute('data-joker', card.joker)
      node.setAttribute('aria-pressed', card.selected ? 'true' : 'false')
      node.setAttribute('aria-label', cardLabel(ctx, card))
      rowNode.appendChild(node)
    }
    block.appendChild(rowNode)
  }
  return block
}

/* ------------------------------------------------------------------ 牌堆布局 */

/** 一个牌堆的像素尺寸：row / stack 两套公式都来自 React 版 CSS，出处写在 renderPiles 的注释里 */
interface PileGeometry {
  /** 牌区能用的宽（堆宽 − border − padding） */
  bodyW: number
  /** 牌区高度（stack 用；0 = 没有高度信息，退化成自然高度） */
  bodyH: number
  cardW: number
  cardH: number
  base: number
}

/** 牌堆里每一张相对前一张的位移（React 用 `--i` × `--pile-step` 在 CSS 里算，这里由 JS 算） */
interface PileStep {
  x: number
  y: number
}

function pileStep(pile: CardPileView, geom: PileGeometry): PileStep {
  var slots = pile.cards.length + pile.hidden
  var gapCount = Math.max(1, slots - 1)
  if (pile.layout === 'row') {
    // 横排：每一步 = min(牌宽 × 0.45, (可用宽 − 牌宽) / (槽位数 − 1))，夹 0
    var x = Math.max(0, Math.min(Math.round(geom.cardW * 0.45), Math.floor((geom.bodyW - geom.cardW) / gapCount)))
    return { x: x, y: 0 }
  }
  // 竖排：每一步 = min(牌高 × 0.34, (可用高 − 牌高) / (槽位数 − 1))，夹 0；
  // 没有高度信息（ctx.height = 0）时不设上限，按自然高度叠下去，绝不裁切
  var y =
    geom.bodyH > 0
      ? Math.max(0, Math.min(Math.round(geom.cardH * 0.34), Math.floor((geom.bodyH - geom.cardH) / gapCount)))
      : Math.round(geom.cardH * 0.34)
  return { x: 0, y: y }
}

/**
 * 一个牌堆（React 的 Pile）：
 *   - 堆名 + 张数分两行（窄屏上牌缝可能只有几像素，张数是唯一的「这一堆有多厚」）；
 *   - 空堆给了 `id` 时，空位本身是可点按钮（虚线、撑满这一堆），点击回传这个 id；
 *   - 数组第一张在最上层（z-index = 槽位数 − i）：牌列顶端那张明牌必须完整可见、可点；
 *   - hidden 的牌背没有 id、点不动，pointer-events:none，绝不挡在可点的牌上面。
 */
function pileBlock(ctx: RenderCtx, pile: CardPileView, geom: PileGeometry, pileW: number): HTMLElement {
  var slots = pile.cards.length + pile.hidden
  var step = pileStep(pile, geom)
  var naturalH = pile.layout === 'row' ? geom.cardH : Math.round(geom.cardH + step.y * Math.max(0, slots - 1))
  var bodyH = pile.layout === 'row' ? geom.cardH : geom.bodyH > 0 ? geom.bodyH : naturalH

  var cls = 'k-pile k-pile--' + (pile.layout === 'row' ? 'row' : 'stack')
  if (pile.selected) cls += ' k-pile--selected'
  var node = el('div', {
    class: cls,
    style:
      'display:inline-block;vertical-align:top;box-sizing:border-box;text-align:center;' +
      'width:' + px(pileW) + ';margin-right:' + px(PILE_GAP) + ';padding:1px;background:#fff;' +
      'border:2px solid #000;border-radius:4px;' +
      // 空堆：虚线框（1-bit 上「这儿是个空位」靠线型说，不靠灰）
      (slots === 0 ? 'border-style:dashed;' : '') +
      // 选中的堆：外圈再加一道粗框（outline 不占布局，选中 / 取消都不会让牌挪一像素）
      (pile.selected ? 'outline:3px solid #000;' : ''),
  })
  node.setAttribute('data-layout', pile.layout)
  node.setAttribute('data-selected', pile.selected ? 'yes' : 'no')
  node.setAttribute('data-empty', slots === 0 ? 'yes' : 'no')
  node.setAttribute('role', 'group')
  node.setAttribute('aria-label', ctx.t(pile.labelKey))

  var head = el('div', { class: 'k-pile__head', style: 'display:block;line-height:1.1;' })
  head.appendChild(
    el(
      'span',
      {
        class: 'k-pile__label',
        style:
          'display:block;white-space:nowrap;overflow:hidden;font-size:' + fontOf(geom.base, 0.8) + ';' +
          // 选中的堆：堆名反白（1-bit 上没有颜色，反白是最强的「就是这一堆」）
          (pile.selected ? 'background:#000;color:#fff;' : ''),
      },
      ctx.t(pile.labelKey),
    ),
  )
  head.appendChild(
    el(
      'span',
      {
        class: 'k-pile__count',
        style:
          'display:inline-block;white-space:nowrap;font-size:' + fontOf(geom.base, 0.68) + ';' +
          'border:1px solid #000;border-radius:999px;padding:0 3px;',
      },
      countText(ctx, slots),
    ),
  )
  node.appendChild(head)

  var body = el('div', {
    class: 'k-pile__cards',
    style: 'position:relative;display:block;width:100%;height:' + px(bodyH) + ';',
  })

  // 空堆的空位（游戏给了 id）：整块牌区是一个可点按钮 —— 空当接龙「放 K / 放 A」的唯一入口。
  // 画在牌与牌背之前：万一这堆还有 hidden 张牌背，它们（更高 z、pointer-events:none）会盖在空位上面，
  // 点击照样落到这个按钮上（React 的注释）。
  if (pile.cards.length === 0 && pile.id !== undefined) {
    var empty = el('button', {
      type: 'button',
      class: 'k-card k-card--pile k-pile--empty',
      style:
        'position:absolute;left:0;top:0;box-sizing:border-box;width:100%;height:' + px(Math.min(TAP, bodyH)) + ';' +
        'border:2px dashed #000;border-radius:4px;background:#fff;z-index:0;',
      onclick: cardClick(ctx, pile.id),
    })
    empty.setAttribute('data-empty', 'yes')
    // 无障碍名用「堆名 · 张数」—— 与堆名同名的空按钮读起来等于没说，加上「0 张」才知道这是个空位
    empty.setAttribute('aria-label', ctx.t(pile.labelKey) + ' · ' + countText(ctx, slots))
    body.appendChild(empty)
  }

  var i: number
  for (i = 0; i < pile.cards.length; i++) {
    var card = pile.cards[i]
    var cardCls = 'k-card k-card--pile'
    if (card.faceDown) cardCls += ' k-card--down'
    if (card.selected) cardCls += ' k-card--selected'
    var button = el(
      'button',
      {
        type: 'button',
        class: cardCls,
        style:
          'position:absolute;left:' + px(step.x * i) + ';top:' + px(step.y * i) + ';' +
          'z-index:' + (slots - i) + ';box-sizing:border-box;overflow:hidden;background:#fff;color:#000;' +
          'font-weight:700;line-height:1;text-align:left;padding:0;border-radius:4px;' +
          'width:' + px(geom.cardW) + ';height:' + px(geom.cardH) + ';' +
          // 选中的牌：框加粗一倍（border-box，外廓不变、不挤动邻牌）
          'border:' + (card.selected ? 4 : 2) + 'px solid #000;' +
          (card.faceDown ? BACK_HATCH : '') +
          'font-size:' + px(geom.cardW * 0.34) + ';',
        onclick: cardClick(ctx, card.id),
      },
      card.faceDown ? null : faceNode(ctx, card, Math.round(geom.cardW * 0.34)),
    )
    button.setAttribute('data-selected', card.selected ? 'yes' : 'no')
    if (card.faceDown) button.setAttribute('data-face-down', 'yes')
    if (card.joker) button.setAttribute('data-joker', card.joker)
    button.setAttribute('aria-pressed', card.selected ? 'true' : 'false')
    button.setAttribute('aria-label', card.faceDown ? ctx.t('shell.cards.hidden') : cardLabel(ctx, card))
    body.appendChild(button)
  }

  // 末尾没翻开的牌背：没有 id、点不动，也不许挡住底下可点的牌
  for (i = 0; i < pile.hidden; i++) {
    var at = pile.cards.length + i
    var back = el('span', {
      class: 'k-card k-card--pile k-card--down',
      style:
        'position:absolute;left:' + px(step.x * at) + ';top:' + px(step.y * at) + ';' +
        'z-index:' + (pile.hidden - i) + ';box-sizing:border-box;' +
        'width:' + px(geom.cardW) + ';height:' + px(geom.cardH) + ';' +
        'border:2px solid #000;border-radius:4px;pointer-events:none;' + BACK_HATCH,
    })
    back.setAttribute('data-face-down', 'yes')
    back.setAttribute('role', 'img')
    back.setAttribute('aria-label', ctx.t('shell.cards.hidden'))
    body.appendChild(back)
  }

  node.appendChild(body)
  return node
}

/**
 * 牌堆布局（只在游戏给了 `CardTableView.piles` 时走这条路）：
 *   上排 = `layout:'row'` 的牌堆一字排开（抽牌堆 / 弃牌堆 / 基础堆）；
 *   下排 = `layout:'stack'` 的牌堆按 n 列竖排（空当接龙是 7 列）。
 *
 * 尺寸全部在这里算（React 版由 CSS 的容器查询算）：
 *   牌宽 = max(min(48px 触摸下限, 均分宽), min(均分宽 × 0.78 / 0.86, 高度比例, 84px))，
 *         再夹一次「不超过均分宽」—— 360 宽的窄屏上宁可窄一点，也不横向溢出。
 *   叠合步长 = min(牌宽/高 × 0.34~0.45, (牌区 − 牌) / (槽位数 − 1))，夹 0：
 *         槽位越多叠得越紧，19 张的长牌列也只会压扁、不会把牌顶出可用区。
 */
function renderPiles(container: HTMLElement, table: CardTableView, ctx: RenderCtx): void {
  var piles = table.piles ? table.piles : []
  var width = widthOf(ctx)
  var height = heightOf(ctx)
  var base = baseFont(height)
  var rows: CardPileView[] = []
  var stacks: CardPileView[] = []
  var i: number
  for (i = 0; i < piles.length; i++) {
    if (piles[i].layout === 'row') rows.push(piles[i])
    else stacks.push(piles[i])
  }

  // 上排：n 个堆均分整宽（不会因为「这堆 24 张、那堆 1 张」就忽宽忽窄）
  var rowCount = Math.max(1, rows.length)
  var rowW = rows.length > 0 ? Math.floor((width - PILE_GAP * (rowCount + 1)) / rowCount) : 0
  // 牌宽 = max(min(48px 触摸下限, 均分宽), min(均分宽 × 0.78, 高度比例, 84px))（React 的 --pile-card-w-row）
  var rowCardW = Math.min(Math.round(rowW * 0.78), MAX_PILE_CARD)
  if (height > 0) rowCardW = Math.min(rowCardW, Math.round(height * 0.16))
  rowCardW = Math.max(Math.min(TAP, rowW), rowCardW)
  rowCardW = clamp(20, Math.min(rowCardW, rowW - 6), MAX_PILE_CARD)
  var rowCardH = Math.round(rowCardW * 1.4)

  // 下排：n 列均分
  var colCount = Math.max(1, stacks.length)
  var colW = stacks.length > 0 ? Math.floor((width - PILE_GAP * (colCount + 1)) / colCount) : 0
  var stackCardW = Math.min(Math.round(colW * 0.86), MAX_PILE_CARD)
  if (height > 0) stackCardW = Math.min(stackCardW, Math.round(height * 0.15))
  stackCardW = Math.max(Math.min(TAP, colW), stackCardW)
  stackCardW = clamp(20, Math.min(stackCardW, colW - 6), MAX_PILE_CARD)
  var stackCardH = Math.round(stackCardW * 1.4)

  // 牌列能用的高度：扣掉提示行、上排牌堆（堆名 + 张数两行 + 牌）与几条缝
  var headH = Math.round(base * 2.1)
  var usedTop = HINT_H + (rows.length > 0 ? headH + rowCardH + PILE_GAP * 2 : 0)
  var stackBodyH = height > 0 ? Math.max(stackCardH + 8, height - usedTop - headH - PILE_GAP * 2) : 0

  var root = el('div', { class: 'k-piles', style: 'display:block;width:100%;box-sizing:border-box;' })

  // 提示行常驻占位：没有提示时它是空的，但高度一直占着 —— 提示出现 / 消失时下面两排不会跳一下
  var hintSlot = el('div', {
    class: 'k-piles__hint-slot',
    style: 'display:block;height:' + px(HINT_H) + ';text-align:center;',
  })
  if (table.bannerKey) {
    var hint = el(
      'span',
      {
        class: 'k-piles__hint',
        style:
          'display:inline-block;border:2px solid #000;border-right-width:4px;border-bottom-width:4px;' +
          'background:#fff;padding:1px 10px;font-weight:700;white-space:nowrap;' +
          'font-size:' + fontOf(base, 1) + ';',
      },
      ctx.t(table.bannerKey, table.bannerParams),
    )
    hint.setAttribute('role', 'status')
    hintSlot.appendChild(hint)
  }
  root.appendChild(hintSlot)

  var rowNode = el('div', { class: 'k-piles__row', style: 'display:block;white-space:nowrap;' })
  for (i = 0; i < rows.length; i++) {
    // 牌区宽 = 堆宽 − 两侧 border 2px − 两侧 padding 1px
    rowNode.appendChild(
      pileBlock(ctx, rows[i], { bodyW: rowW - 6, bodyH: rowCardH, cardW: rowCardW, cardH: rowCardH, base: base }, rowW),
    )
  }
  if (rows.length > 0) root.appendChild(rowNode)

  var gridNode = el('div', { class: 'k-piles__grid', style: 'display:block;white-space:nowrap;' })
  for (i = 0; i < stacks.length; i++) {
    gridNode.appendChild(
      pileBlock(
        ctx,
        stacks[i],
        { bodyW: colW - 6, bodyH: stackBodyH, cardW: stackCardW, cardH: stackCardH, base: base },
        colW,
      ),
    )
  }
  if (stacks.length > 0) root.appendChild(gridNode)

  container.appendChild(root)
}

/* ------------------------------------------------------------------ 入口 */

/**
 * 牌桌入口：与 React 的 `CardTable` 同一个分叉 —— **只有给了 piles 且非空**才走牌堆布局，
 * 其余玩法（斗地主等）的手牌布局一个字节都没变（这条分支就是「缺省行为不变」的保证）。
 * 点牌一律回调 `ctx.onCard(id)`：壳层不认识牌堆、也不判断能不能点，与手牌那条通道完全一样。
 */
export function renderCards(container: HTMLElement, table: CardTableView, ctx: RenderCtx): void {
  clear(container)
  if (table.piles && table.piles.length > 0) {
    renderPiles(container, table, ctx)
    return
  }
  renderHandLayout(container, table, ctx)
}
