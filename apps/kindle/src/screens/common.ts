/**
 * 屏幕公共部件：顶栏、按钮、分页器、对话框、结果面板、提示条。
 * 全部内联样式（老引擎上外部样式表只做粗排版，关键几何由内联属性保证）。
 */
import { el, clear, on } from '../dom.js'
import type { ScreenCtx } from '../screen-ctx.js'

export interface TopBarOptions {
  title: string
  subtitle?: string
  onBack?: (() => void) | null
  /** 右侧动作（如「设置」「菜单」） */
  actions?: Array<{ label: string; onClick: () => void }>
}

export function topBar(ctx: ScreenCtx, options: TopBarOptions): HTMLElement {
  const bar = el('div', { class: 'k-topbar', style: 'position:relative;padding:6px 8px;border-bottom:1px solid #000;background:#fff;min-height:44px;' })
  const row = el('div', { style: 'display:table;width:100%;table-layout:fixed;' })

  const left = el('div', { style: 'display:table-cell;width:25%;vertical-align:middle;text-align:left;' })
  if (options.onBack) {
    left.appendChild(button(ctx.t('shell.common.close'), options.onBack, { small: true }))
  }
  const middle = el('div', { style: 'display:table-cell;vertical-align:middle;text-align:center;' })
  middle.appendChild(el('div', { class: 'k-topbar__title', style: 'font-size:17px;font-weight:700;line-height:1.2;' }, options.title))
  if (options.subtitle) {
    middle.appendChild(el('div', { style: 'font-size:12px;line-height:1.3;' }, options.subtitle))
  }
  const right = el('div', { style: 'display:table-cell;width:25%;vertical-align:middle;text-align:right;white-space:nowrap;' })
  const actions = options.actions ?? []
  for (let i = 0; i < actions.length; i++) {
    const action = actions[i]
    right.appendChild(button(action.label, action.onClick, { small: true }))
  }

  row.appendChild(left)
  row.appendChild(middle)
  row.appendChild(right)
  bar.appendChild(row)
  return bar
}

export interface ButtonOptions {
  small?: boolean
  primary?: boolean
  disabled?: boolean
  /** 危险操作（清除数据等）：用虚线边框区分，不靠颜色 */
  danger?: boolean
  block?: boolean
}

/** 通用按钮：最小 44px 高（墨水屏触摸目标下限） */
export function button(label: string, onClick: () => void, options?: ButtonOptions): HTMLElement {
  const opts = options ?? {}
  const height = opts.small ? 34 : 44
  let css =
    'display:inline-block;height:' + height + 'px;line-height:' + (height - 4) + 'px;' +
    'padding:0 ' + (opts.small ? 8 : 14) + 'px;margin:0 3px 4px 0;box-sizing:border-box;' +
    'border:1px solid #000;border-radius:4px;font-size:' + (opts.small ? 13 : 15) + 'px;' +
    'text-align:center;white-space:nowrap;overflow:hidden;text-decoration:none;'
  if (opts.block) css += 'display:block;width:100%;margin:0 0 8px 0;'
  if (opts.disabled) css += 'border-style:dashed;background:#fff;color:#000;'
  else if (opts.primary) css += 'background:#000;color:#fff;'
  else if (opts.danger) css += 'border-style:dashed;background:#fff;color:#000;'
  else css += 'background:#fff;color:#000;'
  const node = el('button', { class: 'k-btn' + (opts.primary ? ' k-btn--primary' : ''), type: 'button', style: css }, label)
  if (opts.disabled) {
    node.setAttribute('disabled', 'disabled')
  } else {
    node.addEventListener('click', function clicked(): void {
      onClick()
    }, false)
  }
  return node
}

/** 分页器：墨水屏上只翻页、不滚动 */
export function pager(ctx: ScreenCtx, page: number, pageCount: number, onGo: (next: number) => void): HTMLElement {
  const wrap = el('div', { class: 'k-pager', style: 'text-align:center;padding:6px 0;border-top:1px solid #000;' })
  wrap.appendChild(button(ctx.t('shell.pager.prev'), function prev(): void {
    if (page > 0) onGo(page - 1)
  }, { small: true, disabled: page <= 0 }))
  wrap.appendChild(el('span', { class: 'k-pager__info', style: 'font-size:14px;margin:0 10px;' }, String(page + 1) + ' / ' + String(pageCount)))
  wrap.appendChild(button(ctx.t('shell.pager.next'), function next(): void {
    if (page < pageCount - 1) onGo(page + 1)
  }, { small: true, disabled: page >= pageCount - 1 }))
  return wrap
}

export interface DialogOptions {
  title: string
  body?: string
  /** 多行正文：**每一行单独一个节点** —— 文本节点里的 `\n` 在 HTML 里会被折成空格，
   *  结果面板的明细（步数 / 用时 / 最佳）会全挤在一行上。 */
  bodyLines?: string[]
  actions: Array<{ label: string; onClick: () => void; primary?: boolean }>
  onDismiss?: () => void
}

/**
 * 当前打开着的对话框（关闭函数）。
 *
 * 为什么需要登记：对话框是挂在 `document.body` 上的（不是屏幕根节点 `#k-root`），
 * 而切屏只清 `#k-root` —— 于是**切换屏幕时对话框会留下来**。
 * 真机路径：一局结束 → 结果面板 → 按物理返回键回书库 → 结果面板一直浮在书库上面，
 * 挡住内容又关不掉（它自己的按钮已经不在了）。这条被"打到终局"的测试逮到过。
 */
