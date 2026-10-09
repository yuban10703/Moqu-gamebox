// @vitest-environment jsdom
/**
 * 结果面板「最佳 N 步」那一行：玩法字典里**没有** `<ns>.solved.best` 时不许把原始 key 漏给玩家。
 *
 * 由来（2026-10-10 NoteX2 实机走查，问题 1）：数织入门 5×5 通关后，底部结果面板直接印出
 * `⟦nonogram.solved.best⟧` —— 壳层只要 `best !== undefined` 就无条件 `i18n.t('<ns>.solved.best')`，
 * 而 core 的缺词兜底返回 `⟦key⟧`。同一个 key 在 buckshot / chess / doudizhu / minesweeper /
 * sudoku / tetris（历史遗留 6 款）也缺，因此壳层这一侧必须自己兜住。
 *
 * 守两件事：
 *   ① 缺词 → 这一行**不渲染**（面板其余内容照旧，页面上一个 `⟦` 都没有）；
 *   ② 有词 → 这一行照常渲染（给新玩法补进字典的文案得真的显示出来）。
 * 用真实数织走完一局（点满 16 个黑格通关），而不是手搓视图 —— 这条链路上任何一环
 * （session 的 bestMoves 写入 / 壳层的渲染条件 / 字典合并）断了，这里都会红。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { coreDictEn, coreDictZh, compareDicts, createI18n, createMemoryKv, type Dict } from '@eink/core'
import { createPlatform } from '@eink/platform'
import {
  CELL_LABEL_KEYS,
  nonogramEn,
  nonogramGame,
  nonogramZh,
  puzzleOf,
  solutionBits,
} from '@eink/nonogram'
import { klondikeEn, klondikeGame, klondikeZh } from '@eink/klondike'
import { tictactoeEn, tictactoeGame, tictactoeZh } from '@eink/tictactoe'
import { App } from '../src/App.js'
import { defineGame, type GameLibrary } from '../src/registry.js'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

/** 固定时钟：种子来自 Date.now()，固定它才能确定地知道是哪一道题 */
const NOW = 1_700_000_000_000
const SEED = NOW % 0x7fffffff

/** 把 `<ns>.solved.best` 从字典里抹掉，模拟"这个玩法没写这句文案"（6 款历史遗留玩法就是这种状态） */
function withoutBest(dict: Dict): Dict {
  const copy: Dict = { ...dict }
  delete copy['nonogram.solved.best']
  return copy
}

function libraryWith(dicts: { zh: Dict; en: Dict }): GameLibrary {
  return {
    entries: [
      defineGame({
        game: nonogramGame,
        // 与 apps/web/src/library.ts 的登记一致：数织状态里没有动作日志，撤销按钮不渲染
        hideShellControls: ['undo'],
        cellLabelKey: (kind) => CELL_LABEL_KEYS[kind],
        rulesKeys: ['nonogram.rules.body', 'nonogram.rules.body2'],
        defaultDifficulty: 'starter',
      }),
    ],
    dicts: { 'zh-CN': dicts.zh, 'en-US': dicts.en },
  }
}

const FULL_DICTS = { zh: { ...coreDictZh, ...nonogramZh }, en: { ...coreDictEn, ...nonogramEn } }
const NO_BEST_DICTS = {
  zh: { ...coreDictZh, ...withoutBest(nonogramZh) },
  en: { ...coreDictEn, ...withoutBest(nonogramEn) },
}

/** 首页方块：英文名里可能带软连字符，按"人看到的文字"匹配（与 undo-after-loss.test.tsx 同一套路） */
function tileByTitle(title: string): HTMLElement {
  const normalized = title.replace(/\u00AD/g, '')
  const tile = Array.from(document.querySelectorAll<HTMLElement>('.eink-tile')).find(
    (node) => node.textContent?.replace(/\u00AD/g, '').trim() === normalized,
  )
  if (!tile) throw new Error(`tile ${title} not found`)
  return tile
}

function cellAt(index: number): HTMLElement {
  const cell = document.querySelectorAll<HTMLElement>('.eink-board__cell')[index]
  if (!cell) throw new Error(`cell ${index} not found`)
  return cell
}

/** 壳层渲染出来的结果面板 */
function resultPanel(): HTMLElement {
  const panel = document.querySelector<HTMLElement>('.eink-section--result')
  if (!panel) throw new Error('result panel not rendered')
  return panel
}

/** 首页 → 详情 → 开局（新局用固定时钟算出的种子，因此题目是确定的） */
async function enterNonogram(dicts: { zh: Dict; en: Dict }): Promise<void> {
  vi.spyOn(Date, 'now').mockReturnValue(NOW)
  const platform = await createPlatform({ kv: createMemoryKv(), now: () => NOW })
  render(<App platform={platform} library={libraryWith(dicts)} />)
  await waitFor(() => expect(screen.getByText(/All games/)).toBeTruthy())
  fireEvent.click(tileByTitle('Nonogram'))
  await waitFor(() => expect(screen.getByText(/How to play/)).toBeTruthy())
  fireEvent.click(screen.getByText('New game'))
  await waitFor(() => expect(screen.getByRole('grid')).toBeTruthy())
}

