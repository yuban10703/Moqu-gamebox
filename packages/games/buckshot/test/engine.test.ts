/**
 * 对局引擎：装填、开枪、8 种道具、轮次与整场胜负、确定性。
 * 道具效果用「构造的局面」精确断言（引擎是纯函数，直接改字段即可）。
 */
import { describe, expect, it } from 'vitest'
import { IllegalActionError } from '@eink/core'
import {
  ITEMS_PER_LOAD_BY_ROUND,
  MAX_HP_BY_ROUND,
  MAX_ITEMS,
  SHELLS_BY_ROUND,
  applyMove,
  replayDuel,
  startDuel,
  type DuelState,
  type ItemId,
  type Seat,
} from '../src/engine.js'
import { liveChance, observe, remainingShells } from '../src/observe.js'

/** 构造一个已经开始回合的局面：指定弹序、血量、道具与轮到谁 */
function scene(over: Partial<DuelState> & { load: boolean[] }): DuelState {
  const base = applyMove(startDuel(1, over.mode ?? 'vs'), 0, { kind: 'begin' })
  const total = over.load.length
  return {
    ...base,
    round: 1,
    maxHp: 4,
    hp: [4, 4],
    items: [[], []],
    loadLive: over.load.filter(Boolean).length,
    loadBlank: over.load.filter((v) => !v).length,
    pos: 0,
    spent: [],
    known: [Array(total).fill(null), Array(total).fill(null)],
    turn: 0,
    saw: false,
    cuffed: [false, false],
    ...over,
  }
}
const item = (state: DuelState, seat: Seat, id: ItemId): DuelState =>
  applyMove(state, seat, { kind: 'item', slot: state.items[seat].indexOf(id) })

describe('装填', () => {
  it('每轮的弹数在范围内、实弹与空包各至少 1 发；血量 2 / 4 / 6；道具按轮发、最多 8 件', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const duel = startDuel(seed, 'vs')
      expect(duel.phase).toBe('load')
      expect(duel.hp).toEqual([MAX_HP_BY_ROUND[0], MAX_HP_BY_ROUND[0]])
      const [lo, hi] = SHELLS_BY_ROUND[0]!
      expect(duel.load.length).toBeGreaterThanOrEqual(lo)
      expect(duel.load.length).toBeLessThanOrEqual(hi)
      expect(duel.loadLive).toBeGreaterThanOrEqual(1)
      expect(duel.loadBlank).toBeGreaterThanOrEqual(1)
      expect(duel.loadLive + duel.loadBlank).toBe(duel.load.length)
      expect(duel.items).toEqual([[], []]) // 第 1 轮不发道具
    }
    expect(ITEMS_PER_LOAD_BY_ROUND).toEqual([0, 2, 4])
    expect(MAX_HP_BY_ROUND).toEqual([2, 4, 6])
  })

  it('同一 (seed, 日志) 必然复算出同一个局面', () => {
    const log = [{ seat: 0 as Seat, move: { kind: 'begin' as const } }, { seat: 0 as Seat, move: { kind: 'shoot' as const, target: 'opponent' as const } }]
    expect(replayDuel(9, 'vs', log)).toEqual(replayDuel(9, 'vs', log))
    expect(startDuel(9, 'vs').load).not.toEqual(startDuel(10, 'vs').load.concat([true, true, true, true, true]))
  })

  it('装填阶段不能开枪、不能用道具；按「开始」进入回合', () => {
    const duel = startDuel(3, 'vs')
    expect(() => applyMove(duel, 0, { kind: 'shoot', target: 'self' })).toThrow(IllegalActionError)
    expect(applyMove(duel, 0, { kind: 'begin' }).phase).toBe('turn')
  })

  it('道具最多 8 件：超出的部分不再发', () => {
    let state = scene({ load: [true], items: [Array(7).fill('beer'), []], round: 2, maxHp: 6, hp: [6, 6] })
    // 打掉最后一发 → 重新装填（第 3 轮每次 4 件），0 号位只剩 1 个空位
    state = applyMove(state, 0, { kind: 'shoot', target: 'opponent' })
    expect(state.phase).toBe('load')
    expect(state.items[0]).toHaveLength(MAX_ITEMS)
    expect(state.items[1]).toHaveLength(4)
    expect(state.fresh).toEqual([1, 4])
  })
})

