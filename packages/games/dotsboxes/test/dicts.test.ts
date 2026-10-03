/**
 * 字典对齐：中英基础 key 必须完全一致，且「视图/控件/统计/结果页」会取的 key 都能取到文案
 * （避免界面上冒出 ⟦key⟧）。
 */
import { describe, expect, it } from 'vitest'
import { baseKeys, compareDicts, coreDictEn, coreDictZh, createI18n, type Dict } from '@eink/core'
import {
  DIFFICULTY_IDS,
  dotsboxesEn,
  dotsboxesGame,
  dotsboxesZh,
  openEdges,
} from '../src/index.js'
import { CELL_LABEL_KEYS } from '../src/view.js'

const zh: Dict = { ...coreDictZh, ...dotsboxesZh }
const en: Dict = { ...coreDictEn, ...dotsboxesEn }
const i18nZh = createI18n('zh-CN', { 'zh-CN': zh, 'en-US': en })
const i18nEn = createI18n('en-US', { 'zh-CN': zh, 'en-US': en })

describe('中英字典对齐', () => {
  it('没有缺失、多余或复数形式不完整的 key', () => {
    expect(compareDicts({ 'zh-CN': zh, 'en-US': en })).toEqual([])
  })

  it('两边基础 key 集合完全一致', () => {
    expect([...baseKeys(dotsboxesZh)].sort()).toEqual([...baseKeys(dotsboxesEn)].sort())
  })

  it('英文复数形式齐备（中文只用 __other）', () => {
    for (const key of ['dotsboxes.result.black', 'dotsboxes.result.white', 'dotsboxes.solved.best']) {
      expect(en[`${key}__other`], key).toBeDefined()
      expect(zh[`${key}__other`], key).toBeDefined()
    }
    for (const key of ['dotsboxes.result.black', 'dotsboxes.result.white']) {
      expect(en[`${key}__one`], key).toBeDefined()
    }
    expect(en['dotsboxes.solved.best__one']).toBeDefined()
  })
})

describe('壳层会取的 key', () => {
  it('标题、规则、重开、非法提示、难度、统计、格子标签、三种结果标题都不缺', () => {
    const keys = [
      'dotsboxes.title',
      'dotsboxes.rules.body',
      'dotsboxes.rules.body2',
      'dotsboxes.rules.restart',
      'dotsboxes.illegal.notice',
      'dotsboxes.won.title',
      'dotsboxes.lost.title',
      'dotsboxes.draw.title',
      'dotsboxes.stat.black',
      'dotsboxes.stat.white',
      'dotsboxes.stat.remaining',
      'dotsboxes.cell.wall',
      'dotsboxes.cell.empty',
      'dotsboxes.cell.floor',
      'dotsboxes.cell.tile',
      ...DIFFICULTY_IDS.map((id) => `dotsboxes.difficulty.${id}`),
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

  it('「该难度最佳」由壳层带 {count} 取，两种语言都给出完整句子', () => {
    expect(i18nZh.t('dotsboxes.solved.best', { count: 12 })).toContain('12')
    expect(i18nZh.t('dotsboxes.solved.best', { count: 12 })).not.toMatch(/\{\w+\}/)
    expect(i18nEn.t('dotsboxes.solved.best', { count: 1 })).not.toMatch(/\{\w+\}/)
    expect(i18nEn.t('dotsboxes.solved.best', { count: 3 })).toContain('3')
  })

  it('结果明细走 plural，中英都不缺词', () => {
    expect(i18nZh.plural('dotsboxes.result.black', 5, { count: 5 })).toContain('5')
    expect(i18nEn.plural('dotsboxes.result.black', 1, { count: 1 })).toContain('1 black box')
    expect(i18nEn.plural('dotsboxes.result.white', 5, { count: 5 })).toContain('5 white boxes')
    expect(i18nZh.plural('dotsboxes.result.white', 5, { count: 5 })).toContain('5')
  })

  it('view / controls / stats / 难度 / 格子标签里出现的 key 都有两种语言的文案', () => {
    const state = dotsboxesGame.create(1, 'starter')
    const view = dotsboxesGame.view(state)
    const keys: string[] = [
      `${dotsboxesGame.i18nNamespace}.title`,
      `${dotsboxesGame.i18nNamespace}.rules.body`,
      `${dotsboxesGame.i18nNamespace}.rules.restart`,
      dotsboxesGame.illegalNoticeKey ?? '',
      ...view.stats.map((stat) => stat.labelKey),
      ...dotsboxesGame.controls(state).map((control) => control.labelKey),
      ...dotsboxesGame.difficulties.map((difficulty) => difficulty.labelKey),
      ...(Object.values(CELL_LABEL_KEYS).filter(Boolean) as string[]),
    ]
    for (const key of keys) {
      expect(i18nZh.t(key), key).not.toContain('⟦')
      expect(i18nEn.t(key), key).not.toContain('⟦')
    }
    expect(i18nZh.missingKeys()).toEqual([])
    expect(i18nEn.missingKeys()).toEqual([])
  })

  it('结果标题与明细的 key 都能取到（真实终局）', () => {
    let state = dotsboxesGame.create(5, 'starter')
    let guard = 0
    while (dotsboxesGame.status(state) === 'playing' && guard++ < 200) {
      const edges = openEdges(state)
      state = dotsboxesGame.reduce(state, { type: 'claim', index: edges[0]! })
    }
    const result = dotsboxesGame.view(state).result!
    expect(i18nZh.t(result.titleKey)).not.toContain('⟦')
    expect(i18nEn.t(result.titleKey)).not.toContain('⟦')
    for (const detail of result.details) {
      expect(i18nZh.plural(detail.key, 5, detail.params)).not.toContain('⟦')
      expect(i18nEn.plural(detail.key, 1, detail.params)).not.toContain('⟦')
    }
  })

  it('格子无障碍标签覆盖本玩法用到的四种 kind', () => {
    for (const kind of ['wall', 'empty', 'floor', 'tile'] as const) {
      const key = CELL_LABEL_KEYS[kind]!
      expect(zh[key], kind).toBeDefined()
      expect(en[key], kind).toBeDefined()
    }
  })
})
