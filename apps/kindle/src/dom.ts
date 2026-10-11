/**
 * 极简 DOM 工具（ES5 目标，无框架依赖）。
 *
 * 约束（Kindle 自带浏览器 = 老 WebKit）：
 * - 只用 ES5 语法：产物里不得出现箭头函数 / let / const / 模板字符串 / class；
 * - 不拼 innerHTML（避免转义问题），一律建节点 + textContent；
 * - 不依赖 CSS 变量 / grid / calc()。
 */

export type Attrs = Record<string, string | number | boolean | EventListener | undefined>

/** 建元素：attrs 里 `on*` 视为事件，`class` 视为类名，其余走 setAttribute。 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Attrs | null,
  ...children: Array<Node | string | number | Array<Node | string | number | null | undefined> | null | undefined>
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (attrs) {
    for (const key in attrs) {
      if (!Object.prototype.hasOwnProperty.call(attrs, key)) continue
      const value = attrs[key]
      if (value === undefined || value === null || value === false) continue
      if (key === 'class' || key === 'className') {
        node.className = String(value)
      } else if (key.length > 2 && key.charAt(0) === 'o' && key.charAt(1) === 'n') {
        node.addEventListener(key.slice(2).toLowerCase(), value as EventListener, false)
      } else {
        node.setAttribute(key, String(value))
      }
    }
  }
  for (let i = 0; i < children.length; i++) append(node, children[i])
  return node
}

/** 追加子节点：字符串变成文本节点（不解析 HTML）。 */
export function append(
  parent: Node,
  child: Node | string | number | Array<Node | string | number | null | undefined> | null | undefined,
): void {
  if (child === null || child === undefined) return
  if (Object.prototype.toString.call(child) === '[object Array]') {
    const list = child as Array<Node | string | number | null | undefined>
    for (let i = 0; i < list.length; i++) append(parent, list[i])
    return
  }
  if (typeof child === 'string' || typeof child === 'number') {
    parent.appendChild(document.createTextNode(String(child)))
    return
  }
  parent.appendChild(child as Node)
}

/** 清空子节点。 */
export function clear(node: Node): void {
  while (node.firstChild) node.removeChild(node.firstChild)
}

/** 绑定事件，返回解绑函数（屏幕清理时统一调用，避免监听器泄漏）。 */
export function on(
  target: EventTarget,
  type: string,
  handler: EventListener,
  capture?: boolean,
): () => void {
  target.addEventListener(type, handler, capture === true)
  return function off(): void {
    target.removeEventListener(type, handler, capture === true)
  }
}

/** 直接写 style 属性：不依赖外部样式表，老引擎最稳。 */
export function style(node: HTMLElement, rules: Record<string, string | number>): void {
  let css = node.getAttribute('style') || ''
  for (const key in rules) {
    if (!Object.prototype.hasOwnProperty.call(rules, key)) continue
    const value = rules[key]
    if (value === undefined || value === null) continue
    const prop = key.replace(/[A-Z]/g, function (m: string): string {
      return '-' + m.toLowerCase()
    })
    css += prop + ':' + String(value) + ';'
  }
  node.setAttribute('style', css)
}
