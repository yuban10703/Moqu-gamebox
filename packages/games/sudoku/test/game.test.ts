/**
 * GameDef 外壳集成测试：view / controls / encode / decode / i18n。
 * 重点：
 *   - `view` 的 81 格语义（given / tile / empty）、glyph、selected、stats；
 *   - `encode`/`decode` 严格往返，坏数据一律抛 IllegalActionError；
 *   - `decode` 不重新生成题目（题目数据来自存档本身，改一个给定值就会被拒）；
 *   - 中英字典基础 key 集合完全一致，且 view/controls 用到的 key 都能取到。
 */
import { describe, expect, it } from 'vitest'
import { IllegalActionError, baseKeys, compareDicts, createI18n, type Dict } from '@eink/core'
import {
  DIFFICULTY_IDS,
  SUDOKU_CELLS,
  WRONG_MARK,
  createSudokuState,
  reduceSudoku,
  sudokuEn,
  sudokuGame,
  sudokuZh,
  type DifficultyId,
  type SudokuAction,
  type SudokuState,
} from '../src/index.js'

const SEED = 424242

function fresh(difficulty: DifficultyId = 'starter'): SudokuState {
  return createSudokuState(SEED, difficulty)
}

function emptyCells(state: SudokuState): number[] {
  const out: number[] = []
  for (let index = 0; index < SUDOKU_CELLS; index++) if (state.given[index] === 0) out.push(index)
  return out
}

function play(state: SudokuState, action: SudokuAction): SudokuState {
  return reduceSudoku(state, action)
}

function fillCorrect(state: SudokuState, cells: readonly number[]): SudokuState {
  let current = state
  for (const index of cells) {
    current = play(current, { type: 'select', index })
    current = play(current, { type: 'set', value: current.solution[index]! })
  }
  return current
}

/** 同行/同列/同宫里是否已经有这个数字 */
function peerHas(state: SudokuState, index: number, value: number): boolean {
  const row = Math.floor(index / 9)
  const col = index % 9
  for (let cell = 0; cell < SUDOKU_CELLS; cell++) {
    if (cell === index || state.filled[cell] !== value) continue
    const otherRow = Math.floor(cell / 9)
    const otherCol = cell % 9
    const sameBox =
      Math.floor(otherRow / 3) === Math.floor(row / 3) && Math.floor(otherCol / 3) === Math.floor(col / 3)
    if (otherRow === row || otherCol === col || sameBox) return true
  }
  return false
}

const zh: Dict = { ...sudokuZh }
const en: Dict = { ...sudokuEn }

