/**
 * 真实字典对齐校验：壳层文案 + 数织文案，中英基础 key 必须完全一致，
 * 并且「视图 / 控件 / 格子标签 / 提示 / 结果」里出现的 key 都必须能取到文案
 * （避免界面上冒出 ⟦key⟧）。
 */
import { describe, expect, it } from 'vitest'
import { baseKeys, compareDicts, coreDictEn, coreDictZh, createI18n } from '@eink/core'
import {
  DIFFICULTY_IDS,
  nonogramEn,
  nonogramGame,
  nonogramZh,
  puzzleOf,
  solutionBits,
  type NonogramState,
} from '../src/index.js'
import { CELL_LABEL_KEYS } from '../src/view.js'

const zh = { ...coreDictZh, ...nonogramZh }
const en = { ...coreDictEn, ...nonogramEn }

const i18nZh = createI18n('zh-CN', { 'zh-CN': zh, 'en-US': en })
const i18nEn = createI18n('en-US', { 'zh-CN': zh, 'en-US': en })

/** 照答案涂满（最后一下正好过关，之后不能再派发动作） */
function solve(state: NonogramState): NonogramState {
  const answer = solutionBits(puzzleOf(state))
  let next = state
  for (let index = 0; index < answer.length; index++) {
    if (answer[index]) next = nonogramGame.reduce(next, { type: 'cycle', index })
  }
  return next
}

const game = nonogramGame
const fresh = game.create(0, 'starter')
/** 涂错一格 + 检查：拿到 notice 与统计栏的 key */
const checked = game.reduce(game.reduce(fresh, { type: 'cycle', index: 0 }), { type: 'check' })
const solved = solve(fresh)

describe('中英字典对齐', () => {
  it('没有缺失、多余或复数形式不完整的 key', () => {
    expect(compareDicts({ 'zh-CN': zh, 'en-US': en })).toEqual([])
  })

  it('两边基础 key 集合完全一致，且都带 nonogram. 前缀', () => {
    const zhKeys = [...baseKeys(nonogramZh)].sort()
    const enKeys = [...baseKeys(nonogramEn)].sort()
    expect(zhKeys).toEqual(enKeys)
    expect(zhKeys.length).toBeGreaterThan(0)
    for (const key of zhKeys) expect(key.startsWith('nonogram.')).toBe(true)
  })

  it('英文复数形式齐备（中文只用 __other）', () => {
    for (const key of ['nonogram.result.moves', 'nonogram.result.puzzle']) {
      expect(en[`${key}__one`]).toBeDefined()
      expect(en[`${key}__other`]).toBeDefined()
      expect(zh[`${key}__other`]).toBeDefined()
    }
  })

  it('壳层结果面板的「最佳」行取得到词（缺了就会漏出 ⟦nonogram.solved.best⟧）', () => {
    // 壳层渲染这一行走的是 i18n.t(key, { count })，并且先用 i18n.has(key) 判断要不要渲染，
    // 因此**基础键本身**必须存在：只写 __one / __other 后缀的话 has() 是 false，那一行不会出现。
    for (const dict of [zh, en]) {
      expect(dict['nonogram.solved.best'], 'nonogram.solved.best').toBeDefined()
    }
    expect(i18nZh.has('nonogram.solved.best')).toBe(true)
    expect(i18nEn.has('nonogram.solved.best')).toBe(true)
    // 数字要插进句子里（走查时那一行本该显示「最佳 33 步」）
    for (const i18n of [i18nZh, i18nEn]) {
      const text = i18n.t('nonogram.solved.best', { count: 33 })
      expect(text).toContain('33')
      expect(text).not.toContain('⟦')
    }
  })

  it('结果详情用复数键渲染，中英都不缺词', () => {
    expect(i18nZh.plural('nonogram.result.moves', 12, { count: 12 })).toContain('12')
    expect(i18nEn.plural('nonogram.result.moves', 1, { count: 1 })).toContain('1 move')
    expect(i18nEn.plural('nonogram.result.moves', 3, { count: 3 })).toContain('3 moves')
    expect(i18nZh.plural('nonogram.result.puzzle', 2, { count: 2 })).toContain('2')
    expect(i18nEn.plural('nonogram.result.puzzle', 2, { count: 2 })).toContain('2')
  })

  it('标题、规则、难度、动作、非法提示、结果与提示文案都不缺', () => {
    const keys = [
      'nonogram.title',
      'nonogram.rules.body',
      'nonogram.rules.body2',
      'nonogram.rules.restart',
      'nonogram.stat.puzzle',
      'nonogram.stat.black',
      'nonogram.stat.wrong',
      'nonogram.notice.check',
      'nonogram.result.title',
      // 壳层在结果面板末尾接的那一句（走查时缺的就是它）
      'nonogram.solved.best',
      ...DIFFICULTY_IDS.map((id) => `nonogram.difficulty.${id}`),
      ...(Object.values(CELL_LABEL_KEYS).filter(Boolean) as string[]),
    ]
    for (const key of keys) {
      expect(i18nZh.t(key), key).not.toContain('⟦')
      expect(i18nEn.t(key), key).not.toContain('⟦')
    }
    expect(i18nZh.missingKeys()).toEqual([])
    expect(i18nEn.missingKeys()).toEqual([])
  })
})

describe('界面里出现的 key 都能取到文案', () => {
  it('统计栏 / 控件 / 难度 / 非法提示 / 格子标签', () => {
    const keys: string[] = [
      `${game.i18nNamespace}.title`,
      game.illegalNoticeKey ?? '',
      ...game.difficulties.map((difficulty) => difficulty.labelKey),
      ...game.controls(fresh).map((control) => control.labelKey),
      ...game.view(fresh).stats.map((stat) => stat.labelKey),
      ...(Object.values(CELL_LABEL_KEYS).filter(Boolean) as string[]),
    ]
    for (const key of keys) {
      expect(i18nZh.t(key), key).not.toContain('⟦')
      expect(i18nEn.t(key), key).not.toContain('⟦')
    }
  })

  it('提示与结果里的 key（检查之后、过关之后）', () => {
    const noticeKey = game.view(checked).notice?.textKey
    const result = game.view(solved).result
    expect(noticeKey).toBe('nonogram.notice.check')
    expect(result).not.toBeNull()
    // 提示与结果标题走 t()；结果**明细**带 count → 壳层走 plural()（所以基础键必须有 __one/__other）
    for (const key of [noticeKey!, result!.titleKey]) {
      expect(i18nZh.t(key), key).not.toContain('⟦')
      expect(i18nEn.t(key), key).not.toContain('⟦')
    }
    for (const detail of result!.details) {
      const count = detail.params?.count as number
      expect(i18nZh.plural(detail.key, count, detail.params), detail.key).not.toContain('⟦')
      expect(i18nEn.plural(detail.key, count, detail.params), detail.key).not.toContain('⟦')
    }
  })

  it('难度 id 与 labelKey 一一对应（详情页直接用）', () => {
    expect(game.difficulties.map((difficulty) => difficulty.id)).toEqual([...DIFFICULTY_IDS])
    for (const difficulty of game.difficulties) {
      expect(difficulty.labelKey).toBe(`nonogram.difficulty.${difficulty.id}`)
    }
    expect(game.i18nNamespace).toBe('nonogram')
    expect(game.id).toBe('nonogram')
  })
})
