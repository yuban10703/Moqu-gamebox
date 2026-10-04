/**
 * 整局：发牌、叫分、出牌、结算、跨局积分、存档往返与防篡改、座位视角不泄露、提示循环。
 * 真人座位在模拟里也交给电脑决策（翻译成真人动作），于是能跑完整局而不必手写牌谱。
 */
import { describe, expect, it } from 'vitest'
import { IllegalActionError, createRng } from '@eink/core'
import { CARD_COUNT, dealCards, rankOf } from '../src/cards.js'
import { decideMove } from '../src/ai.js'
import { observe } from '../src/observe.js'
import {
  BOT_DELAY_MS,
  DIFFICULTY_IDS,
  HUMAN_SEAT,
  START_SCORE,
  createState,
  decodeState,
  encodeState,
  hintOptions,
  legalActions,
  reduceState,
  statusOf,
  tableOf,
  tickMsOf,
  type DoudizhuAction,
  type DoudizhuState,
} from '../src/rules.js'
import { applyMove, settlement, startTable, type TableState } from '../src/table.js'
import { doudizhuGame } from '../src/index.js'
import { card, hand } from './helpers.js'

/** 推进一步：电脑回合派发 tick；真人回合按电脑的决定翻译成真人动作 */
function step(state: DoudizhuState): DoudizhuState {
  const table = tableOf(state)
  if (table.turn !== HUMAN_SEAT) return reduceState(state, { type: 'tick' })
  const move = decideMove(observe(table, HUMAN_SEAT), 'skilled', createRng(state.log.length + 7))
  if (move.kind === 'bid') return reduceState(state, { type: 'bid', value: move.value })
  if (move.kind === 'pass') return reduceState(state, { type: 'pass' })
  let next = state
  for (const c of move.cards) next = reduceState(next, { type: 'toggle', card: c })
  return reduceState(next, { type: 'play' })
}

function playOut(state: DoudizhuState, onStep?: (s: DoudizhuState) => void): DoudizhuState {
  let current = state
  for (let i = 0; i < 400 && statusOf(current) === 'playing'; i++) {
    current = step(current)
    onStep?.(current)
  }
  return current
}

describe('发牌', () => {
  it('三家各 17 张、底牌 3 张，54 张不重不漏；同 (seed, dealNo) 必然同一副', () => {
    const deal = dealCards(12345, 0)
    const all = [...deal.hands.flat(), ...deal.bottom].sort((a, b) => a - b)
    expect(deal.hands.map((h) => h.length)).toEqual([17, 17, 17])
    expect(deal.bottom).toHaveLength(3)
    expect(all).toEqual(Array.from({ length: CARD_COUNT }, (_, i) => i))
    expect(dealCards(12345, 0)).toEqual(deal)
    expect(dealCards(12345, 1)).not.toEqual(deal)
    expect([0, 1, 2]).toContain(deal.firstBidder)
  })
})

