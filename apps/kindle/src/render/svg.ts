/**
 * 内联 SVG 小工具。
 *
 * 为什么用 SVG 画棋子而不是字体符号：1-bit 屏上灰度不可用，
 * 形状（空心/实心/线宽/朝向）才是唯一的区分手段，而 SVG 能精确控制这些；
 * 字体符号在不同固件上的字形差别太大（甚至缺字）。
 *
 * 老引擎兜底：`svgSupported()` 探一次，不支持时由调用方退化成文字符号。
 */
const SVG_NS = 'http://www.w3.org/2000/svg'

let svgOk: boolean | null = null

/** 探测一次：老 WebKit 上 createElementNS 或 SVG 可能不可用。 */
export function svgSupported(): boolean {
  if (svgOk !== null) return svgOk
  try {
    const node = document.createElementNS(SVG_NS, 'svg')
    svgOk = !!node && typeof node.setAttribute === 'function' && 'ownerSVGElement' in node
  } catch (e) {
    svgOk = false
  }
  return svgOk
}

export function svg(attrs: Record<string, string | number>): SVGElement {
  const node = document.createElementNS(SVG_NS, 'svg')
  node.setAttribute('viewBox', '0 0 24 24')
  node.setAttribute('aria-hidden', 'true')
  node.setAttribute('focusable', 'false')
  for (const key in attrs) {
    if (!Object.prototype.hasOwnProperty.call(attrs, key)) continue
    node.setAttribute(key, String(attrs[key]))
  }
  return node
}

export function shape(tag: string, attrs: Record<string, string | number>): SVGElement {
  const node = document.createElementNS(SVG_NS, tag)
  for (const key in attrs) {
    if (!Object.prototype.hasOwnProperty.call(attrs, key)) continue
    node.setAttribute(key, String(attrs[key]))
  }
  return node
}
