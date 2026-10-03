/**
 * 消消乐（三消）的棋盘模型：几何、难度、符号，以及**确定性**的棋盘生成与结算原语。
 *
 * 为什么把这些放在一处：规则层、视图层与测试都要用同一份事实
 * （几列几行、几种棋子、哪些格成组、怎么补充新棋子）——
 * 集中在一处就不会出现「视图按 8×8 画、规则按 7×7 算」这类分叉。
 *
 * 墨水屏约束（1-bit、无动画、无灰阶）：
 * - 不同种类只靠**符号形状**区分（见 KIND_GLYPHS），不用颜色、不用灰阶；
 * - 消除 / 下落 / 补充全部是纯计算，由 rules.ts 一次算完（离散步进），没有过渡态。
 *
 * 确定性：随机只来自 core 的 `createRng(seed + 游标)`，游标 = 已经消耗的抽取次数。
 * 每次「放置一枚新棋子」恰好消耗一次抽取，因此游标可以精确记账、存档可复算。
 * 绝不使用 Math.random。
 *
 * 索引约定：行优先 `index = row * cols + col`，row 0 在最上、col 0 在最左。
 */
import { IllegalActionError, createRng } from '@eink/core'
import { MATCH3_ID, type DifficultyId } from './meta.js'

// 身份 / 版本 / 难度 id 定义在 meta.ts（最底层，避免依赖环），这里原样再导出，
// 让 `@eink/match3` 的公开面与其它游戏包一致：壳层只认 index.ts，不关心内部拆分。
export {
  DIFFICULTY_IDS,
  MATCH3_CONTENT_VERSION,
  MATCH3_ID,
  MATCH3_RULES_VERSION,
  difficultyLabelKey,
  difficultyOrThrow,
  isDifficultyId,
  type DifficultyId,
} from './meta.js'

export interface BoardConfig {
  readonly cols: number
  readonly rows: number
  /** 棋子种类数：取 KIND_GLYPHS 的前 kinds 个。必须 ≥ 5，见 `forbiddenKinds` 的说明 */
  readonly kinds: number
  /** 过关所需分数 */
  readonly targetScore: number
  /** 步数上限：用尽仍未达标即失败 */
  readonly moveLimit: number
}

export const DIFFICULTIES: Record<DifficultyId, BoardConfig> = {
  // 入门：8×8 只有 5 种棋子（更容易凑三连），30 步凑 900 分（贪心 AI 平均 15 步达标）
  starter: { cols: 8, rows: 8, kinds: 5, targetScore: 900, moveLimit: 30 },
  // 熟练：同样 8×8，棋子加到 6 种，30 步凑 950 分（贪心 AI 平均 19 步）
  skilled: { cols: 8, rows: 8, kinds: 6, targetScore: 950, moveLimit: 30 },
  // 挑战：7×7 更小的棋盘 + 6 种棋子，20 步凑 650 分（贪心 AI 平均 15.5 步，容错只有 4 步）
  challenging: { cols: 7, rows: 7, kinds: 6, targetScore: 650, moveLimit: 20 },
}

/** 空格标记：只出现在「结算过程中」的棋盘上；稳定局面里每一格都有棋子 */
export const EMPTY = -1

/** 至少几格连成一线才算一次消除 */
export const MIN_MATCH = 3

/** 每次消除的基础分（每格） */
const CLEAR_BASE = 10
/** 长连（4 格及以上）超出 3 格的部分，每格额外加分 */
const LONG_RUN_BONUS = 20

/**
 * 生成初始棋盘 / 重排时的重试上限。
 * 每次重试都换一段随机流（`游标 = 起始 + 尝试次数 × 格子数`），因此仍然完全可复现。
 * 8×8 + 5 种下「无解局面」已经极罕见，24 次是纯防御。
 */
export const MAX_BOARD_ATTEMPTS = 24

/**
 * 棋子符号：**纯黑白可区分的字形**，一局内每种棋子一个，取前 `kinds` 个。
 *
 * 选型依据（真机 1-bit、格子约 50px、字号约 0.7 格）：
 * 六个符号的**外轮廓**互不相同 —— 圆 / 方 / 三角 / 菱形 / 星 / 十字，
 * 不依赖「实心 vs 空心」这种在小尺寸下会糊掉的差别，也不依赖颜色或灰阶。
 * 刻意避开了相近形状（○ 与 ● 同轮廓、△ 与 ▲ 同轮廓）同时出现在同一局里。
 */
export const KIND_GLYPHS: readonly string[] = ['●', '■', '▲', '◆', '★', '✚']

export function configFor(difficulty: DifficultyId): BoardConfig {
  return DIFFICULTIES[difficulty]
}

export function cellCount(config: BoardConfig): number {
  return config.cols * config.rows
}

export function totalCellsOf(difficulty: DifficultyId): number {
  return cellCount(configFor(difficulty))
}

