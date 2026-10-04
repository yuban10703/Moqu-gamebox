/**
 * 恶魔（电脑）：只看自己的座位视角，每次决定**一步**（用一件道具，或开一枪）。
 * 确定性：随机只来自调用方传入的 Rng（由局面算出）。
 *
 *   入门 starter      ：只会抽烟回血；开枪接近随机（略偏向朝你开枪）。
 *   熟练 skilled      ：缺血抽烟；不知道当前弹先用放大镜；
 *                      确定实弹 → 先锯枪管 / 铐人再朝你开枪；确定空包 → 逆转器翻成实弹打你，否则打自己赚回合；
 *                      不确定 → 按概率：实弹多就打你，空包多就打自己（可用啤酒退掉这一发）。
 *   挑战 challenging  ：在熟练基础上：血量够时吃过期药赌回血；用手机看后面的弹；手锯只在能决定胜负或确定实弹时用。
 */
import type { Rng } from '@eink/core'
import type { ItemId, Move, Seat } from './engine.js'
import { opponent } from './engine.js'
import { liveChance, type SeatView } from './observe.js'

export type DifficultyId = 'starter' | 'skilled' | 'challenging'

function slotOf(view: SeatView, item: ItemId): number {
  return view.items[view.seat].indexOf(item)
}

export function decideMove(view: SeatView, difficulty: DifficultyId, rng: Rng): Move {
  const me = view.seat
  const foe: Seat = opponent(me)
  const has = (item: ItemId): boolean => slotOf(view, item) >= 0
  const use = (item: ItemId): Move => ({ kind: 'item', slot: slotOf(view, item) })
  const hp = view.hp[me]

  if (has('cigarettes') && hp < view.maxHp) return use('cigarettes')

  if (difficulty === 'starter') {
    const chance = liveChance(view)
    // 有一点点判断：明显实弹多就打你，否则抛硬币
    return { kind: 'shoot', target: chance > 0.6 || rng.next() < 0.55 ? 'opponent' : 'self' }
  }

  if (difficulty === 'challenging' && has('medicine') && hp >= 2 && hp <= view.maxHp - 2) return use('medicine')

  let known = view.known[0] ?? null
  if (known === null && has('magnifier')) return use('magnifier')
  if (known === null && difficulty === 'challenging' && has('phone') && view.left >= 3) return use('phone')

  const chance = liveChance(view)
  if (known === null && chance === 1) known = true
  if (known === null && chance === 0) known = false

  if (known === false) {
    if (has('inverter')) return use('inverter')
    return { kind: 'shoot', target: 'self' }
  }

  if (known === true) {
    const lethalWithSaw = view.hp[foe] === 2
    const wantSaw = difficulty === 'challenging' ? lethalWithSaw || view.hp[foe] > 2 : true
    if (has('saw') && !view.saw && wantSaw && view.hp[foe] > 1) return use('saw')
    if (has('handcuffs') && !view.cuffed[foe] && view.left >= 2) return use('handcuffs')
    return { kind: 'shoot', target: 'opponent' }
  }

  // 不确定
  if (chance >= 0.5) {
    if (has('handcuffs') && !view.cuffed[foe] && view.left >= 2 && chance > 0.5) return use('handcuffs')
    return { kind: 'shoot', target: 'opponent' }
  }
  if (has('beer') && view.left >= 2) return use('beer')
  return { kind: 'shoot', target: 'self' }
}
