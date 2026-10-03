/**
 * 展示模型：把局面翻译成「与呈现技术无关」的棋盘与控制项描述。
 *
 * 1-bit 墨水屏约束（全部复用壳层已有的 kind）：
 * - 空格 `kind:'empty'`；
 * - 出口两格在**没有块占用**时用 `kind:'goal'`（壳层画圆环）；
 * - 块占用的格 `kind:'tile'` + 该块字形（曹/关/张/赵/马/黄/卒），`textScale 0.62`；
 *   同一块的所有格字形相同 —— 靠「同一字形 + 连续矩形」表达形状，不靠灰阶；
 * - 选中的块：它的**每个格**都标 `selected: true`（壳层加粗内描边）。
 */
import type { BoardLabel, BoardView, CellKind, CellView, ControlSpec, GameView, StatView } from '@eink/core'
import {
  CELLS,
  COLS,
  EXIT_CELLS,
  ROWS,
  occupancy,
  PACK,
  levelOrThrow,
  type LevelDef,
  pieceName,
} from './board.js'
import { gameStatus, type KlotskiState } from './rules.js'

/** 块内文字字号：略小于默认，给粗边框留空间 */
export const PIECE_TEXT_SCALE = 0.62

/** 壳层无障碍标签用的 key（apps/web 的约定为 `<namespace>.cell.<kind>`） */
export const CELL_LABEL_KEYS: Partial<Record<CellKind, string>> = {
  empty: 'klotski.cell.empty',
  goal: 'klotski.cell.goal',
  tile: 'klotski.cell.tile',
}

/** 注册表用：把 kind 映射到文案 key（壳层不硬编码玩法文案） */
export function cellLabelKey(kind: CellKind): string | undefined {
  return CELL_LABEL_KEYS[kind]
}

function pieceOf(level: LevelDef, id: string): { glyph: string } | undefined {
  return level.pieces.find((piece) => piece.id === id)
}

export function cellKindAt(state: KlotskiState, index: number): CellKind {
  const level = levelOrThrow(state.levelId).def
  const owner = occupancy(level, state.positions)[index] ?? null
  if (owner !== null) return 'tile'
  return EXIT_CELLS.includes(index) ? 'goal' : 'empty'
}

export function cellGlyphAt(state: KlotskiState, index: number): string {
  const level = levelOrThrow(state.levelId).def
  const owner = occupancy(level, state.positions)[index] ?? null
  if (owner === null) return ''
  return pieceOf(level, owner)?.glyph ?? ''
}

export function buildBoard(state: KlotskiState): BoardView {
  const level = levelOrThrow(state.levelId).def
  const grid = occupancy(level, state.positions)
  const cells: CellView[] = []
  for (let index = 0; index < CELLS; index++) {
    const owner = grid[index] ?? null
    const cell: CellView = { index, kind: 'empty', glyph: '' }
    if (owner !== null) {
      cell.kind = 'tile'
      /*
       * 同一块棋子内部的格线要去掉（用户反馈：分不清哪些方块是一体的）。
       * 只在"右下方向"标出同块的邻格，壳层会由此推出另一侧，从而把**共享的那条边**两侧都去掉；
       * 棋子朝向外部的那条边仍然保留，所以一整块仍然有完整外框。
       */
      const row = Math.floor(index / COLS)
      const col = index % COLS
      if (col + 1 < COLS && grid[index + 1] === owner) cell.mergeRight = true
      if (row + 1 < ROWS && grid[index + COLS] === owner) cell.mergeBottom = true
      // 选中态由整块标签承载（见下方 labels）：逐格画框会把一块棋子又切成小方块
    } else if (EXIT_CELLS.includes(index)) {
      // 出口：空着的时候画圆环，被块压住时让位给块本身
      cell.kind = 'goal'
    }
    cells.push(cell)
  }
  /*
   * 整块文字的覆盖层：一块棋子只写**一个**标签（全名），居中铺满整块。
   * 这样 2×2 的曹操是一整块黑底白字，而不是四个「曹」。
   */
  const anchorOf = new Map<string, number>()
  for (let index = 0; index < CELLS; index++) {
    const owner = grid[index]
    if (owner && !anchorOf.has(owner)) anchorOf.set(owner, index)
  }
  const labels: BoardLabel[] = []
  for (const piece of level.pieces) {
    const anchor = anchorOf.get(piece.id)
    if (anchor === undefined) continue
    const name = pieceName(piece.glyph)
    labels.push({
      index: anchor,
      text: name,
      cols: piece.width,
      rows: piece.height,
      ...(piece.width === 2 && piece.height === 2 ? { invert: true } : {}),
      ...(state.selected === piece.id ? { selected: true } : {}),
    })
  }
  // 刻意不设 groups：4×5 的棋盘没有分组结构
  return { kind: 'grid', cols: COLS, rows: ROWS, cells, labels }
}

/**
 * 控制项：只有撤销。
 * 棋盘点击是唯一的主要输入（selectAction 负责「选中 → 点旁边的空格滑动」两步交互），
 * 重开/关卡选择/下一关都由壳层渲染，游戏不重复声明。
 */
export function buildControls(state: KlotskiState): ControlSpec[] {
  const level = levelOrThrow(state.levelId)
  // 「下一关」由游戏声明壳层才渲染（无关卡玩法不声明），最后一关 enabled:false —— 与 sokoban 同一约定。
  // 这里直接用 PACK 自算下一个关卡，而不是从 index.ts 引 nextLevelId，避免 view ↔ index 的循环导入。
  const index = PACK.findIndex((item) => item.def.id === level.def.id)
  const hasNext = index >= 0 && index + 1 < PACK.length
  return [
    {
      id: 'undo',
      labelKey: 'shell.game.undo',
      role: 'action',
      enabled: state.log.length > 0,
      emphasis: 'normal',
    },
    {
      id: 'next-level',
      labelKey: 'shell.result.next',
      role: 'action',
      enabled: hasNext,
      emphasis: 'primary',
    },
  ]
}

export function buildStats(state: KlotskiState): StatView[] {
  const level = levelOrThrow(state.levelId)
  // 三项恒定输出：内容出现/消失不会让统计栏高度跳动
  return [
    { labelKey: 'klotski.stat.moves', value: String(state.moves) },
    { labelKey: 'klotski.stat.level', value: `${level.index}/${PACK.length}` },
    { labelKey: 'klotski.stat.target', value: String(level.def.optimalMoves) },
  ]
}

export function buildView(state: KlotskiState): GameView {
  const status = gameStatus(state)
  const level = levelOrThrow(state.levelId)
  const details: Array<{ key: string; params?: Record<string, string | number> }> = []
  if (status === 'won') {
    // 带 params 的明细由壳层走 plural()，因此这两个 key 必须提供复数形式
    details.push({ key: 'klotski.result.moves', params: { count: state.moves } })
    details.push({ key: 'klotski.result.target', params: { count: level.def.optimalMoves } })
  }
  return {
    board: buildBoard(state),
    stats: buildStats(state),
    result: status === 'won' ? { titleKey: 'klotski.won.title', details } : null,
    // 没有需要壳层以稳定文字提示的状态：非法滑动由壳层按 illegalNoticeKey 显示
    notice: null,
  }
}
