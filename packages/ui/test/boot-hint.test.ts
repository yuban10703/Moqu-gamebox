/**
 * 启动兜底（apps/web/index.html）的源码护栏 —— 读 index.html 的源码文本，钉住三件事。
 *
 * 由来：汉王墨水屏设备实测**纯白屏**。根因是该机系统 WebView 引擎过旧：bundle 里有
 * ??= / ||= / &&=（**语法级**，Chromium < 85 直接 SyntaxError）与 .at(-1)（需 92），
 * 模块脚本一挂就整段不执行；而壳层又没实现 onConsoleMessage，报错无处可见 ——
 * 页面上只剩一个空的 #root，即"纯白"。
 *
 * 所以 index.html 里必须有两级**不依赖模块**的兜底：
 *   ① 纯 HTML 静态占位（零 JS，能显示就说明渲染链路是通的）；
 *   ② 经典脚本（非 module）+ 纯 ES5 语法，2.5 秒后占位还在就把整页换成可读提示。
 *
 * 为什么读源码文本而不是跑浏览器：这条护栏要拦的恰恰是"新语法混进兜底脚本"——
 * 当前 Node 与 jsdom 都能解析新语法，任何"跑一遍"的测试永远是绿的；
 * 只有把"不许出现的语法"钉在**文本**上，退化时才会红。
 * （位置说明：vitest.config.ts 的 include 只收各 package 下的 test 目录，apps/web 没有测试目录，
 *   所以放这里；它读的是应用外壳的 index.html，与 UI 包的运行时代码没有依赖。）
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const html = readFileSync(new URL('../../../apps/web/index.html', import.meta.url), 'utf8')

/** 脚本里**不许出现**的语法：老引擎上它们不是"行为不同"，而是整段解析失败 */
const MODERN_SYNTAX: Array<{ name: string; pattern: RegExp }> = [
  { name: '箭头函数 =>', pattern: /=>/ },
  { name: '块级声明 const', pattern: /\bconst\b/ },
  { name: '块级声明 let', pattern: /\blet\b/ },
  { name: '模板字符串（反引号）', pattern: /`/ },
  { name: '可选链 ?.', pattern: /\?\./ },
  { name: '空值合并 ??', pattern: /\?\?/ },
  { name: '逻辑赋值 ??= / ||= / &&=', pattern: /\?\?=|\|\|=|&&=/ },
  { name: 'Array.prototype.at()', pattern: /\.at\s*\(/ },
]

interface ScriptTag {
  /** 开标签里的属性文本 */
  attrs: string
  /** 标签之间的脚本文本 */
  body: string
  /** body 在整份 html 里的起始下标（用来报行号） */
  bodyIndex: number
}

function scriptTags(source: string): ScriptTag[] {
  const tags: ScriptTag[] = []
  const open = /<script\b([^>]*)>/gi
  let matched: RegExpExecArray | null
  while ((matched = open.exec(source)) !== null) {
    const close = source.indexOf('</script>', open.lastIndex)
    if (close < 0) break
    tags.push({
      attrs: matched[1] ?? '',
      body: source.slice(open.lastIndex, close),
      bodyIndex: open.lastIndex,
    })
    open.lastIndex = close + '</script>'.length
  }
  return tags
}

/** 命中位置所在的行号（1 起） */
function lineOf(source: string, index: number): number {
  return source.slice(0, index).split('\n').length
}

/** 命中位置的整行 + 上下文片段，报错时直接指出"是哪一段" */
function contextAt(source: string, index: number): string {
  const start = source.lastIndexOf('\n', index) + 1
  const end = source.indexOf('\n', index)
  const line = source.slice(start, end < 0 ? undefined : end)
  const offset = index - start
  const snippet = line.slice(Math.max(0, offset - 20), offset + 20).trim()
  return `    ${line.trim()}\n    命中片段：${JSON.stringify(line.slice(offset, offset + 12))}（整行含：${JSON.stringify(snippet)}）`
}

const tags = scriptTags(html)
/** 内联脚本（带 src 的不算） */
const inline = tags.filter((tag) => tag.body.trim().length > 0 && !/\bsrc\s*=/i.test(tag.attrs))
/** 经典脚本：没有 type 属性的那一个（module 脚本永远不是它） */
const classic = inline.filter((tag) => !/\btype\s*=/i.test(tag.attrs))
/** 静态占位**元素本身**（#boot-hint 开标签 → 它的收尾 </div>），不含后面的脚本 */
const hintStart = html.indexOf('id="boot-hint"')
const hintEnd = html.indexOf('</div>', hintStart)
const hintBlock = html.slice(hintStart, hintEnd < 0 ? undefined : hintEnd)
/** 排版把长句折了行；判断文案前先把空白折成单个空格 */
const hintText = hintBlock.replace(/\s+/g, ' ')

describe('启动兜底 ①：静态占位（零 JS，中英各一份）', () => {
  it('#root 里有一段 id="boot-hint" 的占位，中英文都有', () => {
    expect(html, 'index.html 里找不到 <div id="root">').toContain('<div id="root">')
    expect(hintBlock, '找不到 id="boot-hint" 的静态占位').not.toBe('')
    // 必须在 #root 里面：#root 开标签到占位之间不能先闭合（否则占位跑到容器外，React 挂载清不掉它）
    const beforeHint = html.slice(html.indexOf('<div id="root">'), hintStart)
    expect(beforeHint, '占位不在 #root 里（#root 在它之前就闭合了）').not.toContain('</div>')
    // 中文：老设备用户多半只看中文那几行
    expect(hintText, '占位里没有中文文案').toMatch(/[\u4e00-\u9fff]/)
    expect(hintText, '占位里没有"正在启动"这类中文提示').toContain('墨趣正在启动')
    // 英文：至少一整句，不能只有一个词
    expect(hintText, '占位里没有英文句子').toMatch(/[A-Za-z]+(\s+[A-Za-z"',()\-]+){4,}/)
    expect(hintText, '占位里没有指向 Android System WebView 的更新指引').toContain(
      'Android System WebView',
    )
  })

  it('占位只用内联样式，不引外部 CSS（外链样式正是跑不动的那部分）', () => {
    expect(hintBlock, 'boot-hint 没有内联 style').toMatch(/id="boot-hint"[^>]*\bstyle="/)
    expect(hintBlock, '占位不该引用外部样式表').not.toContain('<link')
    expect(hintBlock, '占位不该用 class 去接外部 CSS').not.toContain('class=')
  })
})

describe('启动兜底 ②：经典脚本 + 纯 ES5 语法', () => {
  it('module 入口还在，且另有一个非 module 的内联脚本', () => {
    expect(tags.some((tag) => /\btype\s*=\s*"module"/i.test(tag.attrs)), 'module 入口不见了').toBe(true)
    expect(classic, '找不到"非 module 的内联脚本"这个二级兜底').toHaveLength(1)
  })

  it('兜底脚本里没有老引擎解析不了的新语法', () => {
    const es5 = classic[0]
    expect(es5, '没有可检查的经典脚本').toBeDefined()
    const source = es5!.body
    const hits: string[] = []
    for (const rule of MODERN_SYNTAX) {
      const matched = rule.pattern.exec(source)
      if (!matched) continue
      const at = es5!.bodyIndex + matched.index
      hits.push(`第 ${lineOf(html, at)} 行 · ${rule.name}\n${contextAt(html, at)}`)
    }
    expect(
      hits,
      `\n兜底脚本里出现了新语法 —— 老 WebView（Chromium < 85）会整段 SyntaxError，兜底本身就没了：\n${hits.join('\n')}\n`,
    ).toEqual([])
  })

  it('兜底逻辑还在：2.5 秒后看 #boot-hint 是否还在', () => {
    const source = classic[0]?.body ?? ''
    expect(source, '兜底脚本没有用 setTimeout 延迟').toContain('setTimeout')
    expect(source, '兜底脚本没有等 2500ms').toContain('2500')
    expect(source, '兜底脚本没有按 #boot-hint 判断应用是否起来').toContain(
      "getElementById('boot-hint')",
    )
  })

  it('阈值 110 写在兜底脚本里（与 vite target: chrome110 / MIN_WEBVIEW_MAJOR 同步）', () => {
    expect(classic[0]?.body ?? '', '兜底脚本里看不到阈值 110').toMatch(/\b110\b/)
  })
})
