/**
 * 记忆配对的「棋盘几何 + 牌堆」——纯函数，不感知 GameDef / 对局状态。
 *
 * 为什么把难度与洗牌放在这里：
 * 尺寸、对数、符号、洗牌结果是规则层与视图层共用的**同一份事实**，
 * 集中在一处就不会出现「视图按 4×4 画、规则按 5×4 算」这类分叉。
 *
 * 索引约定：行优先 `index = row * cols + col`，row 0 在最上、col 0 在最左。
 * 三档难度都是「对数成整」的矩形网格：
 *   starter 4×3 = 12 格 / 6 对，skilled 4×4 = 16 格 / 8 对，challenging 5×4 = 20 格 / 10 对
 *   （写法为 列×行，与壳层 BoardView.cols / rows 一致）。
 *
 * 确定性：洗牌只用 core 的 `createRng(seed + 游标)`，绝不使用 Math.random。
 * 游标由 `restart` 递增，因此「重开必换牌面」也是同种子可复现的。
 */
import { IllegalActionError, createRng } from '@eink/core'

export const MEMORY_ID = 'memory'
/** 规则版本：规则语义变化时 +1，旧存档据此判定兼容性 */
export const MEMORY_RULES_VERSION = 1
/** 内容版本：本作没有题库/关卡包，随规则一起走 */
export const MEMORY_CONTENT_VERSION = 1

/** 三档难度只改网格尺寸（等价于改对数），规则完全相同 */
export const DIFFICULTY_IDS = ['starter', 'skilled', 'challenging'] as const
export type DifficultyId = (typeof DIFFICULTY_IDS)[number]

export interface BoardConfig {
  readonly cols: number
  readonly rows: number
}

export const DIFFICULTIES: Record<DifficultyId, BoardConfig> = {
  starter: { cols: 4, rows: 3 },
  skilled: { cols: 4, rows: 4 },
  challenging: { cols: 5, rows: 4 },
}

/**
 * 卡面符号：**纯黑白可区分的文字符号**，每对取一个、同一局内不重复。
 * 为什么不用颜色/灰度：1-bit 墨水屏上只有「实心 vs 空心」「尖角 vs 圆角」这类
 * 形状差异才稳定可辨，所以符号两两成组（实心/空心、三角/圆/方/菱形/十字/X）。
 * 数量 ≥ 最大对数（10），排在前面的符号优先使用。
 */
export const SYMBOLS: readonly string[] = [
  '★',
  '☆',
  '●',
  '○',
  '▲',
  '△',
  '■',
  '□',
  '◆',
  '◇',
  '✚',
  '✖',
]

export function isDifficultyId(value: string): value is DifficultyId {
  return (DIFFICULTY_IDS as readonly string[]).includes(value)
}

export function difficultyOrThrow(value: string): DifficultyId {
  if (!isDifficultyId(value)) {
    throw new IllegalActionError(MEMORY_ID, `unknown difficulty ${value}`)
  }
  return value
}

export function difficultyLabelKey(id: DifficultyId): string {
  return `${MEMORY_ID}.difficulty.${id}`
}

export function configFor(difficulty: DifficultyId): BoardConfig {
  return DIFFICULTIES[difficulty]
}

export function cellCount(config: BoardConfig): number {
  return config.cols * config.rows
}

/** 对数 = 格子数 / 2；三档难度的格子数都是偶数，因此这是整数 */
export function pairCount(config: BoardConfig): number {
  return cellCount(config) / 2
}

export function totalCellsOf(difficulty: DifficultyId): number {
  return cellCount(configFor(difficulty))
}

/** 种子归一化成 uint32：负数/小数/NaN 都不会破坏「同 seed 同结果」 */
export function normalizeSeed(seed: number): number {
  return Number.isFinite(seed) ? Math.trunc(seed) >>> 0 : 0
}

/** pairId → 符号；越界返回空串（调用方保证 pairId 合法） */
export function glyphForPair(pairId: number): string {
  return SYMBOLS[pairId] ?? ''
}

/**
 * 洗牌：把「每对两张」的牌堆用 `createRng(seed + 游标)` 打乱，返回每格的 pairId。
 *
 * 返回的是 pairId 数组而不是符号数组：符号由 pairId 查表得到，
 * 这样「每张牌恰好出现两次」这条不变量在数据层就是显然的，测试也容易逐项核对。
 */
export function deal(seed: number, cursor: number, difficulty: DifficultyId): number[] {
  const config = configFor(difficulty)
  const pairs = pairCount(config)
  const deck: number[] = []
  for (let pair = 0; pair < pairs; pair++) deck.push(pair, pair)
  return createRng(seed + cursor).shuffle(deck)
}
