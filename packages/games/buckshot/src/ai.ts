/**
 * 恶魔（电脑）：每次决定**一步**（用一件道具、抢对手一件道具，或开一枪）。
 * 确定性：随机只来自调用方传入的 Rng（由局面算出）。
 *
 * 难度决定它「作弊」到什么程度（`truth` 由 rules.ts 传进来，是**真实弹仓与位置**）：
 *
 *   入门 starter      ：**完全不用**真实弹序；只会抽烟回血；开枪接近随机（略偏向朝你开枪）；
 *                      手上有肾上腺素就抢一件用掉。
 *   熟练 skilled      ：**知道当前这一发**（原版 Dealer 那种「它好像知道」的感觉就来自这里）；
 *                      缺血抽烟；确定实弹 → 先锯枪管 / 铐人再朝你开枪；
 *                      确定空包 → 逆转器翻成实弹打你，否则打自己赚回合。
 *   挑战 challenging  ：**读到整条真实弹序** —— 能提前看后面的弹（抢/用啤酒把空包退掉换成实弹）、
 *                      按对手手里的道具决定抢什么（锯子 / 手铐 / 啤酒 / 香烟 / 过期药）、
 *                      血量够时吃过期药赌回血；手锯只在能决定胜负或确定实弹时用。
 *
 * 它仍然**只按自己能看到的公开信息 + 授权给该难度的真实弹序**行动：
 * 对手手里有什么是公开的（原作如此），弹仓里剩几发实弹是公开的，只有具体顺序是「作弊」来的。
 */
import type { Rng } from '@eink/core'
import type { ItemId, Move, Seat } from './engine.js'
import { opponent } from './engine.js'
import { liveChance, type SeatView } from './observe.js'

export type DifficultyId = 'starter' | 'skilled' | 'challenging'

/** 交给恶魔的真实信息：弹仓全序 + 当前位置 + 它这一手能抢对手哪些格子（引擎算好，与界面同源） */
export interface DealerTruth {
  order: readonly boolean[]
  pos: number
  stealable: readonly number[]
}

function slotOf(view: SeatView, item: ItemId): number {
  return view.items[view.seat].indexOf(item)
}

export function decideMove(view: SeatView, difficulty: DifficultyId, rng: Rng, truth?: DealerTruth): Move {
  const me = view.seat
  const foe: Seat = opponent(me)
  const has = (item: ItemId): boolean => slotOf(view, item) >= 0
  const use = (item: ItemId): Move => ({ kind: 'item', slot: slotOf(view, item) })
  const hp = view.hp[me]

  // 难度决定真实弹序的可见范围：入门一点也不看，熟练只看当前这一发，挑战看全序
  const knowsCurrent = difficulty !== 'starter' && truth !== undefined && truth.pos < truth.order.length
  const knowsOrder = difficulty === 'challenging' && truth !== undefined
  const trueShell: boolean | null = knowsCurrent ? (truth as DealerTruth).order[(truth as DealerTruth).pos]! : null

  if (has('cigarettes') && hp < view.maxHp) return use('cigarettes')

  if (difficulty === 'starter') {
    // 手上有肾上腺素就抢一件：优先香烟，其余随便挑一件能抢的
    if (has('adrenaline') && truth !== undefined && truth.stealable.length > 0) {
      const pick =
        truth.stealable.find((slot) => view.items[foe][slot] === 'cigarettes') ??
        truth.stealable[rng.int(truth.stealable.length)]!
      return { kind: 'steal', slot: pick }
    }
    const chance = liveChance(view)
    // 有一点点判断：明显实弹多就打你，否则抛硬币
    return { kind: 'shoot', target: chance > 0.6 || rng.next() < 0.55 ? 'opponent' : 'self' }
  }

  // 抢道具：熟练只在确定能打实弹时抢锯子；挑战按「这一枪能用上什么」排优先级
  if (has('adrenaline') && truth !== undefined && truth.stealable.length > 0) {
    const foeItems = view.items[foe]
    const find = (item: ItemId): number | undefined => truth.stealable.find((slot) => foeItems[slot] === item)
    const nextIsLive = knowsOrder && (truth as DealerTruth).order[(truth as DealerTruth).pos + 1] === true
    const wants: ItemId[] =
      difficulty === 'challenging'
        ? [
            ...(trueShell === true && view.hp[foe] > 1 && !view.saw ? (['saw'] as ItemId[]) : []),
            ...(trueShell === true && !view.cuffed[foe] && view.left >= 2 ? (['handcuffs'] as ItemId[]) : []),
            ...(trueShell === false && nextIsLive && view.left >= 2 ? (['beer'] as ItemId[]) : []),
            ...(hp < view.maxHp ? (['cigarettes'] as ItemId[]) : []),
            ...(hp >= 2 && hp <= view.maxHp - 2 ? (['medicine'] as ItemId[]) : []),
          ]
        : trueShell === true && view.hp[foe] > 1 && !view.saw
          ? (['saw'] as ItemId[])
          : []
    for (const item of wants) {
      const slot = find(item)
      if (slot !== undefined) return { kind: 'steal', slot }
    }
  }

  if (difficulty === 'challenging' && has('medicine') && hp >= 2 && hp <= view.maxHp - 2) return use('medicine')

  let known = view.known[0] ?? null
  // 真实弹序（授权范围内）优先于「先花一件道具去看」
  if (known === null && trueShell !== null) known = trueShell
  if (known === null && has('magnifier')) return use('magnifier')
  if (known === null && difficulty === 'challenging' && has('phone') && view.left >= 3) return use('phone')

  const chance = liveChance(view)
  if (known === null && chance === 1) known = true
  if (known === null && chance === 0) known = false

  if (known === false) {
    // 知道下一发是实弹：用啤酒把这发空包退掉，等于白换一发实弹打你
    if (knowsOrder && has('beer') && view.left >= 2 && (truth as DealerTruth).order[(truth as DealerTruth).pos + 1] === true) {
      return use('beer')
    }
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
