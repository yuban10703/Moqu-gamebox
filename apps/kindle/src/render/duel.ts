/**
 * 对决面板渲染器（DuelView → DOM，ES5 目标）。
 *
 * 与 React 版（packages/ui/src/DuelPanel.tsx）的关系：**语义逐条对齐**，布局手段不同。
 *   [上方一家：头像 · 名字 / 角标 / 胜局 · 血量 · 道具]
 *   [枪（锯短时枪管变短）+ 状态标签 + 开枪定格画面]
 *   [弹仓：已打出 | 枪里]  [剩余：实弹 n · 空包弹 m]  [一行说明]
 *   [整场记录（可滚动，默认停在最新一条；对手回合的几条合进一个框）]
 *   [下方一家：名字 · 血量 · 道具（点了就是使用）]
 *
 * 1-bit（照抄 React 版的口径，别改成颜色）：
 *   - 血量是一格一颗爱心，**实心 = 有血 / 空心 = 没血**（没有灰度可用）；
 *   - 弹仓里：实弹实心、空包空心、未知虚线 + ?、「自己看过的那一发」在实/空之外再加一圈粗框；
 *     已打出的实弹画斜纹、空包打叉；
 *   - 道具能不能点靠线型与线宽（实线 = 可点、点线 = 不可点、虚线 = 空格子），不靠颜色；
 *   - 没有动画 —— 发生了什么全靠记录用文字交代（墨水屏一次整屏刷新约 500ms）。
 *
 * 开枪定格画面（DuelFireScene）：墨水屏做不出枪口闪光那种逐帧动画，「这一枪」的打击感只能靠
 * **对比度**（白底黑字 + 大字 + 粗框 / 反白标题带）、**图形**（实心爆闪 / 空心打叉）与**停多久**
 * （引擎在对手回合多停一拍）。覆盖范围只有「枪 / 弹仓 / 说明」这一段（`.k-duel__stage`），
 * 战斗记录与两侧的血量、道具始终露着 —— 用户明确要求「不要把战斗日志挡住」。
 *
 * 语法约束：产物要能在老 WebKit 上直接跑，源码就按 ES5 写 —— 一律 var / function、
 * 字符串拼接、显式循环（不用 let / const / 箭头函数 / 模板字符串 / 展开 / 解构）。
 * 循环里的事件回调一律用 `clickAt()` 工厂按值捕获（ES5 没有块级作用域，闭包会共享同一个 var）。
 */
import type { DuelFireScene, DuelItem, DuelLine, DuelSide, DuelToken, DuelView } from '@eink/core'
import { append, clear, el } from '../dom.js'
import type { RenderCtx } from './types.js'
import { shape, svg, svgSupported } from './svg.js'

/* ------------------------------------------------------------------ 常量与工具 */

/** 描边图标的默认笔（React 里那个 `stroke` 常量）：fill:none + 2.2px 黑线 */
var STROKE: Record<string, string | number> = { fill: 'none', stroke: '#000', 'stroke-width': 2.2 }

/** 爱心路径（React 的 HEART，viewBox 0 0 24 24） */
var HEART =
  'M12 21 C5 15.6 1.6 12 1.6 7.8 1.6 4.6 4.1 2.4 7 2.4 9.1 2.4 10.9 3.6 12 5.4 13.1 3.6 14.9 2.4 17 2.4 19.9 2.4 22.4 4.6 22.4 7.8 22.4 12 19 15.6 12 21Z'

/** 斜纹（已打出的实弹）：与 React 的 repeating-linear-gradient 同一条纹 */
var HATCH =
  'background-image:-webkit-repeating-linear-gradient(45deg,#000 0,#000 2px,#fff 2px,#fff 5px);' +
  'background-image:repeating-linear-gradient(45deg,#000 0,#000 2px,#fff 2px,#fff 5px);'

/** 各家之间的竖直缝（React: `gap: min(8px, 1.4cqh)`） */
var GAP = 6

/** 抢道具模式存在**容器**上：React 里它是 DuelPanel 的 useState，屏幕一换就该跟着消失 */
interface StealHost extends HTMLElement {
  __kStealMode?: boolean
  /** 上一次画出来的记录条数：只有**新记录**才把记录框拉到底（React 的 useLayoutEffect 依赖 log.length） */
  __kLogLen?: number
  /** 记录框上次的滚动位置：整块 DOM 是重建的，不记住的话「往上翻」一重渲染就跳回顶部 */
  __kLogTop?: number
}

function px(value: number): string {
  return Math.round(value) + 'px'
}

function clamp(min: number, value: number, max: number): number {
  if (value < min) return min
  if (value > max) return max
  return value
}

function has(bag: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(bag, key)
}

/** 合并属性表：不用展开语法（ES5 源码约束），后者覆盖前者 */
function merged(
  base: Record<string, string | number>,
  extra: Record<string, string | number>,
): Record<string, string | number> {
  var out: Record<string, string | number> = {}
  var key: string
  for (key in base) {
    if (has(base, key)) out[key] = base[key]
  }
  for (key in extra) {
    if (has(extra, key)) out[key] = extra[key]
  }
  return out
}

/** 点回调：按值捕获槽位号（ES5 没有块级作用域，循环里的闭包必须这样包一层） */
function clickAt(fn: (slot: number) => void, slot: number): EventListener {
  return function onClick(): void {
    fn(slot)
  }
}

function widthOf(ctx: RenderCtx): number {
  return ctx.width > 0 ? Math.round(ctx.width) : 480
}

function heightOf(ctx: RenderCtx): number {
  return ctx.height > 0 ? Math.round(ctx.height) : 0
}

/** 字号基准（React: `.eink-duel { font-size: min(1em, 3.6cqh) }`） */
function baseFont(height: number): number {
  return clamp(11, height > 0 ? Math.round(height * 0.036) : 15, 16)
}

function fontOf(base: number, factor: number): string {
  return Math.max(9, Math.round(base * factor)) + 'px'
}

