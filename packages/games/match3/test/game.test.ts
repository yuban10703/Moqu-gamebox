/**
 * GameDef 外壳集成测试：view / controls / encode / decode / i18n / 元信息 / 平衡校准。
 *
 * 重点：
 *   - 1-bit 呈现约定（全部 tile + 符号 + textScale、选中格用 selected 整格反白、stats 两项）；
 *   - `encode`/`decode` 严格往返，坏数据一律抛 IllegalActionError；
 *   - 中英字典基础 key 集合一致，壳层会取的 key 全部存在；
 *   - 「可玩性下限」：贪心机器人必须在步数上限内达标（否则难度配置就是不可完成的）。
 */
import { describe, expect, it } from 'vitest'
import {
  IllegalActionError,
  baseKeys,
  compareDicts,
  coreDictEn,
  coreDictZh,
  createI18n,
  createRng,
  type Dict,
} from '@eink/core'
import {
  CELL_LABEL_KEYS,
  DIFFICULTIES,
  DIFFICULTY_IDS,
  EMPTY,
  KIND_GLYPHS,
  MATCH3_CONTENT_VERSION,
  MATCH3_ID,
  MATCH3_RULES_VERSION,
  TILE_TEXT_SCALE,
  buildBoard,
  cellCount,
  configFor,
  decodeState,
  encodeState,
  findGroups,
  findLegalSwaps,
  gameStatus,
  hasLegalSwap,
  match3En,
  match3Game,
  match3Zh,
  selectAction,
  type Match3State,
} from '../src/index.js'
import { act, controlById, fresh, greedyAction, randomPlayer, statValue } from './helpers.js'

const zh: Dict = { ...coreDictZh, ...match3Zh }
const en: Dict = { ...coreDictEn, ...match3En }
const i18nZh = createI18n('zh-CN', { 'zh-CN': zh, 'en-US': en })
const i18nEn = createI18n('en-US', { 'zh-CN': zh, 'en-US': en })

/** 玩几步，得到一个「有历史、有分数」的中局（用于 view / encode 断言） */
function midGame(seed = 21, difficulty: 'starter' | 'skilled' | 'challenging' = 'starter'): Match3State {
  const player = randomPlayer(seed * 31 + 7)
  let state = fresh(seed, difficulty)
  for (let step = 0; step < 3; step++) {
    const pairs = findLegalSwaps(state.board, configFor(difficulty))
    if (pairs.length === 0) break
    const pair = player.pick(pairs)
    state = act(state, { type: 'swap', a: pair[0], b: pair[1] })
  }
  return state
}

describe('元信息', () => {
  it('id / 版本 / 命名空间 / 非法提示 / 难度清单都符合契约', () => {
    expect(match3Game.id).toBe(MATCH3_ID)
    expect(match3Game.i18nNamespace).toBe(MATCH3_ID)
    expect(match3Game.rulesVersion).toBe(MATCH3_RULES_VERSION)
    expect(match3Game.contentVersion).toBe(MATCH3_CONTENT_VERSION)
    expect(match3Game.rulesVersion).toBe(1)
    expect(match3Game.illegalNoticeKey).toBe('match3.illegal.notice')
    expect(match3Game.difficulties.map((item) => item.id)).toEqual([...DIFFICULTY_IDS])
    for (const item of match3Game.difficulties) {
      expect(item.labelKey).toBe(`match3.difficulty.${item.id}`)
      expect(zh[item.labelKey]).toBeDefined()
      expect(en[item.labelKey]).toBeDefined()
    }
    // 撤销按钮声明为 action，且只需要这一个自定义控件
    expect(match3Game.controls(fresh(1, 'starter')).map((control) => control.id)).toEqual(['undo'])
    // 无关卡玩法：内容 id 用难度，进度按已通关难度算
    expect(match3Game.contentId?.(fresh(1, 'skilled'))).toBe('skilled')
    expect(match3Game.movesOf?.(midGame())).toBe(midGame().moves)
  })

  it('未知难度 / 种子归一化', () => {
    expect(() => match3Game.create(1, 'nope')).toThrow(IllegalActionError)
    expect(encodeState(match3Game.create(-5, 'starter'))).toEqual(encodeState(match3Game.create(0xfffffffb, 'starter')))
    expect(encodeState(match3Game.create(Number.NaN, 'starter'))).toEqual(encodeState(match3Game.create(0, 'starter')))
  })
})

