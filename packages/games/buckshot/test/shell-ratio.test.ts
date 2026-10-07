/**
 * 弹数配比的回归护栏：**实弹与空包数量最多相差 1**（对齐原版规则）。
 *
 * 由来：原实现是 `live = 1 + rng.int(total - 1)`（1…total−1 均匀），
 * 管长 4 发时有 2/3 的局面是 1实3空 或 3实1空，8 发时甚至能出 1实7空 ——
 * 与原版「先对半分，奇数才抛硬币决定哪边多一枚」不符，也让局面极端化。
 * 改动同时抬了 RULES_VERSION（1 → 2），旧存档按约定失效。
 *
 * 这里不钉某个种子的结局（弹序一改就变）：把整局走一遍，沿途每一个装填都验不变式，
 * 并要求确实覆盖到第 2、3 轮（那两档管更长，是最容易失衡的地方）。
 */
import { describe, expect, it } from 'vitest'
import { createState, duelOf, reduceState, type BuckshotState } from '../src/index.js'

function step(state: BuckshotState): BuckshotState {
  const duel = duelOf(state)
  if (duel.phase === 'load') return reduceState(state, { type: 'begin' })
  if (duel.phase === 'roundOver') return reduceState(state, { type: 'nextRound' })
  return duel.turn === 0 ? reduceState(state, { type: 'shoot', target: 'opponent' }) : reduceState(state, { type: 'tick' })
}

describe('装填配比：实弹与空包最多相差 1', () => {
  it('整局沿途每个装填都不失衡，且覆盖到第 2、3 轮', () => {
    const roundsSeen = new Set<number>()
    const sizes = new Map<number, string>()
    for (let seed = 1; seed <= 60; seed++) {
      {
        // 用入门档：熟练/挑战现在能读真实弹序，真人很难赢到第 3 轮，覆盖不到长弹管
        let state = createState(seed, 'starter')
        for (let guard = 0; guard < 300 && duelOf(state).phase !== 'matchOver'; guard++) {
          const duel = duelOf(state)
          if (duel.phase === 'load') {
            // 只看**刚装好的这一管**：逆转器会在之后把某一发翻过来（那是道具的本职 ✓），
            // 所以不变式不能对「打过道具之后的弹仓」提要求。
            state = reduceState(state, { type: 'begin' })
            const fresh = duelOf(state)
            const live = fresh.load.filter(Boolean).length
            const blank = fresh.load.length - live
            expect(Math.abs(live - blank), `seed=${seed} 管长=${fresh.load.length} 实=${live} 空=${blank}`).toBeLessThanOrEqual(1)
            roundsSeen.add(fresh.round)
            sizes.set(fresh.load.length, `${live}实 ${blank}空`)
            continue
          }
          state = step(state)
        }
      }
    }
    // 三轮都必须被验到（引擎里 round 从 0 起，显示时才 +1）——长弹管集中在后两轮
    expect([...roundsSeen].sort()).toEqual([0, 1, 2])
    const longSizes = [...sizes.keys()].filter((n) => n >= 5)
    expect(longSizes.length, `长弹管没被覆盖：${[...sizes.keys()].sort().join(',')}`).toBeGreaterThan(0)
    // 偶数管长必须正好对半
    for (const [total, desc] of sizes) {
      if (total % 2 === 0) expect(desc, `管长 ${total} 不是对半`).toBe(`${total / 2}实 ${total / 2}空`)
    }
  })
})