/** 统计栏某一项的值（dt 与 dd 是同一容器内的兄弟节点，与 shell.test.tsx 同一套路） */
function statValue(label: string): string {
  const dt = screen.getAllByText(label).find((node) => node.tagName === 'DT')
  if (!dt) throw new Error(`stat not found: ${label}`)
  return dt.parentElement?.querySelector('dd')?.textContent ?? ''
}

/** 这一局（同一颗种子）的答案：true = 黑格 */
function answerOfGame(): boolean[] {
  return solutionBits(puzzleOf(nonogramGame.create(SEED, 'starter')))
}

/** 逐格点黑（点一下 = 空 → 黑，最后一下正好通关），返回点了几下 */
function fillAnswer(): number {
  const answer = answerOfGame()
  let clicks = 0
  for (let index = 0; index < answer.length; index++) {
    if (!answer[index]) continue
    fireEvent.click(cellAt(index))
    clicks++
  }
  return clicks
}

describe('结果面板的「最佳」行：壳层先问 key 在不在', () => {
  it('缺 nonogram.solved.best：面板里没有 ⟦，也没有那一行；其余明细照旧', async () => {
    await enterNonogram(NO_BEST_DICTS)
    // 与固定种子算出的题号一致（对不上说明种子口径变了，后面的点击也就没有意义）
    const seeded = nonogramGame.create(SEED, 'starter')
    expect(statValue('Puzzle').startsWith(`${seeded.puzzleIndex + 1}/`)).toBe(true)
    const clicks = fillAnswer()
    expect(clicks).toBeGreaterThan(0)

    await waitFor(() => expect(document.querySelector('.eink-section--result')).not.toBeNull())
    const panel = resultPanel()
    // 这一行不渲染：既没有原始 key，也没有「最佳 / Best」这句文案
    expect(panel.textContent).not.toContain('⟦')
    expect(panel.textContent).not.toMatch(/最佳|Best/)
    // 页面其它地方也不许冒出占位符
    expect(document.body.textContent).not.toContain('⟦')
    // 面板其余内容照旧：标题 + 两条明细（步数 / 题号）都在
    expect(panel.querySelector('.eink-result-summary')?.textContent).toBeTruthy()
    expect(panel.textContent).toContain(`${clicks} moves`)
    expect(panel.textContent).toMatch(/Puzzle \d+/)
  })

  it('字典里有这个 key：那一行照常渲染，且带上最佳步数', async () => {
    await enterNonogram(FULL_DICTS)
    const clicks = fillAnswer()
    await waitFor(() => expect(document.querySelector('.eink-section--result')).not.toBeNull())
    const panel = resultPanel()
    expect(panel.textContent).not.toContain('⟦')
    // 补进字典的那句文案（en: 'Best {count} moves'）真的显示出来了，数字就是本局步数
    expect(panel.textContent).toContain(`Best ${clicks} moves`)
  })
})

describe('壳层会向三款新玩法要的「最佳」文案都齐备（compareDicts 口径）', () => {
  /** 三款新玩法（本轮走查对象）：字典前缀 = GameDef.i18nNamespace */
  const NEW_GAMES = [
    { ns: 'nonogram', game: nonogramGame, zh: nonogramZh, en: nonogramEn },
    { ns: 'klondike', game: klondikeGame, zh: klondikeZh, en: klondikeEn },
    { ns: 'tictactoe', game: tictactoeGame, zh: tictactoeZh, en: tictactoeEn },
  ] as const

  it('中英基础 key 集合一致（compareDicts 无 issue），且基础键 <ns>.solved.best 本身存在', () => {
    for (const { ns, game, zh, en } of NEW_GAMES) {
      expect(game.i18nNamespace, ns).toBe(ns)
      const zhAll = { ...coreDictZh, ...zh }
      const enAll = { ...coreDictEn, ...en }
      expect(compareDicts({ 'zh-CN': zhAll, 'en-US': enAll }), ns).toEqual([])
      for (const dict of [zhAll, enAll]) {
        expect(dict[`${ns}.solved.best`], `${ns}.solved.best`).toBeDefined()
      }
      // 壳层用 i18n.has(key) 判断这一行渲不渲染，因此 has 必须为真 —— 只给 __other 后缀是不够的
      const i18nZh = createI18n('zh-CN', { 'zh-CN': zhAll, 'en-US': enAll })
      const i18nEn = createI18n('en-US', { 'zh-CN': zhAll, 'en-US': enAll })
      for (const i18n of [i18nZh, i18nEn]) {
        expect(i18n.has(`${ns}.solved.best`), `${ns}.solved.best`).toBe(true)
        const text = i18n.t(`${ns}.solved.best`, { count: 12 })
        expect(text, `${ns}.solved.best`).not.toContain('⟦')
        expect(text, `${ns}.solved.best`).toContain('12')
      }
    }
  })
})