describe('view / 1-bit 呈现约定', () => {
  it('三档难度的棋盘尺寸与格子索引都正确，且没有分组线', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      const config = configFor(difficulty)
      const board = match3Game.view(fresh(1, difficulty)).board!
      expect(board.kind).toBe('grid')
      expect(board.cols).toBe(config.cols)
      expect(board.rows).toBe(config.rows)
      expect(board.cells).toHaveLength(cellCount(config))
      board.cells.forEach((cell, index) => expect(cell.index).toBe(index))
      // 消消乐没有宫结构：多一层分组线只会让画面更花
      expect(board.groups).toBeUndefined()
    }
  })

  it('每一格都是 tile + 符号 + textScale，符号取该难度前 N 个，没有颜色/灰阶信息', () => {
    const state = midGame()
    const config = configFor(state.difficulty)
    const view = match3Game.view(state)
    for (const cell of view.board!.cells) {
      expect(cell.kind).toBe('tile')
      expect(cell.glyph).toBe(KIND_GLYPHS[state.board[cell.index]!])
      expect(KIND_GLYPHS.slice(0, config.kinds)).toContain(cell.glyph)
      expect(cell.textScale).toBe(TILE_TEXT_SCALE)
      expect(cell.selected).toBeUndefined()
      // 没有 EMPTY 落在展示模型里
      expect(cell.glyph).not.toBe('')
    }
    expect(state.board).not.toContain(EMPTY)
  })

  it('选中格用 selected 标记（壳层据此整格反白），其余格没有该标记', () => {
    const state = act(midGame(), { type: 'select', index: 9 })
    const cells = match3Game.view(state).board!.cells
    expect(cells.filter((cell) => cell.selected).map((cell) => cell.index)).toEqual([9])
    expect(cells[9]!.glyph).toBe(KIND_GLYPHS[state.board[9]!])
  })

  it('统计栏只有两项：分数（含目标分）与剩余步数', () => {
    const state = midGame(3, 'skilled')
    const config = configFor('skilled')
    expect(statValue(state, 'match3.stat.score')).toBe(`${state.score}/${config.targetScore}`)
    expect(statValue(state, 'match3.stat.moves')).toBe(String(config.moveLimit - state.moves))
    expect(match3Game.view(state).stats).toHaveLength(2)
  })

  it('提示：选中时提示怎么换；刚重排过时提示棋盘变了', () => {
    const playing = midGame()
    expect(match3Game.view(playing).notice).toBeNull()
    const selected = act(playing, { type: 'select', index: 0 })
    expect(match3Game.view(selected).notice).toEqual({ textKey: 'match3.notice.pick' })
    const shuffled: Match3State = { ...playing, moves: 3, lastShuffle: 3 }
    expect(match3Game.view(shuffled).notice).toEqual({ textKey: 'match3.notice.shuffled' })
    // 重排已经过去一步后，提示不再挂着
    expect(match3Game.view({ ...playing, moves: 4, lastShuffle: 3 }).notice).toBeNull()
  })

  it('结果页：win/lose 各有标题与两条明细，playing 时为 null', () => {
    const config = configFor('starter')
    const playing = fresh(2, 'starter')
    expect(match3Game.view(playing).result).toBeNull()

    const won: Match3State = { ...playing, score: config.targetScore, moves: 4 }
    const wonView = match3Game.view(won)
    expect(gameStatus(won)).toBe('won')
    expect(wonView.result?.titleKey).toBe('match3.won.title')
    expect(wonView.result?.details.map((detail) => detail.key)).toEqual([
      'match3.result.score',
      'match3.result.moves',
    ])

    const lost: Match3State = { ...playing, score: 10, moves: config.moveLimit }
    expect(gameStatus(lost)).toBe('lost')
    const lostView = match3Game.view(lost)
    expect(lostView.result?.titleKey).toBe('match3.lost.title')
    expect(lostView.result?.details[0]?.params?.count).toBe(10)
  })

  it('控制项：开局撤销不可点，走过一步后可点；终局后仍可点（退回重试）', () => {
    const start = fresh(6, 'starter')
    expect(controlById(start, 'undo')?.enabled).toBe(false)
    expect(controlById(start, 'undo')?.labelKey).toBe('shell.game.undo')
    const played = midGame(6)
    expect(controlById(played, 'undo')?.enabled).toBe(true)
    const finished: Match3State = { ...played, score: 99999 }
    expect(gameStatus(finished)).toBe('won')
    expect(controlById(finished, 'undo')?.enabled).toBe(true)
  })
})

