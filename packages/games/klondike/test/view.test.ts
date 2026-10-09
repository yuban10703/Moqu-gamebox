/**
 * 展示层测试：牌桌（CardTableView）长什么样、可点的牌怎么编号、按钮什么时候亮。
 *
 * 这里守的是「壳层接口」而不是玩法：壳层只会把牌堆里的 CardFace.id（以及空堆的空位 id）
 * 递回来、只会按 controls() 渲染按钮，所以这两条通道必须与规则层严丝合缝
 * （编号唯一、点得动、不该亮的时候不亮），否则真机上就是「点了没反应」。
 */
import { describe, expect, it } from 'vitest'
import { IllegalActionError, createI18n, coreDictEn, coreDictZh } from '@eink/core'
import { CARD_COUNT, clickIdOf, decodeClickId, foundation, tableau } from '../src/cards.js'
import { collectStep, createState, decodeState, encodeState, reduceState, tableOf } from '../src/engine.js'
import { klondikeEn, klondikeZh } from '../src/i18n.js'
import { klondikeGame } from '../src/index.js'
import { CARD_BACK_GLYPH, RECYCLE_GLYPH, buildControls, buildResult, buildStats, buildTable, buildView, clickTargets, isClickable } from '../src/view.js'
import { freshState, freshTable } from './helpers.js'

const i18nZh = createI18n('zh-CN', { 'zh-CN': { ...coreDictZh, ...klondikeZh }, 'en-US': { ...coreDictEn, ...klondikeEn } })
const i18nEn = createI18n('en-US', { 'zh-CN': { ...coreDictZh, ...klondikeZh }, 'en-US': { ...coreDictEn, ...klondikeEn } })

describe('可点的牌（编号与顺序）', () => {
  it('顺序固定：抽牌堆 → 弃牌堆 → 基础堆 → 7 个牌列（每列从列顶往下，牌背在列尾）', () => {
    const state = freshState(21)
    const targets = clickTargets(state)
    const table = tableOf(state)
    // 开局：抽牌堆 + 7 列（第 i 列 i+1 张，只有最后一张是明牌）
    expect(targets[0]!.id).toBe(clickIdOf({ zone: 'stock', index: 0 }))
    expect(targets[0]!.faceDown).toBe(true)
    expect(targets[0]!.face.rank).toBe(CARD_BACK_GLYPH)
    let cursor = 1
    for (let column = 0; column < 7; column++) {
      const cards = table.tableau[column]!.cards
      expect(targets.slice(cursor, cursor + cards.length).map((target) => target.cardIndex)).toEqual(
        cards.map((_, index) => index).reverse(),
      )
      // 只有列顶那张是明牌、也只有它是「提得起来」的
      expect(targets.slice(cursor, cursor + cards.length).filter((target) => !target.faceDown)).toHaveLength(1)
      expect(targets[cursor]!.faceDown).toBe(false)
      expect(targets[cursor]!.face.rank).not.toBe(CARD_BACK_GLYPH)
      cursor += cards.length
    }
    expect(cursor).toBe(targets.length)
  })

  it('编号唯一，而且能原样解回「哪一堆的第几张」', () => {
    const state = freshState(22)
    const targets = clickTargets(state)
    const ids = targets.map((target) => target.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const target of targets) {
      const decoded = decodeClickId(target.id)
      expect(decoded).toEqual({ pile: target.pile, cardIndex: target.cardIndex })
    }
  })

  it('每一张牌列里的牌都被列了出来，且每张只出现一次', () => {
    let state = freshState(23)
    for (let step = 0; step < 12; step++) {
      state = reduceState(state, { type: 'tap', id: clickIdOf({ zone: 'stock', index: 0 }) })
    }
    const table = tableOf(state)
    const targets = clickTargets(state)
    // 牌列里的牌一张不漏、一张不重（含牌背）
    const inStrip = targets
      .filter((target) => target.pile.zone === 'tableau')
      .map((target) => `${target.pile.index}:${target.cardIndex}`)
      .sort()
    const onTable = table.tableau.flatMap((pile, index) => pile.cards.map((_, cardIndex) => `${index}:${cardIndex}`)).sort()
    expect(inStrip).toEqual(onTable)
    // 弃牌堆只画堆顶那一张、基础堆只画堆顶、抽牌堆只画一个牌背入口
    expect(targets.filter((target) => target.pile.zone === 'waste')).toHaveLength(1)
    expect(targets.filter((target) => target.pile.zone === 'foundation')).toHaveLength(0)
    expect(targets.filter((target) => target.pile.zone === 'stock')).toHaveLength(1)
    // 长条长度有上限（52 张 + 抽牌堆 1 个入口 + 弃牌堆 1 个 + 4 个基础堆）：
    // 壳层按 100cqw / (0.5 * (n - 1) + 1) 算牌宽，58 张在 439px 竖屏上还有 ~19px，不会挤出屏幕
    expect(targets.length).toBeLessThanOrEqual(CARD_COUNT + 6)
    expect(targets.length).toBe(1 + 1 + 28)
  })

  it('抽牌堆空了但还能回收时，入口换成回收符号；两边都空就没有入口', () => {
    let state = freshState(24, 'skilled')
    // 翻空抽牌堆
    for (let step = 0; step < Math.ceil(24 / 3); step++) {
      state = reduceState(state, { type: 'tap', id: clickIdOf({ zone: 'stock', index: 0 }) })
    }
    expect(tableOf(state).stock).toHaveLength(0)
    const stockTarget = clickTargets(state).find((target) => target.pile.zone === 'stock')!
    expect(stockTarget.face.rank).toBe(RECYCLE_GLYPH)
    expect(isClickable(state, stockTarget.id)).toBe(true)
    // 真点一下：弃牌堆整叠回到抽牌堆
    const recycled = reduceState(state, { type: 'tap', id: stockTarget.id })
    expect(tableOf(recycled).stock).toHaveLength(24)
    expect(tableOf(recycled).waste).toHaveLength(0)
  })
})