/**
 * 一条记录 / 一行说明的文案（React 的 useLine）：
 * 先把 `subjectKey` / `objectKey` / `itemKey` 翻好，再作为 {subject} / {object} / {item}
 * 代进主句的 params —— 人名与道具名都是 i18n key，不先翻，句子里就会露出 `buckshot.xxx` 这样的原键。
 * 同名的 params 会被这几个覆盖（与 React 的对象展开顺序一致）。
 */
function lineText(ctx: RenderCtx, line: DuelLine): string {
  var params: Record<string, string | number> = {}
  var key: string
  if (line.params) {
    for (key in line.params) {
      if (has(line.params, key)) params[key] = line.params[key]
    }
  }
  if (line.subjectKey) params.subject = ctx.t(line.subjectKey)
  if (line.objectKey) params.object = ctx.t(line.objectKey)
  if (line.itemKey) params.item = ctx.t(line.itemKey)
  return ctx.t(line.key, params)
}

/**
 * 开枪那一下的说明行（React 的 fireCaption）：击倒 · 谁打谁 · 掉几格。
 * 平时那一行说明由它替换掉，所以信息不会因为定格画面盖住说明而丢失。
 */
function fireCaption(ctx: RenderCtx, fire: DuelFireScene, nameOf: (pos: string) => string): string {
  var parts: string[] = []
  if (fire.lethal) parts.push(ctx.t('shell.duel.fire.knockdown'))
  parts.push(
    fire.shooter === fire.target
      ? ctx.t('shell.duel.fire.self', { subject: nameOf(fire.shooter) })
      : ctx.t('shell.duel.fire.at', { subject: nameOf(fire.shooter), object: nameOf(fire.target) }),
  )
  if (fire.damage > 0) parts.push(ctx.t('shell.duel.fire.lost', { amount: fire.damage }))
  return parts.join(' · ')
}

/* ------------------------------------------------------------------ 道具图标 / 头像 */

/**
 * 道具图标（24×24 线条，黑白）—— React 的 ItemIcon，路径原样搬过来。
 * 未知名字回退成一个**空心方框**：React 的注释写了这个口径，但那边 `default` 分支没画东西，
 * 在设备上就是「有道具但看不见」；这里按注释补上。
 * SVG 不可用时返回 null（道具名仍然在，信息不丢）。
 */
function itemIconNode(icon: string, size: number): SVGElement | null {
  if (!svgSupported()) return null
  var node = svg({ viewBox: '0 0 24 24', width: size, height: size })
  node.setAttribute('style', 'display:block;margin:0 auto;')
  if (icon === 'magnifier') {
    node.appendChild(shape('circle', merged(STROKE, { cx: 10, cy: 10, r: 6.5 })))
    node.appendChild(shape('path', { d: 'M15 15l6.5 6.5', stroke: '#000', 'stroke-width': 3, 'stroke-linecap': 'round' }))
  } else if (icon === 'cigarettes') {
    node.appendChild(shape('rect', merged(STROKE, { x: 2.5, y: 13, width: 19, height: 5 })))
    node.appendChild(shape('rect', { x: 17, y: 13, width: 4.5, height: 5, fill: '#000' }))
    node.appendChild(
      shape(
        'path',
        merged(STROKE, { d: 'M7 10c-1.6-2.4 1.6-3.2 0-5.6M11 10c-1.6-2.4 1.6-3.2 0-5.6', 'stroke-width': 1.6 }),
      ),
    )
  } else if (icon === 'beer') {
    node.appendChild(shape('rect', merged(STROKE, { x: 7, y: 4.5, width: 10, height: 17, rx: 1.5 })))
    node.appendChild(shape('path', { d: 'M7 9h10M7 17h10', stroke: '#000', 'stroke-width': 1.4 }))
    node.appendChild(shape('rect', { x: 9.5, y: 2, width: 5, height: 2.5, fill: '#000' }))
  } else if (icon === 'handcuffs') {
    node.appendChild(shape('circle', merged(STROKE, { cx: 7, cy: 14, r: 4.8 })))
    node.appendChild(shape('circle', merged(STROKE, { cx: 17, cy: 14, r: 4.8 })))
    node.appendChild(shape('path', { d: 'M11 11.5h2', stroke: '#000', 'stroke-width': 2.4 }))
  } else if (icon === 'saw') {
    node.appendChild(shape('path', { d: 'M2 15h14l-1.5 5h-11z', fill: '#000' }))
    node.appendChild(
      shape(
        'path',
        merged(STROKE, {
          d: 'M3.5 15l1.5-2.4 1.5 2.4 1.5-2.4 1.5 2.4 1.5-2.4 1.5 2.4 1.5-2.4',
          'stroke-width': 1.3,
        }),
      ),
    )
    node.appendChild(shape('rect', merged(STROKE, { x: 16, y: 8, width: 5.5, height: 10, rx: 1.5 })))
  } else if (icon === 'phone') {
    node.appendChild(shape('rect', merged(STROKE, { x: 7, y: 2.5, width: 10, height: 19, rx: 2 })))
    node.appendChild(shape('rect', { x: 9, y: 5.5, width: 6, height: 9, fill: '#000' }))
    node.appendChild(shape('circle', { cx: 12, cy: 18, r: 1.3, fill: '#000' }))
  } else if (icon === 'inverter') {
    node.appendChild(shape('path', merged(STROKE, { d: 'M4 9h13l-3-3M20 15H7l3 3' })))
    node.appendChild(shape('circle', merged(STROKE, { cx: 12, cy: 12, r: 10, 'stroke-width': 1.4 })))
  } else if (icon === 'medicine') {
    node.appendChild(shape('rect', merged(STROKE, { x: 4, y: 8, width: 16, height: 8, rx: 4 })))
    node.appendChild(shape('path', { d: 'M12 8v8', stroke: '#000', 'stroke-width': 2 }))
    node.appendChild(shape('path', { d: 'M12 8h4a4 4 0 0 1 0 8h-4z', fill: '#000' }))
  } else if (icon === 'adrenaline') {
    // 一支注射器：药管 + 推杆 + 针头（1-bit 下靠线宽区分，不靠颜色）
    node.appendChild(shape('rect', merged(STROKE, { x: 3.5, y: 9, width: 12, height: 6, rx: 1 })))
    node.appendChild(
      shape('path', { d: 'M15.5 12h4.2', stroke: '#000', 'stroke-width': 2.6, 'stroke-linecap': 'round' }),
    )
    node.appendChild(shape('path', { d: 'M19.7 12h1.8', stroke: '#000', 'stroke-width': 1.4 }))
    node.appendChild(shape('path', { d: 'M7 9v6M10 9v6M13 9v6', stroke: '#000', 'stroke-width': 1.1 }))
    node.appendChild(
      shape('path', { d: 'M3.5 9.6V6.8M3.5 14.4v2.8', stroke: '#000', 'stroke-width': 2.2, 'stroke-linecap': 'round' }),
    )
  } else {
    // 未知图标：空心方框（见函数头注释）
    node.appendChild(shape('rect', merged(STROKE, { x: 3, y: 3, width: 18, height: 18 })))
  }
  return node
}