/** 种子归一化成 uint32：负数/小数/NaN 都不会破坏「同 seed 同结果」 */
export function normalizeSeed(seed: number): number {
  return Number.isFinite(seed) ? Math.trunc(seed) >>> 0 : 0
}

export function rowOf(index: number, config: BoardConfig): number {
  return Math.floor(index / config.cols)
}

export function colOf(index: number, config: BoardConfig): number {
  return index % config.cols
}

export function indexOf(row: number, col: number, config: BoardConfig): number {
  return row * config.cols + col
}

export function isIndex(index: number, config: BoardConfig): boolean {
  return Number.isInteger(index) && index >= 0 && index < cellCount(config)
}

/** kind → 符号；越界返回空串（调用方保证 kind 合法） */
export function glyphForKind(kind: number): string {
  return KIND_GLYPHS[kind] ?? ''
}

/** 两格是否正交相邻（上下或左右，斜角不算） */
export function areAdjacent(a: number, b: number, config: BoardConfig): boolean {
  if (!isIndex(a, config) || !isIndex(b, config) || a === b) return false
  const rowA = rowOf(a, config)
  const colA = colOf(a, config)
  const rowB = rowOf(b, config)
  const colB = colOf(b, config)
  return Math.abs(rowA - rowB) + Math.abs(colA - colB) === 1
}

/** 交换两格的内容；返回新数组，不改原数组 */
export function swapCells(board: readonly number[], a: number, b: number): number[] {
  const next = board.slice()
  const tmp = next[a]!
  next[a] = next[b]!
  next[b] = tmp
  return next
}

/** 在一维行/列里找出长度 ≥3 的同种连段，返回 [起, 止] 闭区间（空格不算连段） */
export function lineRuns(values: readonly number[]): Array<readonly [number, number]> {
  const runs: Array<readonly [number, number]> = []
  let start = 0
  for (let i = 1; i <= values.length; i++) {
    const continues = i < values.length && values[i] !== EMPTY && values[i] === values[i - 1]
    if (continues) continue
    if (values[start] !== EMPTY && i - start >= MIN_MATCH) runs.push([start, i - 1])
    start = i
  }
  return runs
}

/**
 * 当前棋盘上所有「成组」的格子：先横扫、再竖扫，每组索引升序。
 * 一组 = 横或竖的极大同种连段（长度 ≥3）；L 形交叉处的格子会同时属于两组（各自计分）。
 */
export function findGroups(board: readonly number[], config: BoardConfig): number[][] {
  const groups: number[][] = []
  for (let row = 0; row < config.rows; row++) {
    const line: number[] = []
    for (let col = 0; col < config.cols; col++) line.push(board[indexOf(row, col, config)]!)
    for (const [start, end] of lineRuns(line)) {
      const group: number[] = []
      for (let col = start; col <= end; col++) group.push(indexOf(row, col, config))
      groups.push(group)
    }
  }
  for (let col = 0; col < config.cols; col++) {
    const line: number[] = []
    for (let row = 0; row < config.rows; row++) line.push(board[indexOf(row, col, config)]!)
    for (const [start, end] of lineRuns(line)) {
      const group: number[] = []
      for (let row = start; row <= end; row++) group.push(indexOf(row, col, config))
      groups.push(group)
    }
  }
  return groups
}

/** 一组的得分：每格 10 分，超出 3 格的长连每格再加 20 分（3→30、4→60、5→90…） */
export function groupScore(length: number): number {
  return length * CLEAR_BASE + Math.max(0, length - MIN_MATCH) * LONG_RUN_BONUS
}

/** 从 index 出发沿 (dRow, dCol) 连续同种棋子的个数；越出同行/同列或遇到异种即停 */
function runLength(
  board: readonly number[],
  config: BoardConfig,
  index: number,
  dRow: number,
  dCol: number,
  kind: number,
): number {
  let row = rowOf(index, config) + dRow
  let col = colOf(index, config) + dCol
  let count = 0
  while (row >= 0 && row < config.rows && col >= 0 && col < config.cols) {
    if (board[indexOf(row, col, config)] !== kind) break
    count += 1
    row += dRow
    col += dCol
  }
  return count
}

/**
 * 若在 index 放进 kind，是否会让这一格落进某个 ≥3 的同种连段。
 *
 * 判据必须同时看**四个方向**：
 * - 只看「上/左已有的两连」不够 —— 左一格与右一格同种时，中间放同种也会凑成三连；
 * - 新补充的棋子落在列顶时，下方是**已有棋子**，同样要检查。
 * 因此这里对每个候选种类精确统计四个方向的连段长度。
 *
 * kinds ≥ 5 时最多有 4 个种类被禁（两轴各最多 2 个），必然还有可选种类，
 * `fillEmpties` 的「一定有解」由此保证。
 */