describe('selectAction（壳层点一下递回来的编号）', () => {
  it('列顶的牌点得动；牌背与空基础堆返回 null（壳层据此提示）', () => {
    const state = freshState(25)
    const table = tableOf(state)
    const topId = clickIdOf(tableau(2), table.tableau[2]!.cards.length - 1)
    expect(klondikeGame.selectAction!(state, topId)).toEqual({ type: 'tap', id: topId })
    // 抽牌堆入口（点它翻牌）永远可点 —— 这条一旦断了，整局游戏就没法翻牌了
    const stockId = clickIdOf({ zone: 'stock', index: 0 })
    expect(klondikeGame.selectAction!(state, stockId)).toEqual({ type: 'tap', id: stockId })
    expect(() => reduceState(state, klondikeGame.selectAction!(state, stockId)!)).not.toThrow()
    // 牌背：没选源的时候不可点
    expect(klondikeGame.selectAction!(state, clickIdOf(tableau(2), 0))).toBeNull()
    // 空基础堆：视图给了它一个可点的空位编号（放 A 的入口），但没提起牌时点它没有动作
    expect(buildTable(state).piles![2]!.id).toBe(clickIdOf(foundation(0)))
    expect(klondikeGame.selectAction!(state, clickIdOf(foundation(0)))).toBeNull()
    // 乱七八糟的编号
    expect(klondikeGame.selectAction!(state, 9999)).toBeNull()
    expect(klondikeGame.selectAction!(state, -3)).toBeNull()
  })

  it('已经提起一段时，牌背可以当目标（点整列 = 放这一列）', () => {
    const state = freshState(26)
    const table = tableOf(state)
    const picked = klondikeGame.selectAction!(state, clickIdOf(tableau(0), table.tableau[0]!.cards.length - 1))!
    const afterPick = reduceState(state, picked)
    expect(afterPick.selected).not.toBeNull()
    // 第 3 列底下那张是牌背，现在它在这条通道上返回动作（规则层再判放不放得下）
    const backId = clickIdOf(tableau(2), 0)
    expect(klondikeGame.selectAction!(afterPick, backId)).toEqual({ type: 'tap', id: backId })
  })

  it('通过 selectAction → reduce 走完整条链路，非法的一步由规则层抛错', () => {
    const state = freshState(27)
    const table = tableOf(state)
    const topId = clickIdOf(tableau(1), table.tableau[1]!.cards.length - 1)
    const picked = reduceState(state, klondikeGame.selectAction!(state, topId)!)
    // 空基础堆放不下（除非列顶正好是 A，那种情况下这一步是合法的）
    const topCard = table.tableau[1]!.cards[table.tableau[1]!.cards.length - 1]!
    const toFoundation = klondikeGame.selectAction!(picked, clickIdOf(foundation(0)))!
    if (Math.floor(topCard / 4) !== 0) {
      expect(() => reduceState(picked, toFoundation)).toThrow(IllegalActionError)
    } else {
      expect(() => reduceState(picked, toFoundation)).not.toThrow()
    }
  })
})

