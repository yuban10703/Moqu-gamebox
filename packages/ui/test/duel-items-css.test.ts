/**
 * 道具栏压缩（单行 8 格）的回归护栏 —— 读 styles.css 的源码文本，钉住三件事。
 *
 * 由来：原来道具是「4 列 × 2 行」，单侧要吃掉 92~112px，比战斗记录（107px）还高；
 * 用户要求在几套方案里选，最后选了 P1「压成一行 8 格、保留小字」。
 *
 * 为什么用读源码的方式（与贪吃蛇那条间隔断言同一套路）：尺寸全在 CSS 里，
 * jsdom 不加载样式表，算不出 grid-template-columns 与槽高 —— 于是把"选定的值"
 * 直接钉在文本上：谁要再改成两行或放大槽高，这条会红，必须连同理由一起改。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MAX_ITEMS } from '@eink/buckshot'

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')

function ruleBody(selector: string): string {
  const index = css.indexOf(selector)
  expect(index, `styles.css 里找不到 ${selector}`).toBeGreaterThanOrEqual(0)
  const open = css.indexOf('{', index)
  const close = css.indexOf('}', open)
  return css.slice(open + 1, close)
}

describe('对决道具栏：单行 8 格', () => {
  it('道具网格是「一行放满 8 格」，不是两行', () => {
    const body = ruleBody('.eink-duel__items {')
    // 列数必须正好等于道具上限 —— MAX_ITEMS 涨了这条会红，逼着一起改
    expect(body).toMatch(new RegExp(`grid-template-columns:\\s*repeat\\(${MAX_ITEMS},\\s*minmax\\(0,\\s*1fr\\)\\)`))
    expect(body).not.toMatch(/grid-template-rows|grid-auto-rows/)
  })

  it('槽高是一行的量级（上 44 / 下 48px 上限），并跟容器单位走', () => {
    const top = /--slot-top:\s*min\(([\d.]+)cqh,\s*(\d+)px\)/.exec(css)
    const bottom = /--slot-bottom:\s*min\(([\d.]+)cqh,\s*(\d+)px\)/.exec(css)
    expect(top, '--slot-top 不见了').not.toBeNull()
    expect(bottom, '--slot-bottom 不见了').not.toBeNull()
    expect(Number(top![2])).toBe(44)
    expect(Number(bottom![2])).toBe(48) // 下家可点：不低于 48px 触摸下限
    // 用了容器单位：屏幕/字号档变化时能自己缩，而不是写死像素
    expect(Number(top![1])).toBeGreaterThan(0)
    expect(Number(bottom![1])).toBeGreaterThan(0)
  })

  it('头像不得再撑高上家那一块（它必须小于右列，才不会在道具行下留空）', () => {
    // 用户反馈「道具栏只有一排了，下面怎么还是空的」：道具压成一行后右列 ≈ 77px，
    // 而头像当时还是 min(18cqh, 96px) —— 整块被头像撑住，道具行下空出 19px。
    const body = ruleBody('.eink-duel__portrait {')
    const w = /width:\s*min\(([\d.]+)cqh,\s*(\d+)px\)/.exec(body)
    const h = /height:\s*min\(([\d.]+)cqh,\s*(\d+)px\)/.exec(body)
    expect(w, '头像宽度不再是 cq 表达').not.toBeNull()
    expect(h, '头像高度不再是 cq 表达').not.toBeNull()
    // 上限必须明显小于「名字 + 血量 + 道具」那一列，否则又会顶出空白
    expect(Number(w![2])).toBeLessThanOrEqual(64)
    expect(Number(h![2])).toBeLessThanOrEqual(64)
    // 仍然是正方形：宽高两个表达式必须一致
    expect(w![1]).toBe(h![1])
    expect(w![2]).toBe(h![2])
  })

  it('槽内小字与图标按单行缩过一档', () => {
    const slot = ruleBody('.eink-duel__slot {')
    expect(slot).toMatch(/font-size:\s*0\.5em/)
    const svg = ruleBody('.eink-duel__slot > svg {')
    expect(svg).toMatch(/width:\s*42%/)
    expect(svg).toMatch(/height:\s*42%/)
    // 名字太长时靠省略号收尾（不能换行 —— 换行会把行高顶开）
    const label = ruleBody('.eink-duel__slotlabel {')
    expect(label).toMatch(/white-space:\s*nowrap/)
    expect(label).toMatch(/text-overflow:\s*ellipsis/)
  })
})

describe('开枪标记：不许再变成覆盖层', () => {
  it('.eink-duel__fire 是行内小块（不是 absolute / 不铺满）', () => {
    // 用户要求「画面在原本的基础上改，不要挡住原来的枪和子弹」：
    // 覆盖层那版会把枪、弹仓、说明整段盖住，这里钉住它必须留在文档流里。
    const index = css.lastIndexOf('.eink-duel__fire {')
    expect(index, 'styles.css 里找不到 .eink-duel__fire').toBeGreaterThanOrEqual(0)
    const body = css.slice(css.indexOf('{', index) + 1, css.indexOf('}', index))
    expect(body).toMatch(/position:\s*static/)
    expect(body).not.toMatch(/position:\s*absolute/)
    // 中和旧规则用的 inset: auto 是允许的；不许出现真的定位值（0 / 百分比 / px）
    expect(body).not.toMatch(/inset:\s*(0|\d|100%|[\d.]+px)/)
  })
})

