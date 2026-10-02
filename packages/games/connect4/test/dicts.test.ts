/**
 * 真实字典对齐校验：壳层文案 + 四子棋文案，中英基础 key 必须完全一致，
 * 并且「视图/控件/格子标签/结果明细里出现的 key」都必须能取到文案
 * （避免界面上冒出 ⟦key⟧）。与核心层 `npm run check:i18n` 的规则一致。
 */
import { describe, expect, it } from 'vitest'
import { baseKeys, compareDicts, coreDictEn, coreDictZh, createI18n, type CellKind } from '@eink/core'
import {
  DIFFICULTY_IDS,
  cellLabelKey,
  connect4En,
  connect4Game,
  connect4Zh,
  reduceConnect4,
} from '../src/index.js'
import { CELL_LABEL_KEYS } from '../src/view.js'
import { at, crowdedState, stateOf } from './helpers.js'

const zh = { ...coreDictZh, ...connect4Zh }
const en = { ...coreDictEn, ...connect4En }
const i18nZh = createI18n('zh-CN', { 'zh-CN': zh, 'en-US': en })
const i18nEn = createI18n('en-US', { 'zh-CN': zh, 'en-US': en })

describe('中英字典对齐', () => {
  it('没有缺失、多余或复数形式不完整的 key', () => {
    expect(compareDicts({ 'zh-CN': zh, 'en-US': en })).toEqual([])
    expect([...baseKeys(connect4Zh)].sort()).toEqual([...baseKeys(connect4En)].sort())
  })

  it('英文复数形式齐备（中文只用 __other）', () => {
    for (const key of ['connect4.result.moves']) {
      expect(en[`${key}__one`], key).toBeDefined()
      expect(en[`${key}__other`], key).toBeDefined()
      expect(zh[`${key}__other`], key).toBeDefined()
    }
    expect(en['connect4.solved.best__one']).toBeDefined()
    expect(en['connect4.solved.best__other']).toBeDefined()
    expect(zh['connect4.solved.best__other']).toBeDefined()
  })

  it('结果明细按复数取词，中英都不缺词', () => {
    expect(i18nZh.plural('connect4.result.moves', 7, { count: 7 })).toContain('7')
    expect(i18nEn.plural('connect4.result.moves', 1, { count: 1 })).toContain('1 move')
    expect(i18nEn.plural('connect4.result.moves', 12, { count: 12 })).toContain('12 moves')
    expect(i18nZh.t('connect4.result.draw')).not.toMatch(/\{\w+\}/)
    expect(i18nEn.t('connect4.result.draw')).not.toMatch(/\{\w+\}/)
  })

  it('标题、规则、难度、非法提示等关键文案都不缺', () => {
    const keys = [
      'connect4.title',
      'connect4.rules.body',
      'connect4.rules.body2',
      'connect4.rules.restart',
      'connect4.illegal.notice',
      'connect4.won.title',
      'connect4.lost.title',
      'connect4.draw.title',
      'connect4.solved.best',
      ...DIFFICULTY_IDS.map((id) => `connect4.difficulty.${id}`),
    ]
    for (const key of keys) {
      expect(i18nZh.t(key), key).not.toContain('⟦')
      expect(i18nEn.t(key), key).not.toContain('⟦')
    }
    expect(i18nZh.missingKeys()).toEqual([])
    expect(i18nEn.missingKeys()).toEqual([])
  })

  it('视图、控件、格子标签里出现的 key 都有两种语言的文案', () => {
    const state = connect4Game.create(1, 'starter')
    const view = connect4Game.view(state)
    const keys: string[] = [
      `${connect4Game.i18nNamespace}.title`,
      connect4Game.illegalNoticeKey ?? '',
      ...view.stats.map((stat) => stat.labelKey),
      ...connect4Game.controls(state).map((control) => control.labelKey),
      ...connect4Game.difficulties.map((difficulty) => difficulty.labelKey),
      ...(Object.values(CELL_LABEL_KEYS).filter(Boolean) as string[]),
    ]
    for (const key of keys) {
      expect(i18nZh.t(key), key).not.toContain('⟦')
      expect(i18nEn.t(key), key).not.toContain('⟦')
    }
    expect(i18nZh.missingKeys()).toEqual([])
    expect(i18nEn.missingKeys()).toEqual([])
  })

  it('cellLabelKey 只映射四子棋用到的三种 kind，未知 kind 返回 undefined', () => {
    expect(cellLabelKey('tile')).toBe('connect4.cell.tile')
    expect(cellLabelKey('empty')).toBe('connect4.cell.empty')
    expect(cellLabelKey('number')).toBe('connect4.cell.number')
    expect(cellLabelKey('wall' as CellKind)).toBeUndefined()
  })

  it('赢/输/平三套结果标题与明细在两种语言里都取得到', () => {
    const won = reduceConnect4(
      stateOf([
        { black: at(5, 0), white: at(5, 6) },
        { black: at(5, 1), white: at(4, 6) },
        { black: at(5, 2), white: at(3, 6) },
      ]),
      { type: 'drop', column: 3 },
    )
    const lost = stateOf([
      { black: at(5, 0), white: at(5, 3) },
      { black: at(5, 1), white: at(4, 3) },
      { black: at(4, 0), white: at(3, 3) },
      { black: at(4, 1), white: at(2, 3) },
    ])
    const draw = crowdedState(21)
    for (const state of [won, lost, draw]) {
      const result = connect4Game.view(state).result
      expect(result).not.toBeNull()
      expect(i18nZh.t(result!.titleKey), result!.titleKey).not.toContain('⟦')
      expect(i18nEn.t(result!.titleKey), result!.titleKey).not.toContain('⟦')
      for (const detail of result!.details) {
        const text = detail.params
          ? i18nZh.plural(detail.key, Number(detail.params.count ?? 0), detail.params)
          : i18nZh.t(detail.key)
        const textEn = detail.params
          ? i18nEn.plural(detail.key, Number(detail.params.count ?? 0), detail.params)
          : i18nEn.t(detail.key)
        expect(text, detail.key).not.toContain('⟦')
        expect(textEn, detail.key).not.toContain('⟦')
      }
    }
    expect(i18nZh.missingKeys()).toEqual([])
    expect(i18nEn.missingKeys()).toEqual([])
  })
})
