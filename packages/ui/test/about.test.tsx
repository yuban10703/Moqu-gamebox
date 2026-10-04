// @vitest-environment jsdom
/**
 * 关于页回归：入口（首页页脚右下角）/ 首页无版本号 / 关于页的作者信息区块。
 *
 * 用户要求改版后，关于页是**纯只读的作者信息页**：署名 / 邮箱 / 打赏码，
 * 没有「我的信息」输入框、也没有保存按钮 —— 因此这里不再有
 * 「保存后重新挂载仍在」那类存储测试（loadNote/saveNote 已随输入框一起删除）。
 * 作者信息的值在 packages/ui/src/screens/authorInfo.ts，测试用 vi.mock 换掉它，
 * 覆盖「三项全空 → 整块不渲染」与「填了就渲染」两条路径。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { coreDictEn, coreDictZh, createMemoryKv, APP_VERSION } from '@eink/core'
import { createPlatform } from '@eink/platform'
import { sokobanEn, sokobanGame, sokobanZh } from '@eink/sokoban'
import { PROJECT_INFO } from '../src/screens/projectInfo.js'
import { App } from '../src/App.js'
import { defineGame, type GameLibrary } from '../src/registry.js'

/**
 * 作者信息的三项值。用 vi.hoisted 让 mock 工厂与测试共享同一个对象，
 * 于是不必为「空 / 有值」各写一个测试文件 —— 改属性即可。
 */
const author = vi.hoisted(() => ({ name: '', email: '', donateImage: './about/donate.png' }))

vi.mock('../src/screens/authorInfo.js', () => ({ AUTHOR_INFO: author }))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

beforeEach(() => {
  author.name = ''
  author.email = ''
  author.donateImage = './about/donate.png'
})

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

async function mount() {
  const platform = await createPlatform({ kv: createMemoryKv(), now: () => 1_700_000_000_000 })
  const utils = render(<App platform={platform} library={library} />)
  await waitFor(() => expect(document.querySelector('.eink-footer')).toBeTruthy())
  return { platform, ...utils }
}

/**
 * 首页上的「关于」入口。**不锁定在页脚还是标题行**：
 * 这两处都被产品要求过（先与设置/帮助/诊断同排，后因英文页脚会折行改到 h1 那一行，
 * 现在用户又要求去掉右下角版本号、把「关于」换回那个位置），
 * 测试只守住「首页有一个真的 <button> 入口」这件事，位置交给布局决定。
 */
function homeEntry(text: string): HTMLButtonElement {
  for (const scope of ['.eink-screen__header', '.eink-footer']) {
    const root = document.querySelector(scope)
    if (!root) continue
    const found = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => (button.textContent ?? '').trim() === text,
    )
    if (found) return found
  }
  throw new Error(`首页没有入口按钮：${text}`)
}

async function openAbout(): Promise<void> {
  fireEvent.click(homeEntry('About'))
  await waitFor(() => expect(document.querySelector('.eink-about__product')).toBeTruthy())
}

describe('首页「关于」入口与关于页', () => {
  it('首页有真的 <button> 入口（在页脚右下角），能进关于页并看到项目名与版本号', async () => {
    await mount()
    const entry = homeEntry('About')
    expect(entry.tagName).toBe('BUTTON')
    // 设置/帮助/诊断仍在页脚那排，「关于」占据原版本号的位置（同一块页脚）
    const footerLabels = [...document.querySelectorAll('.eink-footer button')].map((b) =>
      (b.textContent ?? '').trim(),
    )
    expect(footerLabels).toContain('Settings')
    expect(footerLabels).toContain('Help')
    expect(footerLabels).toContain('Diagnostics')
    expect(footerLabels).toContain('About')
    // 用户要求：首页右下角的构建版本号已删除（它只在关于页显示）
    expect(document.querySelector('.eink-version')).toBeNull()

    await openAbout()
    expect(document.querySelector('.eink-topbar h1')?.textContent).toBe('About')
    const shown = document.body.textContent ?? ''
    expect(shown).toContain('Moqu')
    // 版本号：jsdom 里没有 __BUILD_INFO__，回落到 @eink/core 的 APP_VERSION
    // 断言用常量而不是写死字符串 —— 否则每次抬版本号都要改一次测试
    expect(shown).toContain(`v${APP_VERSION}`)
    expect(shown).not.toContain('⟦')
    // 作者信息三项在真实配置里是空的 → 整块不渲染（不显示假数据、也不显示「待填写」）
    expect(document.querySelector('.eink-about__meta')).toBeNull()
  })

  it('能返回首页', async () => {
    await mount()
    await openAbout()
    fireEvent.click(document.querySelector('.eink-button--back')!)
    await waitFor(() => expect(document.querySelector('.eink-grid')).toBeTruthy())
    expect(document.querySelector('.eink-about__product')).toBeNull()
  })
})

