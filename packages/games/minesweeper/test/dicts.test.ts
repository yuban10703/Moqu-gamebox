/**
 * 真实字典对齐校验：壳层文案 + 扫雷文案，中英基础 key 必须完全一致，
 * 并且「视图/控件里出现的 key」都必须能取到文案（避免界面上冒出 ⟦key⟧）。
 */
import { describe, expect, it } from 'vitest'
import { baseKeys, compareDicts, coreDictEn, coreDictZh, createI18n } from '@eink/core'
import {
  DIFFICULTY_IDS,
  minesweeperEn,
  minesweeperGame,
  minesweeperZh,
} from '../src/index.js'
import { CELL_LABEL_KEYS } from '../src/view.js'

const zh = { ...coreDictZh, ...minesweeperZh }
const en = { ...coreDictEn, ...minesweeperEn }

const i18nZh = createI18n('zh-CN', { 'zh-CN': zh, 'en-US': en })
const i18nEn = createI18n('en-US', { 'zh-CN': zh, 'en-US': en })

describe('中英字典对齐', () => {
  it('没有缺失、多余或复数形式不完整的 key', () => {
    expect(compareDicts({ 'zh-CN': zh, 'en-US': en })).toEqual([])
  })

  it('两边基础 key 集合完全一致', () => {
    expect([...baseKeys(minesweeperZh)].sort()).toEqual([...baseKeys(minesweeperEn)].sort())
  })

  it('英文复数形式齐备（中文只用 __other）', () => {
    for (const key of [
      'minesweeper.result.mines',
      'minesweeper.result.revealed',
      'minesweeper.result.flags',
    ]) {
      expect(en[`${key}__one`]).toBeDefined()
      expect(en[`${key}__other`]).toBeDefined()
      expect(zh[`${key}__other`]).toBeDefined()
    }
  })

  it('结果详情用复数键渲染，中英都不缺词', () => {
    expect(i18nZh.plural('minesweeper.result.mines', 10, { count: 10 })).toContain('10')
    expect(i18nEn.plural('minesweeper.result.mines', 1, { count: 1 })).toContain('1 mine')
    expect(i18nEn.plural('minesweeper.result.revealed', 3, { count: 3 })).toContain('3 cells')
  })

  it('标题、规则、重开说明、难度、非法提示等关键文案都不缺', () => {
    const keys = [
      'minesweeper.title',
      'minesweeper.rules.body',
      'minesweeper.rules.body2',
      'minesweeper.rules.restart',
      'minesweeper.illegal',
      'minesweeper.won.title',
      'minesweeper.lost.title',
      ...DIFFICULTY_IDS.map((id) => `minesweeper.difficulty.${id}`),
    ]
    for (const key of keys) {
      expect(i18nZh.t(key)).not.toContain('⟦')
      expect(i18nEn.t(key)).not.toContain('⟦')
    }
    expect(i18nZh.missingKeys()).toEqual([])
    expect(i18nEn.missingKeys()).toEqual([])
  })

  it('视图、控件、格子标签里出现的 key 都有两种语言的文案', () => {
    const state = minesweeperGame.create(1, 'starter')
    const view = minesweeperGame.view(state)
    const keys: string[] = [
      `${minesweeperGame.i18nNamespace}.title`,
      minesweeperGame.illegalNoticeKey ?? '',
      'minesweeper.control.flagMode.on',
      'minesweeper.control.flagMode.off',
      ...view.stats.map((stat) => stat.labelKey),
      ...minesweeperGame.controls(state).map((control) => control.labelKey),
      ...minesweeperGame.difficulties.map((difficulty) => difficulty.labelKey),
      ...(Object.values(CELL_LABEL_KEYS).filter(Boolean) as string[]),
    ]
    for (const key of keys) {
      expect(i18nZh.t(key)).not.toContain('⟦')
      expect(i18nEn.t(key)).not.toContain('⟦')
    }
    expect(i18nZh.missingKeys()).toEqual([])
    expect(i18nEn.missingKeys()).toEqual([])
  })
})
