// @vitest-environment jsdom
/**
 * 复制到剪贴板的两条路径。
 *
 * 为什么要专门测：这个能力**很容易"看起来成功了"**——墨水屏上用户切到别处粘贴才发现是空的。
 * 因此 copyText 一律返回布尔值，且必须覆盖三条路径：
 *   1) 安全上下文（APK 的 WebView / localhost）：走 navigator.clipboard；
 *   2) 非安全上下文（局域网 http://10.1.1.x 打开网页版）：clipboard 不存在 → 走 execCommand 兜底；
 *   3) 两条都不行：返回 false（调用方据此显示"复制失败"，而不是假装成功）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyText } from '../src/clipboard.js'

/** 用 defineProperty 而不是 stubGlobal：只加 clipboard，不动 navigator 的其它成员 */
function stubClipboard(value: unknown): void {
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true })
}

function removeClipboard(): void {
  // jsdom 默认没有 clipboard —— 删掉属性即可回到"非安全上下文"的样子
  Reflect.deleteProperty(navigator as unknown as Record<string, unknown>, 'clipboard')
}

afterEach(() => {
  removeClipboard()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('copyText', () => {
  it('安全上下文：优先用 navigator.clipboard，并把原文一字不差地传过去', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    stubClipboard({ writeText })
    await expect(copyText('hi@example.com')).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith('hi@example.com')
  })

  it('非安全上下文（clipboard 不存在）：退回 execCommand 兜底，成功时返回 true', async () => {
    removeClipboard()
    expect(navigator.clipboard).toBeUndefined()
    const exec = vi.fn().mockReturnValue(true)
    Object.defineProperty(document, 'execCommand', { value: exec, configurable: true })

    await expect(copyText('hi@example.com')).resolves.toBe(true)
    expect(exec).toHaveBeenCalledWith('copy')
    // 临时 textarea 必须已经摘掉，不能在页面上留残留节点
    expect(document.querySelector('textarea')).toBeNull()
    Reflect.deleteProperty(document as unknown as Record<string, unknown>, 'execCommand')
  })

  it('clipboard 被拒 + 兜底也不可用：返回 false（调用方据此提示"复制失败"）', async () => {
    stubClipboard({ writeText: vi.fn().mockRejectedValue(new Error('NotAllowedError')) })
    // jsdom 里 document.execCommand 本来就不存在 → 兜底会抛异常，必须被吞掉
    await expect(copyText('hi@example.com')).resolves.toBe(false)
    expect(document.querySelector('textarea')).toBeNull()
  })

  it('空字符串不当作复制成功（避免"提示已复制、粘出来是空的"）', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    stubClipboard({ writeText })
    await expect(copyText('')).resolves.toBe(false)
    expect(writeText).not.toHaveBeenCalled()
  })
})
