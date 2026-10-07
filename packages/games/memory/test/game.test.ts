/**
 * GameDef 外壳集成测试：view / controls / encode / decode / i18n / 元信息。
 * 重点：
 *   - 1-bit 呈现约定（hidden 扣牌、tile 符号 + textScale 0.62、待盖回用 selected 描边、stats 只有两项）；
 *   - `encode`/`decode` 严格往返，坏数据一律抛 IllegalActionError；
 *   - 中英字典基础 key 集合一致，壳层会取的 key 全部存在。
 */
import { describe, expect, it } from 'vitest'
import {
  IllegalActionError,
  baseKeys,
  compareDicts,
  coreDictEn,
  coreDictZh,
  createI18n,
  type Dict,
} from '@eink/core'
import {
  CELL_LABEL_KEYS,
  DIFFICULTIES,
  DIFFICULTY_IDS,
  MEMORY_ID,
  TILE_TEXT_SCALE,
  cellCount,
  configFor,
  glyphForPair,
  memoryEn,
  memoryGame,
  memoryZh,
  snapshotOf,
  type DifficultyId,
  type MemoryAction,
  type MemoryState,
} from '../src/index.js'
import { CELL_LABEL_KEYS as VIEW_CELL_LABEL_KEYS } from '../src/view.js'
import { act, controlById, fresh, pairOf, selectAt, statValue } from './helpers.js'

const zh: Dict = { ...coreDictZh, ...memoryZh }
const en: Dict = { ...coreDictEn, ...memoryEn }
const i18nZh = createI18n('zh-CN', { 'zh-CN': zh, 'en-US': en })
const i18nEn = createI18n('en-US', { 'zh-CN': zh, 'en-US': en })

function midGame(seed = 31, difficulty: DifficultyId = 'starter'): MemoryState {
  const state = fresh(seed, difficulty)
  const [a, aPartner] = pairOf(state.deck, 0)
  const [b] = pairOf(state.deck, 1)
  const [c] = pairOf(state.deck, 2)
  // 一次成功的尝试（配对 0）+ 一次失败待盖回的尝试（对子 1 与 2 的第一张）
  return act(
    act(act(act(state, { type: 'flip', index: a }), { type: 'flip', index: aPartner }), {
      type: 'flip',
      index: b,
    }),
    { type: 'flip', index: c },
  )
}

