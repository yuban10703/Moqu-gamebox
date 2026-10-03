// @vitest-environment jsdom
/**
 * 深度巡检（浏览器探针）发现的问题的回归测试。
 *
 * 三条都在真机分辨率的浏览器里实测复现过，这里用 jsdom + 假游戏钉死：
 *
 * 1. **点了一个规则层不会产生动作的格子，界面一声不响**
 *    （扫雷点已翻开的格子、记忆配对点已翻开的牌、五子棋点已有棋子的交叉点、华容道点够不着的空格）。
 *    各玩法的 `illegalNoticeKey` 文案因此永远没有出现的机会。
 * 2. **重新开始后「本关用时」继续累计**（推箱子 439×847 实测：重开前 0:26 → 重开后 0:28）。
 * 3. **重新开始（换种子）之后新局没有立即落盘**：`loadResult` 返回 `empty`，
 *    要等玩家再走一步才写入 —— 重开一局后立刻退出，这一局就凭空消失。
 *
 * 外加一条同源缺陷：**没有方向键的玩法按键盘方向键会弹假错误**
 * （数独弹「这一步填不了」、五子棋弹「这里不能落子」），由壳层忽略该按键。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import {
  IllegalActionError,
  coreDictEn,
  coreDictZh,
  createMemoryKv,
  type CellView,
  type GameDef,
  type GameView,
  type KvBackend,
} from '@eink/core'
import { createPlatform } from '@eink/platform'
import { App } from '../src/App.js'
import { defineGame, type GameLibrary } from '../src/registry.js'
import { useSession } from '../src/session.js'

afterEach(() => {
  cleanup()
  delete window.__einkHandleBack
})

/* ------------------------------------------------------------------ *
 * 假游戏：2×2 棋盘，只有 0 号格点得动，其余格子 selectAction 返回 null
 * ------------------------------------------------------------------ */
interface TapState {
  taps: number
  finished: boolean
  levelId: string
}
type TapAction = { type: 'tap'; index: number } | { type: 'finish' } | { type: 'restart' }

const GAME_ID = 'tap-test'

function boardOf(): GameView['board'] {
  const cells: CellView[] = [0, 1, 2, 3].map((index) => ({
    index,
    kind: index === 0 ? 'tile' : 'empty',
    glyph: index === 0 ? '●' : '',
  }))
  return { kind: 'grid', cols: 2, rows: 2, cells }
}

const tapGame: GameDef<TapState, TapAction> = {
  id: GAME_ID,
  rulesVersion: 1,
  contentVersion: 1,
  i18nNamespace: GAME_ID,
  difficulties: [{ id: 'starter', labelKey: `${GAME_ID}.difficulty.starter` }],
  create: () => ({ taps: 0, finished: false, levelId: 'l1' }),
  reduce: (state, action) => {
    if (action.type === 'tap') return { ...state, taps: state.taps + 1 }
    if (action.type === 'finish') return { ...state, finished: true }
    if (action.type === 'restart') return state
    // 未知动作明确报错（与所有真实玩法一致）：壳层不该在没有方向键的玩法上派发 move
    throw new IllegalActionError(GAME_ID, `unknown ${String((action as { type?: string }).type)}`)
  },
  legal: () => [],
  selectAction: (_state, index) => (index === 0 ? { type: 'tap', index } : null),
  controlAction: () => null,
  illegalNoticeKey: `${GAME_ID}.illegal`,
  status: (state) => (state.finished ? 'won' : 'playing'),
  contentId: (state) => state.levelId,
  movesOf: (state) => state.taps,
  view: (state) => ({
    board: boardOf(),
    stats: [{ labelKey: `${GAME_ID}.stat.taps`, value: String(state.taps) }],
    result: state.finished ? { titleKey: `${GAME_ID}.won.title`, details: [] } : null,
    notice: null,
  }),
  controls: () => [
    { id: 'undo', labelKey: 'shell.game.undo', role: 'action', enabled: false, emphasis: 'normal' },
  ],
  encode: (state) => ({ ...state }),
  decode: (value) => value as TapState,
}

const tapDictZh = {
  [`${GAME_ID}.title`]: '点格子测试',
  [`${GAME_ID}.rules.body`]: '只有第一格点得动。',
  [`${GAME_ID}.rules.restart`]: '重开会换一局。',
  [`${GAME_ID}.difficulty.starter`]: '入门',
  [`${GAME_ID}.illegal`]: '这里不能这样点',
  [`${GAME_ID}.stat.taps`]: '点击数',
  [`${GAME_ID}.won.title`]: '完成',
  [`${GAME_ID}.cell.tile`]: '可点格',
}
const tapDictEn = {
  [`${GAME_ID}.title`]: 'Tap test',
  [`${GAME_ID}.rules.body`]: 'Only the first cell reacts.',
  [`${GAME_ID}.rules.restart`]: 'Restart deals a new board.',
  [`${GAME_ID}.difficulty.starter`]: 'Starter',
  [`${GAME_ID}.illegal`]: 'That tile cannot be tapped',
  [`${GAME_ID}.stat.taps`]: 'Taps',
  [`${GAME_ID}.won.title`]: 'Done',
  [`${GAME_ID}.cell.tile`]: 'Tappable',
}