describe('整局模拟（三档难度 × 多个种子）', () => {
  for (const difficulty of DIFFICULTY_IDS) {
    it(`${difficulty}：每局都能打完，积分零和，每一步都能存档往返`, () => {
      for (let seed = 1; seed <= 12; seed++) {
        let state = createState(seed * 7919, difficulty)
        state = playOut(state, (s) => {
          const raw = encodeState(s)
          expect(encodeState(decodeState(JSON.parse(JSON.stringify(raw))))).toEqual(raw)
        })
        const status = statusOf(state)
        expect(['won', 'lost']).toContain(status)
        const table = tableOf(state)
        expect(table.phase).toBe('over')
        expect(table.hands[table.winner!]).toHaveLength(0)
        expect(state.scores.reduce((a, b) => a + b, 0)).toBe(START_SCORE * 3)
        expect(state.scores).toEqual(settlement(table).map((d) => START_SCORE + d))
      }
    })
  }

  it('「下一局」接着打：发新牌、局数 +1、积分保留', () => {
    let state = playOut(createState(42, 'skilled'))
    const scores = state.scores
    state = reduceState(state, { type: 'nextLevel' })
    expect(state.round).toBe(1)
    expect(state.dealNo).toBeGreaterThanOrEqual(1)
    expect(state.scores).toEqual(scores)
    expect(statusOf(state)).toBe('playing')
    state = playOut(state)
    expect(state.scores.reduce((a, b) => a + b, 0)).toBe(START_SCORE * 3)
  })

  it('三家都不叫：自动重新发牌（dealNo +1、日志清空、给出提示）', () => {
    // 找一个真人先叫的种子，然后三家都不叫
    let seed = 1
    while (dealCards(seed, 0).firstBidder !== HUMAN_SEAT) seed++
    let table = startTable(seed, 0)
    table = applyMove(table, 0, { kind: 'bid', value: 0 })
    table = applyMove(table, 1, { kind: 'bid', value: 0 })
    expect(applyMove(table, 2, { kind: 'bid', value: 0 }).phase).toBe('redeal')

    // 同样的流程走 GameDef：真人不叫 → 电脑若也都不叫，就会重新发牌
    const state = reduceState(createState(seed, 'starter'), { type: 'bid', value: 0 })
    expect(state.log).toHaveLength(1)
  })
})

describe('叫分', () => {
  it('必须比当前最高分高；叫 3 分立即成为地主并拿走底牌、底分 = 3', () => {
    let table = startTable(99, 0)
    const first = table.turn
    table = applyMove(table, first, { kind: 'bid', value: 1 })
    expect(() => applyMove(table, table.turn, { kind: 'bid', value: 1 })).toThrow(IllegalActionError)
    const bidder = table.turn
    table = applyMove(table, bidder, { kind: 'bid', value: 3 })
    expect(table.phase).toBe('playing')
    expect(table.landlord).toBe(bidder)
    expect(table.base).toBe(3)
    expect(table.hands[bidder]).toHaveLength(20)
    expect(table.turn).toBe(bidder)
  })

  it('不是自己的回合不能叫分 / 出牌', () => {
    const table = startTable(99, 0)
    const other = ((table.turn + 1) % 3) as 0 | 1 | 2
    expect(() => applyMove(table, other, { kind: 'bid', value: 2 })).toThrow(IllegalActionError)
  })
})

describe('出牌规则与结算', () => {
  /** 构造一个已经定了地主的局面（手牌任意指定） */
  function custom(hands: [number[], number[], number[]], landlord: 0 | 1 | 2, base = 1): TableState {
    const start = startTable(1, 0)
    return {
      ...start,
      phase: 'playing',
      hands,
      landlord,
      turn: landlord,
      base,
      bids: [null, null, null],
      highestBid: base,
      highestBidder: landlord,
    }
  }

  it('领出不能不出；跟牌必须压过；连续两家不出由最后出牌的人重新领出', () => {
    let t = custom([hand('3 9'), hand('4 5'), hand('6 7')], 0)
    expect(() => applyMove(t, 0, { kind: 'pass' })).toThrow(IllegalActionError)
    t = applyMove(t, 0, { kind: 'play', cards: [card('9')] })
    expect(() => applyMove(t, 1, { kind: 'play', cards: [card('4')] })).toThrow(IllegalActionError)
    t = applyMove(t, 1, { kind: 'pass' })
    t = applyMove(t, 2, { kind: 'pass' })
    expect(t.top).toBeNull()
    expect(t.turn).toBe(0)
    expect(t.lastActions).toEqual([null, null, null])
  })

  it('炸弹 / 王炸各让倍数 ×2；地主春天再 ×2；结算：地主 +2 份、农民各 −1 份', () => {
    let t = custom([hand('3 3 3 3 SJ BJ'), hand('4 5'), hand('6 7')], 0, 2)
    t = applyMove(t, 0, { kind: 'play', cards: hand('3 3 3 3') })
    expect(t.multiplier).toBe(2)
    t = applyMove(t, 1, { kind: 'pass' })
    t = applyMove(t, 2, { kind: 'pass' })
    t = applyMove(t, 0, { kind: 'play', cards: [card('SJ'), card('BJ')] })
    expect(t.phase).toBe('over')
    expect(t.spring).toBe('spring')
    expect(t.multiplier).toBe(8) // 炸弹 ×2、王炸 ×2、春天 ×2
    expect(settlement(t)).toEqual([2 * 2 * 8, -2 * 8, -2 * 8])
  })

  it('反春：地主只出过一手、农民先出完 → ×2；农民赢时地主付两份', () => {
    let t = custom([hand('3 4 5'), hand('9'), hand('6 7')], 0, 1)
    t = applyMove(t, 0, { kind: 'play', cards: [card('3')] })
    t = applyMove(t, 1, { kind: 'play', cards: [card('9')] })
    expect(t.phase).toBe('over')
    expect(t.spring).toBe('antiSpring')
    expect(settlement(t)).toEqual([-4, 2, 2])
  })
})