describe('牌桌与统计条', () => {
  it('用的是牌桌视图（不新增视图类型），没有棋盘', () => {
    const view = buildView(freshState(28))
    expect(view.board).toBeNull()
    expect(view.table?.kind).toBe('cards')
    expect(view.duel).toBeUndefined()
    expect(view.notice).toBeNull()
  })

  it('牌桌给的是 13 个牌堆（壳层按 piles 渲染）：seats / center / hand 一律不给，张数落在每一堆上', () => {
    const state = freshState(29, 'skilled')
    const table = buildTable(state)
    const piles = table.piles!
    // 给了 piles 时壳层不再看 seats / center / hand（CardTable 的既有约定），这里就不产出
    expect(table.seats).toEqual([])
    expect(table.center).toBeNull()
    expect(table.hand).toEqual([])
    // 上排 = 抽牌堆 / 弃牌堆 / 4 个基础堆（横排）；下排 = 7 个牌列（竖排）
    expect(table.piles).toHaveLength(13)
    expect(piles.filter((pile) => pile.layout === 'row')).toHaveLength(6)
    expect(piles.filter((pile) => pile.layout === 'stack')).toHaveLength(7)
    expect(piles.map((pile) => pile.labelKey)).toEqual([
      'klondike.pile.stock',
      'klondike.pile.waste',
      'klondike.pile.foundation',
      'klondike.pile.foundation',
      'klondike.pile.foundation',
      'klondike.pile.foundation',
      ...Array.from({ length: 7 }, () => 'klondike.pile.tableau'),
    ])
    // 总览没有丢：每一堆的张数（cards + hidden）= 真实张数
    const pileTable = tableOf(state)
    const counts = piles.map((pile) => pile.cards.length + pile.hidden)
    expect(counts[0]).toBe(pileTable.stock.length)
    expect(counts[1]).toBe(0)
    expect(counts.slice(2, 6)).toEqual([0, 0, 0, 0])
    expect(counts.slice(6)).toEqual(pileTable.tableau.map((pile) => pile.cards.length))
    // 抽牌堆整堆只有一个入口：一张牌背（点数花色不发出来），其余张数写进 hidden
    expect(piles[0]!.cards).toHaveLength(1)
    expect(piles[0]!.cards[0]!.faceDown).toBe(true)
    expect(piles[0]!.hidden).toBe(pileTable.stock.length - 1)
    // 牌列：整列都画出来（含牌背），列顶那张排第一（壳层把它画在最上层、完整可见）
    const column = piles[6]!
    expect(column.cards.map((card) => card.id)).toEqual(
      pileTable.tableau[0]!.cards
        .map((_, index) => clickIdOf(tableau(0), index))
        .reverse(),
    )
    expect(column.cards.filter((card) => card.faceDown === true)).toHaveLength(pileTable.tableau[0]!.faceDown)
    // 每一堆的牌都是可点编号：卡面上带 id，壳层原样递回来
    for (const pile of piles) {
      for (const card of pile.cards) expect(decodeClickId(card.id)).not.toBeNull()
    }
  })

  it('选中一段牌时：这一段在牌堆里被抬高、提示换成「再点目标」、被选的那一堆标出来', () => {
    const state = freshState(30)
    const table = tableOf(state)
    const picked = reduceState(state, { type: 'tap', id: clickIdOf(tableau(4), table.tableau[4]!.cards.length - 1) })
    const pickedTable = buildTable(picked)
    expect(pickedTable.bannerKey).toBe('klondike.banner.drop')
    const stacks = pickedTable.piles!.filter((pile) => pile.layout === 'stack')
    // 只有被提起的那一列带 selected（壳层画粗框 + 堆名反白）
    expect(stacks.filter((pile) => pile.selected === true)).toHaveLength(1)
    expect(stacks[4]!.selected).toBe(true)
    expect(stacks[3]!.selected).toBeUndefined()
    // 提起来的那几张（这里只有列顶一张）也带 selected：壳层把它们一起抬高
    const marked = stacks[4]!.cards.filter((card) => card.selected === true)
    expect(marked).toHaveLength(1)
    expect(marked[0]!.id).toBe(clickIdOf(tableau(4), table.tableau[4]!.cards.length - 1))
    // 没选的时候是「点一张明牌」
    expect(buildTable(state).bannerKey).toBe('klondike.banner.pick')
  })

  it('统计条固定三条：步数 / 已收牌 / 局号', () => {
    const state = reduceState(freshState(31), { type: 'nextDeal' })
    const stats = buildStats(reduceState(state, { type: 'tap', id: clickIdOf({ zone: 'stock', index: 0 }) }))
    expect(stats.map((stat) => stat.labelKey)).toEqual(['klondike.stat.moves', 'klondike.stat.collected', 'klondike.stat.deal'])
    expect(stats.map((stat) => stat.value)).toEqual(['1', `0/${CARD_COUNT}`, '2'])
  })
})

