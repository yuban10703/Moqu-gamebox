/**
 * 确定性随机源。规则层只允许使用这里的随机数，禁止 Math.random。
 * mulberry32：32 位状态、实现短、跨平台结果一致（双端同种子必然同结果）。
 */
export interface Rng {
  readonly seed: number
  next(): number
  int(maxExclusive: number): number
  pick<T>(items: readonly T[]): T
  shuffle<T>(items: readonly T[]): T[]
}

export function createRng(seed: number): Rng {
  let state = (seed >>> 0) || 0x9e3779b9
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    seed: seed >>> 0,
    next,
    int(maxExclusive: number): number {
      if (maxExclusive <= 0) throw new Error('maxExclusive must be > 0')
      return Math.floor(next() * maxExclusive) % maxExclusive
    },
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) throw new Error('cannot pick from empty list')
      return items[this.int(items.length)]!
    },
    shuffle<T>(items: readonly T[]): T[] {
      const out = items.slice()
      for (let i = out.length - 1; i > 0; i--) {
        const j = this.int(i + 1)
        const tmp = out[i]!
        out[i] = out[j]!
        out[j] = tmp
      }
      return out
    },
  }
}

/** 由字符串生成稳定种子（用于「每日挑战」这类需要可复现种子的场景） */
export function seedFromString(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}