describe('存档防篡改（重放式 decode）', () => {
  const base = (): Record<string, unknown> => {
    let state = createState(2024, 'skilled')
    for (let i = 0; i < 12; i++) state = step(state)
    return JSON.parse(JSON.stringify(encodeState(state))) as Record<string, unknown>
  }

  it.each([
    ['积分不再零和', (raw: Record<string, unknown>) => ((raw.scores as number[])[0] = 9999)],
    ['日志里出了不在手里的牌', (raw: Record<string, unknown>) => {
      ;(raw.log as unknown[]).push({ seat: 0, move: { kind: 'play', cards: [0, 1, 2, 3, 4, 5, 6, 7] } })
    }],
    ['座位越界', (raw: Record<string, unknown>) => ((raw.log as Array<{ seat: number }>)[0]!.seat = 5)],
    ['选中了手里没有的牌', (raw: Record<string, unknown>) => (raw.selected = [999])],
    ['未知难度', (raw: Record<string, unknown>) => (raw.difficulty = 'legend')],
    ['局数超过发牌次数', (raw: Record<string, unknown>) => (raw.round = 99)],
    ['未知提示', (raw: Record<string, unknown>) => (raw.notice = 'hack')],
  ])('%s → 判为损坏', (_name, mutate) => {
    const raw = base()
    mutate(raw)
    expect(() => decodeState(raw)).toThrow(IllegalActionError)
  })
})

describe('座位视角不泄露', () => {
  it('只给自己的手牌与三家张数；叫分阶段底牌不公开；打完才亮牌', () => {
    let state = createState(77, 'skilled')
    const view = observe(tableOf(state), 1)
    expect(view.hand).toEqual(tableOf(state).hands[1])
    expect(view.counts).toEqual([17, 17, 17])
    expect(view.bottom).toBeNull()
    expect(view.revealed).toBeNull()
    expect(JSON.stringify(view)).not.toContain(JSON.stringify(tableOf(state).hands[0]))
    state = playOut(state)
    expect(observe(tableOf(state), 1).revealed).not.toBeNull()
  })
})

