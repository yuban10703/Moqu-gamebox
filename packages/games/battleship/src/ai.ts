/**
 * 白方（对手）策略：三档难度只改这一处，规则层与呈现层都不感知强度差异。
 *
 * - starter：在我方海域里等概率随机挑一个没打过的格；
 * - skilled：**hunt-target** —— 没有未解决的命中时按「隔格扫描」打（棋盘格同色，
 *   用一半的射击覆盖全部可能出现 2 格以上舰只的位置）；有命中时集火该舰命中格的四邻；
 * - challenging：同上，但当某艘舰已经有一条**连成线**的命中时，优先沿这条线往两端延伸。
 *
 * 确定性：随机只来自调用方传入的 `createRng(seed + AI_SEED_OFFSET + 游标)`；
 * 候选一律升序排列、只对同分候选用随机流挑选，因此同 seed + 同局面必然同一手。
 */
import { type Rng } from '@eink/core'
import {
  BOARD_SIZE,
  CELLS,
  colOf,
  rowOf,
  type BattleshipState,
  type DifficultyId,
  type Ship,
} from './board.js'

/** 该舰在我方海域里的命中格（升序） */
function hitsOf(state: BattleshipState, ship: Ship): number[] {
  return ship.cells.filter((cell) => state.enemyShots[cell]).sort((a, b) => a - b)
}

/** 还没被打掉、但已经被打中过的舰（继续集火的目标） */
export function unresolvedShips(state: BattleshipState): Ship[] {
  return state.playerFleet.ships.filter((ship) => {
    const hits = hitsOf(state, ship)
    return hits.length > 0 && hits.length < ship.cells.length
  })
}

/**
 * 集火候选：未解决舰只的命中格**正交四邻**里还没打过的格。
 * 命中格的斜邻不可能是同一艘舰（舰是直的），所以只看四邻。
 */
export function targetCells(state: BattleshipState): number[] {
  const out = new Set<number>()
  for (const ship of unresolvedShips(state)) {
    for (const hit of hitsOf(state, ship)) {
      const row = rowOf(hit)
      const col = colOf(hit)
      for (const [dr, dc] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ] as const) {
        const r = row + dr
        const c = col + dc
        if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) continue
        const index = r * BOARD_SIZE + c
        if (!state.enemyShots[index]) out.add(index)
      }
    }
  }
  return [...out].sort((a, b) => a - b)
}

/**
 * 沿命中线延伸的候选：某艘未解决舰已有 ≥2 个命中且排成一条直线时，
 * 优先打这条线两端的下一个格（这是最有把握的下一手）。
 */
export function lineExtensionCells(state: BattleshipState): number[] {
  const out = new Set<number>()
  for (const ship of unresolvedShips(state)) {
    const hits = hitsOf(state, ship)
    if (hits.length < 2) continue
    const rows = new Set(hits.map((cell) => rowOf(cell)))
    const cols = new Set(hits.map((cell) => colOf(cell)))
    const horizontal = rows.size === 1
    const vertical = cols.size === 1
    if (!horizontal && !vertical) continue
    const sorted = horizontal
      ? [...hits].sort((a, b) => colOf(a) - colOf(b))
      : [...hits].sort((a, b) => rowOf(a) - rowOf(b))
    const first = sorted[0]!
    const last = sorted[sorted.length - 1]!
    for (const end of [first, last]) {
      const step = horizontal
        ? end === first
          ? -1
          : 1
        : end === first
          ? -BOARD_SIZE
          : BOARD_SIZE
      const next = end + step
      if (next < 0 || next >= CELLS) continue
      // 换行保护：横线不能跨行，竖线不能跨列
      if (horizontal && rowOf(next) !== rowOf(end)) continue
      if (vertical && colOf(next) !== colOf(end)) continue
      if (!state.enemyShots[next]) out.add(next)
    }
  }
  return [...out].sort((a, b) => a - b)
}

/** 隔格扫描：只打「行列同色」的一半格子（舰长 ≥2 时必然会被扫到） */
export function huntCells(state: BattleshipState): number[] {
  const untried: number[] = []
  const parity: number[] = []
  for (let index = 0; index < CELLS; index++) {
    if (state.enemyShots[index]) continue
    untried.push(index)
    if ((rowOf(index) + colOf(index)) % 2 === 0) parity.push(index)
  }
  return parity.length > 0 ? parity : untried
}

/**
 * 为白方选一格射击。返回的格一定是白方还没打过的。
 * `state` 的 turn 不参与判断（纯看射击记录）。
 */
export function chooseShot(
  state: BattleshipState,
  difficulty: DifficultyId,
  rng: Rng,
): number {
  const untried: number[] = []
  for (let index = 0; index < CELLS; index++) if (!state.enemyShots[index]) untried.push(index)
  if (untried.length === 0) throw new Error('battleship: no untried cell')
  if (difficulty === 'starter') return rng.pick(untried)

  const targets = targetCells(state)
  if (targets.length > 0) {
    if (difficulty === 'challenging') {
      const extensions = lineExtensionCells(state)
      if (extensions.length > 0) return rng.pick(extensions)
    }
    return rng.pick(targets)
  }
  return rng.pick(huntCells(state))
}

/** 局面评估（玩家视角的剩余舰格差），供测试与调试用 */
export function evaluatePosition(state: BattleshipState): number {
  const playerLeft = state.playerFleet.cells.filter((cell) => !state.enemyShots[cell]).length
  const enemyLeft = state.enemyFleet.cells.filter((cell) => !state.playerShots[cell]).length
  return enemyLeft - playerLeft
}
