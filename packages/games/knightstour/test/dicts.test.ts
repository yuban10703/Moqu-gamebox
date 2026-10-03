/**
 * 字典对齐：中英基础 key 必须完全一致，且「视图/控件/统计/结果页/提示」会取的 key 都能取到文案
 * （避免界面上冒出 ⟦key⟧）。
 */
import { describe, expect, it } from 'vitest'
import { baseKeys, compareDicts, coreDictEn, coreDictZh, createI18n, type Dict } from '@eink/core'
import {
  CELLS,
  DIFFICULTY_IDS,
  knightstourEn,
  knightstourGame,
  knightstourZh,
} from '../src/index.js'
import { CELL_LABEL_KEYS } from '../src/view.js'
import { solveKnightTour } from './helpers.js'

const zh: Dict = { ...coreDictZh, ...knightstourZh }
const en: Dict = { ...coreDictEn, ...knightstourEn }
const i18nZh = createI18n('zh-CN', { 'zh-CN': zh, 'en-US': en })
const i18nEn = createI18n('en-US', { 'zh-CN': zh, 'en-US': en })

describe('中英字典对齐', () => {
  it('没有缺失、多余或复数形式不完整的 key', () => {
    expect(compareDicts({ 'zh-CN': zh, 'en-US': en })).toEqual([])
  })

  it('两边基础 key 集合完全一致', () => {
    expect([...baseKeys(knightstourZh)].sort()).toEqual([...baseKeys(knightstourEn)].sort())
  })

  it('英文复数形式齐备（中文只用 __other）', () => {
    for (const key of ['knightstour.result.moves', 'knightstour.result.visited', 'knightstour.solved.best']) {
      expect(en[`${key}__other`], key).toBeDefined()
      expect(zh[`${key}__other`], key).toBeDefined()
    }
    for (const key of ['knightstour.result.moves', 'knightstour.result.visited']) {
      expect(en[`${key}__one`], key).toBeDefined()
    }
    expect(en['knightstour.solved.best__one']).toBeDefined()
  })
})

describe('壳层会取的 key', () => {
  it('标题、规则、重开、非法提示、难度、统计、格子标签、提示开关与提示文案都不缺', () => {
    const keys = [
      'knightstour.title',
      'knightstour.rules.body',
      'knightstour.rules.body2',
      'knightstour.rules.restart',
      'knightstour.illegal.notice',
      'knightstour.won.title',
      'knightstour.stat.moves',
      'knightstour.stat.visited',
      'knightstour.stat.start',
      'knightstour.cell.floor',
      'knightstour.cell.player',
      'knightstour.cell.goal',
      'knightstour.cell.number',
      'knightstour.control.hint.on',
      'knightstour.control.hint.off',
      'knightstour.notice.hint',
      ...DIFFICULTY_IDS.map((id) => `knightstour.difficulty.${id}`),
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
    expect(i18nZh.t('knightstour.solved.best', { count: 63 })).toContain('63')
    expect(i18nZh.t('knightstour.solved.best', { count: 63 })).not.toMatch(/\{\w+\}/)
    expect(i18nEn.t('knightstour.solved.best', { count: 1 })).not.toMatch(/\{\w+\}/)
    expect(i18nEn.t('knightstour.solved.best', { count: 3 })).toContain('3')
  })

  it('结果明细走 plural，中英都不缺词', () => {
    expect(i18nZh.plural('knightstour.result.moves', 63, { count: 63 })).toContain('63')
    expect(i18nEn.plural('knightstour.result.moves', 1, { count: 1 })).toContain('1 move')
    expect(i18nEn.plural('knightstour.result.visited', 64, { count: 64 })).toContain('64 squares')
    expect(i18nZh.plural('knightstour.result.visited', 64, { count: 64 })).toContain('64')
  })

  it('view / controls / stats / 难度 / 格子标签里出现的 key 都有两种语言的文案', () => {
    const state = knightstourGame.create(0, 'starter')
    const view = knightstourGame.view(state)
    const keys: string[] = [
      `${knightstourGame.i18nNamespace}.title`,
      `${knightstourGame.i18nNamespace}.rules.body`,
      `${knightstourGame.i18nNamespace}.rules.restart`,
      knightstourGame.illegalNoticeKey ?? '',
      ...view.stats.map((stat) => stat.labelKey),
      ...knightstourGame.controls(state).map((control) => control.labelKey),
      ...knightstourGame.difficulties.map((difficulty) => difficulty.labelKey),
      ...(Object.values(CELL_LABEL_KEYS).filter(Boolean) as string[]),
    ]
    for (const key of keys) {
      expect(i18nZh.t(key), key).not.toContain('⟦')
      expect(i18nEn.t(key), key).not.toContain('⟦')
    }
    expect(i18nZh.missingKeys()).toEqual([])
    expect(i18nEn.missingKeys()).toEqual([])
  })

  it('结果标题与明细的 key 都能取到（走满一局）', () => {
    const start = knightstourGame.create(20240607, 'starter')
    const path = solveKnightTour(8, start.start).solution!
    let state = start
    for (const to of path.slice(1)) state = knightstourGame.reduce(state, { type: 'move', to })
    const result = knightstourGame.view(state).result!
    expect(i18nZh.t(result.titleKey)).not.toContain('⟦')
    expect(i18nEn.t(result.titleKey)).not.toContain('⟦')
    for (const detail of result.details) {
      expect(i18nZh.plural(detail.key, CELLS, detail.params)).not.toContain('⟦')
      expect(i18nEn.plural(detail.key, 1, detail.params)).not.toContain('⟦')
    }
  })

  it('提示开启时 notice 的 key 也有两种语言', () => {
    const state = knightstourGame.reduce(knightstourGame.create(1, 'starter'), { type: 'hint' })
    const notice = knightstourGame.view(state).notice!
    expect(i18nZh.t(notice.textKey)).not.toContain('⟦')
    expect(i18nEn.t(notice.textKey)).not.toContain('⟦')
  })

  it('格子无障碍标签覆盖本玩法用到的四种 kind', () => {
    for (const kind of ['floor', 'player', 'goal', 'number'] as const) {
      const key = CELL_LABEL_KEYS[kind]!
      expect(zh[key], kind).toBeDefined()
      expect(en[key], kind).toBeDefined()
    }
  })
})
