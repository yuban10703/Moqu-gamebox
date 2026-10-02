/**
 * 记忆配对规则层测试。覆盖验收点：
 *   1. 洗牌确定性与「每张牌恰好出现两次」；
 *   2. 匹配 / 不匹配逻辑；
 *   3. 关键设计：「不匹配后需要再点一次才盖回」的完整序列；
 *   4. 全部配对后 won（无失败态）；
 *   5. 非法输入（已翻开的牌、已配对、越界、无历史撤销）抛 IllegalActionError；
 *   6. undo 的尝试级语义、restart 重洗且可复现；
 *   7. 属性测试：随机合法动作 60 步内每一步 encode→decode 往返一致且能继续对局；
 *   8. 性能。
 */
import { describe, expect, it } from 'vitest'
import { IllegalActionError, createRng } from '@eink/core'
import {
  DIFFICULTY_IDS,
  MEMORY_ID,
  cellCount,
  configFor,
  deal,
  memoryGame,
  pairCount,
  glyphForPair,
  reduceMemory,
  replayFlips,
  snapshotOf,
  type MemoryState,
} from '../src/index.js'
import { act, controlById, fresh, pairOf, playToWin, selectAt, statValue } from './helpers.js'

describe('匹配 / 不匹配', () => {
  it('翻到同一对子的两张 → 立即锁定为已配对，尝试次数 +1', () => {
    const state = fresh(21, 'starter')
    const [first, second] = pairOf(state.deck, 0)
    const afterFirst = act(state, { type: 'flip', index: first })
    expect(snapshotOf(afterFirst).faceUp).toEqual([first])
    expect(snapshotOf(afterFirst).attempts).toBe(0)
    expect(memoryGame.view(afterFirst).board!.cells[first]!.kind).toBe('tile')

    const afterSecond = act(afterFirst, { type: 'flip', index: second })
    const snapshot = snapshotOf(afterSecond)
    expect(snapshot.matched).toEqual([first, second].sort((a, b) => a - b))
    expect(snapshot.faceUp).toEqual([])
    expect(snapshot.pending).toEqual([])
    expect(snapshot.attempts).toBe(1)
    expect(snapshot.matchedPairs).toBe(1)
    expect(memoryGame.status(afterSecond)).toBe('playing')
    expect(statValue(afterSecond, 'memory.stat.pairs')).toBe(`1/${pairCount(configFor('starter'))}`)
    expect(statValue(afterSecond, 'memory.stat.attempts')).toBe('1')
    // 配对后两张永久可见（tile + 符号），且不再高亮
    for (const index of [first, second]) {
      const cell = memoryGame.view(afterSecond).board!.cells[index]!
      expect(cell.kind).toBe('tile')
      expect(cell.glyph).toBe(glyphForPair(state.deck[index]))
      expect(cell.selected).toBeUndefined()
    }
  })

  it('翻到不同对子的两张 → 保持可见并标记待盖回，不自动翻回', () => {
    const state = fresh(22, 'starter')
    const [a] = pairOf(state.deck, 0)
    const [b] = pairOf(state.deck, 1)
    const after = act(act(state, { type: 'flip', index: a }), { type: 'flip', index: b })
    const snapshot = snapshotOf(after)
    expect(snapshot.matched).toEqual([])
    expect(snapshot.faceUp).toEqual([a, b])
    expect(snapshot.pending).toEqual([a, b])
    expect(snapshot.attempts).toBe(1)
    // 牌面：两张仍是 tile（可见），并带 selected 描边表示待盖回；其它牌扣着
    const view = memoryGame.view(after)
    for (const index of [a, b]) {
      const cell = view.board!.cells[index]!
      expect(cell.kind).toBe('tile')
      expect(cell.glyph).not.toBe('')
      expect(cell.selected).toBe(true)
    }
    expect(view.board!.cells.filter((cell) => cell.selected)).toHaveLength(2)
    expect(view.notice).toEqual({ textKey: 'memory.notice.cover' })
  })

  it('同一张牌不会自成一配对：翻第二次同一张牌抛错', () => {
    const state = fresh(23, 'starter')
    const [first] = pairOf(state.deck, 0)
    const after = act(state, { type: 'flip', index: first })
    expect(() => act(after, { type: 'flip', index: first })).toThrow(IllegalActionError)
    expect(() => replayFlips(state.deck, [first, first])).toThrow(IllegalActionError)
  })
})

