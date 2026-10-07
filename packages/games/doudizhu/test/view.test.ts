/**
 * 展示模型与文案：牌桌只含能看到的信息、按钮随阶段变化、结果面板明细、中英文案对齐。
 */
import { describe, expect, it } from 'vitest'
import { compareDicts, coreDictEn, coreDictZh, createI18n } from '@eink/core'
import { BIG_JOKER, SMALL_JOKER } from '../src/cards.js'
import { doudizhuEn, doudizhuZh } from '../src/i18n.js'
import { HUMAN_SEAT, createState, hintOptions, reduceState, statusOf, tableOf, type DoudizhuState } from '../src/rules.js'
import { buildControls, buildView, cardFace } from '../src/view.js'
import { doudizhuGame } from '../src/index.js'

function run(seed: number, until: (s: DoudizhuState) => boolean): DoudizhuState {
  let state = createState(seed, 'skilled')
  for (let i = 0; i < 400 && !until(state); i++) {
    const table = tableOf(state)
    if (table.turn !== HUMAN_SEAT || table.phase === 'over') {
      state = table.phase === 'over' ? state : reduceState(state, { type: 'tick' })
      continue
    }
    if (table.phase === 'bidding') state = reduceState(state, { type: 'bid', value: 0 })
    else if (table.top && table.top.seat !== HUMAN_SEAT) state = reduceState(state, { type: 'pass' })
    else {
      state = reduceState(state, { type: 'hint' })
      state = reduceState(state, { type: 'play' })
    }
  }
  return state
}

describe('牌桌展示模型', () => {
  it('叫分阶段：底牌画成 3 张牌背；手牌 17 张；两家电脑只给张数', () => {
    const view = buildView(createState(10, 'skilled'))
    expect(view.board).toBeNull()
    const table = view.table!
    expect(table.center).toEqual({ cards: [], hidden: 3 })
    expect(table.hand).toHaveLength(17)
    const left = table.seats.find((s) => s.position === 'left')!
    const right = table.seats.find((s) => s.position === 'right')!
    expect(left.count).toBe(17)
    expect(right.count).toBe(17)
    // 视图里只有自己的 17 张牌面 id（别人的牌一张都不在）
    const ids = JSON.stringify(table)
    for (const card of tableOf(createState(10, 'skilled')).hands[1]) {
      expect(table.hand.some((face) => face.id === card)).toBe(false)
      expect(ids.includes(`"id":${card},`)).toBe(false)
    }
  })

  it('牌面：王没有点数文字、用 joker 区分大小；普通牌给点数与花色', () => {
    expect(cardFace(BIG_JOKER)).toMatchObject({ rank: '', suit: null, joker: 'big' })
    expect(cardFace(SMALL_JOKER)).toMatchObject({ rank: '', suit: null, joker: 'small' })
    expect(cardFace(0)).toMatchObject({ rank: '3', suit: 'spade' })
    expect(cardFace(51, true)).toMatchObject({ rank: '2', suit: 'diamond', selected: true })
  })

  it('按钮随阶段变化：叫分 4 个 → 出牌 4 个（提示带方案数）→ 打完只剩「下一局」', () => {
    const bidding = run(12, (s) => tableOf(s).phase === 'bidding' && tableOf(s).turn === HUMAN_SEAT)
    expect(buildControls(bidding).map((c) => c.id)).toEqual(['bid-0', 'bid-1', 'bid-2', 'bid-3'])

    const playing = run(12, (s) => tableOf(s).phase === 'playing' && tableOf(s).turn === HUMAN_SEAT)
    const controls = buildControls(playing)
    expect(controls.map((c) => c.id)).toEqual(['pass', 'clear', 'hint', 'play'])
    expect(controls.find((c) => c.id === 'hint')!.labelParams!.count).toBeGreaterThanOrEqual(0)

    const over = run(12, (s) => statusOf(s) !== 'playing')
    expect(buildControls(over)).toEqual([
      { id: 'next-level', labelKey: 'doudizhu.next', role: 'action', enabled: true, emphasis: 'primary' },
    ])
    expect(doudizhuGame.controlAction!(over, 'next-level')).toEqual({ type: 'nextLevel' })
  })

  it('提示按钮只在真的有牌可出时可点（压不过上家时为禁用，不再给可按的「提示 (0)」）', () => {
    let enabled = 0
    let disabled = 0
    for (const seed of [1, 7, 12, 33, 99, 2026]) {
      let state = createState(seed, 'skilled')
      for (let step = 0; step < 120 && statusOf(state) === 'playing'; step++) {
        const table = tableOf(state)
        if (table.phase === 'playing' && table.turn === HUMAN_SEAT) {
          const hint = buildControls(state).find((control) => control.id === 'hint')!
          const options = hintOptions(table).length
          expect(hint.labelParams!.count, `seed ${seed} step ${step}`).toBe(options)
          expect(hint.enabled, `seed ${seed} step ${step}`).toBe(options > 0)
          if (hint.enabled) enabled++
          else disabled++
        }
        if (table.turn !== HUMAN_SEAT) {
          state = reduceState(state, { type: 'tick' })
          continue
        }
        if (table.phase === 'bidding') state = reduceState(state, { type: 'bid', value: 0 })
        else if (table.top && table.top.seat !== HUMAN_SEAT) state = reduceState(state, { type: 'pass' })
        else {
          state = reduceState(state, { type: 'hint' })
          state = reduceState(state, { type: 'play' })
        }
      }
    }
    // 两个分支都要真的被覆盖到，否则这条断言等于没测
    expect(enabled).toBeGreaterThan(0)
    expect(disabled).toBeGreaterThan(0)
  })

  it('结果面板：胜负标题 + 地主 / 农民获胜 + 底分倍数 + 本局得失 + 当前积分', () => {
    const over = run(21, (s) => statusOf(s) !== 'playing')
    const result = buildView(over).result!
    expect(['doudizhu.won.title', 'doudizhu.lost.title']).toContain(result.titleKey)
    const keys = result.details.map((d) => d.key)
    expect(keys[0]).toMatch(/landlordWins|farmersWin/)
    expect(keys).toContain('doudizhu.result.unit')
    expect(keys.some((k) => k === 'doudizhu.result.gain' || k === 'doudizhu.result.loss')).toBe(true)
    expect(keys.at(-1)).toBe('doudizhu.result.score')
  })

  it('打完之后两家电脑亮出剩下的牌', () => {
    const over = run(33, (s) => statusOf(s) !== 'playing')
    const table = tableOf(over)
    const seats = buildView(over).table!.seats
    for (const seat of seats.filter((s) => s.position !== 'bottom')) {
      const index = seat.position === 'right' ? 1 : 2
      if (table.hands[index].length > 0) expect(seat.played).toHaveLength(table.hands[index].length)
    }
  })
})

