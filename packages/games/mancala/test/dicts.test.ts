/**
 * 字典对齐：中英基础 key 必须完全一致，且「视图/控件/统计/结果页」会取的 key 都能取到文案
 * （避免界面上冒出 ⟦key⟧）。
 */
import { describe, expect, it } from 'vitest'
import { baseKeys, compareDicts, coreDictEn, coreDictZh, createI18n, type Dict } from '@eink/core'
import { DIFFICULTY_IDS, mancalaEn, mancalaGame, mancalaZh } from '../src/index.js'
import { CELL_LABEL_KEYS } from '../src/view.js'
import { playToEnd } from './helpers.js'

const zh: Dict = { ...coreDictZh, ...mancalaZh }
const en: Dict = { ...coreDictEn, ...mancalaEn }
const i18nZh = createI18n('zh-CN', { 'zh-CN': zh, 'en-US': en })
const i18nEn = createI18n('en-US', { 'zh-CN': zh, 'en-US': en })

describe('中英字典对齐', () => {
  it('没有缺失、多余或复数形式不完整的 key', () => {
    expect(compareDicts({ 'zh-CN': zh, 'en-US': en })).toEqual([])
  })

  it('两边基础 key 集合完全一致', () => {
    expect([...baseKeys(mancalaZh)].sort()).toEqual([...baseKeys(mancalaEn)].sort())
  })

  it('英文复数形式齐备（中文只用 __other）', () => {
    for (const key of ['mancala.result.black', 'mancala.result.white', 'mancala.solved.best']) {
      expect(en[`${key}__other`], key).toBeDefined()
      expect(zh[`${key}__other`], key).toBeDefined()
    }
    for (const key of ['mancala.result.black', 'mancala.result.white']) {
      expect(en[`${key}__one`], key).toBeDefined()
    }
    expect(en['mancala.solved.best__one']).toBeDefined()
  })
})

describe('壳层会取的 key', () => {
  it('标题、规则、重开、非法提示、难度、统计、格子标签、胜负平标题都不缺', () => {
    const keys = [
      'mancala.title',
      'mancala.rules.body',
      'mancala.rules.body2',
      'mancala.rules.restart',
      'mancala.illegal.notice',
      'mancala.won.title',
      'mancala.lost.title',
      'mancala.draw.title',
      'mancala.stat.black',
      'mancala.stat.white',
      'mancala.stat.moves',
      'mancala.cell.floor',
      'mancala.cell.tile',
      'mancala.cell.number',
      ...DIFFICULTY_IDS.map((id) => `mancala.difficulty.${id}`),
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
    expect(i18nZh.t('mancala.solved.best', { count: 18 })).toContain('18')
    expect(i18nZh.t('mancala.solved.best', { count: 18 })).not.toMatch(/\{\w+\}/)
    expect(i18nEn.t('mancala.solved.best', { count: 1 })).not.toMatch(/\{\w+\}/)
    expect(i18nEn.t('mancala.solved.best', { count: 3 })).toContain('3')
  })

  it('结果明细走 plural，中英都不缺词', () => {
    expect(i18nZh.plural('mancala.result.black', 24, { count: 24 })).toContain('24')
    expect(i18nEn.plural('mancala.result.black', 1, { count: 1 })).toContain('1 stone')
    expect(i18nEn.plural('mancala.result.white', 24, { count: 24 })).toContain('24 stones')
    expect(i18nZh.plural('mancala.result.white', 24, { count: 24 })).toContain('24')
  })

  it('view / controls / stats / 难度 / 格子标签里出现的 key 都有两种语言的文案', () => {
    const state = mancalaGame.create(1, 'starter')
    const view = mancalaGame.view(state)
    const keys: string[] = [
      `${mancalaGame.i18nNamespace}.title`,
      `${mancalaGame.i18nNamespace}.rules.body`,
      `${mancalaGame.i18nNamespace}.rules.restart`,
      mancalaGame.illegalNoticeKey ?? '',
      ...view.stats.map((stat) => stat.labelKey),
      ...mancalaGame.controls(state).map((control) => control.labelKey),
      ...mancalaGame.difficulties.map((difficulty) => difficulty.labelKey),
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
    const state = playToEnd(5, 'starter', (current, index) =>
      mancalaGame.reduce(current, { type: 'sow', index }),
    )
    const result = mancalaGame.view(state).result!
    expect(i18nZh.t(result.titleKey)).not.toContain('⟦')
    expect(i18nEn.t(result.titleKey)).not.toContain('⟦')
    for (const detail of result.details) {
      expect(i18nZh.plural(detail.key, 24, detail.params)).not.toContain('⟦')
      expect(i18nEn.plural(detail.key, 1, detail.params)).not.toContain('⟦')
    }
  })

  it('格子无障碍标签覆盖本玩法用到的三种 kind', () => {
    for (const kind of ['floor', 'tile', 'number'] as const) {
      const key = CELL_LABEL_KEYS[kind]!
      expect(zh[key], kind).toBeDefined()
      expect(en[key], kind).toBeDefined()
    }
  })
})
