/**
 * 字典对齐：中英基础 key 必须完全一致，且「视图/控件/格子标签/壳层」会取的 key 都能取到文案
 * （避免界面上冒出 ⟦key⟧）。
 */
import { describe, expect, it } from 'vitest'
import { baseKeys, compareDicts, coreDictEn, coreDictZh, createI18n, type Dict } from '@eink/core'
import {
  DIFFICULTY_IDS,
  cellCount,
  configFor,
  lightsoutEn,
  lightsoutGame,
  lightsoutZh,
} from '../src/index.js'
import { CELL_LABEL_KEYS } from '../src/view.js'
import { allOff, fixtureState, fresh } from './helpers.js'

const zh: Dict = { ...coreDictZh, ...lightsoutZh }
const en: Dict = { ...coreDictEn, ...lightsoutEn }
const i18nZh = createI18n('zh-CN', { 'zh-CN': zh, 'en-US': en })
const i18nEn = createI18n('en-US', { 'zh-CN': zh, 'en-US': en })

describe('中英字典对齐', () => {
  it('没有缺失、多余或复数形式不完整的 key', () => {
    expect(compareDicts({ 'zh-CN': zh, 'en-US': en })).toEqual([])
  })

  it('两边基础 key 集合完全一致', () => {
    expect([...baseKeys(lightsoutZh)].sort()).toEqual([...baseKeys(lightsoutEn)].sort())
  })

  it('英文复数形式齐备（中文只用 __other）', () => {
    for (const key of ['lightsout.result.moves', 'lightsout.result.lights', 'lightsout.solved.best']) {
      expect(en[`${key}__other`], key).toBeDefined()
      expect(zh[`${key}__other`], key).toBeDefined()
    }
    for (const key of ['lightsout.result.moves', 'lightsout.result.lights']) {
      expect(en[`${key}__one`], key).toBeDefined()
    }
  })
})

describe('壳层会取的 key', () => {
  it('标题、规则、重开、非法提示、难度、统计、格子标签都不缺', () => {
    const keys = [
      'lightsout.title',
      'lightsout.rules.body',
      'lightsout.rules.body2',
      'lightsout.rules.restart',
      'lightsout.illegal.notice',
      'lightsout.won.title',
      'lightsout.stat.moves',
      'lightsout.stat.off',
      'lightsout.stat.total',
      'lightsout.cell.tile',
      'lightsout.cell.empty',
      ...DIFFICULTY_IDS.map((id) => `lightsout.difficulty.${id}`),
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
    expect(i18nZh.t('lightsout.solved.best', { count: 7 })).toContain('7')
    expect(i18nZh.t('lightsout.solved.best', { count: 7 })).not.toMatch(/\{\w+\}/)
    expect(i18nEn.t('lightsout.solved.best', { count: 1 })).not.toMatch(/\{\w+\}/)
    expect(i18nEn.t('lightsout.solved.best', { count: 3 })).toContain('3')
  })

  it('结果明细走 plural，中英都不缺词', () => {
    expect(i18nZh.plural('lightsout.result.moves', 12, { count: 12 })).toContain('12')
    expect(i18nEn.plural('lightsout.result.moves', 1, { count: 1 })).toContain('1 move')
    expect(i18nEn.plural('lightsout.result.lights', 25, { count: 25 })).toContain('25 lights')
    expect(i18nZh.plural('lightsout.result.lights', 25, { count: 25 })).toContain('25')
  })

  it('view / controls / stats / 难度 / 格子标签里出现的 key 都有两种语言的文案', () => {
    const state = lightsoutGame.create(1, 'starter')
    const view = lightsoutGame.view(state)
    const keys: string[] = [
      `${lightsoutGame.i18nNamespace}.title`,
      `${lightsoutGame.i18nNamespace}.rules.body`,
      `${lightsoutGame.i18nNamespace}.rules.restart`,
      lightsoutGame.illegalNoticeKey ?? '',
      ...view.stats.map((stat) => stat.labelKey),
      ...lightsoutGame.controls(state).map((control) => control.labelKey),
      ...lightsoutGame.difficulties.map((difficulty) => difficulty.labelKey),
      ...(Object.values(CELL_LABEL_KEYS).filter(Boolean) as string[]),
    ]
    for (const key of keys) {
      expect(i18nZh.t(key), key).not.toContain('⟦')
      expect(i18nEn.t(key), key).not.toContain('⟦')
    }
    expect(i18nZh.missingKeys()).toEqual([])
    expect(i18nEn.missingKeys()).toEqual([])
  })

  it('结果标题与明细的 key 都能取到（全灭局面）', () => {
    const size = configFor('starter').size
    const won = fixtureState(allOff(size), { difficulty: 'starter', moves: 6 })
    const result = lightsoutGame.view(won).result!
    expect(i18nZh.t(result.titleKey)).not.toContain('⟦')
    expect(i18nEn.t(result.titleKey)).not.toContain('⟦')
    for (const detail of result.details) {
      expect(i18nZh.plural(detail.key, 25, detail.params)).not.toContain('⟦')
      expect(i18nEn.plural(detail.key, 1, detail.params)).not.toContain('⟦')
    }
    expect(cellCount(configFor('starter'))).toBe(25)
    // 顺带确认真实初始局面确实是「未解开」的（结果面板不该一开局就出现）
    expect(lightsoutGame.view(fresh()).result).toBeNull()
  })

  it('格子无障碍标签覆盖本玩法用到的两种 kind', () => {
    for (const kind of ['tile', 'empty'] as const) {
      const key = CELL_LABEL_KEYS[kind]!
      expect(zh[key], kind).toBeDefined()
      expect(en[key], kind).toBeDefined()
    }
  })
})
