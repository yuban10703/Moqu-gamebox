/**
 * 直棋（Nine Men's Morris）棋盘模型：7×7 网格上的 24 点位 + 经典连接线。
 *
 * ── 点位判据（不是结论，判据本身）────────────────────────────────────────────
 * 三个同心方框，边长分别是 7、5、3（用 7×7 网格表达）：
 *   环 0（外框）：行/列取 0..6，min=0、max=6、mid=3
 *   环 1（中框）：行/列取 1..5，min=1、max=5、mid=3
 *   环 2（内框）：行/列取 2..4，min=2、max=4、mid=3
 * 每个环取「四个角 + 四条边的中点」共 8 个点位 ⇒ 3 环 × 8 = **24 个点位**。
 * 其余 49−24 = 25 格是**非点位**（`kind:'wall'`，壳层斜纹）。
 * 点位在环内的顺序（也就是环上顺时针一圈）固定为：
 *   (min,min) → (min,mid) → (min,max) → (mid,max) → (max,max) → (max,mid) → (max,min) → (mid,min)
 * 紧凑索引 = ring*8 + 上面这个顺序里的位置 ⇒ 0..23。
 *
 * ── 连接线判据 ──────────────────────────────────────────────────────────────
 * ① **环边**：同一个环上相邻的两个点位相连（上面那个 8 元顺序里 pos 与 pos+1 相连，pos=7 连回 0）
 *    ⇒ 每环 8 条 × 3 环 = 24 条。其中贴着行的 12 条、贴着列的 12 条。
 * ② **径向边**：内外方框**同方位的边中点**相连。边中点是环内位置 1（上）、3（右）、5（下）、7（左），
 *    因此有 4 条**径向线**；相邻两环之间各连一段 ⇒ 每线 2 段 × 4 线 = **8 条径向边**。
 * 合计 24 + 8 = **32 条邻接边**。用度数自检（这条最能说明问题）：
 *   12 个角点度数 2、8 个「中框边中点」度数 3、4 个「中框边中点中位于中间方框的」度数 4
 *   —— 12×2 + 8×3 + 4×4 = 64 = 2×32 ✓，正是经典盘面的特征。
 * 注意：任务书写的「横 12 + 竖 12 + 径向 4 = 28 条」与几何不符 —— 径向线确实是 4 条，
 * 但每条径向线被中间那个方框的中点分成 **2 段**，所以径向**边**是 8 条，总数是 32；
 * 若只连 4 条「外中点 ↔ 内中点」，中框边中点会从度数 4 掉到 2，而且一步会「跨过」中间那个点位，
 * 那不是直棋的走法。这里按经典盘面实现（32 条），测试里同时断言「径向线 4 条 / 径向边 8 条」。
 *
 * ── 成三线判据 ──────────────────────────────────────────────────────────────
 * 一条成三线 = 同一行或同一列上**依次相邻**的 3 个点位（相邻 = 上面两条判据里的邻接边）。
 * 判据用法：把点位按行分组、按列分组，各自按列号/行号排序后每 3 个一段；
 * 校验段内相邻两点必有邻接边。于是得到 8 条行线 + 8 条列线 = **16 条成三线**
 * （行 3 有 6 个点位 (3,0)(3,1)(3,2)(3,4)(3,5)(3,6)，中间 (3,3) 不是点位，所以正好分成两段）。
 */
import { IllegalActionError } from '@eink/core'

export const GAME_ID = 'ninemens'

export const BOARD_SIZE = 7
export const GRID_CELLS = BOARD_SIZE * BOARD_SIZE
export const RING_COUNT = 3
export const POINTS_PER_RING = 8
export const POINT_COUNT = RING_COUNT * POINTS_PER_RING
export const STONES_PER_SIDE = 9

export const DIFFICULTY_IDS = ['starter', 'skilled', 'challenging'] as const
export type DifficultyId = (typeof DIFFICULTY_IDS)[number]

/** 黑方是玩家（先手），白方由规则层自动应手 */
export type Player = 'black' | 'white'
export const BLACK: Player = 'black'
export const WHITE: Player = 'white'

export function otherPlayer(player: Player): Player {
  return player === BLACK ? WHITE : BLACK
}

/** 阶段：落子期 / 移动期 / 飞子期（只表示**当前行棋方**处于哪个阶段） */
export type Phase = 'placing' | 'moving' | 'flying'

