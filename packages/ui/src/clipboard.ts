/**
 * 复制文本到系统剪贴板。**返回是否成功** —— 调用方必须据此给反馈，
 * 不能假设一定成功（墨水屏上「以为复制了、其实没复制」是最糟的结果：
 * 用户切到别处粘贴才发现是空的）。
 *
 * 为什么要两层实现：
 * - `navigator.clipboard` 只存在于**安全上下文**：APK 里的 WebView
 *   （https://appassets.androidplatform.net）与 localhost 都有；
 *   但从局域网用 `http://10.1.1.x:端口` 打开网页版时它是 undefined
 *   （见 docs/lan-access.md 的用法）—— 而"复制邮箱"恰恰是那种场景下最需要的。
 * - 兜底用 `execCommand('copy')` + 一个临时 textarea：老 WebView 与不安全上下文仍可用。
 *   execCommand 已废弃但没被移除，且是这些环境下唯一可用的同步方案。
 */

/** 复制成功返回 true；不可用 / 被拒 / 抛异常都返回 false（绝不抛给调用方） */
export async function copyText(text: string): Promise<boolean> {
  if (text === '') return false

  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // 权限被拒 / 非安全上下文异常：继续走兜底，不要让它冒泡成页面错误
  }

  /*
   * 兜底：execCommand('copy') + 一个临时 textarea。
   * 用 finally 摘掉临时节点 —— 兜底路径本身会抛（老环境没有 execCommand 时是 TypeError），
   * 抛出去之前也必须把节点收干净，否则页面上会留一个隐藏的 textarea（单测专门盯这条）。
   */
  let area: HTMLTextAreaElement | null = null
  try {
    area = document.createElement('textarea')
    area.value = text
    // 只读 + 移出视口：不会弹出软键盘、也不会引起滚动或可见闪烁
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.top = '-1000px'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    area.setSelectionRange(0, text.length)
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    area?.remove()
  }
}