describe('关于页的作者信息区块', () => {
  it('填了署名与邮箱：渲染成「标签 + 值」，且没有用户输入框', async () => {
    author.name = '墨小白'
    author.email = 'hi@example.com'
    await mount()
    await openAbout()

    const dl = document.querySelector('.eink-about__meta')
    expect(dl).toBeTruthy()
    const labels = [...dl!.querySelectorAll('dt')].map((dt) => dt.textContent)
    const values = [...dl!.querySelectorAll('dd')].map((dd) => dd.textContent)
    expect(labels).toEqual(['Author', 'Email'])
    expect(values[0]).toBe('墨小白')
    // 邮箱那一格现在是「地址 + 复制按钮」（用户要求可复制），因此只断言地址在其中
    expect(values[1]).toContain('hi@example.com')
    // 用户要求：删掉「我的信息」的 textarea 与保存按钮
    expect(document.querySelector('.eink-note')).toBeNull()
    expect(document.querySelector('textarea')).toBeNull()
  })

  it('邮箱可点即复制：复制的是完整地址，并就地变成「已复制」', async () => {
    author.email = 'hi@example.com'
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    await mount()
    await openAbout()

    // 地址本身是链接：手点一下能交给系统邮件应用（壳层负责转交）
    const link = document.querySelector<HTMLAnchorElement>('.eink-about__email .eink-about__link')!
    expect(link).toBeTruthy()
    expect(link.getAttribute('href')).toBe('mailto:hi@example.com')
    expect(link.textContent).toContain('hi@example.com')

    const button = document.querySelector<HTMLButtonElement>('.eink-about__email .eink-about__copy')!
    expect(button).toBeTruthy()
    // 点之前就写着"能干什么"，墨水屏没有 hover，这行字是唯一的可见提示
    expect(button.textContent).toContain('Copy')
    // 读屏读按钮时要能听出复制的是什么
    expect(button.getAttribute('aria-label')).toBe('Copy hi@example.com')

    fireEvent.click(button)
    await waitFor(() => expect(button.textContent).toContain('Copied'))
    expect(writeText).toHaveBeenCalledWith('hi@example.com')
    // 地址本身不能因为换状态而消失，且仍可点
    expect(link.textContent).toContain('hi@example.com')
    expect(link.getAttribute('href')).toBe('mailto:hi@example.com')
    Reflect.deleteProperty(navigator as unknown as Record<string, unknown>, 'clipboard')
  })

  it('复制失败时如实提示，不假装成功', async () => {
    author.email = 'hi@example.com'
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('NotAllowedError')) },
      configurable: true,
    })
    await mount()
    await openAbout()

    const button = document.querySelector<HTMLButtonElement>('.eink-about__email .eink-about__copy')!
    fireEvent.click(button)
    await waitFor(() => expect(button.textContent).toContain('Copy failed'))
    expect(button.textContent).not.toContain('Copied')
    Reflect.deleteProperty(navigator as unknown as Record<string, unknown>, 'clipboard')
  })

  it('开源地址既显示为可点链接，也能一键复制完整地址', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    await mount()
    await openAbout()

    // 链接：手点一下交给系统浏览器
    const link = document.querySelector<HTMLAnchorElement>('.eink-about__source .eink-about__link')!
    expect(link).toBeTruthy()
    expect(link.getAttribute('href')).toBe(PROJECT_INFO.repoUrl)
    // 地址必须完整可见（墨水屏上没法 hover 看提示，也不能被截断）
    expect(link.textContent).toContain(PROJECT_INFO.repoUrl)

    const button = document.querySelector<HTMLButtonElement>('.eink-about__source .eink-about__copy')!
    expect(button.textContent).toContain('Copy')
    expect(button.getAttribute('aria-label')).toBe(`Copy ${PROJECT_INFO.repoUrl}`)

    fireEvent.click(button)
    await waitFor(() => expect(button.textContent).toContain('Copied'))
    expect(writeText).toHaveBeenCalledWith(PROJECT_INFO.repoUrl)
    // 状态变化不能把地址本身挤掉，链接也仍然可点
    expect(link.textContent).toContain(PROJECT_INFO.repoUrl)
    expect(link.getAttribute('href')).toBe(PROJECT_INFO.repoUrl)
    Reflect.deleteProperty(navigator as unknown as Record<string, unknown>, 'clipboard')
  })

  /** jsdom 不会真的加载图片：用一个「一设 src 就触发 onload/onerror」的假 Image 驱动探针 */
  class FakeImage {
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    set src(_value: string) {
      queueMicrotask(() => this.onload?.())
    }
  }

  it('打赏码文件存在时显示图片（alt 用 i18n 文案）', async () => {
    author.name = '墨小白'
    vi.stubGlobal('Image', FakeImage)
    await mount()
    await openAbout()
    await waitFor(() => expect(document.querySelector('.eink-about__donate img')).toBeTruthy())
    const img = document.querySelector<HTMLImageElement>('.eink-about__donate img')!
    expect(img.getAttribute('src')).toBe('./about/donate.png')
    expect(img.getAttribute('alt')).toBe('Tip code')
  })

  it('打赏码文件不存在时不显示图片（署名/邮箱照常显示）', async () => {
    author.name = '墨小白'
    author.donateImage = './about/missing.png'
    vi.stubGlobal(
      'Image',
      class {
        onload: (() => void) | null = null
        onerror: (() => void) | null = null
        set src(_value: string) {
          queueMicrotask(() => this.onerror?.())
        }
      },
    )
    await mount()
    await openAbout()
    await waitFor(() => expect(document.querySelector('.eink-about__meta')).toBeTruthy())
    // 探针已经失败过一轮：整张图不渲染（连 figure 一起没有），也不留破图
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(document.querySelector('.eink-about__donate')).toBeNull()
    expect(document.body.textContent).toContain('墨小白')
    expect(document.body.textContent).not.toContain('⟦')
  })
})