export interface PointInfo {
  /** 紧凑点位索引 0..23 */
  readonly index: number
  readonly ring: number
  /** 环内位置 0..7（0/2/4/6 是角，1/3/5/7 是边中点） */
  readonly position: number
  readonly row: number
  readonly col: number
}

/** 环内位置 → 坐标。顺序：(min,min),(min,mid),(min,max),(mid,max),(max,max),(max,mid),(max,min),(mid,min) */
function ringCoordinate(ring: number, position: number): readonly [number, number] {
  const min = ring
  const max = BOARD_SIZE - 1 - ring
  const mid = (BOARD_SIZE - 1) / 2 // 7×7 的中线恒为 3
  switch (position) {
    case 0:
      return [min, min]
    case 1:
      return [min, mid]
    case 2:
      return [min, max]
    case 3:
      return [mid, max]
    case 4:
      return [max, max]
    case 5:
      return [max, mid]
    case 6:
      return [max, min]
    default:
      return [mid, min]
  }
}

export const POINTS: readonly PointInfo[] = (() => {
  const out: PointInfo[] = []
  for (let ring = 0; ring < RING_COUNT; ring++) {
    for (let position = 0; position < POINTS_PER_RING; position++) {
      const [row, col] = ringCoordinate(ring, position)
      out.push({ index: ring * POINTS_PER_RING + position, ring, position, row, col })
    }
  }
  return out
})()

/** 网格格 → 点位索引（-1 = 非点位） */
export const POINT_AT_GRID: readonly number[] = (() => {
  const table = new Array<number>(GRID_CELLS).fill(-1)
  for (const point of POINTS) table[point.row * BOARD_SIZE + point.col] = point.index
  return table
})()

export function gridIndexOf(point: number): number {
  const info = POINTS[point]
  if (!info) throw new IllegalActionError(GAME_ID, `ninemens.illegal.point:${String(point)}`)
  return info.row * BOARD_SIZE + info.col
}

export function pointAtGrid(gridIndex: number): number {
  return Number.isInteger(gridIndex) && gridIndex >= 0 && gridIndex < GRID_CELLS
    ? POINT_AT_GRID[gridIndex]!
    : -1
}

export function isPointAtGrid(gridIndex: number): boolean {
  return pointAtGrid(gridIndex) >= 0
}

export function inRange(point: number): boolean {
  return Number.isInteger(point) && point >= 0 && point < POINT_COUNT
}

export function rowOf(point: number): number {
  return POINTS[point]!.row
}

export function colOf(point: number): number {
  return POINTS[point]!.col
}

/** 环边：同环相邻位置相连（含 pos7 → pos0 收口） */
export const RING_EDGES: readonly (readonly [number, number])[] = (() => {
  const out: Array<readonly [number, number]> = []
  for (let ring = 0; ring < RING_COUNT; ring++) {
    for (let position = 0; position < POINTS_PER_RING; position++) {
      const a = ring * POINTS_PER_RING + position
      const b = ring * POINTS_PER_RING + ((position + 1) % POINTS_PER_RING)
      out.push([a, b])
    }
  }
  return out
})()

/** 径向边：相邻两环同方位的**边中点**相连（4 条径向线 × 2 段） */
export const RADIAL_LINES: readonly (readonly number[])[] = (() => {
  // 边中点 = 环内位置 1(上)/3(右)/5(下)/7(左)
  return [1, 3, 5, 7].map((position) =>
    Array.from({ length: RING_COUNT }, (_, ring) => ring * POINTS_PER_RING + position),
  )
})()

export const RADIAL_EDGES: readonly (readonly [number, number])[] = (() => {
  const out: Array<readonly [number, number]> = []
  for (const line of RADIAL_LINES) {
    for (let index = 0; index + 1 < line.length; index++) {
      out.push([line[index]!, line[index + 1]!])
    }
  }
  return out
})()

export const ADJACENCY_EDGES: readonly (readonly [number, number])[] = [
  ...RING_EDGES,
  ...RADIAL_EDGES,
]

/** 每个点位的相邻点位（升序） */
export const ADJACENT: readonly (readonly number[])[] = (() => {
  const lists: number[][] = Array.from({ length: POINT_COUNT }, () => [])
  for (const [a, b] of ADJACENCY_EDGES) {
    lists[a]!.push(b)
    lists[b]!.push(a)
  }
  return lists.map((list) => [...new Set(list)].sort((x, y) => x - y))
})()

