/**
 * 字典校验：中英「基础 key 集合」必须完全一致（壳层的 check-i18n 共用同一份规则），
 * 并且游戏实际产出的每个 labelKey 都必须能取到文案 ——
 * 否则界面上会出现 ⟦key⟧ 占位符。
 */
import { describe, expect, it } from 'vitest'
import { baseKeys, compareDicts, coreDictEn, coreDictZh, createI18n } from '@eink/core'
import { game2048En, game2048Zh } from '../src/i18n.js'
import { game2048 } from '../src/index.js'
import { createState, encodeState, decodeState, emptyBoard, type Game2048State } from '../src/rules.js'

const zh = { ...coreDictZh, ...game2048Zh }
const en = { ...coreDictEn, ...game2048En }
const i18nZh = createI18n('zh-CN', { 'zh-CN': zh, 'en-US': en })
const i18nEn = createI18n('en-US', { 'zh-CN': zh, 'en-US': en })

function stateWith(board: readonly number[], overrides: Partial<Game2048State> = {}): Game2048State {
  return {
    difficulty: 'starter',
    seed: 1,
    board,
    score: 0,
    moves: 0,
    cursor: 0,
    history: [],
    ...overrides,
  }
}

describe('中英字典对齐', () => {
  it('没有缺失、多余或复数形式不完整的 key', () => {
    expect(compareDicts({ 'zh-CN': game2048Zh, 'en-US': game2048En })).toEqual([])
    // 与核心字典合并后也不允许出现冲突
    expect(compareDicts({ 'zh-CN': zh, 'en-US': en })).toEqual([])
  })

  it('两边基础 key 集合完全一致且非空', () => {
    const zhBase = [...baseKeys(game2048Zh)].sort()
    const enBase = [...baseKeys(game2048En)].sort()
    expect(zhBase).toEqual(enBase)
    expect(zhBase.length).toBeGreaterThanOrEqual(20)
  })

  it('复数形式齐备（英文有 __one/__other，中文只用 __other）', () => {
    for (const key of ['2048.result.moves', '2048.solved.best']) {
      expect(game2048En[`${key}__one`]).toBeDefined()
      expect(game2048En[`${key}__other`]).toBeDefined()
      expect(game2048Zh[`${key}__other`]).toBeDefined()
    }
    expect(game2048Zh['2048.result.score__other']).toBeDefined()
    expect(game2048En['2048.result.score__other']).toBeDefined()
    // 壳层对「最佳成绩」用 t(key, {count})，所以普通 key 也必须存在
    expect(game2048Zh['2048.solved.best']).toBeDefined()
    expect(game2048En['2048.solved.best']).toBeDefined()
  })

  it('关键流程文案（壳层按命名空间取的那些）都能解析', () => {
    const keys = [
      '2048.title',
      '2048.rules.body',
      '2048.rules.body2',
      '2048.rules.restart',
      '2048.blocked',
      '2048.dpad.label',
      '2048.won.title',
      '2048.lost.title',
      '2048.solved.best',
      '2048.stat.score',
      '2048.stat.moves',
      '2048.stat.target',
      '2048.cell.empty',
      '2048.cell.tile',
      // 2048 没有关卡；这两个键只是壳层按命名空间取键时的兜底（见 i18n.ts 注释）
      '2048.level.label',
      '2048.level.position',
      'shell.game.undo',
      ...game2048.difficulties.map((spec) => spec.labelKey),
    ]
    for (const key of keys) {
      expect(i18nZh.t(key), key).not.toContain('⟦')
      expect(i18nEn.t(key), key).not.toContain('⟦')
    }
    expect(i18nZh.missingKeys()).toEqual([])
    expect(i18nEn.missingKeys()).toEqual([])
  })

  it('难度 id 与 sokoban 一致（壳层 prop 直接传 id），labelKey 落在本命名空间', () => {
    expect(game2048.difficulties.map((spec) => spec.id)).toEqual(['starter', 'skilled', 'challenging'])
    expect(game2048.difficulties.every((spec) => spec.labelKey.startsWith('2048.difficulty.'))).toBe(true)
  })
})

describe('游戏产出的每个 key 都能取到文案', () => {
  const board = emptyBoard(4)
  const samples: Game2048State[] = [
    createState(20260101, 'starter'),
    stateWith(board),
    stateWith([256, 2, 4, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], { score: 512, moves: 64 }),
    stateWith([2, 4, 8, 16, 16, 8, 4, 2, 2, 4, 8, 16, 16, 8, 4, 2], { score: 40, moves: 30 }),
  ]

  it('stats / controls / result 里的 labelKey 在 zh 与 en 都能取到', () => {
    for (const state of samples) {
      const view = game2048.view(state)
      const controls = game2048.controls(state)
      const keys = [
        ...view.stats.map((stat) => stat.labelKey),
        ...controls.map((control) => control.labelKey),
        ...(view.result?.details ?? []).map((detail) => `${detail.key}__other`),
        ...(view.result ? [view.result.titleKey] : []),
      ]
      for (const key of keys) {
        expect(i18nZh.t(key), key).not.toContain('⟦')
        expect(i18nEn.t(key), key).not.toContain('⟦')
      }
      // 带 params 的明细走 plural()，中文必须有 __other
      for (const detail of view.result?.details ?? []) {
        const count = Number(detail.params?.count ?? 0)
        expect(i18nZh.plural(detail.key, count, detail.params)).not.toContain('⟦')
        expect(i18nEn.plural(detail.key, count, detail.params)).not.toContain('⟦')
      }
    }
    expect(i18nZh.missingKeys()).toEqual([])
    expect(i18nEn.missingKeys()).toEqual([])
  })

  it('非法提示 key 可解析（走不通时的文字反馈）', () => {
    expect(game2048.illegalNoticeKey).toBe('2048.blocked')
    expect(i18nZh.t(game2048.illegalNoticeKey!)).not.toContain('⟦')
    expect(i18nEn.t(game2048.illegalNoticeKey!)).not.toContain('⟦')
  })

  it('存档经 JSON 往返后仍能渲染（decode 与 view 不依赖 undefined 字段）', () => {
    const state = createState(11, 'skilled')
    const restored = decodeState(JSON.parse(JSON.stringify(encodeState(state))))
    expect(restored).toEqual(state)
    expect(game2048.view(restored).board?.cells).toHaveLength(16)
  })
})
