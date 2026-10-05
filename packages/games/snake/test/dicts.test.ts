/**
 * 字典校验：中英「基础 key 集合」必须完全一致（与 check-i18n 共用同一份规则），
 * 并且游戏实际产出的每个 labelKey 都能取到文案 —— 否则界面上会出现 ⟦key⟧ 占位符。
 */
import { describe, expect, it } from 'vitest'
import { MIN_TICK_MS, baseKeys, compareDicts, coreDictEn, coreDictZh, createI18n } from '@eink/core'
import { snakeEn, snakeGlyph, snakeZh } from '../src/i18n.js'
import { snakeGame } from '../src/index.js'
import {
  INITIAL_LENGTH,
  NO_FOOD,
  createState,
  decodeState,
  encodeState,
  type SnakeState,
} from '../src/rules.js'
import { DIFFICULTY_IDS, difficultySpec } from '../src/meta.js'
import { CELL_LABEL_KEYS, buildControls, buildView } from '../src/view.js'
import { SEED, hamiltonianCycle, stateWith, tick, turn } from './helpers.js'

const SIZE = 12

const zh = { ...coreDictZh, ...snakeZh }
const en = { ...coreDictEn, ...snakeEn }
const i18nZh = createI18n('zh-CN', { 'zh-CN': zh, 'en-US': en })
const i18nEn = createI18n('en-US', { 'zh-CN': zh, 'en-US': en })

function sampleStates(): SnakeState[] {
  // 覆盖四类局面：开局、按键走过一格（立即执行）、撞死、填满棋盘获胜
  const turned = turn(createState(SEED, 'challenging'), 'down')
  const moved = tick(turned)
  const dead = turn(stateWith('skilled', { body: [5, 6, 7], food: 100 }), 'up')
  const score = (SIZE * SIZE - INITIAL_LENGTH) / difficultySpec('skilled').growth
  const won = stateWith('skilled', {
    body: hamiltonianCycle(SIZE),
    food: NO_FOOD,
    score,
    cursor: 1 + score,
  })
  return [createState(SEED, 'starter'), createState(SEED, 'skilled'), turned, moved, dead, won]
}

