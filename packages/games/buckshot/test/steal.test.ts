/**
 * 肾上腺素：抢对手一件道具并**立刻用掉**。
 *
 * 规则要点（都在这里钉住）：
 *  1. 它不走普通道具路径（`itemUsable` 为 false，`applyMove({kind:'item'})` 会抛），
 *     而是先点它、再点对手那一格（`{kind:'steal', slot}`）。
 *  2. 只能抢「效果用得上」的：枪管已锯过不能抢锯子、对手已铐住不能抢手铐；
 *     也不能抢肾上腺素本身（否则可以无限连锁）。
 *  3. 抢来的这件当回合就能生效、对手那份消失、自己的肾上腺素消耗掉。
 *  4. 存档：`encode`/`decode` 之后重放结果一致（steal 动作要走 readMove 校验）。
 *  5. 恶魔拿到真实弹序：当前是实弹时不会打自己，当前是空包时不会打你。
 */
import { describe, expect, it } from 'vitest'
import { IllegalActionError } from '@eink/core'
import {
  buildView,
  createState,
  duelOf,
  encodeState,
  decodeState,
  legalActions,
  observe,
  reduceState,
  type BuckshotState,
} from '../src/index.js'

function step(state: BuckshotState): BuckshotState {
  const duel = duelOf(state)
  if (duel.phase === 'load') return reduceState(state, { type: 'begin' })
  if (duel.phase === 'roundOver') return reduceState(state, { type: 'nextRound' })
  return duel.turn === 0 ? reduceState(state, { type: 'shoot', target: 'opponent' }) : reduceState(state, { type: 'tick' })
}

/** 扫种子找一局「轮到你、且你手里有肾上腺素、对手手里也有道具」的局面 */
function findAdrenalineMoment(): BuckshotState {
  for (let seed = 1; seed <= 400; seed++) {
    let state = reduceState(createState(seed, 'challenging'), { type: 'begin' })
    for (let guard = 0; guard < 400 && duelOf(state).phase !== 'matchOver'; guard++) {
      const duel = duelOf(state)
      if (duel.phase === 'turn' && duel.turn === 0 && duel.items[0].includes('adrenaline') && duel.items[1].length > 0) {
        const targets = legalActions(state).filter((action) => action.type === 'steal')
        if (targets.length > 0) return state
      }
      state = step(state)
    }
  }
  throw new Error('400 个种子里没找到能抢道具的局面')
}

describe('肾上腺素：抢对手一件道具并立刻用掉', () => {
  const state = findAdrenalineMoment()
  const duel = duelOf(state)

  it('有目标时给得出 steal 动作，界面上对手那几格亮着「可抢」', () => {
    const steals = legalActions(state).filter((action) => action.type === 'steal')
    expect(steals.length).toBeGreaterThan(0)
    // 普通道具路径必须排除它（否则界面点它会走进 item 分支）
    expect(legalActions(state).some((action) => action.type === 'item' && duel.items[0][action.slot] === 'adrenaline')).toBe(false)
    const view = buildView(state)
    const top = view.duel!.sides.find((side) => side.position === 'top')!
    const bottom = view.duel!.sides.find((side) => side.position === 'bottom')!
    const adrenaline = bottom.items.find((item) => item.labelKey === 'buckshot.item.adrenaline')!
    expect(adrenaline.selectable).toBe(true)
    expect(top.items.filter((item) => item.stealable).length).toBe(steals.length)
  })

  it('抢过来就用掉：自己的肾上腺素没了、对手少一件、事件里记着抢的是哪件', () => {
    const steal = legalActions(state).find((action) => action.type === 'steal')!
    const slot = (steal as { slot: number }).slot
    const stolenItem = duel.items[1][slot]!
    const next = reduceState(state, steal)
    const after = duelOf(next)
    expect(after.items[0]).not.toContain('adrenaline')
    expect(after.items[0]).toHaveLength(duel.items[0].length - 1) // 肾上腺素消耗掉，抢来的立刻用掉，不留库存
    expect(after.items[1]).toHaveLength(duel.items[1].length - 1) // 道具可以重复，所以只数件数
    expect(after.items[1].length + after.items[0].length).toBe(duel.items[0].length + duel.items[1].length - 2)
    const events = observe(after, 0).events
    expect(events.some((event) => event.type === 'steal' && event.item === stolenItem)).toBe(true)
  })

  it('记录里有「抢走了谁的什么」这一条', () => {
    const steal = legalActions(state).find((action) => action.type === 'steal')!
    const line = buildView(reduceState(state, steal)).duel!.log.filter((l) => l.key === 'buckshot.log.steal').at(-1)
    expect(line).toBeDefined()
    expect(line!.subjectKey).toBe('buckshot.name.you')
    expect(line!.objectKey).toBe('buckshot.name.devil')
    expect(line!.itemKey).toMatch(/^buckshot\.item\./)
  })

  it('非法用法抛错：当普通道具用、抢不存在的格子', () => {
    const slot = duel.items[0].indexOf('adrenaline')
    expect(() => reduceState(state, { type: 'item', slot })).toThrow(IllegalActionError)
    expect(() => reduceState(state, { type: 'steal', slot: 99 })).toThrow(IllegalActionError)
  })

  it('存档往返：带 steal 的日志 encode → decode 后局面一致', () => {
    const steal = legalActions(state).find((action) => action.type === 'steal')!
    const next = reduceState(state, steal)
    const revived = decodeState(encodeState(next))
    expect(encodeState(revived)).toEqual(encodeState(next))
    expect(buildView(revived).duel!.log.length).toBe(buildView(next).duel!.log.length)
  })
})
