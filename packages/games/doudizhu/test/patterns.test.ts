/**
 * 牌型：识别、比较、枚举、拆牌。
 * 每种牌型都给正例与反例；比较覆盖「同型同张数」「炸弹压一切」「王炸最大」。
 */
import { describe, expect, it } from 'vitest'
import { rankOf, sortForDisplay, type CardId } from '../src/cards.js'
import {
  asPlayAgainst,
  beatingPlays,
  beats,
  classify,
  classifyAll,
  decompose,
  type Pattern,
} from '../src/patterns.js'
import { hand } from './helpers.js'

const typeOf = (text: string): string | null => classify(hand(text))?.type ?? null

describe('牌型识别', () => {
  it.each([
    ['5', 'single'],
    ['8 8', 'pair'],
    ['K K K', 'triple'],
    ['K K K 3', 'triple1'],
    ['K K K 3 3', 'triple2'],
    ['3 4 5 6 7', 'straight'],
    ['10 J Q K A', 'straight'],
    ['3 3 4 4 5 5', 'pairStraight'],
    ['3 3 3 4 4 4', 'plane'],
    ['3 3 3 4 4 4 7 9', 'plane1'],
    ['3 3 3 4 4 4 7 7 9 9', 'plane2'],
    ['6 6 6 6 3 9', 'four2'],
    ['6 6 6 6 3 3 9 9', 'four22'],
    ['9 9 9 9', 'bomb'],
    ['SJ BJ', 'rocket'],
  ])('%s → %s', (text, type) => {
    expect(typeOf(text)).toBe(type)
  })

  it.each([
    ['顺子不能到 2', 'J Q K A 2'],
    ['顺子至少 5 张', '3 4 5 6'],
    ['不连续', '3 4 5 6 8'],
    ['连对至少 3 对', '3 3 4 4'],
    ['连对不能到 2', 'K K A A 2 2'],
    ['两张不同点数', '3 4'],
    ['三带二的二必须成对', 'K K K 3 4'],
    ['飞机不能带 2 的三张', 'A A A 2 2 2'],
    ['两张王以外的两张单牌', 'SJ 2'],
  ])('%s：%s 不是合法牌型', (_name, text) => {
    expect(classify(hand(text))).toBeNull()
  })

  it('同一组牌的多种读法都给出（333444555666：四连飞机 / 三连飞机带单）', () => {
    const all = classifyAll(hand('3 3 3 4 4 4 5 5 5 6 6 6'))
    expect(all.map((p) => p.type).sort()).toEqual(['plane', 'plane1', 'plane1'])
  })
})

describe('牌型比较', () => {
  const p = (text: string): Pattern => classify(hand(text))!

  it('同型同张数比主点数', () => {
    expect(beats(p('9'), p('8'))).toBe(true)
    expect(beats(p('8'), p('9'))).toBe(false)
    expect(beats(p('4 5 6 7 8'), p('3 4 5 6 7'))).toBe(true)
    expect(beats(p('4 4 4 9'), p('3 3 3 K'))).toBe(true)
  })

  it('不同类型或不同张数不能压', () => {
    expect(beats(p('9 9'), p('8'))).toBe(false)
    expect(beats(p('4 5 6 7 8 9'), p('3 4 5 6 7'))).toBe(false)
    expect(beats(p('K K K 3 3'), p('Q Q Q 3'))).toBe(false)
  })

  it('炸弹压一切非炸弹，炸弹之间比点数，王炸最大', () => {
    expect(beats(p('3 3 3 3'), p('10 J Q K A'))).toBe(true)
    expect(beats(p('4 4 4 4'), p('3 3 3 3'))).toBe(true)
    expect(beats(p('3 3 3 3'), p('4 4 4 4'))).toBe(false)
    expect(beats(p('SJ BJ'), p('2 2 2 2'))).toBe(true)
    expect(beats(p('2 2 2 2'), p('SJ BJ'))).toBe(false)
  })

  it('跟牌时取与上家同型的那种读法', () => {
    const top = p('3 3 3 4 4 4 7 9') // 三连以下的飞机带单
    const answer = asPlayAgainst(hand('5 5 5 6 6 6 8 10'), top)
    expect(answer?.type).toBe('plane1')
  })
})

describe('压牌枚举（提示与电脑用）', () => {
  it('单张：每个更大的点数给一种，按点数从小到大，炸弹排在后面', () => {
    const plays = beatingPlays(hand('3 5 5 9 K K K K'), classify(hand('4'))!)
    expect(plays.map((p) => p.type)).toEqual(['single', 'single', 'single', 'bomb'])
    expect(plays.map((p) => p.main)).toEqual([5, 9, 13, 13])
  })

  it('三带一挑最省的带牌：优先落单的小牌，不拆对子', () => {
    const plays = beatingPlays(hand('3 3 6 8 8 8'), classify(hand('5 5 5 4'))!)
    expect(plays).toHaveLength(1)
    expect(sortForDisplay(plays[0]!.cards).map(rankOf)).toEqual([8, 8, 8, 6])
  })

  it('顺子：同长度、更大的起点', () => {
    const plays = beatingPlays(hand('4 5 6 7 8 9 10'), classify(hand('3 4 5 6 7'))!)
    expect(plays.map((p) => p.main)).toEqual([4, 5, 6])
    expect(plays.every((p) => p.cards.length === 5)).toBe(true)
  })

  it('每种枚举结果本身都能压过上家（与识别一致）', () => {
    const tops = ['7', 'J J', '6 6 6 3', '4 4 4 9 9', '3 4 5 6 7', '3 3 4 4 5 5', '3 3 3 4 4 4 5 6', '5 5 5 5']
    const mine = hand('3 4 5 6 7 8 8 8 9 9 9 10 10 J Q Q K K A 2 2 SJ BJ').slice(0, 20)
    for (const text of tops) {
      const top = classify(hand(text))!
      for (const play of beatingPlays(mine, top)) {
        expect(asPlayAgainst(play.cards, top), `${text} ← ${play.type}`).not.toBeNull()
      }
    }
  })

  it('王炸之上没有任何压法', () => {
    expect(beatingPlays(hand('2 2 2 2 A'), classify(hand('SJ BJ'))!)).toEqual([])
  })
})

describe('拆牌', () => {
  const covers = (cards: CardId[], groups: Pattern[]): void => {
    const all = groups.flatMap((g) => g.cards).sort((a, b) => a - b)
    expect(all).toEqual([...cards].sort((a, b) => a - b))
    for (const g of groups) expect(classify(g.cards), g.type).not.toBeNull()
  }

  it('每组都是合法牌型，且正好覆盖整手牌', () => {
    for (const text of [
      '3 4 5 6 7 9 9 J J J K',
      '3 3 3 4 4 4 5 6 8 8 2 SJ BJ',
      '6 6 6 6 7 8 9 10 J Q 2 2',
      '3 3 4 4 5 5 9 A',
    ]) covers(hand(text), decompose(hand(text)))
  })

  it('顺子只在能消掉单牌时才拆：88 99 10 10 J J Q Q 不拆成两个顺子', () => {
    const groups = decompose(hand('8 8 9 9 10 10 J J Q Q'))
    expect(groups.map((g) => g.type)).toEqual(['pairStraight'])
  })

  it('三张会带上最小的单牌，不拿 2 和王当带牌', () => {
    const groups = decompose(hand('K K K 4 2 BJ'))
    expect(groups.find((g) => g.type === 'triple1')?.cards.map(rankOf).sort((a, b) => a - b)).toEqual([4, 13, 13, 13])
  })
})