describe('view / 1-bit 呈现约定', () => {
  it('三档难度的棋盘尺寸与格子索引都正确，且没有分组线', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      const config = configFor(difficulty)
      const board = memoryGame.view(fresh(1, difficulty)).board!
      expect(board.kind).toBe('grid')
      expect(board.cols).toBe(config.cols)
      expect(board.rows).toBe(config.rows)
      expect(board.cells).toHaveLength(cellCount(config))
      board.cells.forEach((cell, index) => expect(cell.index).toBe(index))
      // 记忆配对没有宫结构：多一层分组线只会让画面更花
      expect(board.groups).toBeUndefined()
    }
  })

  it('开局全部是扣着的牌：kind hidden、glyph 空、无 textScale、无高亮（底纹由壳层画）', () => {
    const view = memoryGame.view(fresh(2, 'skilled'))
    for (const cell of view.board!.cells) {
      expect(cell.kind).toBe('hidden')
      expect(cell.glyph).toBe('')
      expect(cell.textScale).toBeUndefined()
      expect(cell.selected).toBeUndefined()
    }
    expect(view.result).toBeNull()
    expect(view.notice).toBeNull()
    expect(statValue(fresh(2, 'skilled'), 'memory.stat.pairs')).toBe('0/8')
    expect(statValue(fresh(2, 'skilled'), 'memory.stat.attempts')).toBe('0')
  })

  it('翻开的牌是 tile + 符号 + textScale 0.62；扣着的牌仍是 hidden', () => {
    const state = midGame()
    const snapshot = snapshotOf(state)
    const visible = new Set([...snapshot.matched, ...snapshot.faceUp])
    const cells = memoryGame.view(state).board!.cells
    for (let index = 0; index < cells.length; index++) {
      const cell = cells[index]!
      if (visible.has(index)) {
        expect(cell.kind).toBe('tile')
        expect(cell.glyph).toBe(glyphForPair(state.deck[index]))
        expect(cell.textScale).toBe(TILE_TEXT_SCALE)
      } else {
        expect(cell.kind).toBe('hidden')
        expect(cell.glyph).toBe('')
        expect(cell.textScale).toBeUndefined()
      }
    }
    // 已配对的那两张不再高亮（只有待盖回才用 selected 描边）
    const matched = cells.filter((cell) => cell.kind === 'tile' && cell.selected !== true)
    expect(matched).toHaveLength(snapshot.matched.length)
  })

  it('待盖回的两张保持 tile 并带 selected 描边，同时给出稳定文字提示', () => {
    const state = fresh(32, 'starter')
    const [a] = pairOf(state.deck, 0)
    const [b] = pairOf(state.deck, 1)
    const pending = act(act(state, { type: 'flip', index: a }), { type: 'flip', index: b })
    const view = memoryGame.view(pending)
    const selected = view.board!.cells.filter((cell) => cell.selected)
    expect(selected.map((cell) => cell.index)).toEqual([a, b])
    for (const cell of selected) {
      expect(cell.kind).toBe('tile')
      expect(cell.glyph).toBe(glyphForPair(pending.deck[cell.index]))
    }
    expect(view.notice).toEqual({ textKey: 'memory.notice.cover' })
  })

  it('stats 恰好两项：已配对 n/总对数、尝试次数（值由游戏拼好）', () => {
    const state = midGame()
    const view = memoryGame.view(state)
    expect(view.stats).toHaveLength(2)
    expect(view.stats).toEqual([
      { labelKey: 'memory.stat.pairs', value: `1/${cellCount(configFor('starter')) / 2}` },
      { labelKey: 'memory.stat.attempts', value: '2' },
    ])
  })

  it('胜利时结果页给出标题与尝试次数明细，进行中没有结果', () => {
    const state = fresh(4, 'starter')
    expect(memoryGame.view(state).result).toBeNull()
    let won = state
    const pairs = cellCount(configFor('starter')) / 2
    for (let pair = 0; pair < pairs; pair++) {
      const [first, second] = pairOf(state.deck, pair)
      won = act(won, { type: 'flip', index: first })
      won = act(won, { type: 'flip', index: second })
    }
    expect(memoryGame.status(won)).toBe('won')
    const result = memoryGame.view(won).result!
    expect(result.titleKey).toBe('memory.won.title')
    expect(result.details).toEqual([{ key: 'memory.result.attempts', params: { count: pairs } }])
  })
})

describe('controls / controlAction', () => {
  it('只声明一个 role:action 的 undo 控件，没有 dpad / restart / next-level', () => {
    const state = fresh(1, 'starter')
    const controls = memoryGame.controls(state)
    expect(controls).toHaveLength(1)
    const undo = controls[0]!
    expect(undo.id).toBe('undo')
    expect(undo.role).toBe('action')
    expect(undo.labelKey).toBe('shell.game.undo')
    expect(undo.enabled).toBe(false)
    expect(controls.some((control) => control.role === 'dpad')).toBe(false)
    expect(controls.some((control) => control.id === 'restart')).toBe(false)
    expect(controls.some((control) => control.id === 'next-level')).toBe(false)
    expect(controls.some((control) => control.id === 'levels')).toBe(false)

    const played = act(state, { type: 'flip', index: pairOf(state.deck, 0)[0] })
    expect(controlById(played, 'undo')!.enabled).toBe(true)
    // 终局后仍可撤销（退回重看）
    let won = state
    for (let pair = 0; pair < cellCount(configFor('starter')) / 2; pair++) {
      const [first, second] = pairOf(state.deck, pair)
      won = act(act(won, { type: 'flip', index: first }), { type: 'flip', index: second })
    }
    expect(controlById(won, 'undo')!.enabled).toBe(true)
  })

  it('controlAction 把按钮映射成动作，未知 id 返回 null；壳层直接派发的 undo / restart 都被接受', () => {
    const state = fresh(1, 'starter')
    expect(memoryGame.controlAction!(state, 'undo')).toEqual({ type: 'undo' })
    expect(memoryGame.controlAction!(state, 'restart')).toEqual({ type: 'restart' })
    expect(memoryGame.controlAction!(state, 'flag-mode')).toBeNull()
    const played = act(state, { type: 'flip', index: pairOf(state.deck, 0)[0] })
    expect(memoryGame.encode(act(played, { type: 'undo' }))).toEqual(memoryGame.encode(state))
    expect(memoryGame.status(act(played, { type: 'restart' }))).toBe('playing')
  })
})

