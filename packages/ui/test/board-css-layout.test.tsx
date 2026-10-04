// @vitest-environment jsdom
/**
 * 棋盘几何的回归护栏：**尺寸全在 CSS，JS 一个像素都不给**。
 *
 * 由来：格子边长曾被 JS 算出来（ResizeObserver + getBoundingClientRect + computeBoardLayout），
 * 再以内联样式写进 .eink-board —— 这条链路反复产生「棋盘比可用区高、底部被裁」的缺陷，
 * 还被迫加过「不超过实测值」的夹紧 hack。现在几何改由 CSS 容器查询决定
 * （styles.css 的 .eink-board：100cqw/100cqh + min() + round()），组件只提供棋盘的**形状**。
 *
 * 这里守住三件事（任何一件破了，就说明 JS 又开始管尺寸了）：
 *   1) 只给形状：--board-cols / --board-rows 等于棋盘的列数/行数；
 *   2) 没有内联像素几何：根元素的行内样式里不出现 px（宽度/行高/外框/--cell 都不许写）；
 *   3) 图形 SVG 不自带 width/height 属性：尺寸由 CSS 的百分比给（跟随格子）。
 */
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import type { BoardView, CellView } from '@eink/core'
import { Board } from '../src/components.js'

function grid(cols: number, rows: number, patch: (index: number) => Partial<CellView> = () => ({})): BoardView {
  const cells: CellView[] = []
  for (let index = 0; index < cols * rows; index++) {
    cells.push({ index, kind: 'tile', glyph: String(index + 1), ...patch(index) })
  }
  return { kind: 'grid', cols, rows, cells }
}

describe('棋盘：几何由 CSS 决定，JS 只给形状', () => {
  it('列数/行数以自定义属性给出（供 CSS 的 repeat()/calc() 使用）', () => {
    const { container } = render(<Board board={grid(9, 9)} />)
    const board = container.querySelector('.eink-board') as HTMLElement
    expect(board.style.getPropertyValue('--board-cols')).toBe('9')
    expect(board.style.getPropertyValue('--board-rows')).toBe('9')
    // 无障碍/测试用的形状信息仍然准确
    expect(board.getAttribute('aria-colcount')).toBe('9')
    expect(board.getAttribute('aria-rowcount')).toBe('9')
    expect(container.querySelectorAll('.eink-board__cell')).toHaveLength(81)
  })

  it('根元素的行内样式里没有任何像素值（尺寸、外框、格子变量都不许由 JS 写）', () => {
    const { container } = render(<Board board={grid(4, 5)} />)
    const board = container.querySelector('.eink-board') as HTMLElement
    const inline = board.getAttribute('style') ?? ''
    expect(inline).not.toMatch(/px/)
    for (const prop of ['width', 'height', 'grid-template-columns', 'grid-template-rows', 'border-width']) {
      expect(board.style.getPropertyValue(prop), prop).toBe('')
    }
    // --cell 是 CSS 自己算出来的（容器查询 + min()），组件不得覆盖它
    expect(board.style.getPropertyValue('--cell')).toBe('')
  })

  it('格子图形不带 width/height 属性：尺寸由 CSS 按格子的百分比给', () => {
    const { container } = render(<Board board={grid(3, 3, () => ({ kind: 'box', glyph: '' }))} />)
    const svgs = container.querySelectorAll('.eink-board__cell svg')
    expect(svgs.length).toBe(9)
    for (const svg of svgs) {
      expect(svg.getAttribute('width')).toBeNull()
      expect(svg.getAttribute('height')).toBeNull()
      // viewBox 必须保留：CSS 只改尺寸，坐标系仍由它决定
      expect(svg.getAttribute('viewBox')).toBe('0 0 24 24')
    }
  })

  it('游戏给出的文字缩放系数仍然按格子尺寸换算（var(--cell) 继承自棋盘）', () => {
    const { container } = render(
      <Board board={grid(2, 2, () => ({ kind: 'given', glyph: '5', textScale: 0.74 }))} />,
    )
    const span = container.querySelector('.eink-board__text') as HTMLElement
    expect(span.style.fontSize).toContain('var(--cell')
    expect(span.style.fontSize).toContain('0.74')
  })
})

describe('未翻格的斜纹画在棋盘上（用户报「斜纹斜着对不齐」）', () => {
  /** 每格各画一份 45° 底纹时，图案原点各从格子的左上角算起 —— 线在格边必然错位 */
  const withHidden = {
    kind: 'grid' as const,
    cols: 2,
    rows: 1,
    cells: [
      { index: 0, kind: 'hidden' as const, glyph: '' },
      { index: 1, kind: 'number' as const, glyph: '1' },
    ],
  }

  it('有未翻格：棋盘带 data-cover，未翻格自身不带字形、不画图案', () => {
    const { container } = render(<Board board={withHidden} />)
    const board = container.querySelector('.eink-board')!
    expect(board.getAttribute('data-cover')).toBe('yes')
    const hidden = container.querySelector(".eink-board__cell[data-kind='hidden']")!
    // 标记与底纹都不在格子上（格子只负责"透明，透出棋盘的底纹"）
    expect(hidden.querySelector('.eink-board__text')).toBeNull()
    expect(hidden.getAttribute('data-cover')).toBeNull()
  })

  it('没有未翻格：棋盘不带 data-cover（数独/2048 这些不该出现斜纹）', () => {
    const { container } = render(
      <Board
        board={{
          kind: 'grid',
          cols: 2,
          rows: 1,
          cells: [
            { index: 0, kind: 'number', glyph: '1' },
            { index: 1, kind: 'empty', glyph: '' },
          ],
        }}
      />,
    )
    expect(container.querySelector('.eink-board')!.getAttribute('data-cover')).toBeNull()
  })
})
