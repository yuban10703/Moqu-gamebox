/**
 * 字典对齐：中英基础 key 必须完全一致，且「视图/控件/格子标签/壳层」会取的 key 都能取到文案
 * （避免界面上冒出 ⟦key⟧）。
 */
import { describe, expect, it } from 'vitest'
import { baseKeys, compareDicts, coreDictEn, coreDictZh, createI18n, type Dict } from '@eink/core'
import {
  DIFFICULTY_IDS,
  indexOf,
  pegsolitaireEn,
  pegsolitaireGame,
  pegsolitaireZh,
} from '../src/index.js'
import { CELL_LABEL_KEYS } from '../src/view.js'
import { boardWith, fresh } from './helpers.js'

const zh: Dict = { ...coreDictZh, ...pegsolitaireZh }
const en: Dict = { ...coreDictEn, ...pegsolitaireEn }
const i18nZh = createI18n('zh-CN', { 'zh-CN': zh, 'en-US': en })
const i18nEn = createI18n('en-US', { 'zh-CN': zh, 'en-US': en })

describe('中英字典对齐', () => {
  it('没有缺失、多余或复数形式不完整的 key', () => {
    expect(compareDicts({ 'zh-CN': zh, 'en-US': en })).toEqual([])
  })

  it('两边基础 key 集合完全一致', () => {
    expect([...baseKeys(pegsolitaireZh)].sort()).toEqual([...baseKeys(pegsolitaireEn)].sort())
  })

  it('英文复数形式齐备（中文只用 __other）', () => {
    for (const key of ['pegsolitaire.result.moves', 'pegsolitaire.result.pegs', 'pegsolitaire.solved.best']) {
      expect(en[`${key}__other`], key).toBeDefined()
      expect(zh[`${key}__other`], key).toBeDefined()
    }
    for (const key of ['pegsolitaire.result.moves', 'pegsolitaire.result.pegs']) {
      expect(en[`${key}__one`], key).toBeDefined()
    }
  })
})

describe('壳层会取的 key', () => {
  it('标题、规则、重开、非法提示、难度、统计、格子标签都不缺', () => {
    const keys = [
      'pegsolitaire.title',
      'pegsolitaire.rules.body',
      'pegsolitaire.rules.body2',
      'pegsolitaire.rules.restart',
      'pegsolitaire.illegal.notice',
      'pegsolitaire.won.title',
      'pegsolitaire.stat.pegs',
      'pegsolitaire.stat.moves',
      'pegsolitaire.stat.remaining',
      'pegsolitaire.cell.wall',
      'pegsolitaire.cell.empty',
      'pegsolitaire.cell.tile',
      ...DIFFICULTY_IDS.map((id) => `pegsolitaire.difficulty.${id}`),
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
    expect(i18nZh.t('pegsolitaire.solved.best', { count: 31 })).toContain('31')
    expect(i18nZh.t('pegsolitaire.solved.best', { count: 31 })).not.toMatch(/\{\w+\}/)
    expect(i18nEn.t('pegsolitaire.solved.best', { count: 1 })).not.toMatch(/\{\w+\}/)
    expect(i18nEn.t('pegsolitaire.solved.best', { count: 3 })).toContain('3')
  })

  it('结果明细走 plural，中英都不缺词', () => {
    expect(i18nZh.plural('pegsolitaire.result.moves', 31, { count: 31 })).toContain('31')
    expect(i18nEn.plural('pegsolitaire.result.moves', 1, { count: 1 })).toContain('1 jump')
    expect(i18nEn.plural('pegsolitaire.result.pegs', 1, { count: 1 })).toContain('1 peg')
    expect(i18nZh.plural('pegsolitaire.result.pegs', 1, { count: 1 })).toContain('1')
  })

  it('view / controls / stats / 难度 / 格子标签里出现的 key 都有两种语言的文案', () => {
    const state = pegsolitaireGame.create(0, 'starter')
    const view = pegsolitaireGame.view(state)
    const keys: string[] = [
      `${pegsolitaireGame.i18nNamespace}.title`,
      `${pegsolitaireGame.i18nNamespace}.rules.body`,
      `${pegsolitaireGame.i18nNamespace}.rules.restart`,
      pegsolitaireGame.illegalNoticeKey ?? '',
      ...view.stats.map((stat) => stat.labelKey),
      ...pegsolitaireGame.controls(state).map((control) => control.labelKey),
      ...pegsolitaireGame.difficulties.map((difficulty) => difficulty.labelKey),
      ...(Object.values(CELL_LABEL_KEYS).filter(Boolean) as string[]),
    ]
    for (const key of keys) {
      expect(i18nZh.t(key), key).not.toContain('⟦')
      expect(i18nEn.t(key), key).not.toContain('⟦')
    }
    expect(i18nZh.missingKeys()).toEqual([])
    expect(i18nEn.missingKeys()).toEqual([])
  })

  it('结果标题与明细的 key 都能取到（只剩一枚棋子）', () => {
    const won = {
      ...fresh('starter'),
      pegs: boardWith([indexOf(2, 4)]),
      moves: 31,
    }
    const result = pegsolitaireGame.view(won).result!
    expect(i18nZh.t(result.titleKey)).not.toContain('⟦')
    expect(i18nEn.t(result.titleKey)).not.toContain('⟦')
    for (const detail of result.details) {
      expect(i18nZh.plural(detail.key, 31, detail.params)).not.toContain('⟦')
      expect(i18nEn.plural(detail.key, 1, detail.params)).not.toContain('⟦')
    }
    // 顺带确认起始局面确实没有结果面板
    expect(pegsolitaireGame.view(fresh('starter')).result).toBeNull()
  })

  it('格子无障碍标签覆盖本玩法用到的三种 kind', () => {
    for (const kind of ['wall', 'empty', 'tile'] as const) {
      const key = CELL_LABEL_KEYS[kind]!
      expect(zh[key], kind).toBeDefined()
      expect(en[key], kind).toBeDefined()
    }
  })
})
