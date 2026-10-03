// @vitest-environment jsdom
/**
 * 首页「继续上一局」细栏的内容规则（回归）：
 *   - 有关卡玩法（推箱子）显示「关卡 N」；
 *   - 无关卡玩法（数独）显示真实进度「进度 done/total」，绝不回退成假的「关卡 1」；
 *   - progressFor 拿不到时只显示游戏名。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { coreDictEn, coreDictZh, createMemoryKv, newEnvelope, reseal, type KvBackend } from '@eink/core'
import { createPlatform } from '@eink/platform'
import { PACK, progressSummary, sokobanEn, sokobanGame, sokobanZh } from '@eink/sokoban'
import { sudokuEn, sudokuGame, sudokuZh } from '@eink/sudoku'
import { App } from '../src/App.js'
import { defineGame, type GameLibrary } from '../src/registry.js'

afterEach(cleanup)

/** 只改 id 的克隆：用来模拟「没有 progressFor」的无关卡玩法 */
const sudokuPlain = { ...sudokuGame, id: 'sudoku-plain' }

const library: GameLibrary = {
  entries: [
    defineGame({
      game: sokobanGame,
      rulesKeys: ['sokoban.rules.body'],
      defaultDifficulty: 'starter',
      levels: PACK.map((level) => ({ id: level.def.id })),
      progressFor: (completed) => {
        const summary = progressSummary(completed)
        return { done: summary.done, total: summary.total }
      },
      indexOfLevel: (levelId) => Math.max(0, PACK.findIndex((level) => level.def.id === levelId)),
    }),
    defineGame({
      game: sudokuGame,
      rulesKeys: ['sudoku.rules.body'],
      defaultDifficulty: 'starter',
      progressFor: (completed) => ({
        done: sudokuGame.difficulties.filter((item) => completed.includes(item.id)).length,
        total: sudokuGame.difficulties.length,
      }),
    }),
    defineGame({
      game: sudokuPlain,
      rulesKeys: ['sudoku.rules.body'],
      defaultDifficulty: 'starter',
    }),
  ],
  dicts: {
    'zh-CN': { ...coreDictZh, ...sokobanZh, ...sudokuZh },
    'en-US': { ...coreDictEn, ...sokobanEn, ...sudokuEn },
  },
}

function envelopeOf(id: string, state: unknown, now: number, progress: Record<string, unknown>) {
  const game = id === 'sokoban' ? sokobanGame : sudokuGame
  return reseal({
    ...newEnvelope(
      {
        gameId: id,
        rulesVersion: game.rulesVersion,
        contentVersion: game.contentVersion,
        difficulty: 'starter',
        seed: 0,
        state,
      },
      now,
      progress,
    ),
    moves: 4,
  })
}

async function mount(kv: KvBackend) {
  const platform = await createPlatform({ kv, now: () => 1_700_000_000_000 })
  const utils = render(<App platform={platform} library={library} />)
  await waitFor(() => expect(screen.getByText(/All games/)).toBeTruthy())
  return utils
}

describe('首页「继续上一局」细栏', () => {
  it('无关卡玩法显示真实进度，不出现「关卡 N」', async () => {
    const kv = createMemoryKv()
    await kv.setMany([
      [
        'save:1:committed:sudoku',
        JSON.stringify(
          envelopeOf('sudoku', { difficulty: 'starter' }, 2000, { completed: ['starter'] }),
        ),
      ],
    ])
    const { container } = await mount(kv)
    const bar = container.querySelector('.eink-continue')
    expect(bar).toBeTruthy()
    expect(bar!.textContent).toBe('SudokuProgress 1/3')
    expect(bar!.textContent).not.toContain('Level')
    expect(bar!.getAttribute('aria-label')).toBe('Continue Sudoku Progress 1/3')
  })

  it('有关卡玩法仍然显示「关卡 N」', async () => {
    const kv = createMemoryKv()
    await kv.setMany([
      [
        'save:1:committed:sokoban',
        JSON.stringify(envelopeOf('sokoban', { levelId: 'L02', log: [] }, 3000, { completed: [] })),
      ],
    ])
    const { container } = await mount(kv)
    const bar = container.querySelector('.eink-continue')
    expect(bar!.textContent).toBe('SokobanLevel 2')
    expect(bar!.getAttribute('aria-label')).toBe('Continue Sokoban Level 2')
  })

  it('最近一局决定显示哪一款：无关卡的那款不会退化成「关卡 1」', async () => {
    const kv = createMemoryKv()
    await kv.setMany([
      [
        'save:1:committed:sokoban',
        JSON.stringify(envelopeOf('sokoban', { levelId: 'L01', log: [] }, 1000, { completed: [] })),
      ],
      [
        'save:1:committed:sudoku',
        JSON.stringify(
          envelopeOf('sudoku', { difficulty: 'starter' }, 5000, {
            completed: ['starter', 'skilled'],
          }),
        ),
      ],
    ])
    const { container } = await mount(kv)
    const bar = container.querySelector('.eink-continue')
    expect(bar!.textContent).toBe('SudokuProgress 2/3')
    expect(bar!.textContent).not.toContain('关卡')
  })

  it('progressFor 拿不到时只显示游戏名（不编造关卡或进度）', async () => {
    const kv = createMemoryKv()
    await kv.setMany([
      [
        'save:1:committed:sudoku-plain',
        JSON.stringify(envelopeOf('sudoku-plain', { difficulty: 'starter' }, 4000, { completed: [] })),
      ],
    ])
    const { container } = await mount(kv)
    const bar = container.querySelector('.eink-continue')
    expect(bar!.textContent).toBe('Sudoku')
    expect(bar!.querySelector('.eink-continue__meta')).toBeNull()
    expect(bar!.getAttribute('aria-label')).toBe('Continue Sudoku')
  })
})