describe('encode / decode', () => {
  it('初始局面与中盘局面往返一致（含 JSON 往返）', () => {
    for (const state of [fresh(1, 'starter'), midGame(2, 'skilled')]) {
      const raw = memoryGame.encode(state)
      expect(memoryGame.decode(raw)).toEqual(state)
      expect(memoryGame.decode(JSON.parse(JSON.stringify(raw)))).toEqual(state)
      expect(memoryGame.encode(memoryGame.decode(raw))).toEqual(raw)
    }
  })

  it('decode 不会重新洗牌：牌面原样搬运，后续行为与直接 reduce 一致', () => {
    const state = midGame(8, 'challenging')
    const decoded = memoryGame.decode(JSON.parse(JSON.stringify(memoryGame.encode(state))))
    expect(decoded.deck).toEqual(state.deck)
    const action: MemoryAction = { type: 'flip', index: pairOf(state.deck, 5)[1] }
    expect(memoryGame.encode(act(decoded, action))).toEqual(memoryGame.encode(act(state, action)))
  })

  it('坏数据一律抛 IllegalActionError', () => {
    const state = midGame(31, 'starter')
    const raw = memoryGame.encode(state) as {
      difficulty: string
      seed: number
      rngCursor: number
      deck: number[]
      flips: number[]
    }
    const cells = cellCount(configFor('starter'))
    const [a] = pairOf(state.deck, 0)
    /** 把牌面里两张符号不同的牌对调：牌面不再等于 (seed, 游标) 推出的洗牌结果 */
    const swapDeck = (): number[] => {
      const deck = raw.deck.slice()
      const other = deck.findIndex((pairId) => pairId !== deck[0])
      const tmp = deck[0]!
      deck[0] = deck[other]!
      deck[other] = tmp
      return deck
    }
    const bad: unknown[] = [
      null,
      undefined,
      42,
      'state',
      [],
      {},
      { ...raw, difficulty: 'impossible' },
      { ...raw, difficulty: undefined },
      { ...raw, seed: -1 },
      { ...raw, seed: 1.5 },
      { ...raw, seed: 0x1_0000_0000 },
      { ...raw, rngCursor: -1 },
      { ...raw, rngCursor: 1.5 },
      { ...raw, rngCursor: 0x1_0000_0000 },
      { ...raw, deck: 'nope' },
      { ...raw, deck: raw.deck.slice(0, cells - 1) },
      { ...raw, deck: [...raw.deck, 0] },
      { ...raw, deck: raw.deck.map((pairId) => pairId + 100) },
      { ...raw, deck: raw.deck.map(() => 0) },
      { ...raw, deck: swapDeck() },
      { ...raw, flips: 'nope' },
      { ...raw, flips: [-1] },
      { ...raw, flips: [cells] },
      { ...raw, flips: [1.5] },
      { ...raw, flips: ['0'] },
      // 同一张牌翻两次（会被当成一对）
      { ...raw, flips: [a, a] },
      // 翻已配对的牌
      { ...raw, flips: [...raw.flips, a] },
      // 缺字段
      { difficulty: raw.difficulty, seed: raw.seed },
      { ...raw, deck: undefined },
      { ...raw, flips: undefined },
    ]
    for (const candidate of bad) {
      expect(() => memoryGame.decode(candidate), JSON.stringify(candidate)?.slice(0, 90)).toThrow(
        IllegalActionError,
      )
    }
    // 同一份数据的合法形态必须被接受（说明上面的失败都来自具体校验，而不是整体不可用）
    expect(() => memoryGame.decode(JSON.parse(JSON.stringify(raw)))).not.toThrow()
  })

  it('被手改成「所有对子相邻」的牌面会被拒绝（对局公平性靠这条守住）', () => {
    const state = fresh(3, 'starter')
    const raw = memoryGame.encode(state) as { deck: number[] } & Record<string, unknown>
    const pairs = raw.deck.length / 2
    const rigged: number[] = []
    for (let pair = 0; pair < pairs; pair++) rigged.push(pair, pair)
    expect(() => memoryGame.decode({ ...raw, deck: rigged })).toThrow(IllegalActionError)
  })

  it('decode 后仍能继续对局（重放日志不会拒绝游戏自己产生的状态）', () => {
    let state = fresh(17, 'skilled')
    for (let step = 0; step < 12; step++) {
      const actions = memoryGame.legal(state).filter((action) => action.type === 'flip')
      if (actions.length === 0) break
      state = act(state, actions[step % actions.length]!)
      const decoded = memoryGame.decode(memoryGame.encode(state))
      expect(decoded).toEqual(state)
      expect(memoryGame.view(decoded)).toEqual(memoryGame.view(state))
    }
    expect(snapshotOf(state).attempts).toBeGreaterThan(0)
  })
})