/**
 * 头像（1-bit 自绘）：恶魔 / 玩家；未知名字画一个通用人像 —— React 的 Portrait。
 * 玩家头像里的 1 / 2 是 SVG 文本；SVG 不可用时整块头像不画（名字仍在）。
 */
function portraitNode(name: string, size: number): SVGElement | null {
  if (!svgSupported()) return null
  if (name === 'devil') {
    var devil = svg({ viewBox: '0 0 96 96', width: size, height: size })
    devil.setAttribute('style', 'display:block;')
    devil.appendChild(shape('path', { d: 'M22 30 L12 6 L34 22 Z M74 30 L84 6 L62 22 Z', fill: '#000' }))
    devil.appendChild(
      shape('path', { d: 'M18 44c0-20 13-30 30-30s30 10 30 30v12c0 18-13 30-30 30S18 74 18 56z', fill: '#000' }),
    )
    devil.appendChild(shape('path', { d: 'M30 42l12 6-12 4z M66 42l-12 6 12 4z', fill: '#fff' }))
    devil.appendChild(shape('path', { d: 'M30 64c6 8 30 8 36 0l-4 10c-8 5-20 5-28 0z', fill: '#fff' }))
    devil.appendChild(
      shape('path', { d: 'M36 66v6M42 67v7M48 67v7M54 67v7M60 66v6', stroke: '#000', 'stroke-width': 2 }),
    )
    return devil
  }
  var human = svg({ viewBox: '0 0 96 96', width: size, height: size })
  human.setAttribute('style', 'display:block;')
  human.appendChild(shape('circle', { cx: 48, cy: 36, r: 18, fill: 'none', stroke: '#000', 'stroke-width': 5 }))
  human.appendChild(
    shape('path', { d: 'M16 92c2-20 16-30 32-30s30 10 32 30', fill: 'none', stroke: '#000', 'stroke-width': 5 }),
  )
  var mark = name === 'player2' ? '2' : name === 'player1' ? '1' : ''
  if (mark) {
    var text = shape('text', {
      x: 48,
      y: 44,
      'text-anchor': 'middle',
      'font-size': 24,
      'font-weight': 700,
      'font-family': 'sans-serif',
      fill: '#000',
    })
    append(text, mark)
    human.appendChild(text)
  }
  return human
}

/* ------------------------------------------------------------------ 血量 / 弹仓 */

/** 血量：一格一颗爱心，有血实心、没血空心（React 的 Hp） */
function hpNode(ctx: RenderCtx, hp: number, max: number, size: number): HTMLElement {
  var box = el('span', {
    class: 'k-duel__hp',
    style: 'display:inline-block;white-space:nowrap;vertical-align:middle;',
  })
  box.setAttribute('role', 'img')
  box.setAttribute('aria-label', ctx.t('shell.duel.hp', { hp: hp, max: max }))
  var i: number
  for (i = 0; i < max; i++) {
    var full = i < hp
    var cls = full ? 'k-duel__hp-full' : 'k-duel__hp-empty'
    if (svgSupported()) {
      var heart = svg({ viewBox: '0 0 24 24', width: size, height: size, class: cls })
      heart.setAttribute('data-full', full ? 'yes' : 'no')
      heart.setAttribute('style', 'display:inline-block;vertical-align:middle;margin-left:1px;')
      heart.appendChild(
        shape('path', {
          d: HEART,
          fill: full ? '#000' : '#fff',
          stroke: '#000',
          'stroke-width': 2.2,
          'stroke-linejoin': 'round',
        }),
      )
      box.appendChild(heart)
    } else {
      // SVG 不可用：退回实心 / 空心爱心字形 —— 仍然是「实心 vs 空心」，不是颜色
      box.appendChild(
        el(
          'span',
          { class: cls, style: 'display:inline-block;font-size:' + px(size) + ';line-height:1;' },
          full ? '♥' : '♡',
        ),
      )
    }
  }
  return box
}

/**
 * 一发弹（React 的 Token）：弹身 + 底部铜圈。
 *   实弹 live / knownLive：整颗填黑；
 *   空包 blank / knownBlank：白底黑框（空心）；
 *   未知 unknown：虚线框 + ?；
 *   known*（自己看过的那一发）：在实 / 空之外再加一圈粗框（outline，不占布局）；
 *   已打出的实弹：斜纹；已打出的空包：打叉。
 */
