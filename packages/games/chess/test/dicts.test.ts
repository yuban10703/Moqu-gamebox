/**
 * 字典测试：中英基础 key 集合一致（用核心层的 compareDicts / baseKeys，正确处理 __one/__other 后缀）、
 * 壳层必需的 key 都定义了、玩法说明不超过六行预算。
 */
import { describe, expect, it } from 'vitest'
import { baseKeys, compareDicts, coreDictEn, coreDictZh } from '@eink/core'
import { chessEn, chessZh } from '../src/index.js'

const zh = { ...coreDictZh, ...chessZh }
const en = { ...coreDictEn, ...chessEn }

describe('字典', () => {
  it('中英基础 key 集合一致、无缺失/多余/复数不完整', () => {
    expect(compareDicts({ 'zh-CN': zh, 'en-US': en })).toEqual([])
    expect([...baseKeys(chessZh)].sort()).toEqual([...baseKeys(chessEn)].sort())
  })

  it('壳层必需的 key 都定义了', () => {
    const keys = [
      'chess.title',
      'chess.rules.body',
      'chess.rules.body2',
      'chess.rules.body3',
      'chess.rules.restart',
      'chess.illegal.notice',
      'chess.won.title',
      'chess.lost.title',
      'chess.draw.title',
      'chess.stat.white',
      'chess.stat.black',
      'chess.stat.moves',
      'chess.cell.tile',
      'chess.cell.goal',
      'chess.cell.empty',
      'chess.difficulty.starter',
      'chess.difficulty.skilled',
      'chess.difficulty.challenging',
    ]
    for (const key of keys) {
      expect(chessZh[key], key).toBeDefined()
      expect(chessEn[key], key).toBeDefined()
    }
  })

  it('复数键是扁平后缀键且带 {count}', () => {
    expect(chessZh['chess.result.moves__other']).toContain('{count}')
    expect(chessEn['chess.result.moves__one']).toContain('{count}')
    expect(chessEn['chess.result.moves__other']).toContain('{count}')
  })

  it('玩法说明三段合计不超过 130 字（P6Plus 18px 六行预算）', () => {
    const total =
      (chessZh['chess.rules.body'] as string).length +
      (chessZh['chess.rules.body2'] as string).length +
      (chessZh['chess.rules.body3'] as string).length
    expect(total).toBeLessThanOrEqual(130)
  })
})