describe('开枪', () => {
  it('对对方开枪：实弹扣 1、换人；空包也换人', () => {
    let state = scene({ load: [true, false, true] })
    state = applyMove(state, 0, { kind: 'shoot', target: 'opponent' })
    expect(state.hp).toEqual([4, 3])
    expect(state.turn).toBe(1)
    state = applyMove(state, 1, { kind: 'shoot', target: 'opponent' })
    expect(state.hp).toEqual([4, 3])
    expect(state.turn).toBe(0)
  })

  it('对自己开枪：空包继续行动；实弹扣血并换人', () => {
    let state = scene({ load: [false, true, true] })
    state = applyMove(state, 0, { kind: 'shoot', target: 'self' })
    expect(state.turn).toBe(0)
    state = applyMove(state, 0, { kind: 'shoot', target: 'self' })
    expect(state.hp[0]).toBe(3)
    expect(state.turn).toBe(1)
  })

  it('不是自己的回合不能动', () => {
    const state = scene({ load: [true, true] })
    expect(() => applyMove(state, 1, { kind: 'shoot', target: 'self' })).toThrow(IllegalActionError)
  })

  it('打空一管就重新装填，回合归属不变', () => {
    let state = scene({ load: [false] })
    state = applyMove(state, 0, { kind: 'shoot', target: 'opponent' })
    expect(state.phase).toBe('load')
    expect(state.turn).toBe(1)
  })
})

describe('道具', () => {
  it('放大镜：只有使用者知道当前这一发', () => {
    const state = item(scene({ load: [true, false], items: [['magnifier'], []] }), 0, 'magnifier')
    expect(observe(state, 0).known[0]).toBe(true)
    expect(observe(state, 1).known[0]).toBeNull()
    expect(observe(state, 1).events.some((e) => e.type === 'peek')).toBe(false)
  })

  it('香烟 +1 血但不超过上限', () => {
    let state = scene({ load: [true], hp: [3, 4], items: [['cigarettes', 'cigarettes'], []] })
    state = item(state, 0, 'cigarettes')
    expect(state.hp[0]).toBe(4)
    state = item(state, 0, 'cigarettes')
    expect(state.hp[0]).toBe(4)
  })

  it('啤酒：退掉当前这一发（公开），退空就重新装填', () => {
    let state = scene({ load: [true, false], items: [['beer', 'beer'], []] })
    state = item(state, 0, 'beer')
    expect(state.spent).toEqual([{ live: true, by: 'beer', flipped: false }])
    expect(state.turn).toBe(0)
    state = item(state, 0, 'beer')
    expect(state.phase).toBe('load')
  })

  it('手铐：对方跳过下一回合，随后失效；对方已被铐住时不能再用', () => {
    let state = scene({ load: [false, false, false], items: [['handcuffs', 'handcuffs'], []] })
    state = item(state, 0, 'handcuffs')
    expect(state.cuffed).toEqual([false, true])
    expect(() => item(state, 0, 'handcuffs')).toThrow(IllegalActionError)
    state = applyMove(state, 0, { kind: 'shoot', target: 'opponent' }) // 空包，本该换人
    expect(state.turn).toBe(0)
    expect(state.cuffed).toEqual([false, false])
    state = applyMove(state, 0, { kind: 'shoot', target: 'opponent' })
    expect(state.turn).toBe(1)
  })

  it('手锯：下一枪伤害 ×2，开完一枪就复位；不能重复锯', () => {
    let state = scene({ load: [true, true], items: [['saw', 'saw'], []] })
    state = item(state, 0, 'saw')
    expect(() => item(state, 0, 'saw')).toThrow(IllegalActionError)
    state = applyMove(state, 0, { kind: 'shoot', target: 'opponent' })
    expect(state.hp[1]).toBe(2)
    expect(state.saw).toBe(false)
  })

  it('手机：只有使用者得知后面某一发；只剩当前一发时没有信息', () => {
    const state = item(scene({ load: [true, false, true, false], items: [['phone'], []] }), 0, 'phone')
    const peek = state.events.find((e) => e.type === 'peek')!
    expect(peek.type === 'peek' && peek.offset).toBeGreaterThanOrEqual(2)
    const mine = observe(state, 0).known
    expect(mine.filter((v) => v !== null)).toHaveLength(1)
    expect(mine[0]).toBeNull() // 不含当前这一发
    expect(observe(state, 1).known.every((v) => v === null)).toBe(true)

    const last = item(scene({ load: [true], items: [['phone'], []] }), 0, 'phone')
    expect(last.events.at(-1)).toMatchObject({ type: 'peek', live: null })
  })

  it('逆转器：当前这一发实空互换；原本知道它的人现在也知道翻过来了', () => {
    let state = scene({ load: [true, false], items: [['magnifier', 'inverter'], []] })
    state = item(state, 0, 'magnifier')
    state = item(state, 0, 'inverter')
    expect(state.load[0]).toBe(false)
    expect(state.inverted).toBe(true)
    expect(observe(state, 0).known[0]).toBe(false)
    state = applyMove(state, 0, { kind: 'shoot', target: 'self' })
    expect(state.hp[0]).toBe(4)
    expect(state.turn).toBe(0)
    // 打出去的那一发记着「被逆转过」；换到下一发后标记清掉
    expect(state.spent.at(-1)).toEqual({ live: false, by: 'shot', flipped: true })
    expect(state.inverted).toBe(false)
  })

  it('逆转器用两次等于没用', () => {
    let state = scene({ load: [true, false], items: [['inverter', 'inverter'], []] })
    state = item(state, 0, 'inverter')
    state = item(state, 0, 'inverter')
    expect(state.load[0]).toBe(true)
    expect(state.inverted).toBe(false)
  })

  it('过期药：一半 +2 血、一半 −1 血（两种结果都会出现，−1 也可能致命）', () => {
    const outcomes = new Set<string>()
    for (let steps = 0; steps < 40; steps++) {
      const state = item(scene({ load: [true], hp: [1, 4], items: [['medicine'], []], steps }), 0, 'medicine')
      outcomes.add(state.hp[0] === 3 ? 'heal' : state.phase)
    }
    expect(outcomes.has('heal')).toBe(true)
    expect(outcomes.has('matchOver')).toBe(true) // 1 血吃药掉 1 → 这一轮输了（对恶魔即整场失败）
  })

  it('没有这件道具 / 越界的格子：拒绝', () => {
    const state = scene({ load: [true], items: [['beer'], []] })
    expect(() => applyMove(state, 0, { kind: 'item', slot: 3 })).toThrow(IllegalActionError)
  })
})

