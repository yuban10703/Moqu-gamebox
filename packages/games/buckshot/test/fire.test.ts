/**
 * 开枪定格画面（DuelView.fire）与它的停顿时长。
 *
 * 这一屏存在的理由：墨水屏做不出枪口闪光的动画，只能把「这一枪」单独摆一屏，
 * 靠反转（实弹）/ 虚框（空包）与多停一拍把结果讲清楚。因此测试盯四件事：
 * 1. 画面只在**最后一条事件是开枪**时出现（之后任何事件都把它顶掉）；
 * 2. 画面的三要素正确：谁打谁（按面板位置）、实弹还是空包、掉了几格血；
 * 3. 打倒人的那一枪带 lethal；
 * 4. 对手回合遇到刚开枪时多停一拍（FIRE_HOLD_MS），平时仍是 DEVIL_DELAY_MS。
 */
import { describe, expect, it } from 'vitest'
import {
  DEVIL_DELAY_MS,
  FIRE_HOLD_MS,
  buildView,
  createState,
  duelOf,
  reduceState,
  tickMsOf,
  type BuckshotState,
} from '../src/index.js'

/** 打完「开始」后按顺序派发动作，返回终态 */
function play(state: BuckshotState, actions: Parameters<typeof reduceState>[1][]): BuckshotState {
  return actions.reduce((current, action) => reduceState(current, action), state)
}

function fireOf(state: BuckshotState) {
  return buildView(state).duel!.fire ?? null
}

describe('画面什么时候出现', () => {
  it('装填阶段没有画面', () => {
    const state = createState(1, 'starter')
    expect(fireOf(state)).toBeNull()
    expect(fireOf(play(state, [{ type: 'begin' }]))).toBeNull()
  })

  it('开完枪就定格：位置、实空、伤害、掉血都对', () => {
    const state = play(createState(7, 'starter'), [
      { type: 'begin' },
      { type: 'shoot', target: 'opponent' },
    ])
    const fire = fireOf(state)!
    expect(fire).not.toBeNull()
    expect(fire.shooter).toBe('bottom') // 真人 0 号位在下方
    expect(fire.target).toBe('top') // 恶魔 1 号位在上方
    expect(['live', 'blank']).toContain(fire.shell)
    expect(fire.maxHp).toBe(duelOf(state).maxHp)
    // 实弹掉 1 格血 / 空包不掉血
    expect(fire.hp).toBe(fire.hpBefore - fire.damage)
    expect(fire.damage).toBe(fire.shell === 'live' ? 1 : 0)
    expect(fire.lethal).toBe(false)
  })

  it('下一件事发生（对手行动）就把画面顶掉', () => {
    const shot = play(createState(7, 'starter'), [
      { type: 'begin' },
      { type: 'shoot', target: 'opponent' },
    ])
    expect(fireOf(shot)).not.toBeNull()
    // 恶魔回合：tick 让它行动 → 画面上不再是那一枪
    const after = reduceState(shot, { type: 'tick' })
    const fire = fireOf(after)
    if (fire) {
      // 恶魔也可能又开了一枪：那画面必须是**它**那一枪，而不是玩家上一枪
      expect(fire.shooter).toBe('top')
    } else {
      expect(fire).toBeNull()
    }
  })

  it('朝自己开枪：开枪方与挨打方是同一个位置', () => {
    // 找一局第一发是空包的种子（对自己打空包会保留回合，最典型）
    let state = play(createState(2, 'starter'), [
      { type: 'begin' },
      { type: 'shoot', target: 'self' },
    ])
    let fire = fireOf(state)
    for (let seed = 2; fire && fire.shell === 'live' && seed < 20; seed++) {
      state = play(createState(seed, 'starter'), [
        { type: 'begin' },
        { type: 'shoot', target: 'self' },
      ])
      fire = fireOf(state)
    }
    expect(fire).not.toBeNull()
    expect(fire!.shell).toBe('blank')
    expect(fire!.shooter).toBe('bottom')
    expect(fire!.target).toBe('bottom')
    expect(fire!.damage).toBe(0)
    expect(fire!.hp).toBe(fire!.hpBefore)
  })

  it('打倒人的那一枪 lethal，血量归零', () => {
    // 一路推到底：真人朝恶魔开枪、恶魔 tick、打空弹仓就重新装填、一轮结束就下一轮，
    // 直到出现「打倒」的那一枪（谁打倒谁都可以）。
    let lethal: ReturnType<typeof fireOf> = null
    for (const seed of [11, 3, 5, 9, 17, 23, 31]) {
      let state = play(createState(seed, 'starter'), [{ type: 'begin' }])
      let guard = 0
      while (guard++ < 400) {
        const duel = duelOf(state)
        if (duel.phase === 'load') state = reduceState(state, { type: 'begin' })
        else if (duel.phase === 'roundOver') state = reduceState(state, { type: 'nextRound' })
        else if (duel.phase === 'matchOver') break
        else state = duel.turn === 0 ? reduceState(state, { type: 'shoot', target: 'opponent' }) : reduceState(state, { type: 'tick' })
        const fire = fireOf(state)
        if (fire?.lethal) {
          lethal = fire
          break
        }
      }
      if (lethal) break
    }
    expect(lethal).not.toBeNull()
    expect(lethal!.lethal).toBe(true)
    expect(lethal!.hp).toBe(0)
    expect(lethal!.hpBefore).toBeGreaterThan(0)
    expect(lethal!.shell).toBe('live')
  })
})