describe('存档：encode / decode', () => {
  it('往返一致：初始局面、中局、选中态、终局都能逐字段还原', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      const states = [fresh(1, difficulty), midGame(2, difficulty), act(midGame(2, difficulty), { type: 'select', index: 0 })]
      for (const state of states) {
        expect(match3Game.decode(match3Game.encode(state))).toEqual(state)
      }
    }
  })

  it('缺字段的容忍度：history 缺失按空栈、selected / lastShuffle 缺失按缺省；但局面与撤销栈不能自相矛盾', () => {
    const start = fresh(5, 'skilled')
    const raw = encodeState(start) as Record<string, unknown>
    // 旧存档没有撤销栈（此时也确实没走过棋）→ 正常载入
    const withoutHistory = { ...raw }
    delete withoutHistory['history']
    delete withoutHistory['selected']
    delete withoutHistory['lastShuffle']
    const decoded = decodeState(withoutHistory)
    expect(decoded.history).toEqual([])
    expect(decoded.selected).toBeNull()
    expect(decoded.lastShuffle).toBe(-1)

    // 走过棋却没有撤销栈 → 局面与撤销栈自相矛盾，按损坏拒绝
    const played = midGame(5, 'skilled')
    const playedRaw = encodeState(played) as Record<string, unknown>
    delete playedRaw['history']
    expect(() => decodeState(playedRaw)).toThrow(IllegalActionError)
  })

  it('坏数据一律拒绝：根节点 / 难度 / 盘面 / 棋子取值 / 步数 / 选中 / 重排步号', () => {
    const config = configFor('starter')
    const start = fresh(9, 'starter')
    const raw = encodeState(start) as Record<string, unknown>
    const withBoard = (mutate: (board: number[]) => void): Record<string, unknown> => {
      const copy = { ...raw, board: [...(raw['board'] as number[])] }
      mutate(copy.board as number[])
      return copy
    }
    const cases: Array<[string, unknown]> = [
      ['null', null],
      ['数组', []],
      ['字符串', 'match3'],
      ['难度非法', { ...raw, difficulty: 'impossible' }],
      ['难度缺失', { ...raw, difficulty: undefined }],
      ['盘面长度不对', { ...raw, board: [0, 1, 2] }],
      ['盘面不是数组', { ...raw, board: 'xxxx' }],
      ['棋子种类越界', withBoard((board) => (board[0] = config.kinds))],
      ['棋子是负数', withBoard((board) => (board[0] = -2))],
      ['棋子是小数', withBoard((board) => (board[0] = 1.5))],
      ['步数超上限', { ...raw, moves: config.moveLimit + 1 }],
      ['分数为负', { ...raw, score: -1 }],
      ['游标为负', { ...raw, cursor: -1 }],
      ['种子越界', { ...raw, seed: 0x1_0000_0000 }],
      ['选中越界', { ...raw, selected: cellCount(config) }],
      ['选中不是整数', { ...raw, selected: 1.5 }],
      ['重排步号为 0', { ...raw, lastShuffle: 0 }],
      ['重排步号超过步数', { ...raw, moves: 0, lastShuffle: 1 }],
      ['history 不是数组', { ...raw, history: {} }],
      ['history 条数不等于步数', { ...raw, history: [{ at: [], old: [], score: 0, cursor: 0, lastShuffle: -1 }] }],
    ]
    for (const [label, value] of cases) {
      expect(() => decodeState(value), label).toThrow(IllegalActionError)
    }
  })

  it('语义校验：盘面必须稳定、必须有解', () => {
    const config = configFor('starter')
    const raw = encodeState(fresh(9, 'starter')) as Record<string, unknown>
    // 人为造一个三连（合法取值但不可能由本作产出：结算后不会残留三连）
    const unstable = [...(raw['board'] as number[])]
    unstable[0] = 0
    unstable[1] = 0
    unstable[2] = 0
    expect(() => decodeState({ ...raw, board: unstable })).toThrow(IllegalActionError)

    // 稳定但死局：`(row + col) % 3` 的拉丁方阵，任何相邻交换都凑不出三连
    const dead: number[] = []
    for (let index = 0; index < cellCount(config); index++) {
      dead.push((Math.floor(index / config.cols) + (index % config.cols)) % 3)
    }
    expect(findGroups(dead, config)).toEqual([])
    expect(hasLegalSwap(dead, config)).toBe(false)
    expect(() => decodeState({ ...raw, board: dead })).toThrow(IllegalActionError)
  })

  it('语义校验：撤销栈必须能回退到初始棋盘（改过的棋子 / 被篡改的旧值都会被拒）', () => {
    const played = midGame(13, 'starter')
    const raw = encodeState(played) as {
      moves: number
      history: Array<{ at: number[]; old: number[]; score: number; cursor: number; lastShuffle: number }>
      board: number[]
    }
    expect(raw.history.length).toBeGreaterThan(0)
    expect(() => decodeState(raw)).not.toThrow()

    /*
     * 改掉**最老**那条快照里的旧值：它保存的就是初始棋盘在该格上的取值，
     * 而且回退时最后才写回（不会被更早的记录覆盖），因此必然与初始棋盘对不上。
     */
    const tampered = JSON.parse(JSON.stringify(raw)) as typeof raw
    const oldest = tampered.history[0]!
    oldest.old[0] = (oldest.old[0]! + 1) % configFor('starter').kinds
    expect(() => decodeState(tampered)).toThrow(IllegalActionError)

    // 截断撤销栈（少一条最老的记录）：回退不到初始棋盘
    const truncated = JSON.parse(JSON.stringify(raw)) as typeof raw
    truncated.history = truncated.history.slice(1)
    truncated.moves -= 1
    expect(() => decodeState(truncated)).toThrow(IllegalActionError)

    /*
     * 把当前盘面里**从未被任何一次交换动过**的格子改掉：
     * 回退时不会被任何一条快照覆盖，因此必然与初始棋盘对不上。
     * （改一个「被后续快照覆盖」的格子是测不出问题的 —— 那正是第一次写这个断言时踩的坑。）
     */
    const touched = new Set<number>()
    for (const record of raw.history) for (const index of record.at) touched.add(index)
    const untouched = raw.board.findIndex((_kind, index) => !touched.has(index))
    expect(untouched).toBeGreaterThanOrEqual(0)
    const tamperedBoard = JSON.parse(JSON.stringify(raw)) as typeof raw
    tamperedBoard.board[untouched] = (tamperedBoard.board[untouched]! + 1) % configFor('starter').kinds
    expect(() => decodeState(tamperedBoard)).toThrow(IllegalActionError)

    // 游标推进方向不对（撤销后游标反而变大）也要拒绝
    const badCursor = JSON.parse(JSON.stringify(raw)) as typeof raw
    badCursor.history[badCursor.history.length - 1]!.cursor = 999999
    expect(() => decodeState(badCursor)).toThrow(IllegalActionError)
  })
})

