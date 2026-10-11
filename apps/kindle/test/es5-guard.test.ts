/**
 * ES5 纯净守卫（Kindle 版）。
 *
 * 为什么这条测试是这套代码里最重要的几条之一：
 * Kindle 自带浏览器是**老 WebKit**，它遇到不认识的语法时不是"跳过一行"，而是
 * **整段脚本不执行** —— 页面一片白，没有控制台、没有报错，用户只会以为设备坏了。
 * 所以「产物是不是纯 ES5」必须由机器来判，不能靠人眼看。
 *
 * 覆盖三类文件：
 *  1. 手写的运行时脚本（polyfills.js / amd-shim.js）—— 人最容易混进箭头函数的地方；
 *  2. 内联脚本（index.html / check.html 里的 <script>）—— 它们先于一切执行，尤其不能出错；
 *  3. 构建产物 dist/*.js（存在时）—— tsc 的 downlevel 是否真的到位。
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
// 守卫逻辑放在构建脚本旁边，构建与测试**共用同一份判据**（两处实现迟早会分叉）
import { findEs5Violations } from '../../../tools/scripts/check-es5.mjs'

const APP = fileURLToPath(new URL('../', import.meta.url))
const DIST = `${APP}dist/`
const PUBLIC = `${APP}public/`

/** 从 HTML 里抠出所有内联 <script> 的正文（不含 src 引入的外部脚本） */
function inlineScripts(html: string): string[] {
  const out: string[] = []
  const pattern = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi
  let match = pattern.exec(html)
  while (match !== null) {
    out.push(match[1])
    match = pattern.exec(html)
  }
  return out
}

describe('Kindle 产物必须是纯 ES5', () => {
  it('手写运行时脚本（polyfills.js / amd-shim.js）干净', () => {
    const files = ['polyfills.js', 'amd-shim.js']
    for (const name of files) {
      const path = `${PUBLIC}${name}`
      expect(existsSync(path), `${name} 不存在`).toBe(true)
      const violations = findEs5Violations(name, readFileSync(path, 'utf8'))
      expect(
        violations,
        `${name} 里有 ES5 之后的语法：\n` +
          violations.map((v) => `  第 ${v.line} 行 [${v.kind}] ${v.snippet}`).join('\n'),
      ).toEqual([])
    }
  })

  it('入口页与自检页的内联脚本干净', () => {
    for (const name of ['index.html', 'check.html']) {
      const html = readFileSync(`${APP}${name}`, 'utf8')
      const scripts = inlineScripts(html)
      expect(scripts.length, `${name} 里没有找到内联脚本`).toBeGreaterThan(0)
      for (let i = 0; i < scripts.length; i++) {
        const violations = findEs5Violations(`${name}#inline${i}`, scripts[i])
        expect(
          violations,
          `${name} 第 ${i + 1} 段内联脚本有 ES5 之后的语法：\n` +
            violations.map((v) => `  第 ${v.line} 行 [${v.kind}] ${v.snippet}`).join('\n'),
        ).toEqual([])
      }
    }
  })

  it('入口页用的是经典脚本，不是模块脚本', () => {
    const html = readFileSync(`${APP}index.html`, 'utf8')
    // type="module" 在 Kindle 上会被整段忽略 —— 这一条正是当初"白屏"的根因
    expect(html).not.toMatch(/<script[^>]*type=["']module["']/i)
    // 三个脚本必须按顺序同步加载：async/defer 会打乱 polyfill → shim → 主包的依赖顺序
    const tags = html.match(/<script[^>]*src=[^>]*>/gi) ?? []
    expect(tags.length).toBe(3)
    for (const tag of tags) {
      expect(tag).not.toMatch(/\b(async|defer)\b/i)
    }
    expect(tags[0]).toMatch(/polyfills\.js/)
    expect(tags[1]).toMatch(/amd-shim\.js/)
    expect(tags[2]).toMatch(/kindle\.js/)
  })

  it('构建产物 dist/ 干净（没跑过构建时跳过）', () => {
    if (!existsSync(DIST)) {
      // 不把"没构建"当失败：CI 上先跑 build:kindle，本机开发时可能还没构建
      return
    }
    const files = readdirSync(DIST).filter((name) => name.endsWith('.js'))
    expect(files.length).toBeGreaterThan(0)
    for (const name of files) {
      const violations = findEs5Violations(name, readFileSync(`${DIST}${name}`, 'utf8'))
      expect(
        violations,
        `dist/${name} 里有 ES5 之后的语法：\n` +
          violations.slice(0, 10).map((v) => `  第 ${v.line} 行 [${v.kind}] ${v.snippet}`).join('\n'),
      ).toEqual([])
    }
  })

  it('样式表不含老引擎不认的现代 CSS', () => {
    const css = readFileSync(`${APP}src/styles/kindle.css`, 'utf8')
    // 每一项都是 BOOX 上能用、Kindle 上不能用的：写进来就会整块样式失效
    const forbidden = [
      { pattern: /var\(--/, name: 'CSS 变量 var(--x)' },
      { pattern: /display:\s*grid/, name: 'display:grid' },
      { pattern: /\bcqw\b|\bcqh\b|\bdvh\b|\bdvw\b/, name: '容器查询 / 动态视口单位' },
      { pattern: /:has\(/, name: ':has()' },
      { pattern: /color-mix\(/, name: 'color-mix()' },
      { pattern: /@container/, name: '@container' },
      { pattern: /calc\(/, name: 'calc()' },
      { pattern: /minmax\(|clamp\(/, name: 'minmax()/clamp()' },
      { pattern: /\bgap\s*:/, name: 'gap（老 flexbox 不支持）' },
    ]
    const found: string[] = []
    const lines = css.split('\n')
    for (let i = 0; i < lines.length; i++) {
      for (const rule of forbidden) {
        if (rule.pattern.test(lines[i])) found.push(`第 ${i + 1} 行 ${rule.name}: ${lines[i].trim()}`)
      }
    }
    expect(found, 'kindle.css 里有现代 CSS：\n' + found.join('\n')).toEqual([])
  })
})
