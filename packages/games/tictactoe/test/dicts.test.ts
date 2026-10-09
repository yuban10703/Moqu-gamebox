/**
 * 真实字典对齐校验：壳层文案 + 井字棋文案，中英基础 key 必须完全一致，
 * 并且「视图/控件/格子标签/结果明细/状态提示里出现的 key」都必须能取到文案
 * （避免界面上冒出 ⟦key⟧）。与核心层 `npm run check:i18n` 的规则一致。
 */
import { describe, expect, it } from 'vitest'
import { baseKeys, compareDicts, coreDictEn, coreDictZh, createI18n, type CellKind } from '@eink/core'
import {
  CELL_LABEL_KEYS,
  DIFFICULTY_IDS,
  cellLabelKey,
  createState,
  legalActions,
  reduceState,
  tictactoeEn,
  tictactoeGame,
  tictactoeZh,
  type TictactoeState,
} from '../src/index.js'
import { settle, stateOf } from './helpers.js'

const zh = { ...coreDictZh, ...tictactoeZh }
const en = { ...coreDictEn, ...tictactoeEn }
const i18nZh = createI18n('zh-CN', { 'zh-CN': zh, 'en-US': en })
const i18nEn = createI18n('en-US', { 'zh-CN': zh, 'en-US': en })

/** 覆盖到所有会产生文案的分支：开局 / 等应手 / 两拍中 / 提示 / 三种终局 / 同屏 */
const STATES: TictactoeState[] = [
  createState(1, 'starter'),
  reduceState(createState(1, 'starter'), { type: 'place', index: 4 }),
  reduceState(reduceState(createState(1, 'starter'), { type: 'place', index: 4 }), { type: 'tick' }),
  reduceState(createState(1, 'skilled'), { type: 'hint' }),
  settle(reduceState(createState(1, 'skilled'), { type: 'place', index: 4 })),
  stateOf([0, 3, 1, 4, 2], { difficulty: 'starter' }),
  stateOf([0, 3, 1, 4, 8, 5], { difficulty: 'challenging' }),
  stateOf([0, 1, 2, 4, 3, 5, 8, 6, 7], { difficulty: 'starter' }),
  stateOf([0, 1, 2, 4, 3, 5, 8, 6, 7], { difficulty: 'hotseat' }),
  stateOf([0, 3, 1, 4, 2], { difficulty: 'hotseat' }),
  stateOf([0, 3, 1, 4, 8, 5], { difficulty: 'hotseat' }),
]

