/**
 * 真实字典对齐校验：壳层文案 + 黑白棋文案，中英基础 key 必须完全一致，
 * 并且「视图/控件/格子标签里出现的 key」都必须能取到文案（避免界面上冒出 ⟦key⟧）。
 * 与扫雷、数独的 dicts 测试同构，`npm run check:i18n` 的规则与这里一致。
 */
import { describe, expect, it } from 'vitest'
import { baseKeys, compareDicts, coreDictEn, coreDictZh, createI18n } from '@eink/core'
import { BLACK, DIFFICULTY_IDS, reversiEn, reversiGame, reversiZh } from '../src/index.js'
import { CELL_LABEL_KEYS } from '../src/view.js'
import { settle,  boardOf, fixtureState } from './helpers.js'

const zh = { ...coreDictZh, ...reversiZh }
const en = { ...coreDictEn, ...reversiEn }
const i18nZh = createI18n('zh-CN', { 'zh-CN': zh, 'en-US': en })
const i18nEn = createI18n('en-US', { 'zh-CN': zh, 'en-US': en })

/** 真实对局里搜出来的「白方无处可下」局面 */
const WHITE_STUCK = [
  'WWWWWWWB',
  'WWBBBBBB',
  'WWWWBBBB',
  'WWWWBBBB',
  'WWWWWBBB',
  'WWBBBBWB',
  'WWWBWWWW',
  '··BBBBBB',
]

describe('中英字典对齐', () => {
  it('没有缺失、多余或复数形式不完整的 key', () => {
    expect(compareDicts({ 'zh-CN': zh, 'en-US': en })).toEqual([])
    expect([...baseKeys(reversiZh)].sort()).toEqual([...baseKeys(reversiEn)].sort())
  })

  it('英文复数形式齐备（中文只用 __other）', () => {
    for (const key of ['reversi.result.black', 'reversi.result.white']) {
      expect(en[`${key}__one`], key).toBeDefined()
      expect(en[`${key}__other`], key).toBeDefined()
      expect(zh[`${key}__other`], key).toBeDefined()
    }
  })

  it('结果明细按复数取词，中英都不缺词', () => {
    expect(i18nZh.plural('reversi.result.black', 33, { count: 33 })).toContain('33')
    expect(i18nEn.plural('reversi.result.black', 1, { count: 1 })).toContain('1 black disc')
    expect(i18nEn.plural('reversi.result.white', 32, { count: 32 })).toContain('32 white discs')
  })

  it('标题、规则、难度、非法提示、过手提示等关键文案都不缺', () => {
    const keys = [
      'reversi.title',
      'reversi.rules.body',
      'reversi.rules.body2',
      'reversi.rules.restart',
      'reversi.illegal.notice',
      'reversi.notice.opponentPass',
      'reversi.notice.playerPass',
      'reversi.won.title',
      'reversi.lost.title',
      'reversi.draw.title',
      'reversi.solved.best',
      ...DIFFICULTY_IDS.map((id) => `reversi.difficulty.${id}`),
    ]
    for (const key of keys) {
      expect(i18nZh.t(key), key).not.toContain('⟦')
      expect(i18nEn.t(key), key).not.toContain('⟦')
    }
    expect(i18nZh.missingKeys()).toEqual([])
    expect(i18nEn.missingKeys()).toEqual([])
  })

  it('视图、控件、格子标签里出现的 key 都有两种语言的文案', () => {
    const state = reversiGame.create(1, 'starter')
    const view = reversiGame.view(state)
    const keys: string[] = [
      `${reversiGame.i18nNamespace}.title`,
      reversiGame.illegalNoticeKey ?? '',
      ...view.stats.map((stat) => stat.labelKey),
      ...reversiGame.controls(state).map((control) => control.labelKey),
      ...reversiGame.difficulties.map((difficulty) => difficulty.labelKey),
      ...(Object.values(CELL_LABEL_KEYS).filter(Boolean) as string[]),
    ]
    for (const key of keys) {
      expect(i18nZh.t(key), key).not.toContain('⟦')
      expect(i18nEn.t(key), key).not.toContain('⟦')
    }
    expect(i18nZh.missingKeys()).toEqual([])
    expect(i18nEn.missingKeys()).toEqual([])
  })

  it('自动过手的提示能被壳层取到（不出现 ⟦key⟧）', () => {
    const after = settle(reversiGame.reduce(fixtureState(boardOf(WHITE_STUCK), BLACK), {
      type: 'place',
      index: 57,
    }))
    const notice = reversiGame.view(after).notice
    expect(notice).not.toBeNull()
    expect(i18nZh.t(notice!.textKey)).not.toContain('⟦')
    expect(i18nEn.t(notice!.textKey)).not.toContain('⟦')
    expect(i18nZh.t(notice!.textKey)).not.toMatch(/\{\w+\}/)
    expect(i18nEn.t(notice!.textKey)).not.toMatch(/\{\w+\}/)
  })
})
