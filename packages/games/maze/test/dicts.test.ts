/**
 * 字典对齐：中英基础 key 必须完全一致，且「视图/控件/格子标签/壳层」会取的 key 都能取到文案
 * （避免界面上冒出 ⟦key⟧）。
 */
import { describe, expect, it } from 'vitest'
import { baseKeys, compareDicts, coreDictEn, coreDictZh, createI18n, type Dict } from '@eink/core'
import {
  DIFFICULTY_IDS,
  configFor,
  goalIndex,
  mazeEn,
  mazeGame,
  mazeZh,
} from '../src/index.js'
import { CELL_LABEL_KEYS } from '../src/view.js'
import { fresh, shortestPathDirections } from './helpers.js'

const zh: Dict = { ...coreDictZh, ...mazeZh }
const en: Dict = { ...coreDictEn, ...mazeEn }
const i18nZh = createI18n('zh-CN', { 'zh-CN': zh, 'en-US': en })
const i18nEn = createI18n('en-US', { 'zh-CN': zh, 'en-US': en })

describe('中英字典对齐', () => {
  it('没有缺失、多余或复数形式不完整的 key', () => {
    expect(compareDicts({ 'zh-CN': zh, 'en-US': en })).toEqual([])
  })

  it('两边基础 key 集合完全一致', () => {
    expect([...baseKeys(mazeZh)].sort()).toEqual([...baseKeys(mazeEn)].sort())
  })

  it('英文复数形式齐备（中文只用 __other）', () => {
    for (const key of ['maze.result.moves', 'maze.result.explored', 'maze.solved.best']) {
      expect(en[`${key}__other`], key).toBeDefined()
      expect(zh[`${key}__other`], key).toBeDefined()
    }
    for (const key of ['maze.result.moves', 'maze.result.explored']) {
      expect(en[`${key}__one`], key).toBeDefined()
    }
  })
})

describe('壳层会取的 key', () => {
  it('标题、规则、重开、非法提示、难度、方向盘、格子标签都不缺', () => {
    const keys = [
      'maze.title',
      'maze.rules.body',
      'maze.rules.body2',
      'maze.rules.restart',
      'maze.illegal.notice',
      'maze.dpad.label',
      'maze.dir.up',
      'maze.dir.down',
      'maze.dir.left',
      'maze.dir.right',
      'maze.won.title',
      'maze.stat.moves',
      'maze.stat.explored',
      'maze.cell.wall',
      'maze.cell.floor',
      'maze.cell.player',
      'maze.cell.goal',
      ...DIFFICULTY_IDS.map((id) => `maze.difficulty.${id}`),
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
    expect(i18nZh.t('maze.solved.best', { count: 33 })).toContain('33')
    expect(i18nZh.t('maze.solved.best', { count: 33 })).not.toMatch(/\{\w+\}/)
    expect(i18nEn.t('maze.solved.best', { count: 1 })).not.toMatch(/\{\w+\}/)
    expect(i18nEn.t('maze.solved.best', { count: 3 })).toContain('3')
  })

  it('结果明细走 plural，中英都不缺词', () => {
    expect(i18nZh.plural('maze.result.moves', 40, { count: 40 })).toContain('40')
    expect(i18nEn.plural('maze.result.moves', 1, { count: 1 })).toContain('1 move')
    expect(i18nEn.plural('maze.result.explored', 15, { count: 15 })).toContain('15 cells')
    expect(i18nZh.plural('maze.result.explored', 15, { count: 15 })).toContain('15')
  })

  it('view / controls / stats / 难度 / 格子标签里出现的 key 都有两种语言的文案', () => {
    const state = mazeGame.create(1, 'starter')
    const view = mazeGame.view(state)
    const keys: string[] = [
      `${mazeGame.i18nNamespace}.title`,
      `${mazeGame.i18nNamespace}.rules.body`,
      `${mazeGame.i18nNamespace}.rules.restart`,
      `${mazeGame.i18nNamespace}.dpad.label`,
      mazeGame.illegalNoticeKey ?? '',
      ...view.stats.map((stat) => stat.labelKey),
      ...mazeGame.controls(state).map((control) => control.labelKey),
      ...mazeGame.difficulties.map((difficulty) => difficulty.labelKey),
      ...(Object.values(CELL_LABEL_KEYS).filter(Boolean) as string[]),
    ]
    for (const key of keys) {
      expect(i18nZh.t(key), key).not.toContain('⟦')
      expect(i18nEn.t(key), key).not.toContain('⟦')
    }
    expect(i18nZh.missingKeys()).toEqual([])
    expect(i18nEn.missingKeys()).toEqual([])
  })

  it('结果标题的 key 也能取到（走到出口）', () => {
    const state = fresh(20240607, 'starter')
    const config = configFor('starter')
    const path = shortestPathDirections(state.walls, config.size, state.player, goalIndex(config))!
    let current = state
    for (const dir of path) current = mazeGame.reduce(current, { type: 'move', dir })
    const result = mazeGame.view(current).result!
    expect(i18nZh.t(result.titleKey)).not.toContain('⟦')
    expect(i18nEn.t(result.titleKey)).not.toContain('⟦')
    for (const detail of result.details) {
      expect(i18nZh.plural(detail.key, 15, detail.params)).not.toContain('⟦')
      expect(i18nEn.plural(detail.key, 1, detail.params)).not.toContain('⟦')
    }
  })

  it('格子无障碍标签覆盖本玩法用到的四种 kind', () => {
    for (const kind of ['wall', 'floor', 'player', 'goal'] as const) {
      const key = CELL_LABEL_KEYS[kind]!
      expect(zh[key], kind).toBeDefined()
      expect(en[key], kind).toBeDefined()
    }
  })
})
