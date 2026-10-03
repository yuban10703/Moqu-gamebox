/**
 * 字典对齐：中英基础 key 必须完全一致，且「视图/控件/统计/结果页」会取的 key 都能取到文案
 * （避免界面上冒出 ⟦key⟧）。
 */
import { describe, expect, it } from 'vitest'
import { baseKeys, compareDicts, coreDictEn, coreDictZh, createI18n, type Dict } from '@eink/core'
import { ninemensEn, ninemensGame, ninemensZh } from '../src/index.js'
import { CELL_LABEL_KEYS } from '../src/view.js'
import { fixture } from './helpers.js'

const zh: Dict = { ...coreDictZh, ...ninemensZh }
const en: Dict = { ...coreDictEn, ...ninemensEn }
const i18nZh = createI18n('zh-CN', { 'zh-CN': zh, 'en-US': en })
const i18nEn = createI18n('en-US', { 'zh-CN': zh, 'en-US': en })

describe('中英字典对齐', () => {
  it('没有缺失、多余或复数形式不完整的 key', () => {
    expect(compareDicts({ 'zh-CN': zh, 'en-US': en })).toEqual([])
  })

  it('两边基础 key 集合完全一致', () => {
    expect([...baseKeys(ninemensZh)].sort()).toEqual([...baseKeys(ninemensEn)].sort())
  })

  it('英文复数形式齐备（中文只用 __other）', () => {
    for (const key of ['ninemens.result.moves', 'ninemens.result.captured', 'ninemens.solved.best']) {
      expect(en[`${key}__other`], key).toBeDefined()
      expect(zh[`${key}__other`], key).toBeDefined()
    }
    for (const key of ['ninemens.result.moves', 'ninemens.result.captured']) {
      expect(en[`${key}__one`], key).toBeDefined()
    }
    expect(en['ninemens.solved.best__one']).toBeDefined()
  })
})

describe('壳层会取的 key', () => {
  it('标题、规则、重开、非法提示、难度、统计、格子标签、胜负标题都不缺', () => {
    const keys = [
      'ninemens.title',
      'ninemens.rules.body',
      'ninemens.rules.body2',
      'ninemens.rules.restart',
      'ninemens.illegal.notice',
      'ninemens.won.title',
      'ninemens.lost.title',
      'ninemens.stat.black',
      'ninemens.stat.white',
      'ninemens.stat.hand',
      'ninemens.cell.wall',
      'ninemens.cell.empty',
      'ninemens.cell.tile',
      'ninemens.cell.number',
      'ninemens.difficulty.starter',
      'ninemens.difficulty.skilled',
      'ninemens.difficulty.challenging',
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
    expect(i18nZh.t('ninemens.solved.best', { count: 30 })).toContain('30')
    expect(i18nZh.t('ninemens.solved.best', { count: 30 })).not.toMatch(/\{\w+\}/)
    expect(i18nEn.t('ninemens.solved.best', { count: 1 })).not.toMatch(/\{\w+\}/)
    expect(i18nEn.t('ninemens.solved.best', { count: 3 })).toContain('3')
  })

  it('结果明细走 plural，中英都不缺词', () => {
    expect(i18nZh.plural('ninemens.result.moves', 30, { count: 30 })).toContain('30')
    expect(i18nEn.plural('ninemens.result.moves', 1, { count: 1 })).toContain('1 move')
    expect(i18nEn.plural('ninemens.result.captured', 3, { count: 3 })).toContain('3 enemy stones')
    expect(i18nZh.plural('ninemens.result.captured', 3, { count: 3 })).toContain('3')
  })

  it('view / controls / stats / 难度 / 格子标签里出现的 key 都有两种语言的文案', () => {
    const state = ninemensGame.create(1, 'starter')
    const view = ninemensGame.view(state)
    const keys: string[] = [
      `${ninemensGame.i18nNamespace}.title`,
      `${ninemensGame.i18nNamespace}.rules.body`,
      `${ninemensGame.i18nNamespace}.rules.restart`,
      ninemensGame.illegalNoticeKey ?? '',
      ...view.stats.map((stat) => stat.labelKey),
      ...ninemensGame.controls(state).map((control) => control.labelKey),
      ...ninemensGame.difficulties.map((difficulty) => difficulty.labelKey),
      ...(Object.values(CELL_LABEL_KEYS).filter(Boolean) as string[]),
    ]
    for (const key of keys) {
      expect(i18nZh.t(key), key).not.toContain('⟦')
      expect(i18nEn.t(key), key).not.toContain('⟦')
    }
    expect(i18nZh.missingKeys()).toEqual([])
    expect(i18nEn.missingKeys()).toEqual([])
  })

  it('结果标题与明细的 key 都能取到（真实的「对手被堵死」局面）', () => {
    const state = fixture([0, 5, 9, 10, 11], [1, 2, 3, 4], {
      inHand: { black: 0, white: 0 },
      removed: { black: 4, white: 5 },
      turn: 'white',
    })
    const result = ninemensGame.view(state).result!
    expect(i18nZh.t(result.titleKey)).not.toContain('⟦')
    expect(i18nEn.t(result.titleKey)).not.toContain('⟦')
    for (const detail of result.details) {
      expect(i18nZh.plural(detail.key, 3, detail.params)).not.toContain('⟦')
      expect(i18nEn.plural(detail.key, 1, detail.params)).not.toContain('⟦')
    }
  })

  it('格子无障碍标签覆盖本玩法用到的四种 kind', () => {
    for (const kind of ['wall', 'empty', 'tile', 'number'] as const) {
      const key = CELL_LABEL_KEYS[kind]!
      expect(zh[key], kind).toBeDefined()
      expect(en[key], kind).toBeDefined()
    }
  })
})
