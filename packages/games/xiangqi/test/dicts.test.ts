/**
 * 真实字典对齐校验：壳层文案 + 象棋文案，中英基础 key 必须完全一致，
 * 并且「视图/控件/格子标签/结果明细里出现的 key」都必须能取到文案
 * （避免界面上冒出 ⟦key⟧）。与核心层 `npm run check:i18n` 的规则一致。
 */
import { describe, expect, it } from 'vitest'
import { baseKeys, compareDicts, coreDictEn, coreDictZh, createI18n, type CellKind } from '@eink/core'
import {
  DIFFICULTY_IDS,
  cellLabelKey,
  gameStatus,
  packMove,
  reduceXiangqi,
  xiangqiEn,
  xiangqiGame,
  xiangqiZh,
} from '../src/index.js'
import { CELL_LABEL_KEYS } from '../src/view.js'
import { at, boardOf, positionState, stateOf } from './helpers.js'

const zh = { ...coreDictZh, ...xiangqiZh }
const en = { ...coreDictEn, ...xiangqiEn }
const i18nZh = createI18n('zh-CN', { 'zh-CN': zh, 'en-US': en })
const i18nEn = createI18n('en-US', { 'zh-CN': zh, 'en-US': en })

/** 红方被将死的局面（结果页写「输」） */
function lostState() {
  return positionState(
    boardOf([
      '...k.....',
      '.........',
      '.........',
      '.........',
      '.........',
      '.........',
      '.........',
      '.........',
      '.....r...',
      'r...K....',
    ]),
  )
}

/** 三次重复判和的局面（结果页写「和棋」） */
function drawnState() {
  return stateOf([
    { red: packMove(at(9, 0), at(8, 0)), black: packMove(at(0, 0), at(1, 0)) },
    { red: packMove(at(8, 0), at(9, 0)), black: packMove(at(1, 0), at(0, 0)) },
    { red: packMove(at(9, 0), at(8, 0)), black: packMove(at(0, 0), at(1, 0)) },
    { red: packMove(at(8, 0), at(9, 0)), black: packMove(at(1, 0), at(0, 0)) },
  ])
}

