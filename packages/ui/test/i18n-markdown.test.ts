/**
 * 文案纯净度守卫：字典的**值**是纯文本，不是 markdown 源码。
 *
 * 由来（两次真实缺陷，都一路过关到装机）：
 *   - `nonogram.rules.body` 的值里写过 `**连续黑格**`；
 *   - `klondike.rules.body3` 的值里写过 `**也可以点**` / `**tappable too**`。
 * 壳层把文案当纯文本渲染（详情页 `.eink-rules`、提示条、按钮都只认纯文本 + `{count}` 插值），
 * 不做 markdown 解析 —— 于是这些星号被玩家**原样看见**。
 * 这一层没有任何守卫：prettier / tsc / typecheck / 中英 key 对齐测试都不看值里写了什么。
 *
 * 覆盖范围：**全部 20 款玩法**的中英字典 + `packages/core` 的壳层通用字典（共 21 个来源）。
 * 中英 key 一致性**不在这里重复断言** —— 每个玩法包自己的 i18n/dicts 测试已用
 * `compareDicts` 覆盖（20 款全有），这里只管「值里有没有 markdown 字面量」这一件事。
 *
 * 约定（不是 markdown，别误报）：`__one` / `__other` 是复数后缀、`{count}` 是插值占位符，
 * 都长在 key 或值里，但与 markdown 无关；本测试只扫**值**。
 */
import { describe, expect, it } from 'vitest'
import { coreDictEn, coreDictZh, type Dict } from '@eink/core'
import { game2048En, game2048Zh } from '@eink/2048'
import { buckshotEn, buckshotZh } from '@eink/buckshot'
import { chessEn, chessZh } from '@eink/chess'
import { doudizhuEn, doudizhuZh } from '@eink/doudizhu'
import { fifteenEn, fifteenZh } from '@eink/fifteen'
import { gomokuEn, gomokuZh } from '@eink/gomoku'
import { klondikeEn, klondikeZh } from '@eink/klondike'
import { klotskiEn, klotskiZh } from '@eink/klotski'
import { lightsoutEn, lightsoutZh } from '@eink/lightsout'
import { match3En, match3Zh } from '@eink/match3'
import { memoryEn, memoryZh } from '@eink/memory'
import { minesweeperEn, minesweeperZh } from '@eink/minesweeper'
import { nonogramEn, nonogramZh } from '@eink/nonogram'
import { reversiEn, reversiZh } from '@eink/reversi'
import { snakeEn, snakeZh } from '@eink/snake'
import { sokobanEn, sokobanZh } from '@eink/sokoban'
import { sudokuEn, sudokuZh } from '@eink/sudoku'
import { tetrisEn, tetrisZh } from '@eink/tetris'
import { tictactoeEn, tictactoeZh } from '@eink/tictactoe'
import { xiangqiEn, xiangqiZh } from '@eink/xiangqi'

/** 字典来源：名字只用于报错定位（21 个 = 20 款玩法 + 壳层通用） */
const SOURCES: Array<{ name: string; dicts: Array<[string, Dict]> }> = [
  { name: 'core（壳层通用）', dicts: [['zh-CN', coreDictZh], ['en-US', coreDictEn]] },
  { name: '2048', dicts: [['zh-CN', game2048Zh], ['en-US', game2048En]] },
  { name: 'buckshot', dicts: [['zh-CN', buckshotZh], ['en-US', buckshotEn]] },
  { name: 'chess', dicts: [['zh-CN', chessZh], ['en-US', chessEn]] },
  { name: 'doudizhu', dicts: [['zh-CN', doudizhuZh], ['en-US', doudizhuEn]] },
  { name: 'fifteen', dicts: [['zh-CN', fifteenZh], ['en-US', fifteenEn]] },
  { name: 'gomoku', dicts: [['zh-CN', gomokuZh], ['en-US', gomokuEn]] },
  { name: 'klondike', dicts: [['zh-CN', klondikeZh], ['en-US', klondikeEn]] },
  { name: 'klotski', dicts: [['zh-CN', klotskiZh], ['en-US', klotskiEn]] },
  { name: 'lightsout', dicts: [['zh-CN', lightsoutZh], ['en-US', lightsoutEn]] },
  { name: 'match3', dicts: [['zh-CN', match3Zh], ['en-US', match3En]] },
  { name: 'memory', dicts: [['zh-CN', memoryZh], ['en-US', memoryEn]] },
  { name: 'minesweeper', dicts: [['zh-CN', minesweeperZh], ['en-US', minesweeperEn]] },
  { name: 'nonogram', dicts: [['zh-CN', nonogramZh], ['en-US', nonogramEn]] },
  { name: 'reversi', dicts: [['zh-CN', reversiZh], ['en-US', reversiEn]] },
  { name: 'snake', dicts: [['zh-CN', snakeZh], ['en-US', snakeEn]] },
  { name: 'sokoban', dicts: [['zh-CN', sokobanZh], ['en-US', sokobanEn]] },
  { name: 'sudoku', dicts: [['zh-CN', sudokuZh], ['en-US', sudokuEn]] },
  { name: 'tetris', dicts: [['zh-CN', tetrisZh], ['en-US', tetrisEn]] },
  { name: 'tictactoe', dicts: [['zh-CN', tictactoeZh], ['en-US', tictactoeEn]] },
  { name: 'xiangqi', dicts: [['zh-CN', xiangqiZh], ['en-US', xiangqiEn]] },
]