describe('view', () => {
  it('棋盘是 9×9，共 81 格', () => {
    const view = sudokuGame.view(fresh())
    expect(view.board).not.toBeNull()
    expect(view.board!.kind).toBe('grid')
    expect(view.board!.cols).toBe(9)
    expect(view.board!.rows).toBe(9)
    expect(view.board!.cells).toHaveLength(SUDOKU_CELLS)
    view.board!.cells.forEach((cell, index) => expect(cell.index).toBe(index))
  })

  it('空格为 empty/空 glyph，提示数为 given/数字，填入后变 tile', () => {
    const state = fresh()
    const view = sudokuGame.view(state)
    const empty = emptyCells(state)
    expect(empty.length).toBeGreaterThan(0)
    for (let index = 0; index < SUDOKU_CELLS; index++) {
      const cell = view.board!.cells[index]!
      if (state.given[index] !== 0) {
        expect(cell.kind).toBe('given')
        expect(cell.glyph).toBe(String(state.given[index]))
      } else {
        expect(cell.kind).toBe('empty')
        expect(cell.glyph).toBe('')
      }
    }

    const target = empty[0]!
    const filled = fillCorrect(state, [target])
    const cell = sudokuGame.view(filled).board!.cells[target]!
    expect(cell.kind).toBe('tile')
    expect(cell.glyph).toBe(String(filled.solution[target]))
  })

  it('选中格只有一格带 selected', () => {
    const index = emptyCells(fresh())[3]!
    const state = play(fresh(), { type: 'select', index })
    const cells = sudokuGame.view(state).board!.cells
    const selected = cells.filter((cell) => cell.selected)
    expect(selected).toHaveLength(1)
    expect(selected[0]!.index).toBe(index)
  })

  it('填错但不冲突的数字加 × 前缀（形状区分，不靠灰度）', () => {
    const state = fresh()
    const index = emptyCells(state).find((cell) => {
      const answer = state.solution[cell]!
      // 找一个「填错也不与同行/列/宫冲突」的格子与数字
      return [1, 2, 3, 4, 5, 6, 7, 8, 9].some(
        (digit) => digit !== answer && !peerHas(state, cell, digit),
      )
    })
    expect(index).toBeDefined()
    const answer = state.solution[index!]!
    const wrong = [1, 2, 3, 4, 5, 6, 7, 8, 9].find(
      (digit) => digit !== answer && !peerHas(state, index!, digit),
    )!
    const next = play(play(state, { type: 'select', index: index! }), { type: 'set', value: wrong })
    const cell = sudokuGame.view(next).board!.cells[index!]!
    expect(cell.glyph).toBe(`${WRONG_MARK}${wrong}`)
    expect(cell.kind).toBe('tile')
  })

  it('stats 只有「已填 x/81」一项（总数在分母里，空格是同一信息，都算冗余）', () => {
    const state = fresh()
    const view = sudokuGame.view(state)
    expect(view.stats).toHaveLength(1)
    const filledStat = view.stats[0]!
    expect(filledStat.labelKey).toBe('sudoku.stat.filled')
    let clues = 0
    for (let index = 0; index < SUDOKU_CELLS; index++) if (state.given[index] !== 0) clues++
    expect(filledStat.value).toBe(`${clues}/81`)

    const filled = fillCorrect(state, [emptyCells(state)[0]!])
    const after = sudokuGame.view(filled)
    expect(after.stats).toHaveLength(1)
    expect(after.stats[0]!.value).toBe(`${clues + 1}/81`)
  })

  it('stats / result 的所有 labelKey 在中英字典里都能原样取到（无插值残留）', () => {
    const state = fresh()
    const view = sudokuGame.view(state)
    const i18nZh = createI18n('zh-CN', { 'zh-CN': zh, 'en-US': en })
    const i18nEn = createI18n('en-US', { 'zh-CN': zh, 'en-US': en })
    for (const stat of view.stats) {
      expect(i18nZh.t(stat.labelKey)).not.toContain('⟦')
      expect(i18nEn.t(stat.labelKey)).not.toContain('⟦')
      expect(i18nZh.t(stat.labelKey)).not.toMatch(/\{\w+\}/)
      expect(i18nEn.t(stat.labelKey)).not.toMatch(/\{\w+\}/)
    }
  })

  it('未完成时 result 为 null，完成后有标题与明细（明细可被 plural 取到）', () => {
    const state = fresh()
    expect(sudokuGame.view(state).result).toBeNull()
    const won = fillCorrect(state, emptyCells(state))
    const view = sudokuGame.view(won)
    expect(view.result).not.toBeNull()
    expect(view.result!.titleKey).toBe('sudoku.result.title')
    expect(view.result!.details.length).toBeGreaterThan(0)
    // 每个明细 key 都能取到，不出现 ⟦…⟧ 占位
    const i18n = createI18n('zh-CN', { 'zh-CN': zh, 'en-US': en })
    for (const detail of view.result!.details) {
      // 明细 key 都是复数形式，用 plural 取（中文落 __other）
      expect(i18n.plural(detail.key, 81, detail.params)).not.toContain('⟦')
    }
  })

})

