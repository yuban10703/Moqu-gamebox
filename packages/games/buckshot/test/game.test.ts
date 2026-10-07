/**
 * 整场：对恶魔三档 / 双人同屏的完整模拟、存档往返与防篡改、自动步进只在恶魔回合、展示模型与文案。
 * 真人座位在模拟里交给电脑决策（翻译成真人动作）。
 */
import { describe, expect, it } from 'vitest'
import { IllegalActionError, compareDicts, coreDictEn, coreDictZh, createI18n, createRng } from '@eink/core'
import { decideMove } from '../src/ai.js'
import { observe } from '../src/observe.js'
import {
  DEVIL_DELAY_MS,
  FIRE_HOLD_MS,
  DIFFICULTY_IDS,
  ENDLESS_LEVEL_EVERY,
  devilLevelAt,
  scoreOf,
  createState,
  decodeState,
  duelOf,
  encodeState,
  humanActor,
  legalActions,
  reduceState,
  statusOf,
  tickMsOf,
  type BuckshotAction,
  type BuckshotState,
} from '../src/rules.js'
import { buildControls, buildView } from '../src/view.js'
import { buckshotGame } from '../src/index.js'
import { buckshotEn, buckshotZh } from '../src/i18n.js'

function step(state: BuckshotState): BuckshotState {
  const duel = duelOf(state)
  if (duel.phase === 'matchOver') return state
  if (duel.phase === 'load') return reduceState(state, { type: 'begin' })
  if (duel.phase === 'roundOver') return reduceState(state, { type: 'nextRound' })
  const actor = humanActor(state)
  if (actor === null) return reduceState(state, { type: 'tick' })
  const move = decideMove(observe(duel, actor), 'skilled', createRng(state.log.length + 11))
  const action: BuckshotAction = move.kind === 'item' ? { type: 'item', slot: move.slot } : { type: 'shoot', target: (move as { target: 'self' | 'opponent' }).target }
  return reduceState(state, action)
}

function playOut(state: BuckshotState, onStep?: (s: BuckshotState) => void): BuckshotState {
  let current = state
  for (let i = 0; i < 2000 && statusOf(current) === 'playing'; i++) {
    current = step(current)
    onStep?.(current)
  }
  return current
}

describe('整场模拟', () => {
  for (const difficulty of DIFFICULTY_IDS) {
    it(`${difficulty}：每场都能打完，每一步都能存档往返`, () => {
      for (let seed = 1; seed <= 15; seed++) {
        const state = playOut(createState(seed * 104729, difficulty), (s) => {
          const raw = JSON.parse(JSON.stringify(encodeState(s)))
          expect(encodeState(decodeState(raw))).toEqual(raw)
        })
        const status = statusOf(state)
        expect(status === 'won' || status === 'lost').toBe(true)
        if (difficulty === 'hotseat') expect(status).toBe('won')
        expect(duelOf(state).phase).toBe('matchOver')
      }
    })
  }
})

describe('真人与恶魔的回合', () => {
  it('恶魔回合才声明自动步进间隔；装填 / 轮间 / 真人回合都不步进', () => {
    let state = createState(5, 'skilled')
    for (let i = 0; i < 400 && statusOf(state) === 'playing'; i++) {
      const duel = duelOf(state)
      // 恶魔回合必定起表；间隔取两个声明值之一（刚开枪会多停一拍，见 FIRE_HOLD_MS），
      const tick = tickMsOf(state)
      if (duel.phase === 'turn' && duel.turn === 1) expect([DEVIL_DELAY_MS, FIRE_HOLD_MS]).toContain(tick)
      else expect(tick).toBeNull()
      state = step(state)
    }
    expect(tickMsOf(state)).toBeNull()
  })

  it('双人同屏从不自动步进；道具与开枪替当前行动者操作', () => {
    let state = reduceState(createState(5, 'hotseat'), { type: 'begin' })
    expect(tickMsOf(state)).toBeNull()
    expect(humanActor(state)).toBe(duelOf(state).turn)
    expect(() => reduceState(state, { type: 'tick' })).toThrow(IllegalActionError)
    state = reduceState(state, { type: 'shoot', target: 'opponent' })
    expect(state.log.at(-1)!.seat).toBe(0)
  })

  it('恶魔回合真人不能开枪 / 用道具；撤销与壳层 restart 一律拒绝', () => {
    let state = createState(1, 'skilled')
    for (let i = 0; i < 200; i++) {
      const duel = duelOf(state)
      if (duel.phase === 'turn' && duel.turn === 1) break
      state = step(state)
    }
    expect(() => reduceState(state, { type: 'shoot', target: 'self' })).toThrow(IllegalActionError)
    expect(legalActions(state)).toEqual([{ type: 'tick' }])
    expect(() => reduceState(state, { type: 'undo' } as unknown as BuckshotAction)).toThrow(IllegalActionError)
  })

  it('legal() 与阶段一致', () => {
    let state = createState(21, 'challenging')
    for (let i = 0; i < 300 && statusOf(state) === 'playing'; i++) {
      const duel = duelOf(state)
      const legal = legalActions(state)
      if (duel.phase === 'load') expect(legal).toEqual([{ type: 'begin' }])
      else if (duel.phase === 'roundOver') expect(legal).toEqual([{ type: 'nextRound' }])
      else if (duel.turn === 1) expect(legal).toEqual([{ type: 'tick' }])
      else expect(legal.filter((a) => a.type === 'shoot')).toHaveLength(2)
      state = step(state)
    }
    expect(legalActions(state)).toEqual([])
  })
})