export function degreeOf(point: number): number {
  return ADJACENT[point]?.length ?? 0
}

export function areAdjacent(a: number, b: number): boolean {
  return inRange(a) && inRange(b) && ADJACENT[a]!.includes(b)
}

/** 成三线：同行/同列里依次相邻的 3 个点位（见文件头判据） */
export const MILL_LINES: readonly (readonly number[])[] = (() => {
  const lines: number[][] = []
  // 同一行按列号排序、同一列按行号排序 —— 必须按坐标排，不能按紧凑索引排
  // （紧凑索引是环序，行 3 的点位索引顺序与列号顺序并不一致）
  const pushRuns = (groups: Map<number, Array<{ key: number; index: number }>>) => {
    for (const [, list] of groups) {
      const sorted = [...list].sort((a, b) => a.key - b.key).map((item) => item.index)
      for (let start = 0; start + 3 <= sorted.length; start += 3) {
        const chunk = sorted.slice(start, start + 3)
        // 判据自检：段内相邻两点必须有邻接边，否则不成线
        const linear = chunk.every((point, index) =>
          index === 0 ? true : areAdjacent(chunk[index - 1]!, point),
        )
        if (linear) lines.push(chunk)
      }
    }
  }
  const byRow = new Map<number, Array<{ key: number; index: number }>>()
  const byCol = new Map<number, Array<{ key: number; index: number }>>()
  for (const point of POINTS) {
    if (!byRow.has(point.row)) byRow.set(point.row, [])
    byRow.get(point.row)!.push({ key: point.col, index: point.index })
    if (!byCol.has(point.col)) byCol.set(point.col, [])
    byCol.get(point.col)!.push({ key: point.row, index: point.index })
  }
  pushRuns(byRow)
  pushRuns(byCol)
  return lines
})()

export function isDifficultyId(value: string): value is DifficultyId {
  return (DIFFICULTY_IDS as readonly string[]).includes(value)
}

export function difficultyOrThrow(value: string): DifficultyId {
  if (!isDifficultyId(value)) throw new IllegalActionError(GAME_ID, `unknown difficulty ${value}`)
  return value
}

export function normalizeSeed(seed: number): number {
  return Number.isFinite(seed) ? Math.trunc(seed) >>> 0 : 0
}

function illegal(reason: string): IllegalActionError {
  return new IllegalActionError(GAME_ID, reason)
}

/** 会被写进日志的动作（`select` 只是界面选中，不记录、不计步） */
export type LoggedAction =
  | { readonly type: 'place'; readonly index: number }
  | { readonly type: 'move'; readonly from: number; readonly to: number }
  | { readonly type: 'remove'; readonly index: number }

export interface NinemensState {
  readonly difficulty: DifficultyId
  readonly seed: number
  /** 24 个点位的占用（null = 空点位） */
  readonly points: readonly (Player | null)[]
  /** 双方还没落到盘上的子数（各从 9 开始） */
  readonly inHand: Readonly<Record<Player, number>>
  /** 双方已经被吃掉的子数（不变量：在场 + 被吃 + 手上 = 9） */
  readonly removed: Readonly<Record<Player, number>>
  readonly turn: Player
  /** 当前行棋方的阶段（由手上子数与在场子数推出，这里存一份便于校验） */
  readonly phase: Phase
  /** 还需要吃掉对方几个子（成三 1 个；一次成两条线 2 个；0 = 正常行棋） */
  readonly pendingRemove: number
  /** 界面选中（只有人类玩家用；不进日志、不计步、decode 只做弱校验） */
  readonly selected: number | null
  /** 玩家（黑方）已经做出的动作数（place/move/remove；select 不算） */
  readonly moves: number
  /** 已应手过的白方回合数：白方每回合用 createRng(seed + 该值) 取一次随机流 */
  readonly rngCursor: number
  /** 双方全部动作的日志（动作日志即存档） */
  readonly log: readonly LoggedAction[]
}

export function createBoardState(seed: number, difficulty: DifficultyId): NinemensState {
  return {
    difficulty,
    seed: normalizeSeed(seed),
    points: new Array<Player | null>(POINT_COUNT).fill(null),
    inHand: { black: STONES_PER_SIDE, white: STONES_PER_SIDE },
    removed: { black: 0, white: 0 },
    turn: BLACK,
    phase: 'placing',
    pendingRemove: 0,
    selected: null,
    moves: 0,
    rngCursor: 0,
    log: [],
  }
}