describe('按钮', () => {
  it('撤销交给壳层但要报状态：开局不能撤，走一步就能撤（注册时不要隐藏撤销）', () => {
    const state = freshState(32)
    const before = buildControls(state)
    const undo = before.find((control) => control.id === 'undo')!
    expect(undo.labelKey).toBe('shell.game.undo')
    expect(undo.enabled).toBe(false)
    const after = buildControls(reduceState(state, { type: 'tap', id: clickIdOf({ zone: 'stock', index: 0 }) }))
    expect(after.find((control) => control.id === 'undo')!.enabled).toBe(true)
  })

  it('自动收牌：没什么可收的时候是灰的', () => {
    const state = freshState(33)
    const empty = buildControls(state).find((control) => control.id === 'collect')!
    expect(empty.labelKey).toBe('klondike.action.collect')
    expect(empty.enabled).toBe(collectStep(tableOf(state)) !== null)
  })

  it('重开本局 / 换一局都在，且换一局还给结果面板留了壳层的 next-level', () => {
    const controls = buildControls(freshState(34))
    const ids = controls.map((control) => control.id)
    expect(ids).toEqual(['undo', 'collect', 'restart-deal', 'next-deal', 'next-level'])
    expect(controls.find((control) => control.id === 'restart-deal')!.labelKey).toBe('klondike.action.restartDeal')
    expect(controls.find((control) => control.id === 'next-deal')!.enabled).toBe(true)
    expect(controls.find((control) => control.id === 'next-level')!.labelKey).toBe('klondike.action.nextDeal')
  })

  it('每个亮着的按钮都点到：controlAction 给出的动作都被规则层接受', () => {
    const state = freshState(35)
    const drawn = reduceState(state, { type: 'tap', id: clickIdOf({ zone: 'stock', index: 0 }) })
    const controls = buildControls(drawn)
    expect(controls.some((control) => control.enabled)).toBe(true)
    for (const control of controls) {
      const action = klondikeGame.controlAction!(drawn, control.id)
      if (!action) {
        // 壳层自己的 id（next-level）不在 controlAction 里：它由结果面板的按钮发同名动作
        expect(control.id).toBe('next-level')
        continue
      }
      // 亮着的按钮必须真的能用；灰着的按钮规则层会拒绝（壳层本来就点不到）
      if (control.enabled) expect(() => reduceState(drawn, action)).not.toThrow()
    }
    // 灰着的按钮不给动作也不行 —— 这里只确认「灰」是有依据的：没什么可收
    const collect = controls.find((control) => control.id === 'collect')!
    expect(collect.enabled).toBe(collectStep(tableOf(drawn)) !== null)
  })
})

describe('结果面板', () => {
  it('没收满时没有结果；收满了给出标题与两条详情', () => {
    const state = freshState(36)
    expect(buildResult(state, 'playing')).toBeNull()
    const result = buildResult({ ...state, log: [] }, 'won')!
    expect(result.titleKey).toBe('klondike.won.title')
    expect(result.details.map((detail) => detail.key)).toEqual(['klondike.result.deal', 'klondike.result.moves'])
    expect(buildView(state).result).toBeNull()
  })
})

