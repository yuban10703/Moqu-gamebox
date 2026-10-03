/**
 * 字典对齐：中英基础 key 必须完全一致，且「视图/控件/统计/结果页」会取的 key 都能取到文案
 * （避免界面上冒出 ⟦key⟧）。
 */
import { describe, expect, it } from 'vitest'
import { baseKeys, compareDicts, coreDictEn, coreDictZh, createI18n, type Dict } from '@eink/core'
import {
  DIFFICULTY_IDS,
  battleshipEn,
  battleshipGame,
  battleshipZh,
} from '../src/index.js'
import { CELL_LABEL_KEYS } from '../src/view.js'

const zh: Dict = { ...coreDictZh, ...battleshipZh }
const en: Dict = { ...coreDictEn, ...battleshipEn }
const i18nZh = createI18n('zh-CN', { 'zh-CN': zh, 'en-US': en })
const i18nEn = createI18n('en-US', { 'zh-CN': zh, 'en-US': en })

describe('中英字典对齐', () => {
  it('没有缺失、多余或复数形式不完整的 key', () => {
    expect(compareDicts({ 'zh-CN': zh, 'en-US': en })).toEqual([])
  })

  it('两边基础 key 集合完全一致', () => {
    expect([...baseKeys(battleshipZh)].sort()).toEqual([...baseKeys(battleshipEn)].sort())
  })

  it('英文复数形式齐备（中文只用 __other）', () => {
    for (const key of ['battleship.result.sunk', 'battleship.result.moves', 'battleship.solved.best']) {
      expect(en[`${key}__other`], key).toBeDefined()
      expect(zh[`${key}__other`], key).toBeDefined()
    }
    for (const key of ['battleship.result.sunk', 'battleship.result.moves']) {
      expect(en[`${key}__one`], key).toBeDefined()
    }
    expect(en['battleship.solved.best__one']).toBeDefined()
  })
})

describe('壳层会取的 key', () => {
  it('标题、规则、重开、非法提示、难度、统计、格子标签、胜负标题都不缺', () => {
    const keys = [
      'battleship.title',
      'battleship.rules.body',
      'battleship.rules.body2',
      'battleship.rules.restart',
      'battleship.illegal.notice',
      'battleship.won.title',
      'battleship.lost.title',
      'battleship.stat.mine',
      'battleship.stat.foe',
      'battleship.stat.shots',
      'battleship.cell.floor',
      'battleship.cell.tile',
      ...DIFFICULTY_IDS.map((id) => `battleship.difficulty.${id}`),
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
    expect(i18nZh.t('battleship.solved.best', { count: 20 })).toContain('20')
    expect(i18nZh.t('battleship.solved.best', { count: 20 })).not.toMatch(/\{\w+\}/)
    expect(i18nEn.t('battleship.solved.best', { count: 1 })).not.toMatch(/\{\w+\}/)
    expect(i18nEn.t('battleship.solved.best', { count: 3 })).toContain('3')
  })

  it('结果明细走 plural，中英都不缺词', () => {
    expect(i18nZh.plural('battleship.result.sunk', 3, { count: 3 })).toContain('3')
    expect(i18nEn.plural('battleship.result.sunk', 1, { count: 1 })).toContain('1 enemy ship')
    expect(i18nEn.plural('battleship.result.moves', 9, { count: 9 })).toContain('9 shots')
    expect(i18nZh.plural('battleship.result.moves', 9, { count: 9 })).toContain('9')
  })

  it('view / controls / stats / 难度 / 格子标签里出现的 key 都有两种语言的文案', () => {
    const state = battleshipGame.create(1, 'starter')
    const view = battleshipGame.view(state)
    const keys: string[] = [
      `${battleshipGame.i18nNamespace}.title`,
      `${battleshipGame.i18nNamespace}.rules.body`,
      `${battleshipGame.i18nNamespace}.rules.restart`,
      battleshipGame.illegalNoticeKey ?? '',
      ...view.stats.map((stat) => stat.labelKey),
      ...battleshipGame.controls(state).map((control) => control.labelKey),
      ...battleshipGame.difficulties.map((difficulty) => difficulty.labelKey),
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
    let state = battleshipGame.create(5, 'starter')
    let guard = 0
    while (battleshipGame.status(state) === 'playing' && guard++ < 500) {
      const target = state.enemyFleet.cells.find((cell) => !state.playerShots[cell])
      const shot =
        target ??
        state.playerShots.findIndex((fired, index) => !fired && !state.enemyFleet.mask[index])
      state = battleshipGame.reduce(state, { type: 'fire', index: shot })
    }
    const result = battleshipGame.view(state).result!
    expect(i18nZh.t(result.titleKey)).not.toContain('⟦')
    expect(i18nEn.t(result.titleKey)).not.toContain('⟦')
    for (const detail of result.details) {
      expect(i18nZh.plural(detail.key, 3, detail.params)).not.toContain('⟦')
      expect(i18nEn.plural(detail.key, 1, detail.params)).not.toContain('⟦')
    }
  })

  it('格子无障碍标签覆盖本玩法用到的两种 kind', () => {
    for (const kind of ['floor', 'tile'] as const) {
      const key = CELL_LABEL_KEYS[kind]!
      expect(zh[key], kind).toBeDefined()
      expect(en[key], kind).toBeDefined()
    }
  })
})
