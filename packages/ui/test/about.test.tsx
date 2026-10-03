// @vitest-environment jsdom
/**
 * 关于页回归：入口 / 版本号 / 「我的信息」可编辑保存并跨挂载保留。
 *
 * 「刷新后仍在」在 jsdom 里等价于「用同一份存储重新挂载 App」——
 * 页面刷新会丢掉 React 状态，但不会丢掉本机存储（真实浏览器里由 e2e 验证）。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { coreDictEn, coreDictZh, createMemoryKv, type KvBackend } from '@eink/core'
import { createPlatform } from '@eink/platform'
import { sokobanEn, sokobanGame, sokobanZh } from '@eink/sokoban'
import { App } from '../src/App.js'
import { defineGame, type GameLibrary } from '../src/registry.js'

afterEach(cleanup)

const library: GameLibrary = {
  entries: [
    defineGame({
      game: sokobanGame,
      rulesKeys: ['sokoban.rules.body'],
      defaultDifficulty: 'starter',
    }),
  ],
  dicts: {
    'zh-CN': { ...coreDictZh, ...sokobanZh },
    'en-US': { ...coreDictEn, ...sokobanEn },
  },
}

async function mount(kv: KvBackend = createMemoryKv()) {
  const platform = await createPlatform({ kv, now: () => 1_700_000_000_000 })
  const utils = render(<App platform={platform} library={library} />)
  await waitFor(() => expect(document.querySelector('.eink-footer')).toBeTruthy())
  return { platform, kv, ...utils }
}

/** 页脚里按可见文字找按钮（真 <button>，不是链接式假入口） */
function footerButton(text: string): HTMLButtonElement {
  const found = [...document.querySelectorAll<HTMLButtonElement>('.eink-footer button')].find(
    (button) => (button.textContent ?? '').trim() === text,
  )
  if (!found) throw new Error(`页脚没有按钮：${text}`)
  return found
}

const noteBox = (): HTMLTextAreaElement => document.querySelector<HTMLTextAreaElement>('.eink-note')!

async function openAbout(): Promise<void> {
  fireEvent.click(footerButton('About'))
  await waitFor(() => expect(document.querySelector('.eink-note')).toBeTruthy())
}

describe('首页「关于」入口与关于页', () => {
  it('页脚有真的 <button> 入口，能进关于页并看到项目名与版本号', async () => {
    await mount()
    const entry = footerButton('About')
    expect(entry.tagName).toBe('BUTTON')
    // 与设置/帮助/诊断同一排：四个入口都在页脚里
    expect([...document.querySelectorAll('.eink-footer button')].map((b) => (b.textContent ?? '').trim())).toEqual([
      'Settings',
      'Help',
      'Diagnostics',
      'About',
    ])

    await openAbout()
    expect(document.querySelector('.eink-topbar h1')?.textContent).toBe('About')
    const shown = document.body.textContent ?? ''
    expect(shown).toContain('Moqu')
    // 版本号：jsdom 里没有 __BUILD_INFO__，回落到 @eink/core 的 APP_VERSION
    expect(shown).toContain('v0.1.0')
    expect(shown).toContain('My info')
    expect(shown).not.toContain('⟦')
  })

  it('「我的信息」保存后重新挂载仍在，并且能返回首页', async () => {
    const kv = createMemoryKv()
    const first = await mount(kv)
    await openAbout()
    expect(noteBox().value).toBe('')

    fireEvent.change(noteBox(), { target: { value: '我的信息 hello' } })
    fireEvent.click(footerButton('Save'))
    await waitFor(() => expect(document.body.textContent).toContain('Saved'))

    // 等价于刷新页面：丢掉 React 状态，保留本机存储
    first.unmount()
    await mount(kv)
    await openAbout()
    await waitFor(() => expect(noteBox().value).toBe('我的信息 hello'))

    // 返回首页（关于页的返回走同一套路由）
    fireEvent.click(document.querySelector('.eink-button--back')!)
    await waitFor(() => expect(document.querySelector('.eink-grid')).toBeTruthy())
    expect(document.querySelector('.eink-note')).toBeNull()
  })
})
