// @vitest-environment jsdom
/**
 * 两条入口一致性的回归（2026-10-05 浏览器试玩审计）：
 *
 * 1. **U 键与「撤销」按钮共用同一套开关**。原先 `hideShellControls: ['undo']` 只关掉了按钮，
 *    键盘这条路径照旧可用 —— 数独声明「不提供撤销」却能被 U 键撤销（终局后还能把已完成的
 *    局面退回对局中）、扫雷赢下后按 U 也能把结局撤回去。判胜之后同样不给撤销：
 *    通关记录已经落盘，结果面板本身也故意不渲染那个按钮。
 * 2. **详情页「有没有进行中的局面」= 存档是否存在**，而不是 `moves > 0`。刚开一局、
 *    一步没走就返回的新局（返回时会话已把新种子落盘）原来在详情页既没有「继续」，
 *    点「开始新游戏」也不弹「替换并开始」，而首页的「继续上一局」认的是同一个存档。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  IllegalActionError,
  coreDictEn,
  coreDictZh,
  createMemoryKv,
  newEnvelope,
  reseal,
  type GameDef,
  type GameView,
  type KvBackend,
} from '@eink/core'
import { createPlatform } from '@eink/platform'
import { App } from '../src/App.js'
import { defineGame, type GameLibrary } from '../src/registry.js'

afterEach(() => {
  cleanup()
  delete window.__einkHandleBack
})

interface FakeState {
  moves: number
}
type FakeAction = { type: 'move' } | { type: 'undo' } | { type: 'restart' }

/** 第二步即获胜：让「判胜后不给撤销」这条也能测到 */
const WIN_AT = 2

function fakeGame(): GameDef<FakeState, FakeAction> {
  return {
    id: 'undoable',
    rulesVersion: 1,
    contentVersion: 1,
    i18nNamespace: 'undoable',
    illegalNoticeKey: 'undoable.illegal.notice',
    difficulties: [{ id: 'starter', labelKey: 'undoable.difficulty.starter' }],
    create: () => ({ moves: 0 }),
    reduce: (state, action) => {
      if (action.type === 'move') return { moves: state.moves + 1 }
      if (action.type === 'undo') {
        if (state.moves === 0) throw new IllegalActionError('undoable', 'nothing to undo')
        return { moves: state.moves - 1 }
      }
      if (action.type === 'restart') return { moves: 0 }
      throw new IllegalActionError('undoable', `unknown ${(action as { type: string }).type}`)
    },
    legal: () => [],
    status: (state) => (state.moves >= WIN_AT ? 'won' : 'playing'),
    view: (): GameView => ({
      board: null,
      stats: [],
      result: { titleKey: 'undoable.won.title', details: [] },
      notice: null,
    }),
    // 方向键驱动「走一步」：不依赖棋盘渲染，测试只关心会话行为
    controls: (state) => [
      { id: 'undo', labelKey: 'shell.game.undo', role: 'action', enabled: state.moves > 0, emphasis: 'normal' },
      { id: 'restart', labelKey: 'shell.game.restart', role: 'action', enabled: true, emphasis: 'normal' },
      ...(['up', 'down', 'left', 'right'] as const).map((dir) => ({
        id: `move-${dir}`,
        labelKey: `undoable.dir.${dir}`,
        role: 'dpad' as const,
        dir,
        enabled: true,
        emphasis: 'normal' as const,
      })),
    ],
    controlAction: (_state, controlId) => {
      if (controlId.startsWith('move-')) return { type: 'move' }
      if (controlId === 'undo') return { type: 'undo' }
      if (controlId === 'restart') return { type: 'restart' }
      return null
    },
    encode: (state) => state,
    decode: (raw) => raw as FakeState,
    movesOf: (state) => state.moves,
    contentId: () => 'starter',
  }
}

const fakeDictZh = {
  'undoable.title': '可撤销游戏',
  'undoable.rules.body': '按方向键走一步，按 U 撤销。',
  'undoable.difficulty.starter': '入门',
  'undoable.won.title': '赢了',
  'undoable.illegal.notice': '走不通',
  'undoable.dir.up': '上',
  'undoable.dir.down': '下',
  'undoable.dir.left': '左',
  'undoable.dir.right': '右',
} as const
const fakeDictEn = {
  'undoable.title': 'Undoable',
  'undoable.rules.body': 'Arrow keys move, U undoes.',
  'undoable.difficulty.starter': 'Starter',
  'undoable.won.title': 'Won',
  'undoable.illegal.notice': 'Blocked',
  'undoable.dir.up': 'Up',
  'undoable.dir.down': 'Down',
  'undoable.dir.left': 'Left',
  'undoable.dir.right': 'Right',
} as const