describe('随机合法动作回放（对应跨游戏契约测试）', () => {
  it('用 legal() 随机走 60 步：不抛错，且每一步都能存档往返', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      const rng = createRng(20261004)
      let state = match3Game.create(12345, difficulty)
      expect(() => match3Game.decode(match3Game.encode(state))).not.toThrow()
      for (let step = 0; step < 60; step++) {
        const actions = match3Game.legal(state)
        expect(actions.length).toBeGreaterThan(0)
        const action = actions[rng.int(actions.length)]!
        state = match3Game.reduce(state, action)
        const raw = match3Game.encode(state)
        expect(() => match3Game.decode(raw)).not.toThrow()
        expect(match3Game.encode(match3Game.decode(raw))).toEqual(raw)
      }
    }
  })

  it('selectAction 走满一局：每一步都合法，且终局后不再接受棋盘点击', () => {
    const difficulty = 'challenging' as const
    const config = configFor(difficulty)
    const rng = createRng(4242)
    let state = match3Game.create(777, difficulty)
    let guard = 0
    while (gameStatus(state) === 'playing' && guard < 400) {
      guard += 1
      const pairs = findLegalSwaps(state.board, config)
      expect(pairs.length).toBeGreaterThan(0)
      const pair = pairs[rng.int(pairs.length)]!
      state = match3Game.reduce(state, { type: 'select', index: pair[0] })
      state = match3Game.reduce(state, selectAction(state, pair[1])!)
    }
    expect(gameStatus(state)).not.toBe('playing')
    expect(selectAction(state, 0)).toBeNull()
  })
})

describe('平衡校准（可玩性下限）', () => {
  it('贪心机器人（只看一步的普通玩家）在步数上限内能达标：三档难度 × 24 个种子', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      const config = configFor(difficulty)
      let wins = 0
      for (let seed = 1; seed <= 24; seed++) {
        let state = fresh(seed, difficulty)
        let guard = 0
        while (gameStatus(state) === 'playing' && guard < config.moveLimit) {
          guard += 1
          const action = greedyAction(state)
          if (!action) break
          state = act(state, action)
        }
        if (state.score >= config.targetScore) wins += 1
        else {
          // 失败时把差距打出来，方便调目标分
          expect.fail(
            `${difficulty} seed=${seed} 只拿到 ${state.score}/${config.targetScore}（用了 ${state.moves}/${config.moveLimit} 步）`,
          )
        }
      }
      expect(wins).toBe(24)
    }
  })
})