describe('文案', () => {
  it('中英基础 key 一致，复数键都有 __other', () => {
    expect(compareDicts({ 'zh-CN': doudizhuZh, 'en-US': doudizhuEn })).toEqual([])
  })

  it('展示模型用到的每个 key 在两种语言里都取得到（不出现 ⟦缺词⟧）', () => {
    const dicts = { 'zh-CN': { ...coreDictZh, ...doudizhuZh }, 'en-US': { ...coreDictEn, ...doudizhuEn } }
    for (const locale of ['zh-CN', 'en-US'] as const) {
      const i18n = createI18n(locale, dicts)
      const states = [createState(3, 'skilled'), run(3, (s) => statusOf(s) !== 'playing')]
      for (const state of states) {
        const view = buildView(state)
        for (const seat of view.table!.seats) {
          i18n.t(seat.nameKey)
          if (seat.badgeKey) i18n.t(seat.badgeKey)
          if (seat.statusKey) i18n.t(seat.statusKey, seat.statusParams)
        }
        for (const stat of view.stats) i18n.t(stat.labelKey)
        for (const control of buildControls(state)) i18n.t(control.labelKey, control.labelParams)
        for (const detail of view.result?.details ?? []) {
          if (detail.params) i18n.plural(detail.key, Number(detail.params.count), detail.params)
          else i18n.t(detail.key)
        }
        if (view.result) i18n.t(view.result.titleKey)
      }
      for (const key of ['doudizhu.title', 'doudizhu.rules.body', 'doudizhu.rules.body2', 'doudizhu.rules.restart', 'doudizhu.illegal.notice', 'doudizhu.notice.redeal', 'doudizhu.notice.noBeat']) {
        i18n.t(key)
      }
      expect(i18n.missingKeys(), locale).toEqual([])
    }
  })

  it('状态条提示 ≤ 14 个全角字（提示条预算）', () => {
    for (const key of ['doudizhu.illegal.notice', 'doudizhu.notice.redeal', 'doudizhu.notice.noBeat']) {
      expect([...doudizhuZh[key]!].length, key).toBeLessThanOrEqual(14)
    }
  })
})