describe('中英字典对齐', () => {
  it('没有缺失、多余或复数形式不完整的 key', () => {
    expect(compareDicts({ 'zh-CN': zh, 'en-US': en })).toEqual([])
    expect([...baseKeys(tictactoeZh)].sort()).toEqual([...baseKeys(tictactoeEn)].sort())
  })

  it('英文复数形式齐备（中文只用 __other）', () => {
    for (const key of ['tictactoe.result.moves', 'tictactoe.solved.best']) {
      expect(en[`${key}__one`], key).toBeDefined()
      expect(en[`${key}__other`], key).toBeDefined()
      expect(zh[`${key}__other`], key).toBeDefined()
    }
    expect(zh['tictactoe.solved.best']).toBeDefined()
    expect(en['tictactoe.solved.best']).toBeDefined()
  })

  it('结果明细按复数取词，中英都不缺词', () => {
    expect(i18nZh.plural('tictactoe.result.moves', 9, { count: 9 })).toContain('9')
    expect(i18nEn.plural('tictactoe.result.moves', 1, { count: 1 })).toContain('1 move')
    expect(i18nEn.plural('tictactoe.result.moves', 5, { count: 5 })).toContain('5 moves')
    for (const key of ['tictactoe.result.draw', 'tictactoe.turn.you', 'tictactoe.action.hint']) {
      expect(i18nZh.t(key), key).not.toMatch(/\{\w+\}/)
      expect(i18nEn.t(key), key).not.toMatch(/\{\w+\}/)
    }
  })

  it('标题、规则、难度、动作、状态、非法提示等关键文案都不缺', () => {
    const keys = [
      'tictactoe.title',
      'tictactoe.rules.body',
      'tictactoe.rules.body2',
      'tictactoe.rules.body3',
      'tictactoe.rules.restart',
      'tictactoe.illegal.notice',
      'tictactoe.action.hint',
      'tictactoe.won.title',
      'tictactoe.lost.title',
      'tictactoe.draw.title',
      'tictactoe.won.p1',
      'tictactoe.won.p2',
      'tictactoe.result.draw',
      'tictactoe.solved.best',
      'tictactoe.turn.you',
      'tictactoe.turn.computer',
      'tictactoe.turn.p1',
      'tictactoe.turn.p2',
      ...DIFFICULTY_IDS.map((id) => `tictactoe.difficulty.${id}`),
    ]
    for (const key of keys) {
      expect(i18nZh.t(key), key).not.toContain('⟦')
      expect(i18nEn.t(key), key).not.toContain('⟦')
    }
    // 带 count 的明细走 plural（基础键本身不存在，只有 __one / __other）
    expect(i18nZh.plural('tictactoe.result.moves', 5, { count: 5 })).not.toContain('⟦')
    expect(i18nEn.plural('tictactoe.result.moves', 5, { count: 5 })).not.toContain('⟦')
    expect(i18nZh.missingKeys()).toEqual([])
    expect(i18nEn.missingKeys()).toEqual([])
  })

  it('视图、控件、状态提示、结果里出现的 key 两种语言都取得到', () => {
    for (const state of STATES) {
      const view = tictactoeGame.view(state)
      const keys: string[] = [
        `${tictactoeGame.i18nNamespace}.title`,
        tictactoeGame.illegalNoticeKey ?? '',
        ...view.stats.map((stat) => stat.labelKey),
        ...tictactoeGame.controls(state).map((control) => control.labelKey),
        ...tictactoeGame.difficulties.map((difficulty) => difficulty.labelKey),
        ...(Object.values(CELL_LABEL_KEYS).filter(Boolean) as string[]),
        ...(view.notice ? [view.notice.textKey] : []),
        ...(view.result ? [view.result.titleKey] : []),
      ]
      for (const key of keys) {
        expect(i18nZh.t(key), key).not.toContain('⟦')
        expect(i18nEn.t(key), key).not.toContain('⟦')
      }
      // 明细带 params 的一律按复数取词（壳层就是这么渲染的）
      for (const detail of view.result?.details ?? []) {
        const count = Number(detail.params?.count ?? 0)
        const text = detail.params
          ? i18nZh.plural(detail.key, count, detail.params)
          : i18nZh.t(detail.key)
        const textEn = detail.params
          ? i18nEn.plural(detail.key, count, detail.params)
          : i18nEn.t(detail.key)
        expect(text, detail.key).not.toContain('⟦')
        expect(textEn, detail.key).not.toContain('⟦')
      }
    }
    expect(i18nZh.missingKeys()).toEqual([])
    expect(i18nEn.missingKeys()).toEqual([])
  })

  it('cellLabelKey 只映射井字棋用到的三种 kind，未知 kind 返回 undefined', () => {
    expect(cellLabelKey('tile')).toBe('tictactoe.cell.tile')
    expect(cellLabelKey('empty')).toBe('tictactoe.cell.empty')
    expect(cellLabelKey('number')).toBe('tictactoe.cell.hint')
    expect(cellLabelKey('wall' as CellKind)).toBeUndefined()
  })

  it('规则说明覆盖四档难度与两拍应手（玩家读得到这些差异）', () => {
    for (const key of ['tictactoe.rules.body', 'tictactoe.rules.body2', 'tictactoe.rules.body3']) {
      expect(i18nZh.t(key).length, key).toBeGreaterThan(20)
      expect(i18nEn.t(key).length, key).toBeGreaterThan(20)
    }
    // 双人同屏要在规则里说清（它是第四档难度，详情页上只有名字）
    expect(i18nZh.t('tictactoe.rules.body3')).toContain('玩家一')
    expect(i18nEn.t('tictactoe.rules.body3')).toContain('Player 1')
  })

  it('每个合法动作集合都不为空（回放/按钮都有可派发的东西）', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      expect(legalActions(createState(1, difficulty)).length).toBeGreaterThan(0)
    }
  })
})