describe('元信息与注册表接口', () => {
  it('GameDef 元信息符合契约', () => {
    expect(memoryGame.id).toBe('memory')
    expect(memoryGame.i18nNamespace).toBe('memory')
    expect(memoryGame.rulesVersion).toBeGreaterThanOrEqual(1)
    expect(memoryGame.contentVersion).toBeGreaterThanOrEqual(1)
    expect(memoryGame.illegalNoticeKey).toBe('memory.illegal.notice')
    expect(memoryGame.difficulties.map((item) => item.id)).toEqual([...DIFFICULTY_IDS])
    expect(memoryGame.difficulties.map((item) => item.labelKey)).toEqual([
      'memory.difficulty.starter',
      'memory.difficulty.skilled',
      'memory.difficulty.challenging',
    ])
    // 无关卡玩法：不要声明 levels
    expect((memoryGame as { levels?: unknown }).levels).toBeUndefined()
  })

  it('点不动的提示就是「该点哪」的引导语（审计回归：泛化错误会顶掉有效引导）', () => {
    // 点已配对 / 待盖回的牌时，玩家需要的是下一步该点哪 —— 两条 key 的文案必须一致
    expect(zh['memory.illegal.notice']).toBe(zh['memory.notice.cover'])
    expect(en['memory.illegal.notice']).toBe(en['memory.notice.cover'])
  })

  it('contentId = 难度，movesOf = 尝试次数', () => {
    const state = midGame(1, 'challenging')
    expect(memoryGame.contentId!(state)).toBe('challenging')
    expect(memoryGame.movesOf!(state)).toBe(2)
    expect(memoryGame.contentId!(memoryGame.create(1, 'starter'))).toBe('starter')
  })

  it('create 对不同难度互不串味，未知难度被拒绝', () => {
    expect(memoryGame.create(1, 'skilled').difficulty).toBe('skilled')
    expect(memoryGame.create(1, 'skilled').deck).toHaveLength(cellCount(DIFFICULTIES.skilled))
    expect(() => memoryGame.create(1, 'impossible')).toThrow(IllegalActionError)
  })

  it('selectAction 越界/已配对/已翻开都返回 null', () => {
    const state = midGame(5, 'starter')
    const snapshot = snapshotOf(state)
    for (const index of snapshot.matched) expect(selectAt(state, index)).toBeNull()
    for (const index of snapshot.faceUp) expect(selectAt(state, index)).toBeNull()
    expect(selectAt(state, -1)).toBeNull()
    expect(selectAt(state, cellCount(configFor('starter')))).toBeNull()
  })
})