describe('关键设计：不匹配后需要再点一次才盖回', () => {
  it('完整序列：翻两张不匹配 → 待盖回 → 再点一张扣着的牌时先盖回、并且算作新翻牌', () => {
    const state = fresh(9, 'skilled')
    const [a, aPartner] = pairOf(state.deck, 0)
    const [b] = pairOf(state.deck, 1)
    const [c, cPartner] = pairOf(state.deck, 2)
    // 保证三对互不相同、索引互不相同
    expect(new Set([a, aPartner, b, c, cPartner]).size).toBe(5)

    // 第 1 步：翻第一张（尝试尚未成立）
    const s1 = act(state, { type: 'flip', index: a })
    expect(snapshotOf(s1).faceUp).toEqual([a])
    expect(snapshotOf(s1).pending).toEqual([])
    expect(snapshotOf(s1).attempts).toBe(0)
    expect(memoryGame.view(s1).notice).toBeNull()

    // 第 2 步：翻一张不同对子的牌 → 不匹配，两张保持可见、待盖回
    const s2 = act(s1, { type: 'flip', index: b })
    expect(snapshotOf(s2).pending).toEqual([a, b])
    expect(snapshotOf(s2).faceUp).toEqual([a, b])
    expect(snapshotOf(s2).attempts).toBe(1)
    expect(snapshotOf(s2).matched).toEqual([])
    expect((memoryGame.encode(s2) as { flips: number[] }).flips).toEqual([a, b])
    for (const index of [a, b]) {
      expect(memoryGame.view(s2).board!.cells[index]!.kind).toBe('tile')
    }
    expect(memoryGame.view(s2).notice).toEqual({ textKey: 'memory.notice.cover' })

    // 第 3 步：待盖回的两张仍然算「已翻开」，点它们既非法也不会被 selectAction 采纳
    expect(() => act(s2, { type: 'flip', index: a })).toThrow(IllegalActionError)
    expect(() => act(s2, { type: 'flip', index: b })).toThrow(IllegalActionError)
    expect(selectAt(s2, a)).toBeNull()
    expect(selectAt(s2, b)).toBeNull()
    // pending 不会凭空消失：没有任何延时/自动行为
    expect(snapshotOf(s2).pending).toEqual([a, b])

    // 第 4 步：点一张扣着的牌 → 先把两张盖回，同时这次点击算作新一次翻牌的第一张
    const s3 = act(s2, { type: 'flip', index: c })
    expect(snapshotOf(s3).pending).toEqual([])
    expect(snapshotOf(s3).faceUp).toEqual([c])
    expect(snapshotOf(s3).matched).toEqual([])
    // 尝试次数不变：这次只翻了新尝试的第一张
    expect(snapshotOf(s3).attempts).toBe(1)
    expect((memoryGame.encode(s3) as { flips: number[] }).flips).toEqual([a, b, c])
    expect(memoryGame.view(s3).notice).toBeNull()
    for (const index of [a, b]) {
      const cell = memoryGame.view(s3).board!.cells[index]!
      expect(cell.kind).toBe('hidden')
      expect(cell.glyph).toBe('')
      expect(cell.selected).toBeUndefined()
    }
    // 新翻的那张是可见的
    expect(memoryGame.view(s3).board!.cells[c]!.kind).toBe('tile')

    // 第 5 步：翻新尝试第一张的对子 → 配对成功，尝试次数 +1
    const s4 = act(s3, { type: 'flip', index: cPartner })
    expect(snapshotOf(s4).matched).toEqual([c, cPartner].sort((x, y) => x - y))
    expect(snapshotOf(s4).attempts).toBe(2)
    expect(snapshotOf(s4).pending).toEqual([])
    // 步骤 2 里被盖回的那两张仍然扣着（不匹配不会留下任何痕迹）
    for (const index of [a, b]) {
      expect(memoryGame.view(s4).board!.cells[index]!.kind).toBe('hidden')
    }
  })

  it('盖回发生在「下一次合法翻牌」而不是任何其它动作：撤销期间也不会有自动翻回', () => {
    const state = fresh(31, 'starter')
    const [a] = pairOf(state.deck, 0)
    const [b] = pairOf(state.deck, 1)
    const pendingState = act(act(state, { type: 'flip', index: a }), { type: 'flip', index: b })
    expect(snapshotOf(pendingState).pending).toEqual([a, b])
    // 撤销把整次尝试退回（两张一起消失），而不是「盖回」
    const undone = act(pendingState, { type: 'undo' })
    expect(snapshotOf(undone).pending).toEqual([])
    expect((memoryGame.encode(undone) as { flips: number[] }).flips).toEqual([])
  })
})

