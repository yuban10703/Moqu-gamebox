/**
 * 字典对齐：中英基础 key 必须完全一致，且「视图/控件/格子标签/壳层」会取的 key 都能取到文案
 * （避免界面上冒出 ⟦key⟧）。
 */
import { describe, expect, it } from 'vitest'
import { baseKeys, compareDicts, coreDictEn, coreDictZh, createI18n, type Dict } from '@eink/core'
import {
  DIFFICULTY_IDS,
  DRAW_PLIES,
  checkersEn,
  checkersGame,
  checkersZh,
  indexOf,
} from '../src/index.js'
import { CELL_LABEL_KEYS } from '../src/view.js'
import { boardFromRows, fixtureState, fresh } from './helpers.js'

const zh: Dict = { ...coreDictZh, ...checkersZh }
const en: Dict = { ...coreDictEn, ...checkersEn }
const i18nZh = createI18n('zh-CN', { 'zh-CN': zh, 'en-US': en })
const i18nEn = createI18n('en-US', { 'zh-CN': zh, 'en-US': en })

describe('中英字典对齐', () => {
  it('没有缺失、多余或复数形式不完整的 key', () => {
    expect(compareDicts({ 'zh-CN': zh, 'en-US': en })).toEqual([])
  })

  it('两边基础 key 集合完全一致', () => {
    expect([...baseKeys(checkersZh)].sort()).toEqual([...baseKeys(checkersEn)].sort())
  })

  it('英文复数形式齐备（中文只用 __other）', () => {
    for (const key of [
      'checkers.result.black',
      'checkers.result.white',
      'checkers.result.moves',
      'checkers.solved.best',
    ]) {
      expect(en[`${key}__other`], key).toBeDefined()
      expect(zh[`${key}__other`], key).toBeDefined()
    }
    for (const key of ['checkers.result.black', 'checkers.result.white', 'checkers.result.moves']) {
      expect(en[`${key}__one`], key).toBeDefined()
    }
    expect(en['checkers.solved.best__one']).toBeDefined()
  })
})

describe('壳层会取的 key', () => {
  it('标题、规则、重开、非法提示、难度、统计、格子标签、结果标题都不缺', () => {
    const keys = [
      'checkers.title',
      'checkers.rules.body',
      'checkers.rules.body2',
      'checkers.rules.restart',
      'checkers.illegal.notice',
      'checkers.won.title',
      'checkers.lost.title',
      'checkers.draw.title',
      'checkers.stat.black',
      'checkers.stat.white',
      'checkers.stat.moves',
      'checkers.cell.wall',
      'checkers.cell.empty',
      'checkers.cell.tile',
      ...DIFFICULTY_IDS.map((id) => `checkers.difficulty.${id}`),
    ]
    for (const key of keys) {
      expect(zh[key], key).toBeDefined()
      expect(en[key], key).toBeDefined()
      expect(i18nZh.t(key), key).not.toContain('⟦')
      expect(i18nEn.t(key), key).not.toContain('⟦')
      expect(i18nZh.t(key), key).not.toMatch(/\{\w+\}/)
      expect(i18nEn.t(key), key).not.toMatch(/\{\w+\}/)
    }
    expect(i18nZh.missingKeys()).toEqual([])
    expect(i18nEn.missingKeys()).toEqual([])
  })

  it('规则文案里写明了「吃子必须吃」这条核心规则（中英都给用户看）', () => {
    expect(zh['checkers.rules.body']).toContain('必须吃')
    expect(en['checkers.rules.body']!.toLowerCase()).toContain('compulsory')
  })

  it('「该难度最佳」由壳层带 {count} 取，两种语言都给出完整句子', () => {
    expect(i18nZh.t('checkers.solved.best', { count: 24 })).toContain('24')
    expect(i18nZh.t('checkers.solved.best', { count: 24 })).not.toMatch(/\{\w+\}/)
    expect(i18nEn.t('checkers.solved.best', { count: 1 })).not.toMatch(/\{\w+\}/)
    expect(i18nEn.t('checkers.solved.best', { count: 3 })).toContain('3')
  })

  it('结果明细走 plural，中英都不缺词', () => {
    expect(i18nZh.plural('checkers.result.black', 10, { count: 10 })).toContain('10')
    expect(i18nEn.plural('checkers.result.black', 1, { count: 1 })).toContain('1 black piece')
    expect(i18nEn.plural('checkers.result.white', 3, { count: 3 })).toContain('3 white pieces')
    expect(i18nEn.plural('checkers.result.moves', 1, { count: 1 })).toContain('1 move')
    expect(i18nZh.plural('checkers.result.moves', 24, { count: 24 })).toContain('24')
  })

  it('view / controls / stats / 难度 / 格子标签里出现的 key 都有两种语言的文案', () => {
    const state = checkersGame.create(1, 'starter')
    const view = checkersGame.view(state)
    const keys: string[] = [
      `${checkersGame.i18nNamespace}.title`,
      `${checkersGame.i18nNamespace}.rules.body`,
      `${checkersGame.i18nNamespace}.rules.restart`,
      checkersGame.illegalNoticeKey ?? '',
      ...view.stats.map((stat) => stat.labelKey),
      ...checkersGame.controls(state).map((control) => control.labelKey),
      ...checkersGame.difficulties.map((difficulty) => difficulty.labelKey),
      ...(Object.values(CELL_LABEL_KEYS).filter(Boolean) as string[]),
    ]
    for (const key of keys) {
      expect(i18nZh.t(key), key).not.toContain('⟦')
      expect(i18nEn.t(key), key).not.toContain('⟦')
    }
    expect(i18nZh.missingKeys()).toEqual([])
    expect(i18nEn.missingKeys()).toEqual([])
  })

  it('三种结果标题与明细的 key 都能取到', () => {
    const won = fixtureState(boardFromRows(['.b......']))
    const lost = fixtureState(boardFromRows(['.w......']))
    const draw = fixtureState(
      boardFromRows(['........', '........', '.b......', '........', '.w......']),
      { noProgressPlies: DRAW_PLIES },
    )
    for (const state of [won, lost, draw]) {
      const result = checkersGame.view(state).result!
      expect(i18nZh.t(result.titleKey)).not.toContain('⟦')
      expect(i18nEn.t(result.titleKey)).not.toContain('⟦')
      for (const detail of result.details) {
        expect(i18nZh.plural(detail.key, 12, detail.params)).not.toContain('⟦')
        expect(i18nEn.plural(detail.key, 1, detail.params)).not.toContain('⟦')
      }
    }
    expect(indexOf(0, 1)).toBe(1)
    expect(checkersGame.view(fresh()).result).toBeNull()
  })

  it('格子无障碍标签覆盖本玩法用到的三种 kind', () => {
    for (const kind of ['wall', 'empty', 'tile'] as const) {
      const key = CELL_LABEL_KEYS[kind]!
      expect(zh[key], kind).toBeDefined()
      expect(en[key], kind).toBeDefined()
    }
  })
})
