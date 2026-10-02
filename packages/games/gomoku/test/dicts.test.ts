/**
 * 真实字典对齐校验：壳层文案 + 五子棋文案，中英基础 key 必须完全一致，
 * 并且「视图/控件/格子标签/结果明细里出现的 key」都必须能取到文案
 * （避免界面上冒出 ⟦key⟧）。与核心层 `npm run check:i18n` 的规则一致。
 */
import { describe, expect, it } from 'vitest'
import { baseKeys, compareDicts, coreDictEn, coreDictZh, createI18n, type CellKind } from '@eink/core'
import {
  DIFFICULTY_IDS,
  cellLabelKey,
  gomokuEn,
  gomokuGame,
  gomokuZh,
  reduceGomoku,
} from '../src/index.js'
import { CELL_LABEL_KEYS } from '../src/view.js'
import { at, fillNoFiveBoard, stateOf } from './helpers.js'

const zh = { ...coreDictZh, ...gomokuZh }
const en = { ...coreDictEn, ...gomokuEn }
const i18nZh = createI18n('zh-CN', { 'zh-CN': zh, 'en-US': en })
const i18nEn = createI18n('en-US', { 'zh-CN': zh, 'en-US': en })

describe('中英字典对齐', () => {
  it('没有缺失、多余或复数形式不完整的 key', () => {
    expect(compareDicts({ 'zh-CN': zh, 'en-US': en })).toEqual([])
    expect([...baseKeys(gomokuZh)].sort()).toEqual([...baseKeys(gomokuEn)].sort())
  })

  it('英文复数形式齐备（中文只用 __other）', () => {
    for (const key of ['gomoku.result.moves']) {
      expect(en[`${key}__one`], key).toBeDefined()
      expect(en[`${key}__other`], key).toBeDefined()
      expect(zh[`${key}__other`], key).toBeDefined()
    }
    expect(en['gomoku.solved.best__one']).toBeDefined()
    expect(en['gomoku.solved.best__other']).toBeDefined()
    expect(zh['gomoku.solved.best__other']).toBeDefined()
  })

  it('结果明细按复数取词，中英都不缺词', () => {
    expect(i18nZh.plural('gomoku.result.moves', 7, { count: 7 })).toContain('7')
    expect(i18nEn.plural('gomoku.result.moves', 1, { count: 1 })).toContain('1 move')
    expect(i18nEn.plural('gomoku.result.moves', 12, { count: 12 })).toContain('12 moves')
    expect(i18nZh.t('gomoku.result.draw')).not.toMatch(/\{\w+\}/)
    expect(i18nEn.t('gomoku.result.draw')).not.toMatch(/\{\w+\}/)
  })

  it('标题、规则、难度、非法提示等关键文案都不缺', () => {
    const keys = [
      'gomoku.title',
      'gomoku.rules.body',
      'gomoku.rules.body2',
      'gomoku.rules.restart',
      'gomoku.illegal.notice',
      'gomoku.won.title',
      'gomoku.lost.title',
      'gomoku.draw.title',
      'gomoku.solved.best',
      ...DIFFICULTY_IDS.map((id) => `gomoku.difficulty.${id}`),
    ]
    for (const key of keys) {
      expect(i18nZh.t(key), key).not.toContain('⟦')
      expect(i18nEn.t(key), key).not.toContain('⟦')
    }
    expect(i18nZh.missingKeys()).toEqual([])
    expect(i18nEn.missingKeys()).toEqual([])
  })

  it('视图、控件、格子标签里出现的 key 都有两种语言的文案', () => {
    const state = gomokuGame.create(1, 'starter')
    const view = gomokuGame.view(state)
    const keys: string[] = [
      `${gomokuGame.i18nNamespace}.title`,
      gomokuGame.illegalNoticeKey ?? '',
      ...view.stats.map((stat) => stat.labelKey),
      ...gomokuGame.controls(state).map((control) => control.labelKey),
      ...gomokuGame.difficulties.map((difficulty) => difficulty.labelKey),
      ...(Object.values(CELL_LABEL_KEYS).filter(Boolean) as string[]),
    ]
    for (const key of keys) {
      expect(i18nZh.t(key), key).not.toContain('⟦')
      expect(i18nEn.t(key), key).not.toContain('⟦')
    }
    expect(i18nZh.missingKeys()).toEqual([])
    expect(i18nEn.missingKeys()).toEqual([])
  })

  it('cellLabelKey 只映射五子棋用到的两种 kind，未知 kind 返回 undefined', () => {
    expect(cellLabelKey('tile')).toBe('gomoku.cell.tile')
    expect(cellLabelKey('empty')).toBe('gomoku.cell.empty')
    expect(cellLabelKey('wall' as CellKind)).toBeUndefined()
  })

  it('赢/输/平三套结果标题与明细在两种语言里都取得到', () => {
    const won = reduceGomoku(
      stateOf([
        { black: at(7, 3), white: at(0, 0) },
        { black: at(7, 4), white: at(0, 1) },
        { black: at(7, 5), white: at(0, 2) },
        { black: at(7, 6), white: at(0, 3) },
      ]),
      { type: 'place', index: at(7, 7) },
    )
    const lost = stateOf([
      { black: at(0, 0), white: at(3, 3) },
      { black: at(0, 2), white: at(3, 4) },
      { black: at(0, 4), white: at(3, 5) },
      { black: at(0, 6), white: at(3, 6) },
      { black: at(6, 6), white: at(3, 7) },
    ])
    const draw = stateOf([], { board: fillNoFiveBoard(), moves: 113, rngCursor: 112 })
    for (const state of [won, lost, draw]) {
      const result = gomokuGame.view(state).result
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
