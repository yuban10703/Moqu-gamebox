/**
 * 真实字典对齐校验：壳层文案 + 推箱子文案，中英基础 key 必须完全一致。
 * 同一份规则也由 tools/scripts/check-i18n.mjs 在 `npm run check:i18n` 里执行。
 */
import { describe, expect, it } from 'vitest'
import { baseKeys, compareDicts, coreDictEn, coreDictZh, createI18n } from '@eink/core'
import { sokobanEn, sokobanZh } from '../src/i18n.js'

const zh = { ...coreDictZh, ...sokobanZh }
const en = { ...coreDictEn, ...sokobanEn }

describe('中英字典对齐', () => {
  it('没有缺失、多余或复数形式不完整的 key', () => {
    expect(compareDicts({ 'zh-CN': zh, 'en-US': en })).toEqual([])
  })

  it('两边基础 key 数量一致且都非空', () => {
    // 英文会有额外的 __one 复数形式，因此比较的是去掉复数后缀的基础 key
    const zhBase = [...baseKeys(zh)].sort()
    const enBase = [...baseKeys(en)].sort()
    expect(zhBase).toEqual(enBase)
    expect(zhBase.length).toBeGreaterThan(50)
  })

  it('关键流程文案都能取到（避免出现 ⟦…⟧ 占位符）', () => {
    const i18nZh = createI18n('zh-CN', { 'zh-CN': zh, 'en-US': en })
    const i18nEn = createI18n('en-US', { 'zh-CN': zh, 'en-US': en })
    const keys = [
      'shell.app.title',
      'shell.library.continue',
      'shell.detail.replace.title',
      'shell.storage.failed',
      'shell.diagnostics.title',
      'sokoban.title',
      'sokoban.rules.body',
      'sokoban.solved.title',
      'sokoban.blocked',
      'sokoban.difficulty.starter',
    ]
    for (const key of keys) {
      expect(i18nZh.t(key)).not.toContain('⟦')
      expect(i18nEn.t(key)).not.toContain('⟦')
    }
    expect(i18nZh.missingKeys()).toEqual([])
    expect(i18nEn.missingKeys()).toEqual([])
  })

  it('英文的复数形式齐备（中文只用 __other）', () => {
    for (const key of ['sokoban.solved.moves', 'sokoban.solved.pushes', 'sokoban.solved.undos']) {
      expect(en[`${key}__one`]).toBeDefined()
      expect(en[`${key}__other`]).toBeDefined()
      expect(zh[`${key}__other`]).toBeDefined()
    }
  })
})