const library: GameLibrary = {
  entries: [
    defineGame({
      game: tapGame,
      rulesKeys: [`${GAME_ID}.rules.body`],
      defaultDifficulty: 'starter',
      cellLabelKey: (kind) => (kind === 'tile' ? `${GAME_ID}.cell.tile` : undefined),
    }),
  ],
  dicts: {
    'zh-CN': { ...coreDictZh, ...tapDictZh },
    'en-US': { ...coreDictEn, ...tapDictEn },
  },
}

async function mountSession(kv: KvBackend = createMemoryKv()) {
  const platform = await createPlatform({ kv, now: () => 1_700_000_000_000 })
  const hook = renderHook(() =>
    useSession<TapState, TapAction>({ game: tapGame, storage: platform.storage, difficulty: 'starter' }),
  )
  await waitFor(() => expect(hook.result.current.ready).toBe(true))
  return { platform, hook }
}

describe('点了"规则层不会产生动作"的格子：必须有文字反馈', () => {
  it('点无效格 → 状态条出现该玩法的提示，且局面不变', async () => {
    const { hook } = await mountSession()
    expect(hook.result.current.view.notice).toBeNull()

    act(() => hook.result.current.selectCell?.(3))

    expect(hook.result.current.view.notice?.textKey).toBe(`${GAME_ID}.illegal`)
    expect(hook.result.current.state.taps).toBe(0)
  })

  it('点有效格 → 局面变化，并且把上一次的无效提示清掉', async () => {
    const { hook } = await mountSession()
    act(() => hook.result.current.selectCell?.(2))
    expect(hook.result.current.view.notice?.textKey).toBe(`${GAME_ID}.illegal`)

    act(() => hook.result.current.selectCell?.(0))

    expect(hook.result.current.state.taps).toBe(1)
    // 提示不能挂着："牌翻开了、提示还写着点不了"是更糟的状态
    expect(hook.result.current.view.notice).toBeNull()
  })

  it('终局之后点无效格不再弹提示（结果面板还开着，那时的点击没有意义）', async () => {
    const { hook } = await mountSession()
    act(() => hook.result.current.dispatch({ type: 'finish' }))
    expect(hook.result.current.finished).toBe(true)

    act(() => hook.result.current.selectCell?.(3))

    expect(hook.result.current.view.notice).toBeNull()
  })
})

describe('重新开始：本关用时归零 + 新局立即落盘', () => {
  it('restart 之后 elapsed - levelStart 归零（关卡制玩法的「本关用时」）', async () => {
    const { hook } = await mountSession()
    // 模拟"玩了 60 秒"：用时可变量由 <Timer> 自己累加，这里直接放置
    act(() => {
      hook.result.current.elapsedRef.current = 60_000
    })
    expect(hook.result.current.elapsedRef.current - hook.result.current.levelStartRef.current).toBe(60_000)

    act(() => hook.result.current.restart())

    expect(hook.result.current.elapsedRef.current - hook.result.current.levelStartRef.current).toBe(0)
  })

  it('restartFresh 之后新局立刻写进存档，且 seed 与原来不同', async () => {
    const kv = createMemoryKv()
    const { platform, hook } = await mountSession(kv)
    // 先走一步让当前这局落盘（"每一步立即提交"），拿到盘上的种子
    act(() => hook.result.current.selectCell?.(0))
    await waitFor(async () => {
      const loaded = await platform.storage.saves.loadResult(GAME_ID)
      expect(loaded.status).toBe('ok')
    })
    const before = await platform.storage.saves.loadResult(GAME_ID)
    expect(before.status).toBe('ok')
    const seedBefore = before.status === 'ok' ? before.envelope.seed : null

    act(() => hook.result.current.restartFresh())

    /*
     * 关键：discardAndRestart 会**先删掉旧档**，若新档要等到下一步操作才写，
     * 中间就存在"盘上什么都没有"的窗口（实测 loadResult 返回 empty）——
     * 玩家重开一局后直接退出，这一局就没了。这里要求重开后立刻可读。
     */
    await waitFor(async () => {
      const now = await platform.storage.saves.loadResult(GAME_ID)
      expect(now.status).toBe('ok')
    })
    const after = await platform.storage.saves.loadResult(GAME_ID)
    const seedAfter = after.status === 'ok' ? after.envelope.seed : null
    expect(seedAfter).not.toBeNull()
    expect(seedAfter).not.toBe(seedBefore)
  })
})

describe('没有方向键的玩法：键盘方向键不该弹出假错误', () => {
  async function mountApp() {
    const platform = await createPlatform({ kv: createMemoryKv(), now: () => 1_700_000_000_000 })
    render(<App platform={platform} library={library} />)
    await waitFor(() => expect(screen.getByText(/全部游戏|All games/)).toBeTruthy())
    fireEvent.click(screen.getByText(/点格子测试|Tap test/))
    await waitFor(() => expect(screen.getByText(/玩法说明|How to play/)).toBeTruthy())
    fireEvent.click(screen.getByText(/开始新游戏|New game/))
    await waitFor(() => expect(screen.getByRole('grid')).toBeTruthy())
  }

  it('按方向键：不产生提示、局面不变（玩法没有声明方向控件）', async () => {
    await mountApp()
    expect(screen.queryByTestId('notice')).toBeNull()

    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    fireEvent.keyDown(window, { key: 'ArrowUp' })

    await waitFor(() => expect(screen.queryByTestId('notice')).toBeNull())
    // 也不该被误判成一次操作
    expect(screen.getByText('0')).toBeTruthy()
  })
})