describe('轮次与整场', () => {
  it('血量归零结束这一轮；对恶魔：赢下这一轮进入下一轮，血量 / 道具重置', () => {
    let state = scene({ load: [true, true], hp: [4, 1], items: [['beer'], ['saw']] })
    state = applyMove(state, 0, { kind: 'shoot', target: 'opponent' })
    expect(state.phase).toBe('roundOver')
    expect(state.winner).toBe(0)
    expect(state.roundWins).toEqual([1, 0])
    state = applyMove(state, 0, { kind: 'nextRound' })
    expect(state.round).toBe(2)
    expect(state.hp).toEqual([6, 6])
    expect(state.phase).toBe('load')
  })

  it('对恶魔：输掉任何一轮即整场失败', () => {
    const state = applyMove(scene({ load: [true], hp: [1, 4] }), 0, { kind: 'shoot', target: 'self' })
    expect(state.phase).toBe('matchOver')
    expect(state.winner).toBe(1)
  })

  it('对恶魔：三轮全赢才通关', () => {
    const state = applyMove(scene({ load: [true], hp: [4, 1], round: 2, roundWins: [2, 0] }), 0, { kind: 'shoot', target: 'opponent' })
    expect(state.phase).toBe('matchOver')
    expect(state.winner).toBe(0)
  })

  it('双人同屏：三局两胜，输一轮不算结束', () => {
    let state = applyMove(scene({ mode: 'hotseat', load: [true, true], hp: [1, 4] }), 0, { kind: 'shoot', target: 'self' })
    expect(state.phase).toBe('roundOver')
    expect(state.roundWins).toEqual([0, 1])
    state = applyMove(scene({ mode: 'hotseat', load: [true], hp: [4, 1], roundWins: [1, 1] }), 0, { kind: 'shoot', target: 'opponent' })
    expect(state.phase).toBe('matchOver')
    expect(state.winner).toBe(0)
  })
})

