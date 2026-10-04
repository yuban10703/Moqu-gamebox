/**
 * 未翻格风格（`coverStyle`）的设置模型：非法值回落、循环切换、默认值。
 *
 * 这是用户要求的「暂停菜单里能切未翻格风格」的**取值层**：壳层只负责画，
 * 取值对不对（旧存档读得进、坏值不炸、循环不跳项）由这里守住。
 */
import { describe, expect, it } from 'vitest'
import {
  COVER_STYLES,
  DEFAULT_COVER_STYLE,
  DEFAULT_SETTINGS,
  mergeSettings,
  nextCoverStyle,
  parseSettings,
  type CoverStyle,
} from '../src/index.js'

describe('coverStyle：默认与解析', () => {
  it('默认是单斜纹（用户选定）；DEFAULT_SETTINGS 里就有这个字段', () => {
    expect(DEFAULT_COVER_STYLE).toBe('stripes')
    expect(DEFAULT_SETTINGS.coverStyle).toBe('stripes')
  })

  it('每一种合法风格都能原样读回（旧存档里的任意一项都不能被吞掉）', () => {
    for (const style of COVER_STYLES) {
      expect(parseSettings({ coverStyle: style }).coverStyle).toBe(style)
    }
  })

  it('未知 / 非字符串 / 缺字段一律回落默认值（旧存档与坏数据都必须能读入）', () => {
    const bad: unknown[] = [
      undefined,
      null,
      'nope',
      '',
      42,
      {},
      [],
      'MARK', // 大小写不宽容：写错了就回落，避免悄悄用上另一种风格
    ]
    for (const value of bad) {
      expect(parseSettings({ coverStyle: value }).coverStyle, JSON.stringify(value)).toBe('stripes')
    }
    expect(parseSettings({}).coverStyle).toBe('stripes')
    expect(parseSettings(null).coverStyle).toBe('stripes')
  })

  it('其余字段照旧解析（新字段不影响老字段）', () => {
    const parsed = parseSettings({ coverStyle: 'gray', fontScale: 1.25, timer: false })
    expect(parsed).toMatchObject({ coverStyle: 'gray', fontScale: 1.25, timer: false })
  })
})

describe('coverStyle：循环切换', () => {
  it('从默认值出发走一圈：每种都恰好出现一次，并回到起点', () => {
    const seen: CoverStyle[] = []
    let current = DEFAULT_COVER_STYLE
    for (let step = 0; step < COVER_STYLES.length; step++) {
      seen.push(current)
      current = nextCoverStyle(current)
    }
    // 顺序不写死（默认值可以是列表里的任意一项），但"一项不漏 + 回到起点"必须成立
    expect([...seen].sort()).toEqual([...COVER_STYLES].sort())
    expect(new Set(seen).size).toBe(COVER_STYLES.length)
    expect(current).toBe(DEFAULT_COVER_STYLE)
  })

  it('暂停菜单里那一个按钮点满一圈：每种风格都出现过（用户要求"都做进去"）', () => {
    // 六种风格 —— 三种字形（居中方块 / 大方块 / 空心方块）+ 三种底纹（网点 / 真灰 / 斜纹）
    expect([...COVER_STYLES]).toEqual(['mark', 'markLarge', 'hollow', 'dots', 'gray', 'stripes'])
  })
})

describe('coverStyle：与 mergeSettings 的配合', () => {
  it('merge 能改风格，其它字段保持', () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, { coverStyle: 'dots' })
    expect(merged.coverStyle).toBe('dots')
    expect(merged.perGame).toEqual(DEFAULT_SETTINGS.perGame)
  })

  it('merge 传进非法值时同样回落（写坏值不会污染快照）', () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, { coverStyle: 'oops' as CoverStyle })
    expect(merged.coverStyle).toBe('stripes')
  })
})