describe('中英字典对齐', () => {
  it('没有缺失、多余或复数形式不完整的 key', () => {
    expect(compareDicts({ 'zh-CN': snakeZh, 'en-US': snakeEn })).toEqual([])
    // 与核心字典合并后也不允许出现冲突
    expect(compareDicts({ 'zh-CN': zh, 'en-US': en })).toEqual([])
  })

  it('两边基础 key 集合完全一致且非空', () => {
    const zhBase = [...baseKeys(snakeZh)].sort()
    const enBase = [...baseKeys(snakeEn)].sort()
    expect(zhBase).toEqual(enBase)
    expect(zhBase.length).toBeGreaterThanOrEqual(20)
    // 所有 key 都落在本游戏的命名空间里，避免污染别的游戏
    expect(zhBase.every((key) => key.startsWith('snake.'))).toBe(true)
  })

  it('复数形式齐备（英文有 __one/__other，中文只用 __other）', () => {
    for (const key of ['snake.result.moves', 'snake.result.score', 'snake.result.length', 'snake.solved.best']) {
      expect(snakeEn[`${key}__other`], key).toBeDefined()
      expect(snakeZh[`${key}__other`], key).toBeDefined()
    }
    for (const key of ['snake.result.moves', 'snake.solved.best']) {
      expect(snakeEn[`${key}__one`], key).toBeDefined()
    }
    // 壳层对「最佳成绩」用 t(key, {count})，所以普通 key 也必须存在
    expect(snakeZh['snake.solved.best']).toBeDefined()
    expect(snakeEn['snake.solved.best']).toBeDefined()
  })

  it('关键流程文案（壳层按命名空间取的那些）都能解析', () => {
    const keys = [
      'snake.title',
      'snake.rules.body',
      'snake.rules.body2',
      'snake.rules.restart',
      'snake.blocked',
      'snake.dpad.label',
      'snake.won.title',
      'snake.lost.title',
      'snake.solved.best',
      'snake.stat.score',
      'snake.stat.length',
      'snake.stat.moves',
      // 本作没有关卡；这两个键只是壳层按命名空间取键时的兜底（见 i18n.ts 注释）
      'snake.level.label',
      'snake.level.position',
      'shell.game.undo',
      'shell.game.restart',
      ...snakeGame.difficulties.map((spec) => spec.labelKey),
      ...Object.values(CELL_LABEL_KEYS),
    ]
    for (const key of keys) {
      expect(i18nZh.t(key), key).not.toContain('⟦')
      expect(i18nEn.t(key), key).not.toContain('⟦')
    }
    expect(i18nZh.missingKeys()).toEqual([])
    expect(i18nEn.missingKeys()).toEqual([])
  })

  it('玩法说明如实写明「会自动前进」与「怎么暂停」，间隔写的是**三档统一值**（0.7 秒）', () => {
    expect(snakeZh['snake.rules.body']).toContain('自己往前爬')
    expect(snakeZh['snake.rules.body2']).toContain('暂停')
    expect(snakeEn['snake.rules.body']).toMatch(/crawls on its own/i)
    expect(snakeEn['snake.rules.body2']).toMatch(/pause/i)
    const zhSeconds = [...(snakeZh['snake.rules.body'] ?? '').matchAll(/(\d+(?:\.\d+)?) 秒/g)].map(
      (match) => Number(match[1]),
    )
    const enSeconds = [...(snakeEn['snake.rules.body'] ?? '').matchAll(/(\d+(?:\.\d+)?)s(?=[ ,.])/g)].map(
      (match) => Number(match[1]),
    )
    // 用户要求"不同难度的延迟应该统一"：说明里只能出现**一个**间隔值（0.7 秒），
    // 不能再宣传"越难越快"的分档速度（旧文案 0.6 / 0.48 / 0.4）。
    expect(zhSeconds).toEqual([0.7])
    expect(enSeconds).toEqual([0.7])
    expect(snakeZh['snake.rules.body']).not.toMatch(/0\.6|0\.48|0\.4/)
    expect(snakeEn['snake.rules.body']).not.toMatch(/0\.6|0\.48|0\.4/)
    for (const value of [...zhSeconds, ...enSeconds]) {
      // 不低于 400ms 硬下限，并且与玩法声明的统一值一致（文案不会和 meta.ts 漂移）
      expect(value * 1000).toBeGreaterThanOrEqual(MIN_TICK_MS)
      expect(value * 1000).toBe(difficultySpec('starter').tickMs)
    }
    // 文案说"统一"，三档声明就必须真的统一
    const declared = DIFFICULTY_IDS.map((id) => difficultySpec(id).tickMs)
    expect(new Set(declared).size).toBe(1)
  })

  it('难度 id 与其它游戏一致（壳层 prop 直接传 id），labelKey 落在本命名空间', () => {
    expect(snakeGame.difficulties.map((spec) => spec.id)).toEqual([
      'starter',
      'skilled',
      'challenging',
    ])
    expect(
      snakeGame.difficulties.every((spec) => spec.labelKey.startsWith('snake.difficulty.')),
    ).toBe(true)
  })

  it('首页方块字形是单个汉字（供只显示单字的入口使用）', () => {
    expect([...snakeGlyph]).toHaveLength(1)
  })
})

describe('游戏产出的每个 key 都能取到文案', () => {
  it('stats / controls / result 里的 labelKey 在 zh 与 en 都能取到', () => {
    for (const state of sampleStates()) {
      const view = buildView(state)
      const controls = buildControls(state)
      const keys = [
        ...view.stats.map((stat) => stat.labelKey),
        ...controls.map((control) => control.labelKey),
        ...(view.result ? [view.result.titleKey] : []),
        // 玩法自己产出的提示（现在恒为 null）与壳层的非法提示都必须中英都能取到
        ...(view.notice ? [view.notice.textKey] : []),
        ...(view.result?.details ?? []).map((detail) => `${detail.key}__other`),
      ]
      for (const key of keys) {
        expect(i18nZh.t(key), key).not.toContain('⟦')
        expect(i18nEn.t(key), key).not.toContain('⟦')
      }
      // 带 params 的明细走 plural()，中英都必须能解析
      for (const detail of view.result?.details ?? []) {
        const count = Number(detail.params?.count ?? 0)
        expect(i18nZh.plural(detail.key, count, detail.params)).not.toContain('⟦')
        expect(i18nEn.plural(detail.key, count, detail.params)).not.toContain('⟦')
      }
    }
    expect(i18nZh.missingKeys()).toEqual([])
    expect(i18nEn.missingKeys()).toEqual([])
  })

  it('非法提示 key 可解析（掉头/结束后按键时的文字反馈）', () => {
    expect(snakeGame.illegalNoticeKey).toBe('snake.blocked')
    expect(i18nZh.t(snakeGame.illegalNoticeKey!)).not.toContain('⟦')
    expect(i18nEn.t(snakeGame.illegalNoticeKey!)).not.toContain('⟦')
  })

  it('存档经 JSON 往返后仍能渲染（decode 与 view 不依赖 undefined 字段）', () => {
    for (const state of sampleStates()) {
      const restored = decodeState(JSON.parse(JSON.stringify(encodeState(state))))
      expect(restored).toEqual(state)
      expect(buildView(restored).board?.cells).toHaveLength(SIZE * SIZE)
    }
  })
})