/**
 * 会被玩家原样看到的 markdown 字面量。
 *
 * - `**`：粗体标记（nonogram / klondike 出过的就是这一条）；
 * - 反引号：行内代码；成对出现才是标准 markdown，但单个反引号同样是漏出来的符号，一并拦；
 * - `#` 开头且后面跟空白的行：markdown 标题；
 * - `[](…)`：markdown 链接（壳层不会把 URL 变成可点链接，只会原样显示）。
 */
const MARKDOWN_RULES: Array<{ name: string; hit: (value: string) => boolean }> = [
  { name: '粗体标记 **', hit: (value) => value.includes('**') },
  { name: '反引号 `（行内代码）', hit: (value) => value.includes('`') },
  { name: '标题行（行首 #）', hit: (value) => /^#{1,6}\s/m.test(value) },
  { name: 'markdown 链接 [](…)', hit: (value) => /\[[^\]]*\]\([^)]+\)/.test(value) },
]

/** 找出一个字典里所有违规的值，报错信息带 key 与完整值（方便一眼定位） */
function violations(label: string, dict: Dict): string[] {
  const found: string[] = []
  for (const [key, value] of Object.entries(dict)) {
    for (const rule of MARKDOWN_RULES) {
      if (rule.hit(value)) {
        found.push(`${label} ${key}：值里有${rule.name} → ${JSON.stringify(value)}`)
      }
    }
  }
  return found
}

describe('字典值必须是纯文本（不含 markdown 字面量）', () => {
  for (const source of SOURCES) {
    it(`${source.name}：中英每条文案都干净`, () => {
      const found = source.dicts.flatMap(([locale, dict]) => violations(`${source.name} ${locale}`, dict))
      expect(found).toEqual([])
    })
  }

  it('守卫覆盖到全部 20 款玩法 + 壳层字典，且规则本身能抓到东西', () => {
    // 覆盖范围：漏加一款玩法时这里会先红，而不是「悄悄少扫一款」
    expect(SOURCES.length).toBe(21)
    const keys = SOURCES.flatMap((source) => source.dicts.flatMap(([, dict]) => Object.keys(dict)))
    expect(keys.length).toBeGreaterThan(1000)

    // 规则自检：真的能抓到（否则守卫就是摆设）
    for (const rule of MARKDOWN_RULES) {
      const samples = ['**粗**', 'a `b` c', '## 标题', '见 [文档](https://example.com)']
      expect(samples.some((sample) => rule.hit(sample)), rule.name).toBe(true)
    }
    // 约定不是 markdown：复数后缀 / 插值占位符 / 普通符号都不许被误报
    const clean = ['共 {count} 项', 'Deal {count}', '最佳 {count} 步', 'A♠ K♡ 10♢', '20 秒', '3×3']
    expect(clean.filter((value) => MARKDOWN_RULES.some((rule) => rule.hit(value)))).toEqual([])
  })
})
