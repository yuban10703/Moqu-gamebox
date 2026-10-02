/**
 * 字典对齐：中英基础 key 必须完全一致，且「视图/控件/格子标签/壳层」会取的 key 都能取到文案
 * （避免界面上冒出 ⟦key⟧）。
 */
import { describe, expect, it } from 'vitest'
import { baseKeys, compareDicts, coreDictEn, coreDictZh, createI18n, type Dict } from '@eink/core'
import { DIFFICULTY_IDS, fifteenEn, fifteenGame, fifteenZh } from '../src/index.js'
import { CELL_LABEL_KEYS } from '../src/view.js'
import { fixtureState } from './helpers.js'

const zh: Dict = { ...coreDictZh, ...fifteenZh }
const en: Dict = { ...coreDictEn, ...fifteenEn }
const i18nZh = createI18n('zh-CN', { 'zh-CN': zh, 'en-US': en })
const i18nEn = createI18n('en-US', { 'zh-CN': zh, 'en-US': en })

describe('中英字典对齐', () => {
  it('没有缺失、多余或复数形式不完整的 key', () => {
    expect(compareDicts({ 'zh-CN': zh, 'en-US': en })).toEqual([])
  })

  it('两边基础 key 集合完全一致', () => {
    expect([...baseKeys(fifteenZh)].sort()).toEqual([...baseKeys(fifteenEn)].sort())
  })

  it('英文复数形式齐备（中文只用 __other）', () => {
    for (const key of ['fifteen.result.moves', 'fifteen.result.tiles', 'fifteen.solved.best']) {
      expect(en[`${key}__other`], key).toBeDefined()
      expect(zh[`${key}__other`], key).toBeDefined()
    }
    for (const key of ['fifteen.result.moves', 'fifteen.result.tiles']) {
      expect(en[`${key}__one`], key).toBeDefined()
    }
  })
})

describe('壳层会取的 key', () => {
  it('标题、规则、重开、非法提示、难度、方向盘、格子标签都不缺', () => {
    const keys = [
      'fifteen.title',
      'fifteen.rules.body',
      'fifteen.rules.body2',
      'fifteen.rules.restart',
      'fifteen.illegal.notice',
      'fifteen.dpad.label',
      'fifteen.dir.up',
      'fifteen.dir.down',
      'fifteen.dir.left',
      'fifteen.dir.right',
      'fifteen.won.title',
      'fifteen.stat.moves',
      'fifteen.stat.placed',
      'fifteen.cell.tile',
      'fifteen.cell.empty',
      ...DIFFICULTY_IDS.map((id) => `fifteen.difficulty.${id}`),
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
    expect(i18nZh.t('fifteen.solved.best', { count: 12 })).toContain('12')
    expect(i18nZh.t('fifteen.solved.best', { count: 12 })).not.toMatch(/\{\w+\}/)
    expect(i18nEn.t('fifteen.solved.best', { count: 1 })).not.toMatch(/\{\w+\}/)
    expect(i18nEn.t('fifteen.solved.best', { count: 3 })).toContain('3')
  })

  it('结果明细走 plural，中英都不缺词', () => {
    expect(i18nZh.plural('fifteen.result.moves', 40, { count: 40 })).toContain('40')
    expect(i18nEn.plural('fifteen.result.moves', 1, { count: 1 })).toContain('1 move')
    expect(i18nEn.plural('fifteen.result.tiles', 15, { count: 15 })).toContain('15 tiles')
    expect(i18nZh.plural('fifteen.result.tiles', 15, { count: 15 })).toContain('15')
  })

  it('view / controls / stats / 难度 / 格子标签里出现的 key 都有两种语言的文案', () => {
    const state = fifteenGame.create(1, 'starter')
    const view = fifteenGame.view(state)
    const keys: string[] = [
      `${fifteenGame.i18nNamespace}.title`,
      `${fifteenGame.i18nNamespace}.rules.body`,
      `${fifteenGame.i18nNamespace}.rules.restart`,
      `${fifteenGame.i18nNamespace}.dpad.label`,
      fifteenGame.illegalNoticeKey ?? '',
      ...view.stats.map((stat) => stat.labelKey),
      ...fifteenGame.controls(state).map((control) => control.labelKey),
      ...fifteenGame.difficulties.map((difficulty) => difficulty.labelKey),
      ...(Object.values(CELL_LABEL_KEYS).filter(Boolean) as string[]),
    ]
    for (const key of keys) {
      expect(i18nZh.t(key), key).not.toContain('⟦')
      expect(i18nEn.t(key), key).not.toContain('⟦')
    }
    expect(i18nZh.missingKeys()).toEqual([])
    expect(i18nEn.missingKeys()).toEqual([])
  })

  it('结果标题的 key 也能取到（还原局面）', () => {
    const won = fixtureState([1, 2, 3, 4, 5, 6, 7, 8, 0], { moves: 20 })
    const result = fifteenGame.view(won).result!
    expect(i18nZh.t(result.titleKey)).not.toContain('⟦')
    expect(i18nEn.t(result.titleKey)).not.toContain('⟦')
    for (const detail of result.details) {
      expect(i18nZh.plural(detail.key, 8, detail.params)).not.toContain('⟦')
      expect(i18nEn.plural(detail.key, 1, detail.params)).not.toContain('⟦')
    }
  })

  it('格子无障碍标签覆盖本玩法用到的两种 kind', () => {
    for (const kind of ['tile', 'empty'] as const) {
      const key = CELL_LABEL_KEYS[kind]!
      expect(zh[key], kind).toBeDefined()
      expect(en[key], kind).toBeDefined()
    }
  })
})