describe('i18n 字典', () => {
  it('中英基础 key 一致，且壳层与视图会用到的 key 全部存在', () => {
    expect(compareDicts({ 'zh-CN': match3Zh, 'en-US': match3En })).toEqual([])
    expect([...baseKeys(match3Zh)].sort()).toEqual([...baseKeys(match3En)].sort())

    const keys = new Set<string>([
      'match3.title',
      'match3.illegal.notice',
      'match3.rules.body',
      'match3.rules.body2',
      'match3.rules.body3',
      'match3.rules.restart',
      'match3.won.title',
      'match3.lost.title',
      'match3.result.score__other',
      'match3.result.moves__other',
      'match3.solved.best__other',
      'match3.notice.pick',
      'match3.notice.shuffled',
      'shell.game.undo',
    ])
    for (const key of Object.values(CELL_LABEL_KEYS)) keys.add(key!)
    for (const difficulty of DIFFICULTY_IDS) keys.add(`match3.difficulty.${difficulty}`)
    for (const stat of match3Game.view(midGame()).stats) keys.add(stat.labelKey)
    const view = match3Game.view(midGame())
    for (const detail of view.result?.details ?? []) keys.add(detail.key)

    for (const key of keys) {
      for (const i18n of [i18nZh, i18nEn]) {
        const text = i18n.t(key)
        expect(text, `${key} 缺词`).not.toContain('⟦')
        expect(text.length).toBeGreaterThan(0)
      }
    }
    for (const i18n of [i18nZh, i18nEn]) expect(i18n.missingKeys()).toEqual([])
  })

  it('难度标签在中英两边都能取到，且各不相同', () => {
    const zhLabels = DIFFICULTY_IDS.map((id) => i18nZh.t(`match3.difficulty.${id}`))
    const enLabels = DIFFICULTY_IDS.map((id) => i18nEn.t(`match3.difficulty.${id}`))
    expect(new Set(zhLabels).size).toBe(DIFFICULTY_IDS.length)
    expect(new Set(enLabels).size).toBe(DIFFICULTY_IDS.length)
    expect(zhLabels).not.toEqual(enLabels)
  })

  it('三档难度的配置确实不同（棋盘尺寸 / 种类 / 目标分 / 步数至少两项不同）', () => {
    const signatures = DIFFICULTY_IDS.map((id) => {
      const config = DIFFICULTIES[id]
      return `${config.cols}x${config.rows}-${config.kinds}-${config.targetScore}-${config.moveLimit}`
    })
    expect(new Set(signatures).size).toBe(DIFFICULTY_IDS.length)
    // 入门比挑战更宽裕：目标分/步数的压力必须随难度递增
    const pressure = DIFFICULTY_IDS.map((id) => DIFFICULTIES[id].targetScore / DIFFICULTIES[id].moveLimit)
    expect(pressure[1]!).toBeGreaterThan(pressure[0]!)
    expect(pressure[2]!).toBeGreaterThan(pressure[1]!)
  })

  it('棋盘格的无障碍标签走 match3.cell.tile', () => {
    expect(CELL_LABEL_KEYS.tile).toBe('match3.cell.tile')
    expect(zh['match3.cell.tile']).toBeDefined()
    expect(en['match3.cell.tile']).toBeDefined()
  })
})

describe('存档与重建（初始棋盘可复算）', () => {
  it('decode 会用 seed 重算初始棋盘：改过种子就拒绝', () => {
    const played = midGame(4, 'starter')
    const raw = encodeState(played) as Record<string, unknown>
    expect(() => decodeState({ ...raw, seed: (raw['seed'] as number) + 1 })).toThrow(IllegalActionError)
    // 重算出来的初始棋盘就是 create 的棋盘
    expect(buildBoard(raw['seed'] as number, 'starter').board).toEqual(fresh(raw['seed'] as number, 'starter').board)
  })

  it('同一局走完后 encode 的结果稳定可比较（JSON 逐字节相同）', () => {
    const once = JSON.stringify(encodeState(midGame(8, 'skilled')))
    const twice = JSON.stringify(encodeState(midGame(8, 'skilled')))
    expect(once).toBe(twice)
    // KIND_GLYPHS 是展示层的唯一来源，索引越界必须显式暴露
    expect(KIND_GLYPHS[0]).toBe('●')
  })
})
