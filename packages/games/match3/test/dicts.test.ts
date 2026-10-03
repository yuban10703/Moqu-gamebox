/**
 * 字典对齐测试：中英基础 key 集合必须一致，且键名都落在 match3 命名空间里。
 *
 * 语言对齐的完整规则由 core 的 `compareDicts` 给出（check-i18n 脚本用的是同一份规则）：
 * 1. 各语言的基础 key 集合完全一致（`__one` / `__other` 折叠后比较）；
 * 2. 某语言为某个 key 定义了复数形式时，所有语言都必须有 `__other`；
 * 3. `__one` 可选（中文只用 `__other`）。
 */
import { describe, expect, it } from 'vitest'
import { baseKeys, compareDicts, coreDictEn, coreDictZh, createI18n, type Dict } from '@eink/core'
import { match3En, match3Game, match3Zh } from '../src/index.js'

const zh: Dict = { ...coreDictZh, ...match3Zh }
const en: Dict = { ...coreDictEn, ...match3En }

describe('match3 字典', () => {
  it('中英基础 key 完全一致，且没有多余/缺失的复数形式', () => {
    expect(compareDicts({ 'zh-CN': match3Zh, 'en-US': match3En })).toEqual([])
    expect([...baseKeys(match3Zh)].sort()).toEqual([...baseKeys(match3En)].sort())
  })

  it('所有键都在 match3 命名空间下（防止写错前缀导致界面缺词）', () => {
    for (const dict of [match3Zh, match3En]) {
      for (const key of Object.keys(dict)) {
        expect(key.startsWith('match3.')).toBe(true)
      }
    }
    expect(match3Game.i18nNamespace).toBe('match3')
  })

  it('中英两份字典的非单数 key 逐字相同（复数只允许英文多出 __one）', () => {
    const zhKeys = Object.keys(match3Zh).sort()
    const enKeys = Object.keys(match3En).sort()
    // 中文只用 __other；英文可以多出 __one，但除此之外键名必须一一对应
    for (const key of zhKeys) {
      if (key.endsWith('__one')) continue
      expect(enKeys, key).toContain(key)
    }
    for (const key of enKeys) {
      if (key.endsWith('__one')) continue
      expect(zhKeys, key).toContain(key)
    }
    const enOnes = enKeys.filter((key) => key.endsWith('__one'))
    expect(enOnes.length).toBeGreaterThan(0)
    expect(Object.keys(match3Zh).some((key) => key.endsWith('__one'))).toBe(false)
  })

  it('壳层会直接取的 key（标题 / 难度 / 规则 / 重开确认）都能取到', () => {
    const i18nZh = createI18n('zh-CN', { 'zh-CN': zh, 'en-US': en })
    const i18nEn = createI18n('en-US', { 'zh-CN': zh, 'en-US': en })
    const keys = [
      'match3.title',
      'match3.rules.body',
      'match3.rules.body2',
      'match3.rules.body3',
      'match3.rules.restart',
      'match3.difficulty.starter',
      'match3.difficulty.skilled',
      'match3.difficulty.challenging',
      'match3.solved.best__other',
      'shell.game.undo',
    ]
    for (const key of keys) {
      expect(i18nZh.t(key)).not.toContain('⟦')
      expect(i18nEn.t(key)).not.toContain('⟦')
    }
    expect(i18nZh.missingKeys()).toEqual([])
    expect(i18nEn.missingKeys()).toEqual([])
  })

  it('中文文案里保留的中文与英文文案互不相同（没有直接复制粘贴漏翻）', () => {
    for (const key of Object.keys(match3Zh)) {
      if (key.endsWith('__one')) continue
      expect(match3En[key], key).toBeDefined()
      expect(match3Zh[key], key).not.toBe(match3En[key])
    }
  })
})