function tokenNode(ctx: RenderCtx, kind: DuelToken, spent: boolean, w: number): HTMLElement {
  var label = ctx.t('shell.duel.token.' + (spent ? 'spent-' + kind : kind))
  var filled = kind === 'live' || kind === 'knownLive'
  var known = kind === 'knownLive' || kind === 'knownBlank'
  var style =
    'position:relative;display:inline-block;vertical-align:middle;box-sizing:border-box;text-align:center;' +
    'font-weight:700;overflow:hidden;width:' + px(w) + ';height:' + px(w * 2) + ';line-height:' + px(w * 2 - 6) + ';' +
    'border:2px solid #000;border-radius:4px 4px 2px 2px;' +
    (filled ? 'background:#000;color:#fff;' : 'background:#fff;color:#000;') +
    (kind === 'unknown' ? 'border-style:dashed;' : '') +
    (known ? 'outline:3px solid #000;margin:5px;' : 'margin:2px;') +
    'font-size:' + px(w * 0.8) + ';' +
    (spent && kind === 'live' ? HATCH : '')
  var text: string | null = null
  if (kind === 'unknown') text = '?'
  else if (spent && kind === 'blank') text = '×'
  var node = el('span', { class: 'k-duel__token', style: style }, text)
  node.setAttribute('data-kind', kind)
  node.setAttribute('data-spent', spent ? 'yes' : 'no')
  node.setAttribute('role', 'img')
  node.setAttribute('aria-label', label)
  // 底部铜圈（React 的 ::after）：白底黑框的一条，贴住弹身下沿 —— 带它才像一颗弹壳
  node.appendChild(
    el('span', {
      class: 'k-duel__tokenbase',
      style:
        'position:absolute;left:-2px;right:-2px;bottom:-2px;height:22%;border:2px solid #000;background:#fff;',
    }),
  )
  return node
}

/* ------------------------------------------------------------------ 整场记录 */

/**
 * 整场记录（React 的 Log）：可以往上翻；有新记录时自动停到最新一条（调用方设 scrollTop）。
 * 对手回合的相邻几条（highlight）合进同一个粗框，一眼看出「刚才对面做了什么」。
 * React 用 `groups.at(-1)` 取上一组 —— `Array.prototype.at` 是 ES2022，这里用下标。
 */
function logNode(
  ctx: RenderCtx,
  log: readonly DuelLine[],
  height: number,
  base: number,
  host: StealHost,
  out: { scroll: HTMLElement | null },
): HTMLElement {
  var box = el('div', {
    class: 'k-duel__log',
    style:
      'display:block;box-sizing:border-box;overflow-y:auto;overflow-x:hidden;' +
      'border:1.5px solid #000;padding:4px 8px;font-size:' + fontOf(base, 0.78) + ';' +
      'height:' + px(height) + ';',
  })
  box.setAttribute('role', 'log')
  box.setAttribute('aria-label', ctx.t('shell.duel.recent'))
  out.scroll = box
  // 玩家往上翻时记住位置：这块 DOM 下次是清空重建的，位置只能存在容器上（见 renderDuel 末尾）
  box.addEventListener(
    'scroll',
    function onScroll(): void {
      host.__kLogTop = box.scrollTop
    },
    false,
  )

  var groups: Array<{ highlight: boolean; lines: Array<{ line: DuelLine; index: number }> }> = []
  var i: number
  for (i = 0; i < log.length; i++) {
    var highlight = log[i].highlight === true
    var last = groups.length > 0 ? groups[groups.length - 1] : null
    if (last && last.highlight === highlight) last.lines.push({ line: log[i], index: i })
    else groups.push({ highlight: highlight, lines: [{ line: log[i], index: i }] })
  }

  var lastIndex = log.length - 1
  for (i = 0; i < groups.length; i++) {
    var group = groups[i]
    var list = el('ol', {
      class: group.highlight ? 'k-duel__turnbox' : 'k-duel__plain',
      style: 'margin:0 0 2px 0;padding-left:18px;',
    })
    var k: number
    for (k = 0; k < group.lines.length; k++) {
      var entry = group.lines[k]
      var item = el('li', { style: 'margin:0;' }, lineText(ctx, entry.line))
      item.setAttribute('data-latest', entry.index === lastIndex ? 'yes' : 'no')
      list.appendChild(item)
    }
    box.appendChild(list)
  }
  return box
}

/* ------------------------------------------------------------------ 道具 */

/**
 * 道具槽（React 的 Items）：
 *   - 道具格数**恒定**（itemCapacity）：拿到 / 用掉道具时行高不变，下面的记录不会被顶动；
 *   - 抢道具模式（stealMode）下，对手那几件 `stealable` 的变成可点，回调 `ctx.onSteal(slot)`；
 *   - 其余可点的回调 `ctx.onItem(item.id)`；不可点的画点线框且不绑事件。
 */
function itemsNode(
  ctx: RenderCtx,
  side: DuelSide,
  stealMode: boolean,
  geom: DuelGeometry,
  onPick: (slot: number) => void,
  onSteal: (slot: number) => void,
): HTMLElement {
  var box = el('div', { class: 'k-duel__items', style: 'display:block;white-space:nowrap;' })
  box.setAttribute('data-position', side.position)
  if (stealMode) box.setAttribute('data-steal', 'yes')

  var slotH = side.position === 'bottom' ? geom.bottomSlotH : geom.topSlotH
  var iconSize = clamp(12, Math.round(Math.min(geom.slotW, slotH) * 0.42), 26)
  var i: number
  for (i = 0; i < side.items.length; i++) {
    var item = side.items[i]
    var stealing = stealMode && item.stealable === true
    var usable = stealing || item.selectable
    var cls = 'k-duel__item'
    if (item.fresh) cls += ' k-duel__item--fresh'
    if (!usable) cls += ' k-duel__item--locked'
    // 能用：实线粗框；不能用：点线；抢道具模式下对手可抢的那几格：更粗的实线（线型 + 线宽，不用灰度）
    var border = stealing ? '3px solid #000' : usable ? '2.5px solid #000' : '1.5px dotted #000'
    var style =
      'position:relative;display:inline-block;vertical-align:top;box-sizing:border-box;text-align:center;' +
      'overflow:hidden;background:#fff;color:#000;border-radius:2px;padding:1px;margin-right:2px;' +
      'width:' + px(geom.slotW) + ';height:' + px(slotH) + ';border:' + border + ';' +
      'font-size:' + fontOf(geom.base, side.position === 'bottom' ? 0.56 : 0.5) + ';'
    var children: Array<Node | string | null> = [itemIconNode(item.icon, iconSize)]
    children.push(
      el(
        'span',
        { class: 'k-duel__itemlabel', style: 'display:block;white-space:nowrap;overflow:hidden;line-height:1.1;' },
        ctx.t(item.labelKey),
      ),
    )
    if (item.fresh) {
      children.push(
        el(
          'span',
          {
            class: 'k-duel__fresh',
            style:
              'position:absolute;top:-1px;right:-1px;background:#000;color:#fff;padding:0 3px;line-height:1.1;' +
              'font-size:' + fontOf(geom.base, 0.48) + ';',
          },
          ctx.t('shell.duel.fresh'),
        ),
      )
    }
    var slot = el(
      'button',
      { type: 'button', class: cls, style: style, onclick: usable ? clickAt(stealing ? onSteal : onPick, i) : undefined },
      children,
    )
    slot.setAttribute('data-selectable', usable ? 'yes' : 'no')
    if (stealing) slot.setAttribute('data-stealable', 'yes')
    slot.setAttribute('aria-label', ctx.t(item.labelKey) + (item.fresh ? ' · ' + ctx.t('shell.duel.fresh') : ''))
    if (!usable) {
      slot.setAttribute('disabled', 'disabled')
      slot.setAttribute('aria-disabled', 'true')
    }
    box.appendChild(slot)
  }

  // 空格子：占位（道具格数恒定，行高才不会跳），画虚线框、不响应点击
  var capacity = Math.max(0, side.itemCapacity)
  for (i = side.items.length; i < capacity; i++) {
    var blank = el('span', {
      class: 'k-duel__item k-duel__item--empty',
      style:
        'position:relative;display:inline-block;vertical-align:top;box-sizing:border-box;' +
        'width:' + px(geom.slotW) + ';height:' + px(slotH) + ';border:1.5px dashed #000;border-radius:2px;' +
        'margin-right:2px;',
    })
    blank.setAttribute('aria-hidden', 'true')
    box.appendChild(blank)
  }
  return box
}