describe('存档防篡改', () => {
  const base = (): Record<string, unknown> => {
    let state = createState(2024, 'skilled')
    for (let i = 0; i < 10; i++) state = step(state)
    return JSON.parse(JSON.stringify(encodeState(state))) as Record<string, unknown>
  }
  it.each([
    ['未知难度', (raw: Record<string, unknown>) => (raw.difficulty = 'nightmare')],
    ['座位越界', (raw: Record<string, unknown>) => ((raw.log as Array<{ seat: number }>)[0]!.seat = 3)],
    ['真人替恶魔按开始', (raw: Record<string, unknown>) => ((raw.log as Array<{ seat: number }>)[0]!.seat = 1)],
    ['日志里用了不存在的道具格', (raw: Record<string, unknown>) => (raw.log as unknown[]).push({ seat: 0, move: { kind: 'item', slot: 99 } })],
    ['种子越界', (raw: Record<string, unknown>) => (raw.seed = -1)],
  ])('%s → 判为损坏', (_name, mutate) => {
    const raw = base()
    mutate(raw)
    expect(() => decodeState(raw)).toThrow(IllegalActionError)
  })
})

describe('展示模型', () => {
  it('装填阶段：枪里亮出组成，按钮只有「开始」；回合中：两个开枪按钮', () => {
    const state = createState(8, 'skilled')
    const view = buildView(state)
    expect(view.board).toBeNull()
    const duel = view.duel!
    expect(duel.chamber.every((t) => t === 'live' || t === 'blank')).toBe(true)
    expect(duel.caption.key).toBe('buckshot.caption.load')
    expect(buildControls(state).map((c) => c.id)).toEqual(['begin'])
    const playing = reduceState(state, { type: 'begin' })
    expect(buildView(playing).duel!.chamber.every((t) => t === 'unknown')).toBe(true)
    expect(buildControls(playing).map((c) => c.id)).toEqual(['shoot-self', 'shoot-opponent'])
    expect(buckshotGame.controlAction!(playing, 'shoot-opponent')).toEqual({ type: 'shoot', target: 'opponent' })
  })

  it('上方是恶魔、下方是你；双人同屏时是玩家二 / 玩家一', () => {
    const vs = buildView(createState(1, 'skilled')).duel!.sides
    expect(vs.map((s) => [s.position, s.nameKey, s.portrait])).toEqual([
      ['top', 'buckshot.name.devil', 'devil'],
      ['bottom', 'buckshot.name.you', 'player'],
    ])
    const hot = buildView(createState(1, 'hotseat')).duel!.sides
    expect(hot.map((s) => s.nameKey)).toEqual(['buckshot.name.p2', 'buckshot.name.p1'])
  })

  it('道具只在轮到真人时可点；点了就是使用', () => {
    // 推进到第 2 轮真人回合、手里有道具（第 1 轮不发道具；有的种子第 1 轮就输了，换下一个）
    const ready = (s: BuckshotState): boolean => {
      const duel = duelOf(s)
      return duel.round >= 1 && duel.phase === 'turn' && duel.turn === 0 && duel.items[0].length > 0
    }
    let state = createState(3, 'skilled')
    for (let seed = 3; seed < 200 && !ready(state); seed++) {
      state = createState(seed, 'skilled')
      for (let i = 0; i < 400 && !ready(state) && statusOf(state) === 'playing'; i++) state = step(state)
    }
    expect(ready(state)).toBe(true)
    const bottom = buildView(state).duel!.sides[1]!
    expect(bottom.items.some((i) => i.selectable)).toBe(true)
    const slot = bottom.items.find((i) => i.selectable)!.id
    expect(buckshotGame.selectAction!(state, slot)).toEqual({ type: 'item', slot })
    const top = buildView(state).duel!.sides[0]!
    expect(top.items.every((i) => !i.selectable)).toBe(true)
  })

  it('回合中直接给出剩余实弹 / 空包弹数量；装填阶段不给', () => {
    const state = createState(8, 'skilled')
    expect(buildView(state).duel!.remaining).toBeNull()
    const playing = reduceState(state, { type: 'begin' })
    const duel = duelOf(playing)
    const remaining = buildView(playing).duel!.remaining!
    expect(remaining.key).toBe('buckshot.remaining.exact')
    expect(remaining.params).toEqual({ live: duel.loadLive, blank: duel.loadBlank })
  })

  it('战斗记录：整场保留不截断；道具与效果合成一条；恶魔回合的记录高亮', () => {
    // 不钉死某个种子的结局（弹序/配比一改就会变）：扫种子，挑一局「恶魔开过枪也用
    // 过道具」的来验记录规则；对照隔壁「对手的放大镜」那条的写法。
    for (let seed = 1; seed < 400; seed++) {
      const over = playOut(createState(seed, 'challenging'))
      const log = buildView(over).duel!.log
      // 你能看到的事件里，紧跟在道具后面的效果事件都并进了道具那一条，其余一一对应
      const visible = observe(duelOf(over), 0).events
      const effects = visible.filter((e, i) => ['peek', 'eject', 'heal', 'hurt'].includes(e.type) && visible[i - 1]?.type === 'item')
      expect(log.length).toBe(visible.length - effects.length)
      if (!log.some((l) => l.key.startsWith('buckshot.log.shoot'))) continue
      if (!log.some((l) => l.key.startsWith('buckshot.log.use.'))) continue
      expect(log.every((l) => !/log\.(item|peek|eject|heal|hurt)/.test(l.key))).toBe(true)
      // 恶魔的开枪全部高亮、你的开枪全部不高亮
      for (const line of log) {
        if (line.key.startsWith('buckshot.log.shoot')) {
          expect(line.highlight === true).toBe(line.subjectKey === 'buckshot.name.devil')
        }
      }
      expect(log.some((l) => l.highlight)).toBe(true)
      return
    }
    throw new Error('400 场里没有一局同时出现恶魔开枪与道具使用')
  })

  it('恶魔不再花道具去「看」：熟练/挑战已经能读到真实弹序', () => {
    // 这是「Dealer 可以读到真实弹序」的直接后果：它不会再浪费放大镜与手机
    for (let seed = 1; seed < 120; seed++) {
      const over = playOut(createState(seed, 'challenging'))
      const peek = buildView(over)
        .duel!.log.filter((l) => l.key.startsWith('buckshot.log.use.magnifier') || l.key.startsWith('buckshot.log.use.phone'))
        .filter((l) => l.subjectKey === 'buckshot.name.devil')
      expect(peek).toHaveLength(0)
    }
  })

  it('偷看的结果不外泄：双人同屏时另一个人看不到', () => {
    let checked = 0
    for (let seed = 1; seed < 300 && checked === 0; seed++) {
      let state = reduceState(createState(seed, 'hotseat'), { type: 'begin' })
      for (let guard = 0; guard < 400 && duelOf(state).phase !== 'matchOver'; guard++) {
        const duel = duelOf(state)
        if (duel.phase === 'load') {
          state = reduceState(state, { type: 'begin' })
          continue
        }
        if (duel.phase === 'roundOver') {
          state = reduceState(state, { type: 'nextRound' })
          continue
        }
        const actor = duel.turn
        const slot = duel.items[actor].indexOf('magnifier')
        if (slot >= 0) {
          const otherSeat = actor === 0 ? 1 : 0
          const next = reduceState(state, { type: 'item', slot })
          const other = observe(duelOf(next), otherSeat)
          // 另一个座位可见的事件里，绝不能出现这次偷看（连"偷看了"都不该有：那是私事）
          expect(other.events.some((event) => event.type === 'peek' && event.user === actor)).toBe(false)
          checked++
          state = next
          continue
        }
        state = reduceState(state, { type: 'shoot', target: 'opponent' })
      }
    }
    expect(checked, '300 个种子里没有一局用上放大镜').toBeGreaterThan(0)
  })

  it('整场结束：结果面板给胜负与轮次比分', () => {
    const over = playOut(createState(17, 'skilled'))
    const result = buildView(over).result!
    expect(['buckshot.won.title', 'buckshot.lost.title']).toContain(result.titleKey)
    expect(result.details[0]!.key).toBe('buckshot.result.rounds')
    const hot = playOut(createState(17, 'hotseat'))
    expect(['buckshot.won.p1', 'buckshot.won.p2']).toContain(buildView(hot).result!.titleKey)
  })
})