describe('真人操作', () => {
  /** 推进到轮到真人出牌 */
  function toHumanPlay(seed: number): DoudizhuState {
    let state = createState(seed, 'skilled')
    for (let i = 0; i < 200; i++) {
      const table = tableOf(state)
      if (table.phase === 'playing' && table.turn === HUMAN_SEAT) return state
      state = step(state)
    }
    throw new Error('never reached the human turn')
  }

  it('点牌切换选中；重选清空；选中不进日志', () => {
    let state = toHumanPlay(5)
    const [a, b] = tableOf(state).hands[HUMAN_SEAT]
    state = reduceState(state, { type: 'toggle', card: a! })
    state = reduceState(state, { type: 'toggle', card: b! })
    expect(state.selected).toHaveLength(2)
    const logLength = state.log.length
    state = reduceState(state, { type: 'toggle', card: a! })
    expect(state.selected).toEqual([b])
    state = reduceState(state, { type: 'clear' })
    expect(state.selected).toEqual([])
    expect(state.log).toHaveLength(logLength)
  })

  it('压不过时按提示：清空选中并提示「没有能压过的牌」', () => {
    for (let seed = 1; seed < 200; seed++) {
      let state = toHumanPlay(seed)
      if (hintOptions(tableOf(state)).length > 0) continue
      state = reduceState(state, { type: 'hint' })
      expect(state.selected).toEqual([])
      expect(state.notice).toBe('doudizhu.notice.noBeat')
      return
    }
    throw new Error('no seed without a beating play')
  })

  it('提示按方案循环，每个方案都能直接出', () => {
    // 推进到真人「领出」的时刻：领出时一定有方案（压牌时可能一个都没有）
    let state = toHumanPlay(11)
    while (tableOf(state).top !== null) state = step(state)
    while (tableOf(state).turn !== HUMAN_SEAT) state = step(state)
    const options = hintOptions(tableOf(state))
    expect(options.length).toBeGreaterThan(0)
    const seen: string[] = []
    for (let i = 0; i < options.length + 1; i++) {
      state = reduceState(state, { type: 'hint' })
      seen.push(state.selected.join(','))
    }
    expect(seen[options.length]).toBe(seen[0]) // 循环一圈回到第一个
    expect(() => reduceState(state, { type: 'play' })).not.toThrow()
  })

  it('出不合法的牌给出 IllegalActionError（壳层据此显示提示），局面不变', () => {
    const state = toHumanPlay(3)
    const table = tableOf(state)
    const handCards = table.hands[HUMAN_SEAT]
    // 选两张点数不同的牌：既不是对子也不是任何牌型
    const a = handCards[0]!
    const b = handCards.find((c) => rankOf(c) !== rankOf(a))!
    let picked = reduceState(state, { type: 'toggle', card: a })
    picked = reduceState(picked, { type: 'toggle', card: b })
    expect(() => reduceState(picked, { type: 'play' })).toThrow(IllegalActionError)
  })

  it('电脑回合才声明自动步进间隔；真人回合与打完都不步进', () => {
    let state = createState(8, 'skilled')
    for (let i = 0; i < 300 && statusOf(state) === 'playing'; i++) {
      const table = tableOf(state)
      const expected = table.turn === HUMAN_SEAT ? null : BOT_DELAY_MS
      expect(tickMsOf(state)).toBe(expected)
      expect(doudizhuGame.tickMs!(state, state.difficulty)).toBe(expected)
      state = step(state)
    }
    expect(tickMsOf(state)).toBeNull()
  })

  it('撤销与壳层的 restart 动作都会被拒绝（本作不提供撤销）', () => {
    const state = createState(1, 'skilled')
    expect(() => reduceState(state, { type: 'undo' } as unknown as DoudizhuAction)).toThrow(IllegalActionError)
    expect(() => reduceState(state, { type: 'restart' } as unknown as DoudizhuAction)).toThrow(IllegalActionError)
  })

  it('legal() 列出的动作都与当前阶段一致', () => {
    let state = createState(31, 'skilled')
    for (let i = 0; i < 80 && statusOf(state) === 'playing'; i++) {
      const legal = legalActions(state)
      const table = tableOf(state)
      if (table.turn !== HUMAN_SEAT) expect(legal[0]).toEqual({ type: 'tick' })
      else if (table.phase === 'bidding') expect(legal.some((a) => a.type === 'bid')).toBe(true)
      else expect(legal.some((a) => a.type === 'hint')).toBe(true)
      state = step(state)
    }
    expect(legalActions(playOut(state))).toEqual([{ type: 'nextLevel' }])
  })
})