/* ------------------------------------------------------------------ 一家 */

/** 一家（React 的 Side）：头像（只有上方那家有）· 名字 / 状态 / 胜局 · 血量 · 道具 */
function sideNode(
  ctx: RenderCtx,
  side: DuelSide,
  stealMode: boolean,
  geom: DuelGeometry,
  onPick: (slot: number) => void,
  onSteal: (slot: number) => void,
): HTMLElement {
  var cls = 'k-duel__side k-duel__side--' + side.position
  if (side.active) cls += ' k-duel__side--active'
  var node = el('section', { class: cls, style: 'display:block;box-sizing:border-box;' })
  node.setAttribute('data-position', side.position)
  node.setAttribute('data-active', side.active ? 'yes' : 'no')
  if (side.active) node.setAttribute('aria-current', 'true')

  // 上方那家有头像：正在行动的一方框加粗一倍（线宽区分，不用灰度）
  var infoIndent = ''
  if (side.position === 'top') {
    var frame = el('span', {
      class: 'k-duel__portrait',
      style:
        'float:left;box-sizing:border-box;width:' + px(geom.portrait) + ';height:' + px(geom.portrait) + ';' +
        'background:#fff;border-radius:6px;border:' + (side.active ? 4 : 2) + 'px solid #000;',
    })
    var portrait = portraitNode(side.portrait, geom.portrait - 8)
    if (portrait) frame.appendChild(portrait)
    node.appendChild(frame)
    infoIndent = 'margin-left:' + px(geom.portrait + 10) + ';'
  }

  var info = el('div', { class: 'k-duel__info', style: 'display:block;' + infoIndent })
  var head = el('div', {
    class: 'k-duel__head',
    style: 'display:block;white-space:nowrap;min-height:' + px(geom.base * 1.6) + ';',
  })

  var nameStyle = 'display:inline-block;vertical-align:middle;font-weight:700;margin-right:6px;'
  // 下方一家没有头像：轮到自己时用「加粗下划线」代替头像框加粗（React 的 CSS 口径）
  if (side.position === 'bottom' && side.active) nameStyle += 'text-decoration:underline;'
  head.appendChild(el('span', { class: 'k-duel__name', style: nameStyle }, ctx.t(side.nameKey)))

  if (side.statusKey) {
    head.appendChild(
      el(
        'span',
        {
          class: 'k-duel__status',
          style:
            'display:inline-block;vertical-align:middle;margin-right:6px;padding:2px 6px;white-space:nowrap;' +
            'background:#000;color:#fff;font-size:' + fontOf(geom.base, 0.75) + ';line-height:1.2;',
        },
        ctx.t(side.statusKey),
      ),
    )
  }
  if (side.wins > 0) {
    head.appendChild(
      el(
        'span',
        {
          class: 'k-duel__wins',
          style:
            'display:inline-block;vertical-align:middle;margin-right:6px;padding:2px 6px;white-space:nowrap;' +
            'border:1.5px solid #000;font-size:' + fontOf(geom.base, 0.75) + ';line-height:1.2;',
        },
        ctx.t('shell.duel.wins', { count: side.wins }),
      ),
    )
  }
  // 血量靠右（React: margin-left:auto），老引擎上用 float 实现
  head.appendChild(el('span', { style: 'float:right;' }, hpNode(ctx, side.hp, side.maxHp, geom.heart)))
  info.appendChild(head)

  info.appendChild(itemsNode(ctx, side, stealMode, geom, onPick, onSteal))
  node.appendChild(info)
  node.appendChild(el('div', { style: 'clear:both;height:0;overflow:hidden;' }))
  return node
}

/* ------------------------------------------------------------------ 枪 / 定格画面 */