describe('文案', () => {
  it('中英基础 key 一致', () => {
    expect(compareDicts({ 'zh-CN': buckshotZh, 'en-US': buckshotEn })).toEqual([])
  })

  it('一整场里出现过的每个 key 两种语言都取得到（含记录里的人名代入）', () => {
    const dicts = { 'zh-CN': { ...coreDictZh, ...buckshotZh }, 'en-US': { ...coreDictEn, ...buckshotEn } }
    for (const locale of ['zh-CN', 'en-US'] as const) {
      const i18n = createI18n(locale, dicts)
      for (const difficulty of ['challenging', 'endless', 'hotseat'] as const) {
        playOut(createState(99, difficulty), (s) => {
          const view = buildView(s)
          const duel = view.duel!
          const lines = [duel.caption, ...duel.tags, ...duel.log]
          for (const line of lines) {
            const subject = line.subjectKey ? i18n.t(line.subjectKey) : ''
            const object = line.objectKey ? i18n.t(line.objectKey) : ''
            expect(i18n.t(line.key, { ...line.params, subject, object })).not.toMatch(/\{\w+\}/)
          }
          for (const side of duel.sides) {
            i18n.t(side.nameKey)
            if (side.statusKey) i18n.t(side.statusKey)
            for (const item of side.items) i18n.t(item.labelKey)
          }
          for (const control of buildControls(s)) i18n.t(control.labelKey)
          for (const stat of view.stats) i18n.t(stat.labelKey)
        })
      }
      for (const key of ['buckshot.title', 'buckshot.rules.body', 'buckshot.rules.body2', 'buckshot.rules.body3', 'buckshot.rules.restart', 'buckshot.illegal.notice']) i18n.t(key)
      expect(i18n.missingKeys(), locale).toEqual([])
    }
  })
})

