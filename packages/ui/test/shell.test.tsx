// @vitest-environment jsdom
/**
 * 壳层集成测试（jsdom）。
 *
 * 覆盖 M2 的验收点：游戏库 → 详情 → 游戏 → 存档；设置切换即时生效；
 * 保存失败可见可重试；损坏存档被保留并提示（不被静默覆盖）；返回键钩子行为正确。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { coreDictEn, coreDictZh, createMemoryKv, newEnvelope, reseal, type KvBackend } from '@eink/core'
import { createPlatform } from '@eink/platform'
import {
  LEVEL_WITNESSES,
  PACK,
  progressSummary,
  sokobanEn,
  sokobanGame,
  sokobanZh,
} from '@eink/sokoban'
import { App } from '../src/App.js'
import { defineGame, type GameLibrary } from '../src/registry.js'

afterEach(() => {
  cleanup()
  delete window.__einkHandleBack
})

const library: GameLibrary = {
  entries: [
    defineGame({
      game: sokobanGame,
      rulesKeys: ['sokoban.rules.body', 'sokoban.rules.body2'],
      defaultDifficulty: 'starter',
      levels: PACK.map((level) => ({ id: level.def.id })),
      progressFor: (completed) => {
        const summary = progressSummary(completed)
        return { done: summary.done, total: summary.total }
      },
      indexOfLevel: (levelId) => Math.max(0, PACK.findIndex((level) => level.def.id === levelId)),
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
  await waitFor(() => expect(screen.getByText(/All games|全部游戏/)).toBeTruthy())
  return { platform, kv, ...utils }
}

/** 进入推箱子详情并开始新游戏 */
async function enterGame(): Promise<void> {
  fireEvent.click(screen.getByText('Sokoban'))
  await waitFor(() => expect(screen.getByText(/How to play/)).toBeTruthy())
  fireEvent.click(screen.getByText('New game'))
  await waitFor(() => expect(screen.getByRole('grid')).toBeTruthy())
}

/** 读取某个统计项的值（dt 与 dd 是同一容器内的兄弟节点） */
function statValue(label: string): string {
  const dt = screen.getAllByText(label).find((node) => node.tagName === 'DT')
  if (!dt) throw new Error(`stat not found: ${label}`)
  return dt.parentElement?.querySelector('dd')?.textContent ?? ''
}

const DIR_LABEL: Record<string, string> = { up: 'Up', down: 'Down', left: 'Left', right: 'Right' }