/** 枪（React 的 Gun）：锯短时枪管变短、枪口多一道锯齿 */
function gunNode(sawn: boolean, width: number, height: number): SVGElement | null {
  if (!svgSupported()) return null
  var barrel = sawn ? 70 : 120
  var node = svg({ viewBox: '0 0 300 64', width: width, height: height, preserveAspectRatio: 'xMinYMid meet' })
  node.setAttribute('style', 'display:block;')
  node.appendChild(
    shape('path', {
      d: 'M6 44 Q28 30 76 28 L116 26 L116 44 L94 44 Q88 52 78 52 L68 46 Q38 50 14 58 Z',
      fill: '#000',
    }),
  )
  node.appendChild(shape('rect', { x: 116, y: 20, width: 56, height: 26, rx: 3, fill: '#000' }))
  node.appendChild(shape('path', { d: 'M126 46 q6 12 18 10', fill: 'none', stroke: '#000', 'stroke-width': 3 }))
  node.appendChild(shape('rect', { x: 172, y: 22, width: barrel, height: 9, fill: '#000' }))
  node.appendChild(shape('rect', { x: 172, y: 34, width: barrel, height: 9, fill: '#000' }))
  if (sawn) {
    node.appendChild(
      shape('path', {
        d: 'M' + (172 + barrel) + ' 20 l6 6 -6 6 6 6 -6 6',
        fill: 'none',
        stroke: '#000',
        'stroke-width': 2.4,
      }),
    )
  }
  return node
}

/** 枪口爆闪：实心多角星 —— 1-bit 下最醒目的「开火了」（React 的 Blast） */
function blastNode(size: number): Node {
  if (!svgSupported()) return document.createTextNode('★')
  var node = svg({ viewBox: '0 0 100 100', width: size, height: size, class: 'k-duel__blast' })
  node.setAttribute('style', 'display:block;margin:0 auto;')
  node.appendChild(
    shape('path', {
      d:
        'M50 1 L59 32 L90 14 L70 43 L99 50 L70 57 L90 86 L59 68 L50 99 L41 68 L10 86 L30 57 L1 50 L30 43 L10 14 L41 32 Z',
      fill: '#000',
    }),
  )
  return node
}

/** 空膛：空心膛口 + 打叉（空包弹那一声「咔」）—— React 的 Dud */
function dudNode(size: number): Node {
  if (!svgSupported()) return document.createTextNode('×')
  var node = svg({ viewBox: '0 0 100 100', width: size, height: size, class: 'k-duel__dud' })
  node.setAttribute('style', 'display:block;margin:0 auto;')
  node.appendChild(shape('circle', { cx: 50, cy: 50, r: 36, fill: 'none', stroke: '#000', 'stroke-width': 7 }))
  node.appendChild(
    shape('path', { d: 'M32 32 L68 68 M68 32 L32 68', stroke: '#000', 'stroke-width': 9, 'stroke-linecap': 'round' }),
  )
  return node
}

/**
 * 开枪定格画面（React 的 FireScene + fireCaption）：**单独占满「枪 / 弹仓 / 说明」这一段**。
 *
 * 为什么整块仍是白底黑字：黑带白字与整块反色一起在俄罗斯方块的消行特效里做过、被真机否掉
 * （docs/eink-guidelines.md 的口径是「白底黑字」）。所以这里只有**标题带**反白（实弹）——
 * 对比度给足，又不把整屏压黑。空包用白底 + 粗虚线框：实心 vs 空心、实线 vs 虚线，
 * 都是 1-bit 的原生手段，不依赖灰阶。记录与两侧始终露着：用户要求「不要把战斗日志挡住」。
 */
function fireNode(
  ctx: RenderCtx,
  fire: DuelFireScene,
  geom: DuelGeometry,
  nameOf: (pos: string) => string,
): HTMLElement {
  var live = fire.shell === 'live'
  var node = el('span', {
    class: 'k-duel__fire k-duel__fire--' + fire.shell,
    style:
      'position:absolute;left:0;top:0;right:0;bottom:0;z-index:3;box-sizing:border-box;display:block;' +
      'background:#fff;color:#000;text-align:center;overflow:hidden;font-size:' + fontOf(geom.base, 1) + ';' +
      'border:' + (live ? 5 : 3) + 'px ' + (live ? 'solid' : 'dashed') + ' #000;',
  })
  node.setAttribute('data-shell', fire.shell)
  node.setAttribute('data-lethal', fire.lethal ? 'yes' : 'no')
  node.setAttribute('role', 'status')

  // 竖排居中：老 WebKit 上没有 flex，用 table / table-cell（最稳的两句 display）
  var middle = el('div', { style: 'display:table;width:100%;height:100%;' })
  var cellBox = el('div', { style: 'display:table-cell;vertical-align:middle;text-align:center;' })

  cellBox.appendChild(live ? blastNode(geom.fireIcon) : dudNode(geom.fireIcon))

  // 标题带：大字 + 反白（实弹）/ 粗虚线框（空包）—— 一眼看出「这一枪是什么」
  cellBox.appendChild(
    el(
      'span',
      {
        class: 'k-duel__firetitle',
        style:
          'display:inline-block;margin:4px 0;padding:2px 12px;font-size:' + fontOf(geom.base, 1.7) + ';' +
          'font-weight:900;letter-spacing:1px;line-height:1.25;' +
          (live ? 'background:#000;color:#fff;border:2px solid #000;' : 'background:#fff;color:#000;border:3px dashed #000;'),
      },
      ctx.t(live ? 'shell.duel.fire.live' : 'shell.duel.fire.blank') +
        (fire.damage > 0 ? ' ' + ctx.t('shell.duel.fire.damage', { amount: fire.damage }) : ''),
    ),
  )

  // 击倒：反白小标（文字本身已经在下面那行说明里，这里只是把它顶出来）
  if (fire.lethal) {
    cellBox.appendChild(
      el(
        'div',
        {},
        el(
          'span',
          {
            class: 'k-duel__fireknock',
            style:
              'display:inline-block;padding:0 8px;font-weight:900;background:#000;color:#fff;border:2px solid #000;' +
              'font-size:' + fontOf(geom.base, 1) + ';',
          },
          ctx.t('shell.duel.fire.knockdown'),
        ),
      ),
    )
  }

  // 说明行：击倒 · 谁打谁 · 掉几格（说明行本来就占着位置，出现 / 消失都不会让高度跳）
  cellBox.appendChild(
    el(
      'div',
      {
        class: 'k-duel__firecaption',
        style: 'font-weight:800;font-size:' + fontOf(geom.base, 1.05) + ';line-height:1.3;',
      },
      fireCaption(ctx, fire, nameOf),
    ),
  )

  middle.appendChild(cellBox)
  node.appendChild(middle)
  return node
}