export function boardCount(state: NinemensState, player: Player): number {
  let count = 0
  for (const owner of state.points) if (owner === player) count += 1
  return count
}

/** 该方还剩多少子（在场 + 手上）—— 不变量里「+ 被吃 = 9」的那部分 */
export function stonesLeft(state: NinemensState, player: Player): number {
  return boardCount(state, player) + state.inHand[player]
}

/** 空点位（升序） */
export function emptyPoints(state: NinemensState): number[] {
  const out: number[] = []
  for (let point = 0; point < POINT_COUNT; point++) {
    if (state.points[point] === null) out.push(point)
  }
  return out
}

export function pointsOf(state: NinemensState, player: Player): number[] {
  const out: number[] = []
  for (let point = 0; point < POINT_COUNT; point++) {
    if (state.points[point] === player) out.push(point)
  }
  return out
}

export function phaseOf(state: NinemensState): Phase {
  if (state.inHand[state.turn] > 0) return 'placing'
  return boardCount(state, state.turn) === 3 ? 'flying' : 'moving'
}

/** 某个点位上的子是否属于某条已完成的成三线 */
export function isInMill(state: NinemensState, point: number, player: Player): boolean {
  return MILL_LINES.some(
    (line) => line.includes(point) && line.every((cell) => state.points[cell] === player),
  )
}

/** 落在 point 上、属于 player 的**已完成成三线**条数（同一子属于两条线时算两次） */
export function millsAt(state: NinemensState, point: number, player: Player): number {
  return MILL_LINES.filter(
    (line) =>
      line.includes(point) && line.every((cell) => state.points[cell] === player),
  ).length
}

/**
 * 现在可以被吃掉的对方点位：不能吃掉成三线里的子，
 * **除非**对方所有子都在成三里（经典规则，否则会出现吃不动的情况）。
 */
export function removablePoints(state: NinemensState, victim: Player): number[] {
  const own = pointsOf(state, victim)
  const outside = own.filter((point) => !isInMill(state, point, victim))
  return outside.length > 0 ? outside : own
}

/** 不含终局判断的原始动作生成（终局判定要用它，避免递归） */
export function rawActions(state: NinemensState): LoggedAction[] {
  const actions: LoggedAction[] = []
  if (state.pendingRemove > 0) {
    for (const index of removablePoints(state, otherPlayer(state.turn))) {
      actions.push({ type: 'remove', index })
    }
    return actions
  }
  const side = state.turn
  if (state.phase === 'placing') {
    for (const index of emptyPoints(state)) actions.push({ type: 'place', index })
    return actions
  }
  const targets = state.phase === 'flying' ? emptyPoints(state) : null
  for (const from of pointsOf(state, side)) {
    const candidates = targets ?? ADJACENT[from]!.filter((point) => state.points[point] === null)
    for (const to of candidates) {
      if (state.points[to] !== null) continue
      actions.push({ type: 'move', from, to })
    }
  }
  return actions
}

export function isTerminal(state: NinemensState): boolean {
  return stonesLeft(state, BLACK) <= 2 || stonesLeft(state, WHITE) <= 2
}

/** 该方现在是否因为无子可动而输（子数还够，但一步都走不了） */
export function stuckPlayer(state: NinemensState): Player | null {
  if (isTerminal(state)) return null
  if (state.pendingRemove > 0) return null
  return rawActions(state).length === 0 ? state.turn : null
}

function switched(state: NinemensState, turn: Player): NinemensState {
  const rngCursor = turn === WHITE && state.turn === BLACK ? state.rngCursor + 1 : state.rngCursor
  const next: NinemensState = { ...state, turn, rngCursor }
  return { ...next, phase: phaseOf(next) }
}

export interface ApplyResult {
  readonly state: NinemensState
  /** 这一手让对方被吃掉的子数（remove 为 1，其它为 0） */
  readonly captured: number
  /** 这一手形成的成三线条数（place/move；remove 为 0） */
  readonly mills: number
}

