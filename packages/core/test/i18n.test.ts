/**
 * i18n 运行时机制测试（真实字典的对齐由 check-i18n 与 dicts.test.ts 负责）。
 */
import { describe, expect, it } from 'vitest'
import { compareDicts, createI18n, detectLocale, interpolate } from '../src/i18n.js'

const dicts = {
  'zh-CN': {
    'a.hello': '你好 {name}',
    'a.count__other': '共 {count} 项',
    'a.only_zh': '仅中文',
  },
  'en-US': {
    'a.hello': 'Hello {name}',
    'a.count__one': '{count} item',
    'a.count__other': '{count} items',
    'a.only_zh': 'Only English',
  },
}

describe('文案查找与插值', () => {
  it('按语言取词并替换参数', () => {
    expect(createI18n('zh-CN', dicts).t('a.hello', { name: '小明' })).toBe('你好 小明')
    expect(createI18n('en-US', dicts).t('a.hello', { name: 'Boox' })).toBe('Hello Boox')
  })

  it('缺词时返回可见的占位符，而不是静默回落成别的语言', () => {
    const i18n = createI18n('zh-CN', { 'zh-CN': {}, 'en-US': {} })
    expect(i18n.t('missing.key')).toBe('⟦missing.key⟧')
    expect(i18n.missingKeys()).toContain('missing.key')
  })

  it('复数按语言规则选择 __one/__other，缺失 __one 时回落 __other', () => {
    const zh = createI18n('zh-CN', dicts)
    const en = createI18n('en-US', dicts)
    expect(zh.plural('a.count', 1)).toBe('共 1 项')
    expect(zh.plural('a.count', 5)).toBe('共 5 项')
    expect(en.plural('a.count', 1)).toBe('1 item')
    expect(en.plural('a.count', 3)).toBe('3 items')
  })

  it('插值遇到未知参数时保留原样（便于发现漏传参数）', () => {
    expect(interpolate('x={x} y={y}', { x: 1 })).toBe('x=1 y={y}')
  })

  it('has 能判断 key 是否存在', () => {
    const i18n = createI18n('zh-CN', dicts)
    expect(i18n.has('a.hello')).toBe(true)
    expect(i18n.has('nope')).toBe(false)
  })
})

describe('语言推断', () => {
  it('zh 系列落到 zh-CN，en 系列落到 en-US，其它落到 zh-CN', () => {
    expect(detectLocale(['zh-Hant-TW'])).toBe('zh-CN')
    expect(detectLocale(['en-GB'])).toBe('en-US')
    expect(detectLocale(['ja-JP'])).toBe('zh-CN')
    expect(detectLocale([])).toBe('zh-CN')
  })
})

describe('字典对齐校验', () => {
  it('缺少的 key 会被报出来', () => {
    const issues = compareDicts({
      'zh-CN': { 'x.a': '甲' },
      'en-US': {},
    })
    expect(issues.some((issue) => issue.key === 'x.a' && issue.kind === 'missing')).toBe(true)
  })

  it('有复数键但缺 __other 会被报出来', () => {
    const issues = compareDicts({
      'zh-CN': { 'x.b__other': '甲' },
      'en-US': { 'x.b__one': 'A' },
    })
    expect(issues.some((issue) => issue.key === 'x.b' && issue.kind === 'missing-other')).toBe(true)
  })

  it('只有 __one 的语言不影响中文只写 __other 的写法', () => {
    const issues = compareDicts({
      'zh-CN': { 'x.c__other': '甲' },
      'en-US': { 'x.c__one': 'A', 'x.c__other': 'As' },
    })
    expect(issues).toEqual([])
  })
})