/* ------------------------------------------------------------------ 尺寸 */

interface DuelGeometry {
  base: number
  tokenW: number
  heart: number
  slotW: number
  topSlotH: number
  bottomSlotH: number
  portrait: number
  gunH: number
  fireIcon: number
  logH: number
}

/**
 * 尺寸（React 版由 CSS 的容器查询算，这里按 ctx 的宽高算）：
 *   --token-w: min(22px, 5cqw)；爱心 1.25em；道具槽单行 8 格（上家 44px、下家 48px）；
 *   portrait: min(11cqh, 64px)；枪高 min(8cqh, 56px)。
 * 记录框（React 里是 flex:1 1 auto 吃掉剩余高度）在这里用「总高 − 上下两家 − 枪那一段」估出来。
 */
function duelGeometry(ctx: RenderCtx): DuelGeometry {
  var width = widthOf(ctx)
  var height = heightOf(ctx)
  var base = baseFont(height)

  var tokenW = clamp(10, Math.round(width * 0.05), 22)
  var heart = clamp(12, Math.round(base * 1.25), 22)
  var slotW = clamp(40, Math.floor((width - 16) / 8), 76)
  var topSlotH = height > 0 ? Math.min(44, Math.round(height * 0.08)) : 44
  var bottomSlotH = height > 0 ? Math.min(48, Math.round(height * 0.096)) : 48
  topSlotH = Math.max(30, topSlotH)
  bottomSlotH = Math.max(34, bottomSlotH)

  var portrait = Math.min(Math.round(width * 0.12), 64)
  if (height > 0) portrait = Math.min(portrait, Math.round(height * 0.11))
  portrait = Math.max(40, portrait)

  var gunH = height > 0 ? Math.min(56, Math.round(height * 0.08)) : 44
  gunH = Math.max(30, gunH)

  var headH = Math.round(base * 1.6)
  var topSideH = Math.max(portrait, headH + GAP + topSlotH)
  var bottomSideH = headH + GAP + bottomSlotH
  // 枪那一行 + 弹仓 + 剩余 + 说明 + 上下边框与内边距（React 真机实测 table ≈ 172px）
  var tableH = gunH + tokenW * 2 + Math.round(base * 3.2) + GAP * 2
  var logH = 140
  if (height > 0) logH = clamp(80, height - (topSideH + tableH + bottomSideH + GAP * 3), 400)

  return {
    base: base,
    tokenW: tokenW,
    heart: heart,
    slotW: slotW,
    topSlotH: topSlotH,
    bottomSlotH: bottomSlotH,
    portrait: portrait,
    gunH: gunH,
    fireIcon: clamp(28, Math.round(height > 0 ? height * 0.1 : 40), 56),
    logH: logH,
  }
}

/* ------------------------------------------------------------------ 入口 */

function findSide(duel: DuelView, position: string): DuelSide | null {
  var i: number
  for (i = 0; i < duel.sides.length; i++) {
    if (duel.sides[i].position === position) return duel.sides[i]
  }
  return null
}

function itemAt(side: DuelSide, slot: number): DuelItem | null {
  if (slot < 0 || slot >= side.items.length) return null
  return side.items[slot]
}

/** 有没有「现在能抢的」道具：有，抢道具模式才真的亮起来（React 的 armed） */
function anyStealable(duel: DuelView): boolean {
  var i: number
  var k: number
  for (i = 0; i < duel.sides.length; i++) {
    for (k = 0; k < duel.sides[i].items.length; k++) {
      if (duel.sides[i].items[k].stealable === true) return true
    }
  }
  return false
}

/**
 * 对决面板入口（React 的 `DuelPanel`）。
 *
 * 抢道具是**两步**操作：先点自己那件肾上腺素、再点对手那一格。
 * 这一步状态只活在面板里（不进存档、不进规则层）—— React 用 useState，这里存在容器元素上，
 * 屏幕一换就跟着消失；改变它时自己重渲染一次（等价于 React 的 setState 重渲染）。
 * 真正抢的时候只清状态、把槽位号交给壳层（`ctx.onSteal`），由壳层转成动作 ——
 * 渲染器不判断规则，也不认识肾上腺素是什么，只认「这个 labelKey 的那件道具」。
 */