/**
 * 纯局面转移：执行一个**会进日志**的动作（place/move/remove）。
 * 校验全部在这里做（decode 复用同一函数），非法输入抛 IllegalActionError。
 *
 * 流程：
 * 1. place/move 落子后统计该点形成的成三线条数 → `pendingRemove` 累加；
 * 2. `pendingRemove > 0` 时**不换手**（这一方继续吃子）；
 * 3. 吃子满足条件后（pendingRemove 归零）换手，并重算阶段；
 * 4. 每次动作后都重算 `phase`（落子期结束会自动切到移动/飞子期）。
 */
export function applyAction(state: NinemensState, action: LoggedAction): ApplyResult {
  if (isTerminal(state)) throw illegal('game already finished')
  switch (action.type) {
    case 'place': {
      if (state.pendingRemove > 0) throw illegal('ninemens.illegal.pending-remove')
      if (state.phase !== 'placing') throw illegal('ninemens.illegal.not-placing')
      if (!inRange(action.index)) throw illegal(`ninemens.illegal.point:${String(action.index)}`)
      if (state.points[action.index] !== null) throw illegal(`ninemens.illegal.occupied:${action.index}`)
      const side = state.turn
      const points = [...state.points]
      points[action.index] = side
      const inHand = { ...state.inHand, [side]: state.inHand[side] - 1 }
      let next: NinemensState = { ...state, points, inHand }
      const mills = millsAt(next, action.index, side)
      next = { ...next, pendingRemove: state.pendingRemove + mills }
      next = { ...next, phase: phaseOf(next), log: [...state.log, action] }
      next =
        next.pendingRemove > 0
          ? next
          : switched(next, otherPlayer(side))
      return { state: withMoves(next, state), captured: 0, mills }
    }

    case 'move': {
      if (state.pendingRemove > 0) throw illegal('ninemens.illegal.pending-remove')
      if (state.phase === 'placing') throw illegal('ninemens.illegal.still-placing')
      if (!inRange(action.from) || !inRange(action.to)) throw illegal('ninemens.illegal.point')
      const side = state.turn
      if (state.points[action.from] !== side) throw illegal(`ninemens.illegal.not-yours:${action.from}`)
      if (state.points[action.to] !== null) throw illegal(`ninemens.illegal.occupied:${action.to}`)
      // 只有飞子期可以跳到任意空点；其它时候必须沿连接线走一格
      const flying = state.phase === 'flying'
      if (!flying && !areAdjacent(action.from, action.to)) {
        throw illegal(`ninemens.illegal.not-adjacent:${action.from}->${action.to}`)
      }
      const points = [...state.points]
      points[action.from] = null
      points[action.to] = side
      let next: NinemensState = { ...state, points }
      const mills = millsAt(next, action.to, side)
      next = { ...next, pendingRemove: state.pendingRemove + mills }
      next = { ...next, phase: phaseOf(next), log: [...state.log, action] }
      next = next.pendingRemove > 0 ? next : switched(next, otherPlayer(side))
      return { state: withMoves(next, state), captured: 0, mills }
    }

    case 'remove': {
      if (state.pendingRemove <= 0) throw illegal('ninemens.illegal.no-pending-remove')
      const victim = otherPlayer(state.turn)
      if (!inRange(action.index)) throw illegal(`ninemens.illegal.point:${String(action.index)}`)
      if (state.points[action.index] !== victim) {
        throw illegal(`ninemens.illegal.not-removable:${action.index}`)
      }
      if (!removablePoints(state, victim).includes(action.index)) {
        throw illegal(`ninemens.illegal.mill-protected:${action.index}`)
      }
      const points = [...state.points]
      points[action.index] = null
      const removed = { ...state.removed, [victim]: state.removed[victim] + 1 }
      const pendingRemove = state.pendingRemove - 1
      let next: NinemensState = { ...state, points, removed, pendingRemove, log: [...state.log, action] }
      next = { ...next, phase: phaseOf(next) }
      next = pendingRemove > 0 ? next : switched(next, otherPlayer(state.turn))
      return { state: withMoves(next, state), captured: 1, mills: 0 }
    }

    default: {
      const unknown = action as { type?: unknown }
      throw illegal(`ninemens.illegal.action:${String(unknown.type)}`)
    }
  }
}

/** 黑方动作计数：place/move/remove 都算玩家动作（select 不算，也不进日志） */
function withMoves(next: NinemensState, before: NinemensState): NinemensState {
  return before.turn === BLACK ? { ...next, moves: before.moves + 1 } : next
}