describe('胜负', () => {
  it('把所有对子配完 → won，结果页给出尝试次数，且没有失败态', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      const state = playToWin(fresh(5, difficulty))
      expect(memoryGame.status(state)).toBe('won')
      expect(snapshotOf(state).matchedPairs).toBe(pairCount(configFor(difficulty)))
      expect(snapshotOf(state).pending).toEqual([])
      const view = memoryGame.view(state)
      expect(view.result!.titleKey).toBe('memory.won.title')
      expect(view.result!.details).toEqual([
        { key: 'memory.result.attempts', params: { count: pairCount(configFor(difficulty)) } },
      ])
      expect(statValue(state, 'memory.stat.pairs')).toBe(
        `${pairCount(configFor(difficulty))}/${pairCount(configFor(difficulty))}`,
      )
      expect(statValue(state, 'memory.stat.attempts')).toBe(String(pairCount(configFor(difficulty))))
      // 终局后：不能再翻牌，只剩重开与撤销
      expect(() => act(state, { type: 'flip', index: 0 })).toThrow(IllegalActionError)
      expect(selectAt(state, 0)).toBeNull()
      expect(memoryGame.legal(state).map((action) => action.type).sort()).toEqual(['restart', 'undo'])
      // 不可能出现 lost
      expect(memoryGame.status(state)).not.toBe('lost')
    }
  })

  it('movesOf 与尝试次数一致：翻两张算一次，只翻第一张不计', () => {
    const state = fresh(6, 'starter')
    const [a, partner] = pairOf(state.deck, 0)
    const [b] = pairOf(state.deck, 1)
    expect(memoryGame.movesOf!(state)).toBe(0)
    expect(memoryGame.movesOf!(act(state, { type: 'flip', index: a }))).toBe(0)
    expect(memoryGame.movesOf!(act(act(state, { type: 'flip', index: a }), { type: 'flip', index: partner }))).toBe(1)
    expect(memoryGame.movesOf!(act(act(state, { type: 'flip', index: a }), { type: 'flip', index: b }))).toBe(1)
  })
})

describe('undo / restart', () => {
  it('undo 撤回一次完整尝试（两张）；当前尝试只翻了一张时只退回这一张', () => {
    const state = fresh(12, 'starter')
    const [a, aPartner] = pairOf(state.deck, 0)
    const [b] = pairOf(state.deck, 1)
    // 只翻第一张 → 撤销退一张
    const one = act(state, { type: 'flip', index: a })
    expect((memoryGame.encode(act(one, { type: 'undo' })) as { flips: number[] }).flips).toEqual([])
    // 配对成功 → 撤销退整次尝试
    const matched = act(one, { type: 'flip', index: aPartner })
    const backMatched = act(matched, { type: 'undo' })
    expect((memoryGame.encode(backMatched) as { flips: number[] }).flips).toEqual([])
    expect(snapshotOf(backMatched).matched).toEqual([])
    // 不匹配待盖回 → 撤销退整次尝试
    const pending = act(act(state, { type: 'flip', index: a }), { type: 'flip', index: b })
    const backPending = act(pending, { type: 'undo' })
    expect((memoryGame.encode(backPending) as { flips: number[] }).flips).toEqual([])
    expect(snapshotOf(backPending).pending).toEqual([])
    // 完成一次尝试后又翻了一张 → 只退回最后那张
    const mixed = act(matched, { type: 'flip', index: b })
    const backMixed = act(mixed, { type: 'undo' })
    expect((memoryGame.encode(backMixed) as { flips: number[] }).flips).toEqual([a, aPartner])
    expect(snapshotOf(backMixed).matchedPairs).toBe(1)
  })

  it('undo 控件在无翻牌时禁用，有翻牌后启用；controlAction 映射正确', () => {
    const state = fresh(13, 'starter')
    expect(controlById(state, 'undo')!.enabled).toBe(false)
    const played = act(state, { type: 'flip', index: pairOf(state.deck, 0)[0] })
    expect(controlById(played, 'undo')!.enabled).toBe(true)
    expect(memoryGame.controlAction!(state, 'undo')).toEqual({ type: 'undo' })
    expect(memoryGame.controlAction!(state, 'restart')).toEqual({ type: 'restart' })
    expect(memoryGame.controlAction!(state, 'next-level')).toBeNull()
    expect(() => act(state, { type: 'undo' })).toThrow(IllegalActionError)
  })

  it('restart 重新洗牌：游标 +1、进度清空，且同种子的重开序列可复现', () => {
    const seed = 20240607
    const state = act(fresh(seed, 'skilled'), { type: 'flip', index: pairOf(deal(seed, 0, 'skilled'), 0)[0] })
    const restarted = act(state, { type: 'restart' })
    expect(restarted.rngCursor).toBe(1)
    expect(restarted.flips).toEqual([])
    expect(restarted.seed).toBe(seed)
    expect(restarted.deck).toEqual(deal(seed, 1, 'skilled'))
    expect(restarted.deck).not.toEqual(deal(seed, 0, 'skilled'))
    expect(memoryGame.status(restarted)).toBe('playing')
    // 同 seed + 同 restart 次数 → 同一牌面
    expect(memoryGame.encode(act(restarted, { type: 'restart' }))).toEqual(
      memoryGame.encode(act(act(fresh(seed, 'skilled'), { type: 'restart' }), { type: 'restart' })),
    )
    // 已终局的局面也能重开
    const won = playToWin(fresh(seed, 'starter'))
    expect(memoryGame.status(act(won, { type: 'restart' }))).toBe('playing')
  })
})