export function renderDuel(container: HTMLElement, duel: DuelView, ctx: RenderCtx): void {
  clear(container)
  var host = container as StealHost
  var stealMode = host.__kStealMode === true
  var armed = stealMode && anyStealable(duel)
  var geom = duelGeometry(ctx)
  var top = findSide(duel, 'top')
  var bottom = findSide(duel, 'bottom')

  function nameOf(position: string): string {
    var side = position === 'top' ? top : position === 'bottom' ? bottom : null
    // 名字同样是 key；那一方不在场时给空串，不拿空 key 去查词表（缺 key 会显示 ⟦⟧）
    return side ? ctx.t(side.nameKey) : ''
  }

  function pickFor(side: DuelSide): (slot: number) => void {
    return function pick(slot: number): void {
      var item = itemAt(side, slot)
      if (!item) return
      // 肾上腺素不是「直接用」的道具：点它进入 / 退出选择状态，再点一次取消（React 的口径）
      if (item.labelKey === 'buckshot.item.adrenaline') {
        host.__kStealMode = host.__kStealMode !== true
        renderDuel(container, duel, ctx)
        return
      }
      ctx.onItem(item.id)
    }
  }

  function stealAt(slot: number): void {
    host.__kStealMode = false
    // 槽位号就是「第几格」（RenderCtx 的契约）；壳层把它交给游戏的 stealAction
    ctx.onSteal(slot)
  }

  var root = el('div', { class: 'k-duel', style: 'display:block;box-sizing:border-box;width:100%;' })

  if (top) root.appendChild(sideNode(ctx, top, armed, geom, pickFor(top), stealAt))

  // 枪 / 弹仓 / 说明这一段：定格画面就盖在这一段上（战斗记录在它外面，永远露着）
  var stage = el('div', { class: 'k-duel__stage', style: 'position:relative;display:block;' })
  var table = el('section', {
    class: 'k-duel__table',
    style:
      'display:block;box-sizing:border-box;padding:' + px(GAP) + ' 0;text-align:center;' +
      'border-top:2px solid #000;border-bottom:2px solid #000;',
  })

  var gunrow = el('div', { class: 'k-duel__gunrow', style: 'display:block;white-space:nowrap;' })
  var gun = gunNode(duel.sawn, Math.round(widthOf(ctx) * 0.5), geom.gunH)
  if (gun) {
    gun.setAttribute('class', 'k-duel__gun')
    gun.setAttribute('style', 'display:inline-block;vertical-align:middle;')
    gunrow.appendChild(gun)
  }
  if (duel.tags.length > 0) {
    var tags = el('span', {
      class: 'k-duel__tags',
      style: 'display:inline-block;vertical-align:middle;margin-left:6px;',
    })
    var t: number
    for (t = 0; t < duel.tags.length; t++) {
      tags.appendChild(
        el(
          'span',
          {
            class: 'k-duel__tag',
            style:
              'display:inline-block;margin-left:4px;padding:1px 6px;white-space:nowrap;border:2px solid #000;' +
              'font-weight:700;font-size:' + fontOf(geom.base, 0.75) + ';',
          },
          lineText(ctx, duel.tags[t]),
        ),
      )
    }
    gunrow.appendChild(tags)
  }
  table.appendChild(gunrow)

  // 弹仓：「已打出 | 枪里」。已打出一组**常驻**（没有时 visibility:hidden 但占着宽度）——
  // 否则首次开枪多出这一组、枪那一段变高，下面的记录会被挤矮一截（React 真机实测差 33px）。
  var chamber = el('div', { class: 'k-duel__chamber', style: 'display:block;white-space:nowrap;' })
  var spentBox = el('span', {
    class: 'k-duel__spent',
    style: 'display:inline-block;vertical-align:middle;' + (duel.spent.length > 0 ? '' : 'visibility:hidden;'),
  })
  spentBox.setAttribute('data-empty', duel.spent.length > 0 ? 'no' : 'yes')
  spentBox.appendChild(
    el(
      'span',
      {
        class: 'k-duel__label',
        style: 'display:inline-block;vertical-align:middle;font-size:' + fontOf(geom.base, 0.72) + ';',
      },
      ctx.t('shell.duel.spent'),
    ),
  )
  var s: number
  for (s = 0; s < duel.spent.length; s++) {
    spentBox.appendChild(tokenNode(ctx, duel.spent[s], true, geom.tokenW))
  }
  spentBox.appendChild(
    el('span', {
      class: 'k-duel__sep',
      style:
        'display:inline-block;vertical-align:middle;width:2px;height:' + px(geom.tokenW * 1.6) + ';' +
        'background:#000;margin:0 4px;',
    }),
  )
  chamber.appendChild(spentBox)
  chamber.appendChild(
    el(
      'span',
      {
        class: 'k-duel__label',
        style: 'display:inline-block;vertical-align:middle;font-size:' + fontOf(geom.base, 0.72) + ';',
      },
      ctx.t('shell.duel.chamber'),
    ),
  )
  var c: number
  for (c = 0; c < duel.chamber.length; c++) {
    chamber.appendChild(tokenNode(ctx, duel.chamber[c], false, geom.tokenW))
  }
  table.appendChild(chamber)

  // 「剩余」行同样常驻：装填阶段没有它，但空行占着位置 —— 否则点「开始」时这一行凭空出现，日志又会被挤矮。
  // 占位用不换行空格（与 React 一样）：普通空格在有些引擎上会被折叠掉，整行高度就塌了。
  var remaining = el(
    'p',
    { class: 'k-duel__remaining', style: 'margin:2px 0;font-weight:700;font-size:' + fontOf(geom.base, 0.9) + ';' },
    duel.remaining ? lineText(ctx, duel.remaining) : '\u00a0',
  )
  if (!duel.remaining) remaining.setAttribute('aria-hidden', 'true')
  table.appendChild(remaining)

  var caption = el(
    'p',
    {
      class: 'k-duel__caption',
      style: 'margin:2px 0;font-weight:700;text-align:center;font-size:' + fontOf(geom.base, 0.85) + ';',
    },
    armed ? ctx.t('buckshot.steal.pick') : duel.fire ? fireCaption(ctx, duel.fire, nameOf) : lineText(ctx, duel.caption),
  )
  caption.setAttribute('role', 'status')
  table.appendChild(caption)

  stage.appendChild(table)
  // 定格画面盖住「枪 / 弹仓 / 说明」这一段：不挡记录，也不把下面的东西顶动（绝对定位）
  if (duel.fire) stage.appendChild(fireNode(ctx, duel.fire, geom, nameOf))
  root.appendChild(stage)

  var scroll: { scroll: HTMLElement | null } = { scroll: null }
  root.appendChild(logNode(ctx, duel.log, geom.logH, geom.base, host, scroll))

  if (bottom) root.appendChild(sideNode(ctx, bottom, armed, geom, pickFor(bottom), stealAt))

  container.appendChild(root)

  /*
   * 记录框的滚动条（React 的 useLayoutEffect，依赖 log.length）：
   * - 有新记录 → 停到最新一条（黑底白字那一屏之后第一眼要看的就是它）；
   * - 没有新记录（例如只是进出抢道具模式）→ 恢复玩家上次翻到的位置。
   * 这里比 React 多一句「恢复」：React 是原地更新、同一个节点自己保住滚动位置，
   * 而这块 DOM 每次都是清空重建的 —— 不记住的话，往上翻之后一重渲染就跳回顶部。
   */
  if (scroll.scroll) {
    if (host.__kLogLen !== duel.log.length) {
      scroll.scroll.scrollTop = scroll.scroll.scrollHeight
    } else if (host.__kLogTop !== undefined) {
      scroll.scroll.scrollTop = host.__kLogTop
    } else {
      scroll.scroll.scrollTop = scroll.scroll.scrollHeight
    }
    host.__kLogLen = duel.log.length
    host.__kLogTop = scroll.scroll.scrollTop
  }
}