describe('游戏库 → 详情 → 游戏', () => {
  it('首页只显示游戏名（不含进度），无法持久化时有明确提示', async () => {
    await mount()
    expect(screen.getByText('Sokoban')).toBeTruthy()
    expect(screen.getByText(/cannot be persisted/)).toBeTruthy()
    // 用户要求：卡片上不要进度行（没有关卡的游戏更没有意义）→ 首页不应出现任何「进度 x/y」
    expect(screen.queryByText(/进度\s*\d+\/\d+/)).toBeNull()
  })

  it('开始新游戏后棋盘渲染出全部格子，有效方向产生状态变化', async () => {
    await mount()
    await enterGame()
    const level = PACK[0]!.parsed
    expect(screen.getAllByRole('gridcell')).toHaveLength(level.cols * level.rows)
    expect(statValue('Moves')).toBe('0')

    fireEvent.click(screen.getByLabelText('Up'))
    await waitFor(() => expect(statValue('Moves')).toBe('1'))
  })

  it('走不通的方向给出明确文字提示，而不是静默无响应', async () => {
    await mount()
    await enterGame()
    // 一路向上，直到撞到顶墙
    for (let i = 0; i < 6; i++) fireEvent.click(screen.getByLabelText('Up'))
    await waitFor(() => expect(screen.getByTestId('notice').textContent).toMatch(/blocked/))
    // 被拒绝的输入不改变局面计数
    const moves = statValue('Moves')
    fireEvent.click(screen.getByLabelText('Up'))
    expect(statValue('Moves')).toBe(moves)
  })

  it('有效动作会写盘并显示已保存', async () => {
    await mount()
    await enterGame()
    fireEvent.click(screen.getByLabelText('Up'))
    await waitFor(() => expect(screen.getByTestId('save-badge').textContent).toMatch(/Saved/), {
      timeout: 3000,
    })
  })

  it('进入游戏界面后，无关重渲染不会再次读取存档（加载只发生一次）', async () => {
    // 回归测试：加载 effect 曾经因为依赖不稳定（now 每次渲染都是新函数）而每次渲染都重跑，
    // 每次都重新读取存档并 setState 出一个新对象，把未提交的动作冲掉。
    // 真机上表现为「点方向键没反应 + JS 无响应」（渲染线程被持续的读取打满）。
    // 这里直接数「读取已提交存档」的次数：正确实现每个 (游戏, 难度) 只读一次。
    const base = createMemoryKv()
    let saveReads = 0
    const counted: KvBackend = {
      ...base,
      get: (key) => {
        if (key === 'save:1:committed:sokoban') saveReads++
        return base.get(key)
      },
    }
    await mount(counted)
    await enterGame()
    const afterMount = saveReads
    expect(afterMount).toBe(1)

    for (let i = 0; i < 3; i++) {
      fireEvent.click(screen.getByText('Menu'))
      fireEvent.click(screen.getByText('Close'))
    }
    expect(saveReads).toBe(afterMount)
  })

  it('按见证解法走完首关会显示过关面板与下一关入口', async () => {
    const { kv } = await mount()
    await enterGame()
    const witness = LEVEL_WITNESSES['L01']!
    expect(witness.length).toBeGreaterThan(0)
    for (const dir of witness) {
      // 见证解法可能比最优解长：过关后方向盘会消失，此时停止（设备上同理）
      if (screen.queryByText(/Level solved/)) break
      fireEvent.click(screen.getByLabelText(DIR_LABEL[dir]!))
    }
    await waitFor(() => expect(screen.getByText(/Level solved/)).toBeTruthy())
    expect(screen.getByText('Next level')).toBeTruthy()
    // 过关后方向盘让位给结果面板：墨水屏上不该为了看结果去滚动
    expect(screen.queryByLabelText('Up')).toBeNull()
    // 棋盘仍然可见，便于复盘（查看过程不改变结果）
    expect(screen.getByRole('grid')).toBeTruthy()

    // 过关是「关键节点」：必须已经立即落盘（不依赖防抖窗口），并记录完成进度。
    // 提交是串行队列（避免并发提交被 CAS 判成冲突），因此这里等待它落盘而不是立刻断言 ——
    // 断言的是「最终一定会写入」，而不是「某个微任务时刻已经写入」。
    let stored = ''
    await waitFor(async () => {
      stored = (await kv.get('save:1:committed:sokoban')) ?? ''
      expect(stored).toContain('"ended":"won"')
    })
    expect(stored).toContain('L01')
    // 过关只提交一次，不允许出现「界面过关但存档冲突」的假失败
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('设置与语言', () => {
  it('切换到中文后界面文案立即变化，字号写入根节点', async () => {
    await mount()
    fireEvent.click(screen.getByText('Settings'))
    await waitFor(() => expect(screen.getByText(/Text size/)).toBeTruthy())

    fireEvent.click(screen.getByText('简体中文'))
    await waitFor(() => expect(screen.getByText('字号')).toBeTruthy())
    expect(document.documentElement.lang).toBe('zh-CN')

    fireEvent.click(screen.getByText('特大'))
    await waitFor(() => expect(document.documentElement.dataset.fontScale).toBe('1.5'))
  })

  it('不支持直接控制刷新时，不把档位显示为可用', async () => {
    await mount()
    fireEvent.click(screen.getByText('Settings'))
    await waitFor(() => expect(screen.getByText(/Refresh profile/)).toBeTruthy())
    expect(screen.getByText(/does not expose refresh control/)).toBeTruthy()
  })
})

describe('保存失败与损坏存档', () => {
  it('写入失败时显示失败原因与重试入口', async () => {
    const base = createMemoryKv()
    const failing: KvBackend = {
      ...base,
      commitCas: async () => {
        throw new Error('QuotaExceededError: storage full')
      },
    }
    await mount(failing)
    await enterGame()
    fireEvent.click(screen.getByLabelText('Up'))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Save failed/), {
      timeout: 3000,
    })
    expect(screen.getByText('Retry')).toBeTruthy()
  })

  it('规则版本落后的存档提示「版本不受支持」，而不是笼统的「存档已损坏」', async () => {
    const kv = createMemoryKv()
    // 校验和正确、但 rulesVersion 与当前游戏不一致：这是「旧版本存档」，不是坏数据
    const stale = reseal({
      // moves > 0 才会出现「继续」入口；规则版本比当前新，用于模拟旧客户端写下的存档
      ...newEnvelope(
        {
          gameId: 'sokoban',
          rulesVersion: sokobanGame.rulesVersion + 1,
          contentVersion: sokobanGame.contentVersion,
          difficulty: 'starter',
          seed: 0,
          state: { levelId: 'L01', log: [] },
        },
        1000,
      ),
      moves: 3,
    })
    await kv.setMany([['save:1:committed:sokoban', JSON.stringify(stale)]])

    await mount(kv)
    // 校验和与 schema 都有效，所以它不会进「存档自检」；只有加载时比对规则版本才发现落后
    fireEvent.click(screen.getAllByText('Sokoban').at(-1)!)
    await waitFor(() => expect(screen.getByText(/How to play/)).toBeTruthy())
    fireEvent.click(screen.getByText('Continue'))
    // 关键：文案必须区分「旧版本」与「数据损坏」
    await waitFor(() => expect(screen.getByText(/version is not supported/i)).toBeTruthy())
    expect(screen.queryByText(/save is corrupted/i)).toBeNull()
  })

  it('损坏的存档会在首页暴露，打开后提示且原档不被覆盖', async () => {
    const kv = createMemoryKv()
    const broken = newEnvelope(
      {
        gameId: 'sokoban',
        rulesVersion: sokobanGame.rulesVersion,
        contentVersion: sokobanGame.contentVersion,
        difficulty: 'starter',
        seed: 0,
        state: { levelId: 'L01', log: [] },
      },
      1000,
    )
    await kv.setMany([
      ['save:1:committed:sokoban', JSON.stringify({ ...broken, checksum: '00000000' })],
    ])

    await mount(kv)
    // 首页必须提示存在损坏存档
    const warning = await screen.findByText(/cannot be read/)
    expect(warning).toBeTruthy()

    fireEvent.click(screen.getByText(/Save check/))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/corrupted/i), {
      timeout: 3000,
    })
    expect(await kv.get('save:1:committed:sokoban')).toContain('"checksum":"00000000"')
  })

  it('损坏存档时详情页开新局需要确认', async () => {
    const kv = createMemoryKv()
    const broken = newEnvelope(
      {
        gameId: 'sokoban',
        rulesVersion: sokobanGame.rulesVersion,
        contentVersion: sokobanGame.contentVersion,
        difficulty: 'starter',
        seed: 0,
        state: { levelId: 'L01', log: [] },
      },
      1000,
    )
    await kv.setMany([
      ['save:1:committed:sokoban', JSON.stringify({ ...broken, checksum: '00000000' })],
    ])
    await mount(kv)
    fireEvent.click(screen.getByText('Sokoban'))
    await waitFor(() => expect(screen.getByText(/How to play/)).toBeTruthy())
    expect(screen.getAllByText(/cannot be read/).length).toBeGreaterThan(0)

    fireEvent.click(screen.getByText('New game'))
    // 不是直接开始，而是先弹出替换确认
    await waitFor(() => expect(screen.getByText(/A game is in progress/)).toBeTruthy())
  })
})

describe('系统返回键', () => {
  it('首页返回 false（允许退出应用），进入子页面后返回 true', async () => {
    await mount()
    expect(window.__einkHandleBack?.()).toBe(false)

    fireEvent.click(screen.getByText('Settings'))
    await waitFor(() => expect(screen.getByText(/Text size/)).toBeTruthy())
    expect(window.__einkHandleBack?.()).toBe(true)
  })
})
