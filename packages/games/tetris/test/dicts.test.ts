/**
 * 字典校验：中英「基础 key 集合」必须完全一致（与壳层 check-i18n 共用同一份规则），
 * 并且游戏实际产出的每个 labelKey 都必须能取到文案 ——
 * 否则界面上会出现 ⟦key⟧ 占位符。
 */
import { describe, expect, it } from 'vitest'
import { baseKeys, compareDicts, coreDictEn, coreDictZh, createI18n } from '@eink/core'
import { tetrisEn, tetrisZh } from '../src/i18n.js'
import { tetrisGame } from '../src/index.js'
import { CELL_LABEL_KEYS, buildControls, buildView } from '../src/view.js'
import { CELL_FILLED, cellIndex, createState, emptyBoard, pieceCells, spawnPiece, type TetrisState } from '../src/rules.js'

const zh = { ...coreDictZh, ...tetrisZh }
const en = { ...coreDictEn, ...tetrisEn }
const i18nZh = createI18n('zh-CN', { 'zh-CN': zh, 'en-US': en })
const i18nEn = createI18n('en-US', { 'zh-CN': zh, 'en-US': en })

function lostState(): TetrisState {
  const piece = spawnPiece('T', 10)
  const board = emptyBoard(10, 18)
  for (const cell of pieceCells(piece)) board[cellIndex(10, cell.row, cell.col)] = CELL_FILLED
  return {
    difficulty: 'starter',
    seed: 1,
    board,
    piece,
    cursor: 5,
    score: 900,
    lines: 6,
    pieces: 4,
    history: [],
  }
}

describe('中英字典对齐', () => {
  it('没有缺失、多余或复数形式不完整的 key', () => {
    expect(compareDicts({ 'zh-CN': tetrisZh, 'en-US': tetrisEn })).toEqual([])
    // 与核心字典合并后也不允许出现冲突
    expect(compareDicts({ 'zh-CN': zh, 'en-US': en })).toEqual([])
  })

  it('两边基础 key 集合完全一致且非空', () => {
    const zhBase = [...baseKeys(tetrisZh)].sort()
    const enBase = [...baseKeys(tetrisEn)].sort()
    expect(zhBase).toEqual(enBase)
    expect(zhBase.length).toBeGreaterThanOrEqual(20)
  })

  it('复数形式齐备（英文有 __one/__other，中文只用 __other）', () => {
    for (const key of ['tetris.result.lines', 'tetris.result.pieces']) {
      expect(tetrisEn[`${key}__one`]).toBeDefined()
      expect(tetrisEn[`${key}__other`]).toBeDefined()
      expect(tetrisZh[`${key}__other`]).toBeDefined()
    }
    expect(tetrisZh['tetris.result.score__other']).toBeDefined()
    expect(tetrisEn['tetris.result.score__other']).toBeDefined()
  })

  it('关键流程文案（壳层按命名空间取的那些）都能解析', () => {
    const keys = [
      'tetris.title',
      'tetris.rules.body',
      'tetris.rules.body2',
      'tetris.rules.difficulty',
      // 重新开始的确认框按 <ns>.rules.restart 取正文，缺了就会显示 ⟦key⟧
      'tetris.rules.restart',
      'tetris.blocked',
      'tetris.dpad.label',
      'tetris.lost.title',
      'tetris.stat.score',
      'tetris.stat.lines',
      'tetris.stat.level',
      'tetris.cell.empty',
      'tetris.cell.mine',
      'tetris.cell.boxOnGoal',
      'shell.game.undo',
      ...tetrisGame.difficulties.map((spec) => spec.labelKey),
      // 格子无障碍文案（注册表用 (kind) => `tetris.cell.${kind}` 取）
      ...Object.values(CELL_LABEL_KEYS),
    ]
    for (const key of keys) {
      expect(i18nZh.t(key), key).not.toContain('⟦')
      expect(i18nEn.t(key), key).not.toContain('⟦')
    }
    expect(i18nZh.missingKeys()).toEqual([])
    expect(i18nEn.missingKeys()).toEqual([])
  })

  it('难度 id 与壳层约定一致，labelKey 落在本命名空间', () => {
    expect(tetrisGame.difficulties.map((spec) => spec.id)).toEqual(['starter', 'skilled', 'challenging'])
    expect(tetrisGame.difficulties.every((spec) => spec.labelKey.startsWith('tetris.difficulty.'))).toBe(true)
  })

  it('方向盘标签是两个语言里都短的词（48px 的按钮装得下）', () => {
    for (const dir of ['up', 'down', 'left', 'right']) {
      expect(i18nZh.t(`tetris.dir.${dir}`).length).toBeLessThanOrEqual(2)
      expect(i18nEn.t(`tetris.dir.${dir}`).length).toBeLessThanOrEqual(5)
    }
  })
})

