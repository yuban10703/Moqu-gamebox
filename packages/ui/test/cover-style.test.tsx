// @vitest-environment jsdom
/**
 * 未翻格风格（暂停菜单里的选项）：用户要求「在暂停内加个切换未翻格风格的选项，都做进去」。
 *
 * 这个测试守三件事：
 * 1. **选项只在有未翻格的玩法里出现**（扫雷 / 记忆配对给，数独不给 —— 改了也看不见的选项是噪音）；
 * 2. 点一下**循环到下一种风格**，标签立刻显示新风格，并且**真的写进了设置**（下次进来还在）；
 * 3. 壳层按风格画：三种字形风格各画一枚居中字形，三种底纹风格不画字形（底纹交给 CSS）。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  COVER_STYLES,
  DEFAULT_COVER_STYLE,
  coreDictEn,
  createMemoryKv,
  nextCoverStyle,
} from '@eink/core'
import { createPlatform } from '@eink/platform'
import { App } from '../src/App.js'
import { Board } from '../src/components.js'
import { library } from '../../../apps/web/src/library.js'

afterEach(() => {
  cleanup()
  delete window.__einkHandleBack
})

const TITLE = coreDictEn['shell.cover.title']!
/* 游戏名从**玩法字典**取（不在 core 字典里；英文标题还带软连字符，写死字符串会对不上） */
const EN_GAMES = library.dicts['en-US'] ?? {}
const MINESWEEPER = EN_GAMES['minesweeper.title']!
const MEMORY = EN_GAMES['memory.title']!
const SUDOKU = EN_GAMES['sudoku.title']!
const LABELS: Record<string, string> = {
  mark: coreDictEn['shell.cover.mark']!,
  markLarge: coreDictEn['shell.cover.markLarge']!,
  hollow: coreDictEn['shell.cover.hollow']!,
  dots: coreDictEn['shell.cover.dots']!,
  gray: coreDictEn['shell.cover.gray']!,
  stripes: coreDictEn['shell.cover.stripes']!,
}

async function mount() {
  const platform = await createPlatform({ kv: createMemoryKv(), now: () => 1_700_000_000_000 })
  render(<App platform={platform} library={library} />)
  await waitFor(() => expect(screen.getByText(/All games/)).toBeTruthy())
  return platform
}

/** 开一局并把暂停面板打开 */
async function startAndPause(title: string): Promise<void> {
  fireEvent.click(screen.getByText(title))
  await waitFor(() => expect(screen.getByText(/How to play/)).toBeTruthy())
  fireEvent.click(screen.getByText('New game'))
  await waitFor(() => expect(screen.getByRole('grid')).toBeTruthy())
  fireEvent.click(screen.getByText('Pause'))
  await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
}

describe('暂停菜单里的未翻格风格选项', () => {
  it('扫雷：有这一项，标签显示当前风格（默认单斜纹）', async () => {
    await mount()
    await startAndPause(MINESWEEPER)
    expect(screen.getByText(`${TITLE}: ${LABELS[DEFAULT_COVER_STYLE]}`)).toBeTruthy()
  })

  it('记忆配对：同样有这一项（扣着的牌与扫雷未翻格共用风格）', async () => {
    await mount()
    await startAndPause(MEMORY)
    expect(screen.getByText(`${TITLE}: ${LABELS[DEFAULT_COVER_STYLE]}`)).toBeTruthy()
  })

  it('数独：没有未翻格，不给这一项（改了也看不见的选项不出现）', async () => {
    await mount()
    await startAndPause(SUDOKU)
    for (const label of Object.values(LABELS)) {
      expect(screen.queryByText(`${TITLE}: ${label}`)).toBeNull()
    }
  })

  it('点一下循环到下一种：标签立刻更新，并真的写进设置', async () => {
    const platform = await mount()
    await startAndPause(MINESWEEPER)
    let current = DEFAULT_COVER_STYLE
    for (let step = 0; step < COVER_STYLES.length; step++) {
      expect(screen.getByText(`${TITLE}: ${LABELS[current]}`)).toBeTruthy()
      fireEvent.click(screen.getByText(`${TITLE}: ${LABELS[current]}`))
      const next = nextCoverStyle(current)
      await waitFor(() => expect(screen.getByText(`${TITLE}: ${LABELS[next]}`)).toBeTruthy())
      current = next
    }
    // 走满一圈回到默认
    expect(current).toBe(DEFAULT_COVER_STYLE)
    expect((await platform.storage.loadSettings()).coverStyle).toBe(DEFAULT_COVER_STYLE)
  })

  it('字形风格画标记、底纹风格不画（走 UI 切换，不直接改存储）', async () => {
    await mount()
    await startAndPause(MINESWEEPER)
    const hiddenGlyphs = (): number =>
      document.querySelectorAll(".eink-board__cell[data-kind='hidden'] .eink-board__text").length
    const cells = document.querySelectorAll(".eink-board__cell[data-kind='hidden']")
    expect(cells.length).toBeGreaterThan(0)
    // 默认是底纹风格（单斜纹）：棋盘上一枚字形都没有，底纹交给 CSS
    expect(hiddenGlyphs()).toBe(0)
    // 一路切到 mark（字形风格）：未翻格上出现标记
    let current = DEFAULT_COVER_STYLE
    while (current !== 'mark') {
      fireEvent.click(screen.getByText(`${TITLE}: ${LABELS[current]}`))
      current = nextCoverStyle(current)
      await waitFor(() => expect(screen.getByText(`${TITLE}: ${LABELS[current]}`)).toBeTruthy())
    }
    expect(hiddenGlyphs()).toBe(cells.length)
  })
})

describe('壳层按风格画未翻格', () => {
  const board = {
    kind: 'grid' as const,
    cols: 2,
    rows: 2,
    cells: [
      { index: 0, kind: 'hidden' as const, glyph: '' },
      { index: 1, kind: 'hidden' as const, glyph: '' },
      { index: 2, kind: 'number' as const, glyph: '1' },
      { index: 3, kind: 'empty' as const, glyph: '' },
    ],
  }

  it('字形风格：每格一枚居中字形，尺寸随格子缩放', () => {
    const expected: Array<[string, string, number]> = [
      ['mark', '■', 0.35],
      ['markLarge', '■', 0.5],
      ['hollow', '□', 0.55],
    ]
    for (const [style, glyph, scale] of expected) {
      const { container } = render(<Board board={board} coverStyle={style as never} />)
      const marks = [...container.querySelectorAll(".eink-board__cell[data-kind='hidden'] .eink-board__text")]
      expect(marks, style).toHaveLength(2)
      for (const mark of marks) {
        expect(mark.textContent).toBe(glyph)
        expect((mark as HTMLElement).style.fontSize).toBe(`calc(var(--cell, 40px) * ${scale})`)
      }
      // 标记是装饰：无障碍标签仍由格子给出，标记本身不进读屏
      expect(marks[0]!.getAttribute('aria-hidden')).toBe('true')
      cleanup()
    }
  })

  it('底纹风格：不画字形（dots / gray / stripes 全交给 CSS 铺底）', () => {
    for (const style of ['dots', 'gray', 'stripes']) {
      const { container } = render(<Board board={board} coverStyle={style as never} />)
      expect(container.querySelectorAll('.eink-board__text'), style).toHaveLength(1)
      // 唯一那个字形是数字格（number），未翻格没有字形
      expect(container.querySelector(".eink-board__cell[data-kind='hidden'] .eink-board__text")).toBeNull()
      expect(container.querySelector(".eink-board__cell[data-kind='number'] .eink-board__text")?.textContent).toBe('1')
      cleanup()
    }
  })
})
