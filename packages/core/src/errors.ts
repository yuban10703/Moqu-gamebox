/**
 * 自定义错误的 ES5 兼容修正。
 *
 * 由来（一条真机上才会暴露、本地测试永远测不到的缺陷）：
 * `tsc --target ES5` 把 `class X extends Error` 降级成
 *
 *     var _this = _super.call(this, message) || this;
 *
 * 而 **`Error.call(this, message)` 不修改 `this`** —— 它忽略传入的接收者，
 * 返回一个**新的普通 Error 对象**。于是 `_this` 是那个普通 Error，
 * 它的原型链上没有 `X.prototype`，`err instanceof X` **恒为 false**。
 *
 * 影响不是"少一个类型判断"这么轻：
 * - 规则层用它区分「按规则的非法动作」与「真的写错了」——
 *   例如 `snake` / `2048` / `tetris` 的 isLegal 都是
 *   `try { reduce(...) } catch (e) { if (e instanceof IllegalActionError) return false; throw e }`，
 *   判错就会把玩家一次正常的非法输入当成崩溃抛出去；
 * - 壳层用它决定"给一句明确文字提示"还是"当作 bug 上报"。
 *
 * 也就是说：**同一个非法输入，现代构建里是一句提示，ES5 构建里是一个未捕获异常。**
 * 本地跑 vitest 用的是源码（原生 class，instanceof 正常），所以这条只能靠
 * 「把构建产物跑起来」的测试守住（见 apps/kindle/test/artifact-boot.test.ts）。
 *
 * 修法：构造完把实例的原型接回自己的 prototype。现代浏览器上这是无害的
 * （设成它本来就是的那个）。
 */
export function linkErrorSubclass(instance: object, ctor: { prototype: object }): void {
  const proto = ctor.prototype
  const setProto = (Object as unknown as { setPrototypeOf?: (target: object, p: object) => object })
    .setPrototypeOf
  if (typeof setProto === 'function') {
    setProto(instance, proto)
    return
  }
  // 老引擎没有 Object.setPrototypeOf 时的兜底：__proto__ 是事实标准
  if ('__proto__' in instance) {
    ;(instance as unknown as { __proto__: object }).__proto__ = proto
  }
}