describe('controls', () => {
  it('包含 digit-1..digit-9（role: action）与 clear', () => {
    const controls = sudokuGame.controls(fresh())
    const ids = controls.map((control) => control.id)
    for (let value = 1; value <= 9; value++) expect(ids).toContain(`digit-${value}`)
    expect(ids).toContain('clear')
    for (const control of controls) {
      expect(control.role).toBe('action')
      expect(control.enabled).toBe(false) // 还没选中格子
    }
  })

  it('选中空格后数字键可用、清除不可用', () => {
    const index = emptyCells(fresh())[0]!
    const controls = sudokuGame.controls(play(fresh(), { type: 'select', index }))
    for (const control of controls) {
      expect(control.enabled).toBe(control.id.startsWith('digit-'))
    }
  })

  it('填入后清除可用、数字键不可用（先清掉才能重填）', () => {
    const state = fresh()
    const index = emptyCells(state)[0]!
    const filled = fillCorrect(state, [index])
    const controls = sudokuGame.controls(filled)
    expect(controls.find((control) => control.id === 'clear')!.enabled).toBe(true)
    expect(controls.find((control) => control.id === 'digit-1')!.enabled).toBe(false)
  })

  it('选中给定格时数字键与清除都不可用', () => {
    const state = fresh()
    const given = state.given.findIndex((value) => value !== 0)
    const controls = sudokuGame.controls(play(state, { type: 'select', index: given }))
    for (const control of controls) expect(control.enabled).toBe(false)
  })

  it('controls 的 labelKey 在中英字典里都能取到', () => {
    const i18nZh = createI18n('zh-CN', { 'zh-CN': zh, 'en-US': en })
    const i18nEn = createI18n('en-US', { 'zh-CN': zh, 'en-US': en })
    const labelKeys = [
      ...sudokuGame.controls(fresh()).map((control) => control.labelKey),
      ...sudokuGame.difficulties.map((difficulty) => difficulty.labelKey),
      ...(sudokuGame.illegalNoticeKey ? [sudokuGame.illegalNoticeKey] : []),
    ]
    for (const key of labelKeys) {
      expect(i18nZh.t(key)).not.toContain('⟦')
      expect(i18nEn.t(key)).not.toContain('⟦')
      // 壳层只调 t(labelKey) 不传参：文案里不能残留未替换的 {xxx}
      expect(i18nZh.t(key)).not.toMatch(/\{\w+\}/)
      expect(i18nEn.t(key)).not.toMatch(/\{\w+\}/)
    }
    // 数字键直接显示 1..9
    expect(i18nZh.t('sudoku.digit.1')).toBe('1')
    expect(i18nZh.t('sudoku.digit.9')).toBe('9')
    expect(i18nEn.t('sudoku.digit.5')).toBe('5')
    expect(i18nZh.missingKeys()).toEqual([])
    expect(i18nEn.missingKeys()).toEqual([])
  })
})