describe('文案 key 都能取到（中英两套）', () => {
  it('视图里出现的每个 key 在两种语言下都有词，且没有 ⟦占位符⟧', () => {
    // 覆盖三种局面：开局、提起一段、自动收牌之后
    const seed = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].find((candidate) => collectStep(tableOf(freshState(candidate))) !== null)!
    const states = [freshState(seed), reduceState(freshState(seed), { type: 'collect' }), (() => {
      const base = freshState(seed)
      const table = tableOf(base)
      return reduceState(base, { type: 'tap', id: clickIdOf(tableau(0), table.tableau[0]!.cards.length - 1) })
    })()]
    const keys = new Set<string>()
    for (const state of states) {
      const view = buildView(state)
      keys.add(view.table!.bannerKey!)
      for (const seat of view.table!.seats) {
        keys.add(seat.nameKey)
        if (seat.badgeKey) keys.add(seat.badgeKey)
      }
      // 牌堆布局：13 个堆的小标题（壳层翻好后当堆名与无障碍名）
      for (const pile of view.table!.piles ?? []) keys.add(pile.labelKey)
      for (const stat of view.stats) keys.add(stat.labelKey)
      for (const control of buildControls(state)) keys.add(control.labelKey)
      keys.add(buildResult(state, 'won')!.titleKey)
      // 结果面板的两条详情带参数，壳层用 plural 渲染 —— 单独按 plural 验
      for (const detail of buildResult(state, 'won')!.details) {
        for (const i18n of [i18nZh, i18nEn]) {
          expect(i18n.plural(detail.key, Number(detail.params?.count ?? 0)), detail.key).not.toContain('⟦')
        }
      }
    }
    keys.add('klondike.illegal.notice')
    keys.add('klondike.solved.best')
    // 重开确认框的正文由壳层取 rules.restart（它没法从 view 里看出来，单独盯着）
    keys.add('klondike.rules.restart')
    expect(keys.size).toBeGreaterThan(12)
    for (const key of keys) {
      for (const i18n of [i18nZh, i18nEn]) {
        expect(i18n.has(key), `${key} 缺词`).toBe(true)
        expect(i18n.t(key)).not.toContain('⟦')
      }
    }
    expect(i18nZh.missingKeys()).toEqual([])
    expect(i18nEn.missingKeys()).toEqual([])
  })

  it('难度与游戏名的 key 与 GameDef 声明一致', () => {
    expect(klondikeGame.i18nNamespace).toBe('klondike')
    for (const difficulty of klondikeGame.difficulties) {
      expect(i18nZh.has(difficulty.labelKey), difficulty.labelKey).toBe(true)
      expect(i18nEn.has(difficulty.labelKey), difficulty.labelKey).toBe(true)
    }
    expect(i18nZh.t('klondike.title')).not.toContain('⟦')
  })
})

describe('GameDef 接线', () => {
  it('id / 难度 / 计步数 / 内容 id 都对得上', () => {
    expect(klondikeGame.id).toBe('klondike')
    expect(klondikeGame.difficulties.map((item) => item.id)).toEqual(['starter', 'skilled'])
    const state = createState(77, 'skilled')
    expect(klondikeGame.contentId!(state)).toBe('skilled')
    expect(klondikeGame.movesOf!(state)).toBe(0)
    expect(klondikeGame.status(state)).toBe('playing')
    // 不声明自动步进：单人排牌一分钟不动也不该自己走
    expect(klondikeGame.tickMs).toBeUndefined()
  })

  it('encode → decode 往返（含选中）', () => {
    const state = createState(78, 'starter')
    const table = tableOf(state)
    const picked = reduceState(state, { type: 'tap', id: clickIdOf(tableau(0), table.tableau[0]!.cards.length - 1) })
    const raw = klondikeGame.encode(picked)
    expect(decodeState(raw)).toEqual(picked)
    expect(klondikeGame.decode(encodeState(picked))).toEqual(picked)
    expect(klondikeGame.decode(JSON.parse(JSON.stringify(raw)))).toEqual(picked)
  })

  it('开局局面在两种难度下都能建出来', () => {
    const difficulties = ['starter', 'skilled'] as const
    for (const difficulty of difficulties) {
      const state = createState(79, difficulty)
      expect(freshTable(79, difficulty)).toEqual(tableOf(state))
      expect(() => klondikeGame.decode(klondikeGame.encode(state))).not.toThrow()
    }
  })
})