describe('字典', () => {
  it('中英基础 key 集合完全一致，没有缺失/多余/复数不完整', () => {
    expect(compareDicts({ 'zh-CN': memoryZh, 'en-US': memoryEn })).toEqual([])
    expect([...baseKeys(memoryZh)].sort()).toEqual([...baseKeys(memoryEn)].sort())
  })

  it('壳层必需的 key 都定义了，且两种语言都能取到（无 ⟦key⟧、无残留插值）', () => {
    const keys = [
      'memory.title',
      'memory.rules.body',
      'memory.rules.body2',
      'memory.rules.restart',
      'memory.illegal.notice',
      'memory.notice.cover',
      'memory.won.title',
      'memory.stat.pairs',
      'memory.stat.attempts',
      'memory.cell.tile',
      'memory.cell.hidden',
      ...DIFFICULTY_IDS.map((id) => `memory.difficulty.${id}`),
    ]
    for (const key of keys) {
      expect(zh[key], key).toBeDefined()
      expect(en[key], key).toBeDefined()
      expect(i18nZh.t(key), key).not.toContain('⟦')
      expect(i18nEn.t(key), key).not.toContain('⟦')
      expect(i18nZh.t(key), key).not.toMatch(/\{\w+\}/)
      expect(i18nEn.t(key), key).not.toMatch(/\{\w+\}/)
    }
    // 结果明细走 plural：中文只提供 __other，英文两种都要有
    for (const key of ['memory.result.attempts']) {
      expect(zh[`${key}__other`], key).toBeDefined()
      expect(en[`${key}__one`], key).toBeDefined()
      expect(en[`${key}__other`], key).toBeDefined()
    }
    // 「最佳成绩」由壳层带 {count} 取，因此必然会含插值（单独检查）
    expect(zh['memory.solved.best']).toBeDefined()
    expect(en['memory.solved.best']).toBeDefined()
    expect(zh['memory.solved.best__other']).toBeDefined()
    expect(en['memory.solved.best__other']).toBeDefined()
    expect(i18nZh.t('memory.solved.best', { count: 9 })).toContain('9')
    expect(i18nEn.t('memory.solved.best', { count: 1 })).not.toMatch(/\{\w+\}/)
    expect(i18nZh.plural('memory.result.attempts', 3, { count: 3 })).toContain('3')
    expect(i18nEn.plural('memory.result.attempts', 1, { count: 1 })).not.toMatch(/\{\w+\}/)
  })

  it('view / controls / 格子标签用到的 key 都能取到（两种语言都不缺）', () => {
    const state = midGame(6, 'skilled')
    const view = memoryGame.view(state)
    const keys: string[] = [
      `${memoryGame.i18nNamespace}.title`,
      `${memoryGame.i18nNamespace}.rules.body`,
      `${memoryGame.i18nNamespace}.rules.body2`,
      `${memoryGame.i18nNamespace}.rules.restart`,
      memoryGame.illegalNoticeKey!,
      ...view.stats.map((stat) => stat.labelKey),
      ...memoryGame.controls(state).map((control) => control.labelKey),
      ...memoryGame.difficulties.map((difficulty) => difficulty.labelKey),
      ...(Object.values(VIEW_CELL_LABEL_KEYS).filter(Boolean) as string[]),
    ]
    for (const key of keys) {
      expect(i18nZh.t(key), key).not.toContain('⟦')
      expect(i18nEn.t(key), key).not.toContain('⟦')
    }
    expect(i18nZh.missingKeys()).toEqual([])
    expect(i18nEn.missingKeys()).toEqual([])
  })

  it('结果标题、待盖回提示在两种语言里都能取到', () => {
    const state = fresh(7, 'starter')
    expect(i18nZh.t('memory.notice.cover')).not.toContain('⟦')
    expect(i18nEn.t('memory.notice.cover')).not.toContain('⟦')
    let won = state
    for (let pair = 0; pair < cellCount(configFor('starter')) / 2; pair++) {
      const [first, second] = pairOf(state.deck, pair)
      won = act(act(won, { type: 'flip', index: first }), { type: 'flip', index: second })
    }
    const result = memoryGame.view(won).result!
    expect(i18nZh.t(result.titleKey)).not.toContain('⟦')
    expect(i18nEn.t(result.titleKey)).not.toContain('⟦')
    for (const detail of result.details) {
      if (detail.params) {
        expect(i18nZh.plural(detail.key, Number(detail.params.count), detail.params)).not.toContain('⟦')
        expect(i18nEn.plural(detail.key, Number(detail.params.count), detail.params)).not.toContain('⟦')
      } else {
        expect(i18nZh.t(detail.key)).not.toContain('⟦')
        expect(i18nEn.t(detail.key)).not.toContain('⟦')
      }
    }
    expect(i18nZh.missingKeys()).toEqual([])
    expect(i18nEn.missingKeys()).toEqual([])
  })

  it('格子无障碍标签覆盖用到的两种 kind', () => {
    expect(CELL_LABEL_KEYS).toEqual({
      tile: 'memory.cell.tile',
      hidden: 'memory.cell.hidden',
    })
    expect(VIEW_CELL_LABEL_KEYS).toEqual(CELL_LABEL_KEYS)
    for (const kind of ['tile', 'hidden'] as const) {
      const key = VIEW_CELL_LABEL_KEYS[kind]!
      expect(zh[key]).toBeDefined()
      expect(en[key]).toBeDefined()
    }
    expect(MEMORY_ID).toBe('memory')
  })
})