describe('无尽模式', () => {
  it('恶魔每 3 轮升一档：入门 → 熟练 → 挑战，之后一直是挑战', () => {
    const levels = Array.from({ length: 12 }, (_, round) => devilLevelAt('endless', round))
    expect(ENDLESS_LEVEL_EVERY).toBe(3)
    expect(levels).toEqual([
      'starter', 'starter', 'starter', 'skilled', 'skilled', 'skilled',
      'challenging', 'challenging', 'challenging', 'challenging', 'challenging', 'challenging',
    ])
    expect(devilLevelAt('skilled', 7)).toBe('skilled')
    expect(devilLevelAt('hotseat', 0)).toBeNull()
  })

  it('整场只会以失败收场；成绩 = 赢下的轮数；结果面板与统计按无尽口径', () => {
    let longest = 0
    for (let seed = 1; seed <= 20; seed++) {
      const over = playOut(createState(seed * 7919, 'endless'))
      expect(statusOf(over)).toBe('lost')
      const duel = duelOf(over)
      expect(scoreOf(over)).toBe(duel.roundWins[0])
      expect(duel.roundWins[1]).toBe(1)
      const view = buildView(over)
      expect(view.result!.titleKey).toBe('buckshot.endless.over')
      expect(view.result!.details[0]).toEqual({ key: 'buckshot.result.endless', params: { count: duel.roundWins[0], round: duel.round + 1 } })
      expect(view.stats.map((s) => s.labelKey)).toEqual(['buckshot.stat.round', 'buckshot.stat.cleared'])
      longest = Math.max(longest, duel.roundWins[0])
    }
    expect(longest).toBeGreaterThanOrEqual(3) // 20 场里总有人撑过前 3 轮，验证跨过「第 3 轮」不会结束
    expect(scoreOf(createState(1, 'skilled'))).toBeNull()
  })

  it('装填说明带上恶魔当前档位；升档时记录里记一条', () => {
    expect(buildView(createState(4, 'endless')).duel!.caption).toMatchObject({
      key: 'buckshot.caption.loadEndless',
      objectKey: 'buckshot.difficulty.starter',
    })
    for (let seed = 1; seed < 300; seed++) {
      const over = playOut(createState(seed, 'endless'))
      if (duelOf(over).roundWins[0] < ENDLESS_LEVEL_EVERY) continue
      const log = buildView(over).duel!.log
      expect(log).toContainEqual({ key: 'buckshot.log.levelUp', objectKey: 'buckshot.difficulty.skilled' })
      return
    }
    throw new Error('300 场里没有人撑过 3 轮')
  })

  it('恶魔回合照常自动步进；存档里恶魔不能替你按「开始」', () => {
    let state = reduceState(createState(12, 'endless'), { type: 'begin' })
    for (let i = 0; i < 200 && !(duelOf(state).turn === 1 && duelOf(state).phase === 'turn'); i++) state = step(state)
      expect([DEVIL_DELAY_MS, FIRE_HOLD_MS]).toContain(tickMsOf(state))
    const raw = JSON.parse(JSON.stringify(encodeState(state))) as { log: Array<{ seat: number }> }
    raw.log[0]!.seat = 1
    expect(() => decodeState(raw)).toThrow(IllegalActionError)
  })
})
