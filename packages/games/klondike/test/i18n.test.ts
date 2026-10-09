/**
 * 文案测试：中英两套 key 必须完全一致、前缀必须统一、界面上真的取得到词。
 *
 * 与推箱子的 dicts.test.ts 同一套路（compareDicts 是壳层与 check-i18n.mjs 共用的规则）：
 * 中英 key 一旦对不上，英文界面就会冒出 ⟦klondike.xxx⟧ 这种占位符，
 * 而这一类缺陷单看中文界面永远发现不了。
 */
import { describe, expect, it } from 'vitest'
import { baseKeys, compareDicts, coreDictEn, coreDictZh, createI18n } from '@eink/core'
import { DIFFICULTY_IDS } from '../src/engine.js'
import { klondikeEn, klondikeZh } from '../src/i18n.js'

const zh = { ...coreDictZh, ...klondikeZh }
const en = { ...coreDictEn, ...klondikeEn }
const i18nZh = createI18n('zh-CN', { 'zh-CN': zh, 'en-US': en })
const i18nEn = createI18n('en-US', { 'zh-CN': zh, 'en-US': en })

describe('中英字典对齐', () => {
  it('没有缺失、多余或复数形式不完整的 key', () => {
    expect(compareDicts({ 'zh-CN': zh, 'en-US': en })).toEqual([])
  })

  it('两套基础 key 完全一致，而且都在 klondike. 前缀下', () => {
    const zhKeys = [...baseKeys(klondikeZh)].sort()
    const enKeys = [...baseKeys(klondikeEn)].sort()
    expect(zhKeys).toEqual(enKeys)
    for (const key of zhKeys) {
      expect(key.startsWith('klondike.'), `${key} 的前缀不对`).toBe(true)
    }
    // 任务要求覆盖的几类文案都在：游戏名 / 难度名 / 动作按钮 / 状态与结果 / 记录
    for (const key of [
      'klondike.title',
      'klondike.difficulty.starter',
      'klondike.difficulty.skilled',
      'klondike.action.collect',
      'klondike.action.restartDeal',
      'klondike.action.nextDeal',
      'klondike.banner.pick',
      'klondike.banner.drop',
      'klondike.won.title',
      'klondike.solved.best',
      'klondike.result.deal',
      'klondike.result.moves',
      'klondike.illegal.notice',
      'klondike.rules.body',
      'klondike.rules.restart',
    ]) {
      expect(zhKeys, `${key} 不在字典里`).toContain(key)
    }
    // 两种难度的 labelKey 就是 GameDef 声明的那两个
    expect(DIFFICULTY_IDS).toEqual(['starter', 'skilled'])
  })

  it('取值不会掉进 ⟦占位符⟧，且两套都非空', () => {
    // 逐个真 key 取（含 __other / __one 这类复数键，它们是模板、带 {count} 占位符）
    for (const key of Object.keys(klondikeZh)) {
      expect(i18nZh.t(key), key).not.toContain('⟦')
      expect(i18nZh.t(key).length).toBeGreaterThan(0)
    }
    for (const key of Object.keys(klondikeEn)) {
      expect(i18nEn.t(key), key).not.toContain('⟦')
      expect(i18nEn.t(key).length).toBeGreaterThan(0)
    }
    // 每个基础 key 在两种语言里都取得到 —— 取不到就会是 ⟦key⟧
    for (const key of baseKeys(klondikeZh)) {
      const rendered = i18nZh.has(key) ? i18nZh.t(key) : i18nZh.plural(key, 2)
      expect(rendered, key).not.toContain('⟦')
      const renderedEn = i18nEn.has(key) ? i18nEn.t(key) : i18nEn.plural(key, 2)
      expect(renderedEn, key).not.toContain('⟦')
    }
    expect(i18nZh.missingKeys()).toEqual([])
    expect(i18nEn.missingKeys()).toEqual([])
  })

  it('带参数的文案（结果面板用 plural）两种语言都齐备，插值也对', () => {
    // 结果面板走的是 i18n.plural(key, count)：中文只要求 __other，英文两个都要
    for (const key of ['klondike.result.deal', 'klondike.result.moves']) {
      expect(klondikeZh[`${key}__other`]).toBeDefined()
      expect(klondikeEn[`${key}__one`]).toBeDefined()
      expect(klondikeEn[`${key}__other`]).toBeDefined()
    }
    expect(i18nZh.plural('klondike.result.deal', 3)).toContain('3')
    expect(i18nEn.plural('klondike.result.moves', 1)).toContain('1')
    expect(i18nEn.plural('klondike.result.moves', 1)).not.toContain('moves')
    expect(i18nEn.plural('klondike.result.moves', 4)).toContain('moves')
    // 最佳步数那条是普通 t（壳层用 i18n.t 取），参数名叫 count
    expect(i18nZh.t('klondike.solved.best', { count: 42 })).toContain('42')
    expect(i18nEn.t('klondike.solved.best', { count: 42 })).toContain('42')
  })

  it('壳层自己渲染的两个 key（撤销）在 core 字典里，本包直接用它的 labelKey', () => {
    expect(zh['shell.game.undo']).toBeDefined()
    expect(en['shell.game.undo']).toBeDefined()
  })
})