function makeLibrary(hideUndo: boolean): GameLibrary {
  return {
    entries: [
      defineGame({
        game: fakeGame(),
        rulesKeys: ['undoable.rules.body'],
        defaultDifficulty: 'starter',
        ...(hideUndo ? { hideShellControls: ['undo'] as const } : {}),
      }),
    ],
    dicts: {
      'zh-CN': { ...coreDictZh, ...fakeDictZh },
      'en-US': { ...coreDictEn, ...fakeDictEn },
    },
  }
}

async function mount(library: GameLibrary, kv: KvBackend = createMemoryKv()) {
  const platform = await createPlatform({ kv, now: () => 1_700_000_000_000 })
  render(<App platform={platform} library={library} />)
  await waitFor(() => expect(screen.getByText(/All games|全部游戏/)).toBeTruthy())
  return platform
}

/** 首页 → 详情 → 开局（英文环境下的按钮文案与 shell.test.tsx 一致） */
async function enterGame(): Promise<void> {
  fireEvent.click(screen.getByText('Undoable'))
  await waitFor(() => expect(screen.getByText(/How to play/)).toBeTruthy())
  fireEvent.click(screen.getByText('New game'))
  await waitFor(() => expect(screen.getByLabelText('Up')).toBeTruthy())
}

const move = (): void => {
  fireEvent.keyDown(window, { key: 'ArrowUp' })
}
const pressUndoKey = (): void => {
  fireEvent.keyDown(window, { key: 'u' })
}

/**
 * 读**局面里**的步数（不是 `envelope.moves`）：后者是「已应用动作数」，
 * 连撤销也会 +1（见 core/save.ts 的 applyAction），拿它衡量撤销会得到反直觉的结果。
 */
async function gameMoves(platform: Awaited<ReturnType<typeof createPlatform>>): Promise<number> {
  const result = await platform.storage.saves.loadResult('undoable')
  if (result.status !== 'ok') return -1
  return (result.envelope.state as FakeState).moves
}

// 注：这些 waitFor 等的是**存档落盘**（壳层有防抖）。全量并行跑时 1 秒默认超时偶尔不够，
// 会偶发 `expected -1 to be 1`（gameMoves 读不到存档）——与玩法无关，这里给足 5 秒。
describe('U 键与「撤销」按钮的开关一致', () => {
  it('未声明隐藏撤销：U 键照常撤销', async () => {
    const platform = await mount(makeLibrary(false))
    await enterGame()
    move()
    await waitFor(async () => expect(await gameMoves(platform)).toBe(1), { timeout: 5000 })
    pressUndoKey()
    await waitFor(async () => expect(await gameMoves(platform)).toBe(0), { timeout: 5000 })
  })

  it('声明 hideShellControls: [undo]：U 键不再撤销（数独/斗地主/恶魔轮盘赌）', async () => {
    const platform = await mount(makeLibrary(true))
    await enterGame()
    move()
    await waitFor(async () => expect(await gameMoves(platform)).toBe(1), { timeout: 5000 })
    pressUndoKey()
    // 按键被忽略：局面一动不动（旧行为会退回 0）
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(await gameMoves(platform)).toBe(1)
  })

  it('已判胜：U 键不再撤销（结果面板故意不给撤销）', async () => {
    const platform = await mount(makeLibrary(false))
    await enterGame()
    move()
    move()
    await waitFor(() => expect(screen.getByText('Won')).toBeTruthy())
    pressUndoKey()
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(await gameMoves(platform)).toBe(WIN_AT)
    expect(screen.getByText('Won')).toBeTruthy()
  })
})

describe('详情页的「有没有进行中的局面」', () => {
  it('moves = 0 的新局仍然显示「继续」，并要求确认后才替换', async () => {
    const kv = createMemoryKv()
    // 刚开一局、一步没走就返回：返回时会话把新种子落盘，moves 仍是 0
    await kv.setMany([
      [
        'save:1:committed:undoable',
        JSON.stringify(
          reseal(
            newEnvelope(
              {
                gameId: 'undoable',
                rulesVersion: 1,
                contentVersion: 1,
                difficulty: 'starter',
                seed: 42,
                state: { moves: 0 },
              },
              1000,
            ),
          ),
        ),
      ],
    ])
    await mount(makeLibrary(false), kv)
    // 有存档时首页的「继续上一局」细栏里也有游戏名 → 取最后一个（游戏方块）
    fireEvent.click(screen.getAllByText('Undoable').at(-1)!)
    await waitFor(() => expect(screen.getByText(/How to play/)).toBeTruthy())

    // 旧行为：moves === 0 被判成「没有存档」，既没有 Continue，也不弹替换确认
    expect(screen.getByText('Continue')).toBeTruthy()
    fireEvent.click(screen.getByText('New game'))
    await waitFor(() => expect(screen.getByText('A game is in progress')).toBeTruthy())
  })
})
