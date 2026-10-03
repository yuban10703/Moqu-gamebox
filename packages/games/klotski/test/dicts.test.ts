/**
 * 字典对齐：中英基础 key 必须完全一致，且「视图/控件/统计/关卡标题/结果页」会取的 key 都能取到文案
 * （避免界面上冒出 ⟦key⟧）。
 */
import { describe, expect, it } from 'vitest'
import { baseKeys, compareDicts, coreDictEn, coreDictZh, createI18n, type Dict } from '@eink/core'
import {
  CELLS,
  DIFFICULTY_IDS,
  PACK,
  klotskiEn,
  klotskiGame,
  klotskiZh,
} from '../src/index.js'
import { CELL_LABEL_KEYS } from '../src/view.js'

const zh: Dict = { ...coreDictZh, ...klotskiZh }
const en: Dict = { ...coreDictEn, ...klotskiEn }
const i18nZh = createI18n('zh-CN', { 'zh-CN': zh, 'en-US': en })
const i18nEn = createI18n('en-US', { 'zh-CN': zh, 'en-US': en })

describe('中英字典对齐', () => {
  it('没有缺失、多余或复数形式不完整的 key', () => {
    expect(compareDicts({ 'zh-CN': zh, 'en-US': en })).toEqual([])
  })

  it('两边基础 key 集合完全一致', () => {
    expect([...baseKeys(klotskiZh)].sort()).toEqual([...baseKeys(klotskiEn)].sort())
  })

  it('英文复数形式齐备（中文只用 __other）', () => {
    for (const key of ['klotski.result.moves', 'klotski.result.target', 'klotski.solved.best']) {
      expect(en[`${key}__other`], key).toBeDefined()
      expect(zh[`${key}__other`], key).toBeDefined()
    }
    for (const key of ['klotski.result.moves', 'klotski.result.target']) {
      expect(en[`${key}__one`], key).toBeDefined()
    }
  })
})

describe('壳层会取的 key', () => {
  it('标题、规则、重开、非法提示、难度、统计、格子标签、关卡标题都不缺', () => {
    const keys = [
      'klotski.title',
      'klotski.rules.body',
      'klotski.rules.body2',
      'klotski.rules.restart',
      'klotski.illegal.notice',
      'klotski.won.title',
      'klotski.level.label',
      'klotski.level.position',
      'klotski.level.last',
      'klotski.stat.moves',
      'klotski.stat.level',
      'klotski.stat.target',
      'klotski.cell.empty',
      'klotski.cell.goal',
      'klotski.cell.tile',
      ...DIFFICULTY_IDS.map((id) => `klotski.difficulty.${id}`),
    ]
    for (const key of keys) {
      expect(zh[key], key).toBeDefined()
      expect(en[key], key).toBeDefined()
      expect(i18nZh.t(key), key).not.toContain('⟦')
      expect(i18nEn.t(key), key).not.toContain('⟦')
    }
    // 关卡位置由壳层带 {index}/{total} 取
    expect(i18nZh.t('klotski.level.position', { index: 1, total: 4 })).toBe('第 1/4 关')
    expect(i18nEn.t('klotski.level.position', { index: 2, total: 4 })).toBe('Level 2/4')
    // 不带参数的统计/标签类文案不能残留插值占位
    for (const key of [
      'klotski.stat.moves',
      'klotski.stat.level',
      'klotski.stat.target',
      'klotski.cell.empty',
      'klotski.cell.goal',
      'klotski.cell.tile',
      'klotski.won.title',
      'klotski.illegal.notice',
    ]) {
      expect(i18nZh.t(key), key).not.toMatch(/\{\w+\}/)
      expect(i18nEn.t(key), key).not.toMatch(/\{\w+\}/)
    }
    expect(i18nZh.missingKeys()).toEqual([])
    expect(i18nEn.missingKeys()).toEqual([])
  })

  it('「该难度最佳」由壳层带 {count} 取，两种语言都给出完整句子', () => {
    expect(i18nZh.t('klotski.solved.best', { count: 116 })).toContain('116')
    expect(i18nZh.t('klotski.solved.best', { count: 116 })).not.toMatch(/\{\w+\}/)
    expect(i18nEn.t('klotski.solved.best', { count: 1 })).not.toMatch(/\{\w+\}/)
    expect(i18nEn.t('klotski.solved.best', { count: 3 })).toContain('3')
  })

  it('结果明细走 plural，中英都不缺词', () => {
    expect(i18nZh.plural('klotski.result.moves', 116, { count: 116 })).toContain('116')
    expect(i18nEn.plural('klotski.result.moves', 1, { count: 1 })).toContain('1 move')
    expect(i18nEn.plural('klotski.result.target', 99, { count: 99 })).toContain('99 moves')
    expect(i18nZh.plural('klotski.result.target', 99, { count: 99 })).toContain('99')
  })

  it('view / controls / stats / 难度 / 格子标签里出现的 key 都有两种语言的文案', () => {
    const state = klotskiGame.create(0, 'starter')
    const view = klotskiGame.view(state)
    const keys: string[] = [
      `${klotskiGame.i18nNamespace}.title`,
      `${klotskiGame.i18nNamespace}.rules.body`,
      `${klotskiGame.i18nNamespace}.rules.restart`,
      klotskiGame.illegalNoticeKey ?? '',
      ...view.stats.map((stat) => stat.labelKey),
      ...klotskiGame.controls(state).map((control) => control.labelKey),
      ...klotskiGame.difficulties.map((difficulty) => difficulty.labelKey),
      ...(Object.values(CELL_LABEL_KEYS).filter(Boolean) as string[]),
    ]
    for (const key of keys) {
      expect(i18nZh.t(key), key).not.toContain('⟦')
      expect(i18nEn.t(key), key).not.toContain('⟦')
    }
    expect(i18nZh.missingKeys()).toEqual([])
    expect(i18nEn.missingKeys()).toEqual([])
  })

  it('关卡序号用整包序号，四种字形都在字典里（格子无障碍标签覆盖三种 kind）', () => {
    expect(PACK.map((level) => level.index)).toEqual([1, 2, 3, 4])
    expect(CELLS).toBe(20)
    for (const kind of ['empty', 'goal', 'tile'] as const) {
      const key = CELL_LABEL_KEYS[kind]!
      expect(zh[key], kind).toBeDefined()
      expect(en[key], kind).toBeDefined()
    }
  })
})
