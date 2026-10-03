/**
 * 历史记录工具测试。
 *
 * 重点在"旧存档绝不能让页面打不开"：读入任何形状的数据都必须退化成可用结果，而不是抛错。
 */
import { describe, expect, it } from 'vitest'
import {
  HISTORY_LIMIT,
  appendHistory,
  normalizeHistoryEntry,
  pushHistory,
  readHistory,
  type HistoryEntry,
} from '../src/history.js'

const entry = (over: Partial<HistoryEntry> = {}): HistoryEntry => ({
  difficulty: 'starter',
  moves: 12,
  seconds: 65,
  won: true,
  at: 1_700_000_000_000,
  ...over,
})

describe('readHistory：宽容解析', () => {
  it('缺失 / 非数组 / 乱类型一律退化成空数组', () => {
    for (const value of [undefined, null, 0, '', 'nope', {}, [], [[]], new Map(), true]) {
      expect(readHistory(value)).toEqual([])
    }
  })

  it('合法记录原样读出，坏记录丢掉（不抛错）', () => {
    const raw = [
      entry({ at: 300 }),
      null,
      42,
      {},
      { difficulty: '', moves: 1 },
      { difficulty: 'hard', moves: -5, seconds: Number.NaN, won: 'yes', at: -1 },
      entry({ at: 100 }),
    ]
    const list = readHistory(raw)
    expect(list).toEqual([
      { difficulty: 'starter', moves: 12, seconds: 65, won: true, at: 300 },
      // 负数 / NaN 一律归零，won 只有严格 true 才算胜
      { difficulty: 'hard', moves: 0, seconds: 0, won: false, at: 0 },
      { difficulty: 'starter', moves: 12, seconds: 65, won: true, at: 100 },
    ])
  })

  it('读取时就截断到上限，防止别人写进来的超长数组撑爆页面', () => {
    const raw = Array.from({ length: 20 }, (_, index) => entry({ at: index }))
    expect(readHistory(raw)).toHaveLength(HISTORY_LIMIT)
    expect(readHistory(raw)[0]!.at).toBe(0)
  })

  it('单条记录归一化：非对象 / 空难度 / 非数值都处理掉', () => {
    expect(normalizeHistoryEntry(null)).toBeNull()
    expect(normalizeHistoryEntry([entry()])).toBeNull()
    expect(normalizeHistoryEntry({ moves: 3 })).toBeNull()
    expect(normalizeHistoryEntry({ difficulty: 'x' })).toEqual({
      difficulty: 'x',
      moves: 0,
      seconds: 0,
      won: false,
      at: 0,
    })
  })
})

describe('pushHistory：最新在前 / 上限 5 / 去重', () => {
  it('新记录压在最前，且不改动原数组', () => {
    const first = entry({ at: 1, difficulty: 'starter' })
    const base = [first]
    const next = pushHistory(base, entry({ at: 2, difficulty: 'hard' }))
    expect(next.map((item) => item.at)).toEqual([2, 1])
    expect(base.map((item) => item.at)).toEqual([1])
  })

  it('最多保留 5 条，最旧的被挤掉', () => {
    let list: HistoryEntry[] = []
    for (let index = 1; index <= 7; index++) list = pushHistory(list, entry({ at: index }))
    expect(list).toHaveLength(HISTORY_LIMIT)
    expect(list.map((item) => item.at)).toEqual([7, 6, 5, 4, 3])
  })

  it('与最新一条完全相同的记录不重复写（同一次结束被重复提交）', () => {
    const once = pushHistory([], entry())
    expect(once).toHaveLength(1)
    expect(pushHistory(once, entry())).toHaveLength(1)
    // 只差一个字段就算新记录
    expect(pushHistory(once, entry({ at: 1_700_000_000_001 }))).toHaveLength(2)
    expect(pushHistory(once, entry({ won: false }))).toHaveLength(2)
    expect(pushHistory(once, entry({ moves: 13 }))).toHaveLength(2)
  })

  it('不同难度各自成条（互不覆盖）', () => {
    let list: HistoryEntry[] = []
    list = pushHistory(list, entry({ difficulty: 'starter', at: 1 }))
    list = pushHistory(list, entry({ difficulty: 'skilled', at: 2 }))
    list = pushHistory(list, entry({ difficulty: 'challenging', at: 3 }))
    expect(list.map((item) => item.difficulty)).toEqual(['challenging', 'skilled', 'starter'])
  })
})

describe('appendHistory：并入 progress 而不碰其它字段', () => {
  it('保留 completed / bestMoves，并新增 history', () => {
    const progress = { completed: ['level-1'], bestMoves: { 'level-1': 12 } }
    const next = appendHistory(progress, entry())
    expect(next.completed).toEqual(['level-1'])
    expect(next.bestMoves).toEqual({ 'level-1': 12 })
    expect(readHistory(next.history)).toHaveLength(1)
    // 原对象不变
    expect((progress as { history?: unknown }).history).toBeUndefined()
  })

  it('progress 为空 / history 是坏数据时也能安全追加', () => {
    expect(readHistory(appendHistory(undefined, entry()).history)).toHaveLength(1)
    expect(readHistory(appendHistory({ history: 'nope', completed: ['a'] } as never, entry()).history)).toHaveLength(1)
  })
})