const openDialogs: Array<() => void> = []

/** 切屏前统一收掉所有对话框（静默关闭，不触发各自的 onDismiss） */
export function closeAllDialogs(): void {
  while (openDialogs.length > 0) {
    const close = openDialogs.pop()
    if (close) close()
  }
}

/**
 * 模态对话框。
 * 用 fixed 覆盖层而不是 <dialog>：`<dialog>` 在老 WebKit 上不存在。
 */
export function showDialog(options: DialogOptions): () => void {
  const overlay = el('div', {
    class: 'k-dialog',
    style: 'position:fixed;left:0;top:0;width:100%;height:100%;background:rgba(0,0,0,0.45);z-index:1000;',
  })
  const box = el('div', {
    class: 'k-dialog__panel',
    style:
      'position:absolute;left:50%;top:50%;width:86%;max-width:420px;margin-left:-43%;' +
      'background:#fff;border:2px solid #000;border-radius:6px;padding:16px;box-sizing:border-box;',
  })
  box.appendChild(el('div', { class: 'k-dialog__title', style: 'font-size:17px;font-weight:700;margin-bottom:10px;text-align:center;' }, options.title))
  if (options.body) {
    box.appendChild(el('div', { style: 'font-size:14px;line-height:1.5;margin-bottom:14px;' }, options.body))
  }
  const lines = options.bodyLines ?? []
  if (lines.length > 0) {
    const bodyBox = el('div', { style: 'font-size:14px;line-height:1.6;margin-bottom:14px;' })
    for (let i = 0; i < lines.length; i++) {
      // 空行留一个占位高度，避免"明细之间的分隔"被吃掉
      bodyBox.appendChild(el('div', { style: 'min-height:1.2em;' }, lines[i]))
    }
    box.appendChild(bodyBox)
  }
  const actions = el('div', { class: 'k-dialog__actions', style: 'text-align:center;' })
  for (let i = 0; i < options.actions.length; i++) {
    const action = options.actions[i]
    actions.appendChild(button(action.label, function wrap(): void {
      close()
      action.onClick()
    }, { primary: action.primary === true }))
  }
  box.appendChild(actions)
  overlay.appendChild(box)

  let closed = false
  function close(): void {
    if (closed) return
    closed = true
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay)
    const index = openDialogs.indexOf(close)
    if (index >= 0) openDialogs.splice(index, 1)
    if (options.onDismiss) options.onDismiss()
  }
  openDialogs.push(close)

  // 点遮罩关闭（和 dismiss 语义一致）
  overlay.addEventListener('click', function maskClick(event: Event): void {
    if (event.target === overlay) close()
  }, false)

  document.body.appendChild(overlay)
  // 把焦点给第一个按钮：Kindle 有物理键，焦点在哪里很重要
  const first = box.querySelector('button')
  if (first) {
    try {
      ;(first as HTMLButtonElement).focus()
    } catch (e) {
      /* 老引擎可能不支持 focus，忽略 */
    }
  }
  return close
}

/** 顶部一行状态提示（保存成功 / 走不通 / 坏档提示） */
export function statusLine(text: string | null): HTMLElement | null {
  if (!text) return null
  return el('div', {
    class: 'k-notice',
    style: 'padding:6px 10px;border-bottom:1px solid #000;background:#000;color:#fff;font-size:13px;',
  }, text)
}

/** 一行「标签: 值」 */
export function field(label: string, value: string): HTMLElement {
  return el(
    'div',
    { style: 'padding:4px 0;font-size:14px;line-height:1.45;' },
    el('span', { style: 'font-weight:700;' }, label + ': '),
    el('span', {}, value),
  )
}

/** 进度条（1-bit：实心段 + 空心段，不靠灰度） */
export function progressBar(done: number, total: number, width: number): HTMLElement {
  const cells = Math.max(1, Math.min(total, 20))
  const filled = total > 0 ? Math.round((done / total) * cells) : 0
  let text = ''
  for (let i = 0; i < cells; i++) text += i < filled ? '■' : '□'
  return el('span', { style: 'font-size:' + Math.max(12, Math.round(width / 28)) + 'px;letter-spacing:1px;' }, text)
}

/** 在 root 上装一次「返回」键（Kindle 的物理返回/ESC 都走这里） */
export function bindBackKey(onBack: () => void): () => void {
  return on(document, 'keydown', function keydown(event: Event): void {
    const e = event as KeyboardEvent
    const code = e.keyCode || 0
    // 27 = Esc；8 = Backspace；Kindle 的物理返回键通常上报其中之一
    if (code === 27 || code === 8) {
      e.preventDefault()
      onBack()
    }
  })
}

export function screenRoot(): HTMLElement {
  const existing = document.getElementById('k-root')
  if (existing) return existing
  const node = el('div', { id: 'k-root', class: 'k-app' })
  document.body.appendChild(node)
  return node
}

export function mount(root: HTMLElement, children: HTMLElement[]): void {
  clear(root)
  for (let i = 0; i < children.length; i++) root.appendChild(children[i])
}
