// @vitest-environment jsdom
/**
 * 提示条文案的**单行预算**守卫。
 *
 * 由来（用户报的真实缺陷）：竖屏 P6Plus 上贪吃蛇的提示
 * 「这一步走不通（不能原地掉头，或本局已经结束）」只显示了前半截 ——
 * 因为它渲染在对局页状态条里（固定 48px 高 + `white-space: nowrap` + `overflow: hidden`），
 * 放不下的字被**静默切掉**。用户看到的是半句话，而不是「这里还有内容」。
 *
 * 状态条高度必须固定（提示出现/消失不能让棋盘抖动），所以约束只能落在文案上：
 * `packages/core/src/noticeBudget.ts` 用实测把预算定为 13 全角字
 * （最紧的是竖屏 439×847 的 1.5× 档：一行约 13.4 汉字）。这里把它变成可执行的守卫 ——
 * 以后往提示里塞长句，先在这里红，而不是等用户在真机上看到半句话。
 *
 * 覆盖范围：所有**会出现在提示条里**的 key —— 各游戏的 `*.blocked`、`*.illegal.notice`
 * 与其它 `*.notice.*`（如消消乐的「再点相邻一格交换」「已重排」）。壳层自己的提示
 * （`shell.game.*`）有各自的展开规则，不在这里卡。
 */
import { describe, expect, it } from 'vitest'
import { NOTICE_BUDGET, noticeWidth, type Dict } from '@eink/core'
import { game2048En, game2048Zh } from '@eink/2048'
import { fifteenEn, fifteenZh } from '@eink/fifteen'
import { gomokuEn, gomokuZh } from '@eink/gomoku'
import { klotskiEn, klotskiZh } from '@eink/klotski'
import { lightsoutEn, lightsoutZh } from '@eink/lightsout'
import { match3En, match3Zh } from '@eink/match3'
import { memoryEn, memoryZh } from '@eink/memory'
import { minesweeperEn, minesweeperZh } from '@eink/minesweeper'
import { snakeEn, snakeZh } from '@eink/snake'
import { sokobanEn, sokobanZh } from '@eink/sokoban'
import { sudokuEn, sudokuZh } from '@eink/sudoku'
import { tetrisEn, tetrisZh } from '@eink/tetris'

const DICTS: Array<[string, Dict]> = [
  ['zh 2048', game2048Zh],
  ['en 2048', game2048En],
  ['zh fifteen', fifteenZh],
  ['en fifteen', fifteenEn],
  ['zh gomoku', gomokuZh],
  ['en gomoku', gomokuEn],
  ['zh klotski', klotskiZh],
  ['en klotski', klotskiEn],
  ['zh lightsout', lightsoutZh],
  ['en lightsout', lightsoutEn],
  ['zh match3', match3Zh],
  ['en match3', match3En],
  ['zh memory', memoryZh],
  ['en memory', memoryEn],
  ['zh minesweeper', minesweeperZh],
  ['en minesweeper', minesweeperEn],
  ['zh snake', snakeZh],
  ['en snake', snakeEn],
  ['zh sokoban', sokobanZh],
  ['en sokoban', sokobanEn],
  ['zh sudoku', sudokuZh],
  ['en sudoku', sudokuEn],
  ['zh tetris', tetrisZh],
  ['en tetris', tetrisEn],
]

/** 会出现在对局页提示条里的 key（见文件头说明） */
function isNoticeKey(key: string): boolean {
  return key.endsWith('.blocked') || key.includes('.illegal.') || /\.notice(\.|$)/.test(key)
}

describe('提示条文案的单行预算', () => {
  it(`每条提示的显示宽度都 ≤ ${NOTICE_BUDGET} 全角字（超出会在状态条里被静默截断）`, () => {
    const offenders: string[] = []
    let checked = 0
    for (const [label, dict] of DICTS) {
      for (const [key, text] of Object.entries(dict)) {
        if (!isNoticeKey(key)) continue
        checked++
        const width = noticeWidth(text)
        if (width > NOTICE_BUDGET) {
          offenders.push(`${label} ${key} = ${width} 字：「${text}」`)
        }
      }
    }
    // 守卫必须真的覆盖到东西：12 款游戏 × 中英，至少十几条（现在是 28 条）
    expect(checked).toBeGreaterThanOrEqual(20)
    expect(offenders).toEqual([])
  })

  it('宽度估算符合「半角 0.5 / 全角 1」的约定', () => {
    expect(noticeWidth('这一步走不通')).toBe(6)
    expect(noticeWidth('That move is blocked')).toBe(12)
    expect(noticeWidth('这一步走不通：不能掉头')).toBe(11)
  })
})
