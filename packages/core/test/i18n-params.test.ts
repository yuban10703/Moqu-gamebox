/** t()/plural() 缺参会把 {token} 原样渲染（评审发现静默）——这里守「登记进 missingKeys」的口径 */
import { describe, expect, it } from 'vitest'
import { createI18n } from '../src/i18n.js'

describe('i18n 缺参数登记', () => {
  it('t() 部分缺参：传的替换、缺的残留并登记', () => {
    const i = createI18n('zh-CN', { 'zh-CN': { demo: '值 {val} 与 {other}' } })
    expect(i.t('demo', { val: 'A' })).toBe('值 A 与 {other}')
    expect(i.missingKeys().some((key) => key.startsWith('demo'))).toBe(true)
  })

  it('t() 不传参数：按「原文探查」口径不登记（{token} 原样留在输出里）', () => {
    const i = createI18n('zh-CN', { 'zh-CN': { demo: '值 {val}' } })
    expect(i.t('demo')).toBe('值 {val}')
    expect(i.missingKeys()).toHaveLength(0)
  })

  it('参数齐全时不登记（回归：无假阳性）', () => {
    const i = createI18n('zh-CN', { 'zh-CN': { demo: '值 {val}' } })
    expect(i.t('demo', { val: 'x' })).toBe('值 x')
    expect(i.missingKeys()).toHaveLength(0)
  })
})