describe('非法输入', () => {
  it('已翻开的牌、已配对的牌、越界索引、未知动作都抛 IllegalActionError', () => {
    const state = fresh(14, 'starter')
    const [a, aPartner] = pairOf(state.deck, 0)
    const [b] = pairOf(state.deck, 1)
    const cells = cellCount(configFor('starter'))
    // 越界 / 非整数
    for (const index of [-1, cells, cells + 5, 1.5, Number.NaN]) {
      expect(() => act(state, { type: 'flip', index })).toThrow(IllegalActionError)
    }
    // 已翻开（正面朝上）
    const one = act(state, { type: 'flip', index: a })
    expect(() => act(one, { type: 'flip', index: a })).toThrow(IllegalActionError)
    // 已配对
    const matched = act(one, { type: 'flip', index: aPartner })
    expect(() => act(matched, { type: 'flip', index: a })).toThrow(IllegalActionError)
    expect(() => act(matched, { type: 'flip', index: aPartner })).toThrow(IllegalActionError)
    // 待盖回的两张
    const pending = act(act(state, { type: 'flip', index: a }), { type: 'flip', index: b })
    expect(() => act(pending, { type: 'flip', index: a })).toThrow(IllegalActionError)
    // 未知动作（壳层误派）
    expect(() => reduceMemory(state, { type: 'move', dir: 'up' } as never)).toThrow(IllegalActionError)
    expect(() => reduceMemory(state, { type: 'reveal', index: 0 } as never)).toThrow(IllegalActionError)
  })

  it('selectAction 与 legal 一致：只采纳扣着的牌，其余返回 null', () => {
    const state = fresh(15, 'starter')
    const [a, aPartner] = pairOf(state.deck, 0)
    const [b] = pairOf(state.deck, 1)
    const matched = act(act(state, { type: 'flip', index: a }), { type: 'flip', index: aPartner })
    const pending = act(act(matched, { type: 'flip', index: b }), {
      type: 'flip',
      index: pairOf(state.deck, 2)[0],
    })
    const legal = memoryGame.legal(pending)
    for (let index = 0; index < cellCount(configFor('starter')); index++) {
      const action = selectAt(pending, index)
      if (action === null) continue
      expect(legal).toContainEqual(action)
      expect(() => act(pending, action)).not.toThrow()
    }
    expect(selectAt(pending, a)).toBeNull()
    expect(selectAt(pending, -1)).toBeNull()
    expect(selectAt(pending, cellCount(configFor('starter')))).toBeNull()
    // legal 里的动作都真的能被 reduce 接受（含 undo / restart）
    for (const action of legal) expect(() => act(pending, action)).not.toThrow()
  })
})