export function forbiddenKinds(board: readonly number[], config: BoardConfig, index: number): Set<number> {
  const forbidden = new Set<number>()
  for (let kind = 0; kind < config.kinds; kind++) {
    const horizontal =
      1 + runLength(board, config, index, 0, -1, kind) + runLength(board, config, index, 0, 1, kind)
    const vertical =
      1 + runLength(board, config, index, -1, 0, kind) + runLength(board, config, index, 1, 0, kind)
    if (horizontal >= MIN_MATCH || vertical >= MIN_MATCH) forbidden.add(kind)
  }
  return forbidden
}

/** 重力：每列的棋子保持相对顺序落到列底，空出来的格子留在列顶 */
export function applyGravity(board: readonly number[], config: BoardConfig): number[] {
  const next = new Array<number>(board.length).fill(EMPTY)
  for (let col = 0; col < config.cols; col++) {
    let write = config.rows - 1
    for (let row = config.rows - 1; row >= 0; row--) {
      const kind = board[indexOf(row, col, config)]!
      if (kind === EMPTY) continue
      next[indexOf(write, col, config)] = kind
      write -= 1
    }
  }
  return next
}

/**
 * 按行优先顺序给所有空格补新棋子，**每格恰好消耗一次抽取**（游标可精确记账）。
 *
 * 补进来的棋子一定不会当场连成三连：候选种类按随机起点轮转，取第一个不在
 * `forbiddenKinds` 里的种类。这样「补充」永远不会引发新的连锁 ——
 * 连锁只可能来自上方落下来的**旧棋子**，结算因此天然收敛。
 */
export function fillEmpties(
  board: readonly number[],
  config: BoardConfig,
  seed: number,
  cursor: number,
): { board: number[]; cursor: number } {
  const next = board.slice()
  let at = cursor
  for (let index = 0; index < next.length; index++) {
    if (next[index] !== EMPTY) continue
    const forbidden = forbiddenKinds(next, config, index)
    const start = createRng((seed + at) >>> 0).int(config.kinds)
    at += 1
    let picked = -1
    for (let step = 0; step < config.kinds; step++) {
      const kind = (start + step) % config.kinds
      if (!forbidden.has(kind)) {
        picked = kind
        break
      }
    }
    // 只有 kinds 太少（≤4）才可能走到这里；本作三档都是 5~6 种
    if (picked < 0) throw new IllegalActionError(MATCH3_ID, 'match3.illegal.state:no-kind-available')
    next[index] = picked
  }
  return { board: next, cursor: at }
}

/**
 * 从给定游标生成一盘「稳定（无三连）且至少存在一次有效交换」的新棋盘。
 * 初始棋盘用 `cursor = 0`，中途重排用当前游标 —— 同一段随机流因此完全可复现。
 */
export function createStableBoard(
  config: BoardConfig,
  seed: number,
  cursor: number,
): { board: number[]; cursor: number } {
  const cells = cellCount(config)
  for (let attempt = 0; attempt < MAX_BOARD_ATTEMPTS; attempt++) {
    const empty = new Array<number>(cells).fill(EMPTY)
    const filled = fillEmpties(empty, config, seed, cursor + attempt * cells)
    if (hasLegalSwap(filled.board, config)) return filled
  }
  throw new IllegalActionError(MATCH3_ID, 'match3.illegal.state:no-playable-board')
}

/** 初始棋盘（同 seed + 同难度必然相同） */
export function buildBoard(seed: number, difficulty: DifficultyId): { board: number[]; cursor: number } {
  return createStableBoard(configFor(difficulty), normalizeSeed(seed), 0)
}

/** 交换 a、b 后是否至少产生一组三连（只看交换后的盘面，不结算） */
export function isProductiveSwap(board: readonly number[], config: BoardConfig, a: number, b: number): boolean {
  if (!areAdjacent(a, b, config)) return false
  return findGroups(swapCells(board, a, b), config).length > 0
}

/** 当前盘面上所有「换了就能消」的相邻对，行优先、先右后下（顺序固定，便于测试与回放） */
export function findLegalSwaps(board: readonly number[], config: BoardConfig): Array<readonly [number, number]> {
  const swaps: Array<readonly [number, number]> = []
  for (let row = 0; row < config.rows; row++) {
    for (let col = 0; col < config.cols; col++) {
      const index = indexOf(row, col, config)
      if (col + 1 < config.cols && isProductiveSwap(board, config, index, index + 1)) {
        swaps.push([index, index + 1])
      }
      if (row + 1 < config.rows && isProductiveSwap(board, config, index, index + config.cols)) {
        swaps.push([index, index + config.cols])
      }
    }
  }
  return swaps
}

/** 是否还存在能消除的交换；为 false 即「死局」，规则层会重排棋盘 */
export function hasLegalSwap(board: readonly number[], config: BoardConfig): boolean {
  return findLegalSwaps(board, config).length > 0
}
