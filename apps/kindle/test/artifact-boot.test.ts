// @vitest-environment jsdom
/**
 * 产物启动测试：把 `dist/` 里**真正要发给 Kindle 的那几个文件**按 index.html 的顺序跑一遍。
 *
 * 为什么不能只测 TypeScript 源码：
 * 这套链路上任何一环断掉，表现都是"白屏"，而**每一环都不在源码里**：
 *   ① tsc 的 ES5 降级产物能不能被解析 → 语法问题
 *   ② AMD 的 define 有没有被执行 → amd-shim 的问题
 *   ③ 运行时缺的方法有没有被 polyfill 补上 → 真机上才炸的那类问题
 *   ④ 壳层挂载后有没有真的渲染出内容
 * 逐环"看起来都对"没有意义；这里让它们**串起来跑一次**，四条一起验。
 *
 * dist/ 不存在时（没跑过构建）跳过 —— 不把"还没构建"当成失败。
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/*
 * jsdom 环境下 import.meta.url 是 http:// 而不是 file://，
 * 所以这里用 cwd 相对路径（vitest 的工作目录就是仓库根）。
 */
const DIST = resolve(process.cwd(), 'apps/kindle/dist') + '/'

/** 从 index.html 里取出 #k-root 的初始 DOM 与三个脚本的加载顺序 */
function readEntry() {
  const html = readFileSync(`${DIST}index.html`, 'utf8')
  const sources = Array.from(html.matchAll(/<script[^>]*src=["']\.\/([^"']+)["'][^>]*>/gi)).map((m) => m[1])
  const rootMatch = /<div id="k-root"[^>]*>/.exec(html)
  return { html, sources, hasRoot: rootMatch !== null }
}

describe('构建产物能在浏览器里真的跑起来', () => {
  it('按 index.html 的顺序加载三个脚本后，游戏库渲染出内容', () => {
    if (!existsSync(`${DIST}kindle.js`)) return // 没构建过：跳过

    const { sources, hasRoot } = readEntry()
    expect(hasRoot, 'index.html 里没有 #k-root').toBe(true)
    // 顺序是硬约束：polyfill 必须先于 shim，shim 必须先于主包
    expect(sources).toEqual(['polyfills.js', 'amd-shim.js', 'kindle.js'])

    // 还原入口页的初始 DOM：#k-root 必须带 k-app 类，否则 .k-app 的定位规则不生效
    document.body.innerHTML = '<div id="k-root" class="k-app"></div>'

    const errors: string[] = []
    window.addEventListener('error', (event) => {
      errors.push(String((event as ErrorEvent).message))
    })

    for (const name of sources) {
      const code = readFileSync(`${DIST}${name}`, 'utf8')
      try {
        // 用 window.eval 在 jsdom 的全局作用域里执行：这三个脚本本来就是给浏览器全局用的
        ;(window as unknown as { eval(code: string): void }).eval(code)
      } catch (error) {
        throw new Error(`${name} 执行失败：${String(error)}`)
      }
    }

    expect(errors, '脚本执行期间有未捕获错误：\n' + errors.join('\n')).toEqual([])

    // ① AMD 真的执行了模块
    const amd = (window as unknown as { __MOQU_AMD__?: { count(): number; pending(): number } }).__MOQU_AMD__
    expect(amd, 'amd-shim 没有挂上 __MOQU_AMD__').toBeTruthy()
    expect(amd?.count() ?? 0).toBeGreaterThan(100)
    // ② 没有卡在等待依赖的模块：那说明依赖图断了
    expect(amd?.pending() ?? -1).toBe(0)

    // ③ 壳层挂载后渲染出了游戏库（标题来自字典，不是硬编码）
    const text = document.body.textContent ?? ''
    expect(text.length).toBeGreaterThan(50)
    // 游戏库会把玩法列出来，推箱子一定在列表里
    expect(text).toContain('推箱子')
    // 并且有翻页控件，说明是完整的库页而不是半截
    expect(text).toContain('下一页')
  })

  /*
   * 这一条守的是一个**只在 ES5 产物里存在**的缺陷，本地跑源码的测试永远测不到。
   *
   * tsc --target ES5 把 `class X extends Error` 降级成
   *   `var _this = _super.call(this, msg) || this`
   * 而 `Error.call(this, msg)` 不修改 this、返回一个新的普通 Error ——
   * 于是 `_this` 是普通 Error，`err instanceof X` **恒为 false**。
   *
   * 后果不是"少个类型判断"：规则层用 instanceof 区分「按规则的非法动作」与「真 bug」
   * （贪吃蛇/2048/俄罗斯方块的 isLegal），壳层用它决定"给提示"还是"当崩溃抛"。
   * 判错 → 玩家一次正常的非法输入被抛成未捕获异常：点了没反应、控制台报错。
   */
  it('ES5 产物里 IllegalActionError 的 instanceof 仍然成立', () => {
    if (!existsSync(`${DIST}kindle.js`)) return
    document.body.innerHTML = '<div id="k-root" class="k-app"></div>'
    for (const name of ['polyfills.js', 'amd-shim.js', 'kindle.js']) {
      ;(window as unknown as { eval(code: string): void }).eval(readFileSync(`${DIST}${name}`, 'utf8'))
    }
    const amd = (window as unknown as { __MOQU_AMD__?: { get(name: string): unknown } }).__MOQU_AMD__
    expect(amd, 'amd-shim 没有挂上 __MOQU_AMD__').toBeTruthy()

    const types = amd?.get('packages/core/src/types') as
      | { IllegalActionError: new (gameId: string, reason: string) => Error }
      | undefined
    expect(types, '取不到 core/types 模块').toBeTruthy()
    const Ctor = types?.IllegalActionError
    expect(typeof Ctor).toBe('function')

    const error = new (Ctor as new (a: string, b: string) => Error)('sudoku', 'conflict')
    // 这一条就是缺陷本身：降级后 error 会是一个普通 Error，instanceof 为 false
    expect(error instanceof (Ctor as unknown as Function), 'ES5 产物里 instanceof 失效（extends Error 的原型链断了）').toBe(true)
    // 消息与字段也必须在：壳层要靠 reason 给提示
    expect(error.message).toContain('illegal action for sudoku')
    expect((error as unknown as { name: string }).name).toBe('IllegalActionError')
    expect((error as unknown as { reason: string }).reason).toBe('conflict')
  })

  it('polyfill 补齐了共用代码真正依赖的那些方法', () => {
    if (!existsSync(`${DIST}polyfills.js`)) return
    document.body.innerHTML = '<div id="k-root" class="k-app"></div>'
    ;(window as unknown as { eval(code: string): void }).eval(readFileSync(`${DIST}polyfills.js`, 'utf8'))

    // 这几项缺任何一个，共用代码在真机上就会直接抛错
    expect(typeof ([] as unknown as { includes(x: unknown): boolean }).includes).toBe('function')
    expect(typeof ([] as unknown as { at(i: number): unknown }).at).toBe('function')
    expect(typeof Object.entries).toBe('function')
    expect(typeof Object.values).toBe('function')
    expect(typeof Object.fromEntries).toBe('function')
    expect(typeof ('' as unknown as { padStart(n: number): string }).padStart).toBe('function')
    expect(typeof Promise).toBe('function')
    expect(typeof Set).toBe('function')
    expect(typeof Map).toBe('function')
    // tsc 的 --downlevelIteration 产物会读这个键：数组上没有它，for...of 数组就会炸
    expect(typeof ([] as unknown as Record<symbol, unknown>)[Symbol.iterator as unknown as symbol]).toBe('function')
  })
})