describe('中英字典对齐', () => {
  it('没有缺失、多余或复数形式不完整的 key', () => {
    expect(compareDicts({ 'zh-CN': zh, 'en-US': en })).toEqual([])
    expect([...baseKeys(xiangqiZh)].sort()).toEqual([...baseKeys(xiangqiEn)].sort())
  })

  it('英文复数形式齐备（中文只用 __other）', () => {
    for (const key of ['xiangqi.result.moves']) {
      expect(en[`${key}__one`], key).toBeDefined()
      expect(en[`${key}__other`], key).toBeDefined()
      expect(zh[`${key}__other`], key).toBeDefined()
    }
    expect(en['xiangqi.solved.best__one']).toBeDefined()
    expect(en['xiangqi.solved.best__other']).toBeDefined()
    expect(zh['xiangqi.solved.best__other']).toBeDefined()
  })

  it('结果明细按复数取词，中英都不缺词', () => {
    expect(i18nZh.plural('xiangqi.result.moves', 7, { count: 7 })).toContain('7')
    expect(i18nEn.plural('xiangqi.result.moves', 1, { count: 1 })).toContain('1 move')
    expect(i18nEn.plural('xiangqi.result.moves', 12, { count: 12 })).toContain('12 moves')
    for (const key of ['xiangqi.result.checkmate', 'xiangqi.result.stalemate', 'xiangqi.result.repetition']) {
      expect(i18nZh.t(key), key).not.toMatch(/\{\w+\}/)
      expect(i18nEn.t(key), key).not.toMatch(/\{\w+\}/)
    }
  })

  it('标题、规则、难度、非法提示等关键文案都不缺', () => {
    const keys = [
      'xiangqi.title',
      'xiangqi.rules.body',
      'xiangqi.rules.body2',
      'xiangqi.rules.body3',
      'xiangqi.rules.restart',
      'xiangqi.illegal.notice',
      'xiangqi.won.title',
      'xiangqi.lost.title',
      'xiangqi.draw.title',
      'xiangqi.notice.check',
      'xiangqi.solved.best',
      ...DIFFICULTY_IDS.map((id) => `xiangqi.difficulty.${id}`),
    ]
    for (const key of keys) {
      expect(i18nZh.t(key), key).not.toContain('⟦')
      expect(i18nEn.t(key), key).not.toContain('⟦')
    }
    expect(i18nZh.missingKeys()).toEqual([])
    expect(i18nEn.missingKeys()).toEqual([])
  })

  it('视图、控件、格子标签里出现的 key 都有两种语言的文案', () => {
    const state = xiangqiGame.create(1, 'starter')
    const view = xiangqiGame.view(state)
    const keys: string[] = [
      `${xiangqiGame.i18nNamespace}.title`,
      xiangqiGame.illegalNoticeKey ?? '',
      ...view.stats.map((stat) => stat.labelKey),
      ...xiangqiGame.controls(state).map((control) => control.labelKey),
      ...xiangqiGame.difficulties.map((difficulty) => difficulty.labelKey),
      ...(Object.values(CELL_LABEL_KEYS).filter(Boolean) as string[]),
    ]
    for (const key of keys) {
      expect(i18nZh.t(key), key).not.toContain('⟦')
      expect(i18nEn.t(key), key).not.toContain('⟦')
    }
    expect(i18nZh.missingKeys()).toEqual([])
    expect(i18nEn.missingKeys()).toEqual([])
  })

  it('cellLabelKey 只映射本作使用的三种 kind，未知 kind 返回 undefined', () => {
    expect(cellLabelKey('tile')).toBe('xiangqi.cell.piece')
    // 最后一手不再借用 given（改成壳层的 lastFrom/lastTo 位置痕迹），因此不再映射它
    expect(cellLabelKey('given')).toBeUndefined()
    expect(cellLabelKey('goal')).toBe('xiangqi.cell.target')
    expect(cellLabelKey('empty')).toBe('xiangqi.cell.empty')
    expect(cellLabelKey('wall' as CellKind)).toBeUndefined()
    expect(cellLabelKey('mine' as CellKind)).toBeUndefined()
  })

  it('赢 / 输 / 和 三套结果标题与明细在两种语言里都取得到', () => {
    const won = reduceXiangqi(
      positionState(
        boardOf([
          '...a.k...',
          'R......R.',
          '.........',
          '.........',
          '.........',
          '.........',
          '.........',
          '.........',
          '.........',
          '...K.....',
        ]),
      ),
      { type: 'move', from: at(1, 7), to: at(0, 7) },
    )
    const lost = lostState()
    const drawn = drawnState()
    expect(gameStatus(won)).toBe('won')
    expect(gameStatus(lost)).toBe('lost')
    expect(gameStatus(drawn)).toBe('won') // 和棋并入 won
    for (const state of [won, lost, drawn]) {
      const result = xiangqiGame.view(state).result
      expect(result).not.toBeNull()
      expect(i18nZh.t(result!.titleKey), result!.titleKey).not.toContain('⟦')
      expect(i18nEn.t(result!.titleKey), result!.titleKey).not.toContain('⟦')
      for (const detail of result!.details) {
        const textZh = detail.params
          ? i18nZh.plural(detail.key, Number(detail.params.count ?? 0), detail.params)
          : i18nZh.t(detail.key)
        const textEn = detail.params
          ? i18nEn.plural(detail.key, Number(detail.params.count ?? 0), detail.params)
          : i18nEn.t(detail.key)
        expect(textZh, detail.key).not.toContain('⟦')
        expect(textEn, detail.key).not.toContain('⟦')
      }
    }
    // 三种标题各不相同（和棋不会被说成赢或输）
    expect(new Set([won, lost, drawn].map((state) => xiangqiGame.view(state).result!.titleKey)).size).toBe(3)
    expect(i18nZh.missingKeys()).toEqual([])
    expect(i18nEn.missingKeys()).toEqual([])
  })

  it('被将军的提示在两种语言里都取得到', () => {
    // 黑车 (4,4) 顺着空列照住 (9,4) 的红帅：轮到红方走且正被将军
    const board = boardOf([
      'k........',
      '.........',
      '.........',
      '.........',
      '....r....',
      '.........',
      '.........',
      '.........',
      '.........',
      '....K....',
    ])
    const state = positionState(board)
    expect(gameStatus(state)).toBe('playing')
    const notice = xiangqiGame.view(state).notice
    expect(notice).not.toBeNull()
    expect(i18nZh.t(notice!.textKey), notice!.textKey).not.toContain('⟦')
    expect(i18nEn.t(notice!.textKey), notice!.textKey).not.toContain('⟦')
    expect(i18nZh.missingKeys()).toEqual([])
    expect(i18nEn.missingKeys()).toEqual([])
  })
})