describe('属性测试：随机合法动作序列', () => {
  it('60 步内每一步 encode→decode 往返一致，且解码后的状态能继续对局', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      for (const seed of [3, 11, 29, 101]) {
        const rng = createRng(seed * 131 + 17)
        let state: MemoryState = memoryGame.create(seed, difficulty)
        const seenKinds = new Set<string>()
        for (let step = 0; step < 60; step++) {
          // 1) 当前状态的存档必须能往返（JSON 也走一遍）
          const raw = memoryGame.encode(state)
          const decoded = memoryGame.decode(JSON.parse(JSON.stringify(raw)))
          expect(decoded, `${difficulty} seed=${seed} step=${step}`).toEqual(state)
          expect(memoryGame.encode(decoded)).toEqual(raw)

          // 2) 随机取一个合法动作；解码后的状态走同一个动作，结果必须一致
          const actions = memoryGame.legal(state)
          expect(actions.length).toBeGreaterThan(0)
          const action = rng.pick(actions)
          seenKinds.add(action.type)
          const nextOriginal = memoryGame.reduce(state, action)
          const nextDecoded = memoryGame.reduce(decoded, action)
          expect(memoryGame.encode(nextDecoded)).toEqual(memoryGame.encode(nextOriginal))

          // 3) 解码后的状态确实「能继续对局」：状态与视图都能算出来
          expect(memoryGame.status(decoded)).toBe(memoryGame.status(state))
          expect(memoryGame.view(decoded)).toEqual(memoryGame.view(state))
          state = nextOriginal
        }
        // 随机策略应当覆盖过翻牌（其它两类不一定每轮都抽到）
        expect(seenKinds.has('flip')).toBe(true)
      }
    }
  })

  it('随机对局里状态始终自洽：牌数守恒、匹配数 = 尝试成功的次数', () => {
    const rng = createRng(8888)
    let state = memoryGame.create(77, 'challenging')
    for (let step = 0; step < 400; step++) {
      const actions = memoryGame.legal(state).filter((action) => action.type === 'flip')
      if (actions.length === 0) state = act(state, { type: 'restart' })
      else state = act(state, rng.pick(actions))
      const snapshot = snapshotOf(state)
      expect(snapshot.matched.length).toBe(snapshot.matchedPairs * 2)
      expect(snapshot.attempts).toBe(Math.floor(state.flips.length / 2))
      expect(snapshot.faceUp.length).toBeLessThanOrEqual(2)
      expect(snapshot.pending.length === 0 || snapshot.pending.length === 2).toBe(true)
      // 没有一张牌同时既配对又朝上
      for (const index of snapshot.matched) expect(snapshot.faceUp).not.toContain(index)
    }
  })
})

describe('确定性与性能', () => {
  it('同 seed + 同动作序列 → 完全相同的状态（含 JSON 形式）', () => {
    const play = (): MemoryState => {
      const rng = createRng(2468)
      let state = memoryGame.create(1357, 'skilled')
      for (let step = 0; step < 30; step++) {
        state = act(state, rng.pick(memoryGame.legal(state)))
      }
      return state
    }
    expect(play()).toEqual(play())
    expect(JSON.stringify(memoryGame.encode(play()))).toBe(JSON.stringify(memoryGame.encode(play())))
  })

  it('性能：几千次 reduce + encode/decode 在宽松上限内完成（没有指数级重放）', () => {
    const rng = createRng(20260101)
    let state = memoryGame.create(7, 'challenging')
    const start = performance.now()
    let checksum = 0
    for (let step = 0; step < 3000; step++) {
      const flips = memoryGame.legal(state).filter((action) => action.type === 'flip')
      state = flips.length > 0 ? act(state, rng.pick(flips)) : act(state, { type: 'restart' })
      if (memoryGame.status(state) !== 'playing') state = act(state, { type: 'restart' })
      const decoded = memoryGame.decode(JSON.parse(JSON.stringify(memoryGame.encode(state))))
      checksum += decoded.flips.length + snapshotOf(decoded).matchedPairs
    }
    const elapsed = performance.now() - start
    expect(checksum).toBeGreaterThan(0)
    expect(elapsed).toBeLessThan(3000)
  })

  it('元信息：id / 命名空间 / 版本 / 非法提示 key', () => {
    expect(memoryGame.id).toBe('memory')
    expect(memoryGame.i18nNamespace).toBe(MEMORY_ID)
    expect(memoryGame.rulesVersion).toBeGreaterThanOrEqual(1)
    expect(memoryGame.contentVersion).toBeGreaterThanOrEqual(1)
    expect(memoryGame.illegalNoticeKey).toBe('memory.illegal.notice')
    expect(() => memoryGame.create(1, 'impossible')).toThrow(IllegalActionError)
  })
})