describe('定格时长', () => {
  it('刚开枪、轮到恶魔 → 多停一拍；平时是普通间隔', () => {
    const state = play(createState(7, 'starter'), [
      { type: 'begin' },
      { type: 'shoot', target: 'opponent' },
    ])
    // 这一枪若把回合交给了恶魔，就该等 FIRE_HOLD_MS
    if (duelOf(state).turn === 1 && duelOf(state).phase === 'turn') {
      expect(tickMsOf(state)).toBe(FIRE_HOLD_MS)
    }
    // 恶魔行动之后（画面已换/消失）回到普通间隔
    const after = reduceState(state, { type: 'tick' })
    if (duelOf(after).turn === 1 && duelOf(after).phase === 'turn') {
      expect([DEVIL_DELAY_MS, FIRE_HOLD_MS]).toContain(tickMsOf(after))
    }
  })

  it('轮到自己时不起表（定格画面等玩家看完再动手）', () => {
    const state = play(createState(2, 'starter'), [
      { type: 'begin' },
      { type: 'shoot', target: 'self' },
    ])
    if (duelOf(state).turn === 0) expect(tickMsOf(state)).toBeNull()
    expect(FIRE_HOLD_MS).toBeGreaterThan(DEVIL_DELAY_MS) // 定格比平时长，才读得完
  })
})

describe('整场结束：画面必须退场', () => {
/** 推进一步：装填就「开始」、轮间就「下一轮」、否则轮到谁谁行动 */
function step(state: BuckshotState): BuckshotState {
  const duel = duelOf(state)
  if (duel.phase === 'load') return reduceState(state, { type: 'begin' })
  if (duel.phase === 'roundOver') return reduceState(state, { type: 'nextRound' })
  return duel.turn === 0 ? reduceState(state, { type: 'shoot', target: 'opponent' }) : reduceState(state, { type: 'tick' })
}

/** 一直推到整场结束（或步数上限），返回终态 */
function toMatchOver(seed: number): BuckshotState {
  let state = reduceState(createState(seed, 'starter'), { type: 'begin' })
  let guard = 0
  while (guard++ < 500 && duelOf(state).phase !== 'matchOver') state = step(state)
  return state
}

describe('整场结束：画面必须退场', () => {
  it('matchOver 时不再有开枪画面（让位给结果面板），信息仍在 log 里', () => {
    // 用户真机反馈：「游戏结束了画面还挂着」—— 整场结束时不再有下一条事件，
    // 画面必须自己退场，否则会一直盖着枪与说明
    const state = toMatchOver(11)
    expect(duelOf(state).phase).toBe('matchOver')
    expect(buildView(state).duel!.fire ?? null).toBeNull()
    expect(buildView(state).duel!.log.length).toBeGreaterThan(0)
  })

  it('一轮被真人赢下（roundOver）时画面仍在：打倒那一枪不该被误伤', () => {
    // vs 模式输一轮即整场结束，所以要找一个「真人赢下一轮」的种子才会停在 roundOver
    let checked = 0
    for (const seed of [2, 3, 5, 7, 11, 13, 17, 19, 23, 29]) {
      let state = reduceState(createState(seed, 'starter'), { type: 'begin' })
      let guard = 0
      while (guard++ < 500) {
        const phase = duelOf(state).phase
        if (phase === 'roundOver') {
          checked++
          expect(buildView(state).duel!.fire ?? null).not.toBeNull()
          break
        }
        if (phase === 'matchOver') break // 这一局真人先输了整场：换下一个种子找「赢下一轮」
        state = step(state)
      }
      if (checked > 0) break
    }
    expect(checked).toBeGreaterThan(0)
  })
})
})