describe('座位视角不泄露弹序', () => {
  it('装填阶段公开组成但按「实弹在前」排好；回合中枪里的弹都是未知', () => {
    for (let seed = 1; seed < 30; seed++) {
      const duel = startDuel(seed, 'vs')
      const view = observe(duel, 0)
      const sorted = [...duel.load].sort((a, b) => Number(b) - Number(a))
      expect(view.revealed).toEqual(sorted)
      const playing = observe(applyMove(duel, 0, { kind: 'begin' }), 1)
      expect(playing.revealed).toBeNull()
      expect(playing.known.every((v) => v === null)).toBe(true)
      // 视角里没有弹序字段（只有数量、已打出的弹与自己知道的弹）
      expect('load' in playing).toBe(false)
      expect('pos' in playing).toBe(false)
    }
  })
})

describe('剩余数量（只用公开信息）', () => {
  it('装填数量减去打出 / 退出的弹，就是枪里真实剩余', () => {
    let state = scene({ load: [true, false, true, false, false], items: [['beer'], []] })
    expect(remainingShells(observe(state, 0))).toEqual({ live: 2, blank: 3, approx: false })
    state = item(state, 0, 'beer') // 退出实弹
    expect(remainingShells(observe(state, 1))).toEqual({ live: 1, blank: 3, approx: false })
    state = applyMove(state, 0, { kind: 'shoot', target: 'self' }) // 空包，继续
    const left = remainingShells(observe(state, 0))
    expect(left).toEqual({ live: 1, blank: 2, approx: false })
    const rest = state.load.slice(state.pos)
    expect([rest.filter(Boolean).length, rest.filter((v) => !v).length]).toEqual([left.live, left.blank])
  })

  it('当前一发被逆转：按逆转前计数并标出来；打出之后又是准确数量', () => {
    let state = scene({ load: [true, false, false], items: [['inverter'], []] })
    state = item(state, 0, 'inverter')
    expect(remainingShells(observe(state, 1))).toEqual({ live: 1, blank: 2, approx: true })
    state = applyMove(state, 0, { kind: 'shoot', target: 'opponent' }) // 逆转后是空包
    expect(state.hp[1]).toBe(4)
    const left = remainingShells(observe(state, 1))
    expect(left).toEqual({ live: 0, blank: 2, approx: false })
    expect(state.load.slice(state.pos).every((v) => !v)).toBe(true)
  })

  it('概率估计考虑逆转：剩 1 实 0 空、当前被逆转 → 当前必是空包', () => {
    let state = scene({ load: [true], items: [['inverter'], []] })
    state = item(state, 0, 'inverter')
    expect(liveChance(observe(state, 1))).toBe(0)
  })
})

describe('无尽模式（引擎）', () => {
  it('赢下第 3 轮也不结束；第 4 轮起沿用第 3 轮的设定；输一轮才结束', () => {
    let state = applyMove(startDuel(9, 'endless'), 0, { kind: 'begin' })
    // 直接把恶魔打到 0 血来推进轮数（构造局面：当前一发实弹、恶魔 1 血）
    for (let round = 0; round < 4; round++) {
      state = { ...state, load: [true, ...state.load.slice(1)], pos: 0, hp: [state.hp[0], 1], turn: 0, phase: 'turn' }
      state = applyMove(state, 0, { kind: 'shoot', target: 'opponent' })
      expect(state.phase).toBe('roundOver')
      expect(state.roundWins[0]).toBe(round + 1)
      state = applyMove(state, 0, { kind: 'nextRound' })
      expect(state.round).toBe(round + 1)
      expect(state.maxHp).toBe(MAX_HP_BY_ROUND[Math.min(round + 1, 2)])
    }
    expect(state.items[0]).toHaveLength(ITEMS_PER_LOAD_BY_ROUND[2]!)
    expect(state.load.length).toBeGreaterThanOrEqual(SHELLS_BY_ROUND[2]![0])
    // 输掉一轮：整场结束，胜者是恶魔
    state = applyMove(state, 0, { kind: 'begin' })
    state = { ...state, load: [true, ...state.load.slice(1)], pos: 0, hp: [1, state.hp[1]], turn: 0 }
    state = applyMove(state, 0, { kind: 'shoot', target: 'self' })
    expect(state.phase).toBe('matchOver')
    expect(state.winner).toBe(1)
    expect(state.roundWins[0]).toBe(4)
  })
})