describe('游戏产出的每个 key 都能取到文案', () => {
  const samples: TetrisState[] = [
    createState(20260101, 'starter'),
    createState(20260101, 'skilled'),
    createState(20260101, 'challenging'),
    lostState(),
  ]

  it('stats / controls / result 里的 labelKey 在 zh 与 en 都能取到', () => {
    for (const state of samples) {
      const view = buildView(state)
      const controls = buildControls(state)
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
      // 带 params 的明细走 plural()，中文必须有 __other，英文要有 __one/__other
      for (const detail of view.result?.details ?? []) {
        const count = Number(detail.params?.count ?? 0)
        expect(i18nZh.plural(detail.key, count, detail.params)).not.toContain('⟦')
        expect(i18nEn.plural(detail.key, count, detail.params)).not.toContain('⟦')
        expect(i18nEn.plural(detail.key, 1, { ...detail.params, count: 1 })).not.toContain('⟦')
      }
    }
    expect(i18nZh.missingKeys()).toEqual([])
    expect(i18nEn.missingKeys()).toEqual([])
  })

  it('非法提示 key 可解析（走不通时的文字反馈）', () => {
    expect(tetrisGame.illegalNoticeKey).toBe('tetris.blocked')
    expect(i18nZh.t(tetrisGame.illegalNoticeKey!)).not.toContain('⟦')
    expect(i18nEn.t(tetrisGame.illegalNoticeKey!)).not.toContain('⟦')
  })

  it('玩法说明如实写明「会自动下落」与「怎么暂停」', () => {
    for (const dict of [tetrisZh, tetrisEn]) {
      for (const key of Object.keys(dict)) expect(key.startsWith('tetris.'), key).toBe(true)
    }
    expect(tetrisZh['tetris.rules.body']).toContain('自动往下掉')
    expect(tetrisZh['tetris.rules.body2']).toContain('暂停')
    expect(tetrisEn['tetris.rules.body']).toMatch(/falls on its own/i)
    expect(tetrisEn['tetris.rules.body2']).toMatch(/pause/i)
  })

  it('说明里给出的自动下落间隔都 ≥ 400ms（墨水屏刷新下限，不允许承诺更快）', () => {
    const zhSeconds = [...(tetrisZh['tetris.rules.body'] ?? '').matchAll(/(\d+(?:\.\d+)?) 秒/g)].map(
      (match) => Number(match[1]),
    )
    const enSeconds = [...(tetrisEn['tetris.rules.body'] ?? '').matchAll(/(\d+(?:\.\d+)?)s(?=[ ,.])/g)].map(
      (match) => Number(match[1]),
    )
    expect(zhSeconds.length).toBeGreaterThanOrEqual(3)
    expect(enSeconds.length).toBeGreaterThanOrEqual(3)
    for (const value of [...zhSeconds, ...enSeconds]) {
      expect(value * 1000).toBeGreaterThanOrEqual(400)
    }
  })

  it('存档经 JSON 往返后仍能渲染', () => {
    const state = createState(11, 'challenging')
    const raw = JSON.parse(JSON.stringify(tetrisGame.encode(state))) as unknown
    const restored = tetrisGame.decode(raw)
    expect(restored).toEqual(state)
    expect(tetrisGame.view(restored).board?.cells).toHaveLength(10 * 16)
  })
})