describe('encode / decode', () => {
  it('原样状态往返一致', () => {
    const state = fresh()
    expect(sudokuGame.decode(sudokuGame.encode(state))).toEqual(state)
  })

  it('进行中的状态（含选中格）往返一致', () => {
    const state = fresh('skilled')
    const index = emptyCells(state)[2]!
    const midway = play(play(state, { type: 'select', index }), {
      type: 'set',
      value: state.solution[index]!,
    })
    const decoded = sudokuGame.decode(sudokuGame.encode(midway))
    expect(decoded).toEqual(midway)
    expect(decoded.selected).toBe(index)
    expect(Array.from(decoded.given)).toEqual(Array.from(midway.given))
  })

  it('胜利状态往返一致且仍是 won', () => {
    const won = fillCorrect(fresh('challenging'), emptyCells(fresh('challenging')))
    const decoded = sudokuGame.decode(sudokuGame.encode(won))
    expect(decoded).toEqual(won)
    expect(sudokuGame.status(decoded)).toBe('won')
    expect(sudokuGame.encode(decoded)).toEqual(sudokuGame.encode(won))
  })

  it('encode 结果是纯 JSON（可 JSON.stringify/parse 后再 decode）', () => {
    const state = play(fresh(), { type: 'select', index: emptyCells(fresh())[0]! })
    const raw = sudokuGame.encode(state)
    const roundTripped = sudokuGame.decode(JSON.parse(JSON.stringify(raw)))
    expect(roundTripped).toEqual(state)
  })

  it('decode 不重新生成题目：篡改一个给定值会被拒绝，而不是重新出题', () => {
    const state = fresh()
    const raw = sudokuGame.encode(state) as {
      difficulty: string
      given: number[]
      solution: number[]
      filled: number[]
      selected: number | null
    }
    const broken = { ...raw, given: raw.given.slice(), solution: raw.solution.slice(), filled: raw.filled.slice() }
    const first = broken.given.findIndex((value) => value !== 0)
    broken.given[first] = broken.given[first] === 1 ? 2 : 1
    expect(() => sudokuGame.decode(broken)).toThrow(IllegalActionError)
  })

  it('坏数据一律抛 IllegalActionError', () => {
    const raw = sudokuGame.encode(fresh()) as Record<string, unknown>
    const bad: unknown[] = [
      null,
      undefined,
      42,
      'state',
      {},
      { ...raw, difficulty: 'impossible' },
      { ...raw, given: 'nope' },
      { ...raw, given: (raw.given as number[]).slice(0, 80) },
      { ...raw, given: (raw.given as number[]).slice(0, 80).concat([9, 9]) },
      { ...raw, solution: (raw.solution as number[]).map(() => 0) },
      { ...raw, filled: (raw.filled as number[]).map((value, index) => (index === 0 ? 10 : value)) },
      { ...raw, filled: (raw.filled as number[]).map((value, index) => (index === 0 ? -1 : value)) },
      { ...raw, selected: 81 },
      { ...raw, selected: -2 },
      { ...raw, selected: 1.5 },
      // 玩家盘面覆盖题目给定格
      (() => {
        const given = (raw.given as number[]).slice()
        const filled = (raw.filled as number[]).slice()
        const first = given.findIndex((value) => value !== 0)
        filled[first] = given[first] === 1 ? 2 : 1
        return { ...raw, given, filled }
      })(),
      // 玩家填入与解不符
      (() => {
        const filled = (raw.filled as number[]).slice()
        const index = (raw.given as number[]).findIndex((value) => value === 0)
        const answer = (raw.solution as number[])[index]!
        filled[index] = answer === 9 ? 1 : answer + 1
        return { ...raw, filled }
      })(),
      // 题目有两个解（把给定值全清掉）
      { ...raw, given: new Array(81).fill(0), filled: new Array(81).fill(0) },
    ]
    for (const candidate of bad) {
      expect(() => sudokuGame.decode(candidate), JSON.stringify(candidate)?.slice(0, 80)).toThrow(
        IllegalActionError,
      )
    }
  })

  it('丢一个已知解的数独题（唯一解）能正常 decode —— 题目数据在状态里', () => {
    const state = fresh()
    const raw = sudokuGame.encode(state)
    const again = sudokuGame.decode(JSON.parse(JSON.stringify(raw)))
    // 两次 decode 同一个 raw 得到完全相同的题目（不涉及任何随机）
    const twice = sudokuGame.decode(JSON.parse(JSON.stringify(raw)))
    expect(Array.from(again.given)).toEqual(Array.from(twice.given))
    expect(Array.from(again.solution)).toEqual(Array.from(twice.solution))
  })
})

describe('字典对齐', () => {
  it('中英基础 key 集合完全一致，没有缺失/多余/复数不完整', () => {
    expect(compareDicts({ 'zh-CN': zh, 'en-US': en })).toEqual([])
    expect([...baseKeys(zh)].sort()).toEqual([...baseKeys(en)].sort())
  })

  it('壳层需要的 key 都定义了（难度三档、重开确认正文、非法输入提示）', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      const key = `sudoku.difficulty.${difficulty}`
      expect(zh[key]).toBeDefined()
      expect(en[key]).toBeDefined()
    }
    expect(zh['sudoku.rules.restart']).toBeDefined()
    expect(en['sudoku.rules.restart']).toBeDefined()
    expect(zh['sudoku.illegal.notice']).toBeDefined()
    expect(en['sudoku.illegal.notice']).toBeDefined()
  })

  it('游戏元信息符合契约', () => {
    expect(sudokuGame.id).toBe('sudoku')
    expect(sudokuGame.i18nNamespace).toBe('sudoku')
    expect(sudokuGame.rulesVersion).toBeGreaterThanOrEqual(1)
    expect(sudokuGame.contentVersion).toBeGreaterThanOrEqual(1)
    expect(sudokuGame.difficulties.map((difficulty) => difficulty.id)).toEqual([...DIFFICULTY_IDS])
    expect(sudokuGame.illegalNoticeKey).toBe('sudoku.illegal.notice')
  })
})
