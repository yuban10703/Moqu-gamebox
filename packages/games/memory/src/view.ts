/**
 * 展示模型：把局面翻译成「与呈现技术无关」的棋盘与控制项描述。
 *
 * 1-bit 墨水屏约束：
 * - 只用到两种格子语义：`hidden`（扣着的牌，壳层已有斜纹纹理）与
 *   `tile`（翻开的牌，显示符号文字）；状态区分靠**符号形状**与**描边**，不用灰阶；
 * - 未翻开的牌不显示任何文字（glyph 为空），翻开后显示该对子的符号；
 * - 不匹配、等待盖回的两张用 `selected: true` 加重描边 —— 黑白屏上这是唯一稳定的
 *   层次手段，玩家因此能看出「这两张待盖回，再点一张扣着的牌就会盖回去」；
 * - 不加动画、不加计时器：盖回由玩家下一次点击触发（见 rules.ts 的设计说明）。
 */
import type { BoardView, CellKind, CellView, ControlSpec, GameView, StatView } from '@eink/core'
import { cellCount, configFor, glyphForPair, pairCount } from './board.js'
import { gameStatus, snapshotOf, type MemoryState } from './rules.js'

/** 符号文字相对格子边长的字号系数：略小于缺省 0.66，给实心/空心符号留出留白 */
export const TILE_TEXT_SCALE = 0.62


/** 壳层无障碍标签用的 key（apps/web 的约定：`<namespace>.cell.<kind>`） */
export const CELL_LABEL_KEYS: Partial<Record<CellKind, string>> = {
  tile: 'memory.cell.tile',
  hidden: 'memory.cell.hidden',
}

/** 注册表用：把 kind 映射到文案 key（壳层不硬编码玩法文案） */
export function cellLabelKey(kind: CellKind): string | undefined {
  return CELL_LABEL_KEYS[kind]
}

function isFaceUp(state: MemoryState, index: number): boolean {
  const snapshot = snapshotOf(state)
  return snapshot.matched.includes(index) || snapshot.faceUp.includes(index)
}

export function cellKindAt(state: MemoryState, index: number): CellKind {
  return isFaceUp(state, index) ? 'tile' : 'hidden'
}

export function cellGlyphAt(state: MemoryState, index: number): string {
  if (!isFaceUp(state, index)) return ''
  return glyphForPair(state.deck[index])
}

export function buildBoard(state: MemoryState): BoardView {
  const config = configFor(state.difficulty)
  const snapshot = snapshotOf(state)
  const faceUp = new Set(snapshot.faceUp)
  const matched = new Set(snapshot.matched)
  const pending = new Set(snapshot.pending)
  const cells: CellView[] = []
  for (let index = 0; index < cellCount(config); index++) {
    if (!faceUp.has(index) && !matched.has(index)) {
      // 盖着的牌：标记由壳层按用户选的风格画（暂停菜单可切）
      cells.push({ index, kind: 'hidden', glyph: '' })
      continue
    }
    const cell: CellView = {
      index,
      kind: 'tile',
      glyph: glyphForPair(state.deck[index]),
      textScale: TILE_TEXT_SCALE,
    }
    // 待盖回的两张加重描边：黑白屏上没有颜色可用，描边是唯一稳定的层次手段
    if (pending.has(index)) cell.selected = true
    cells.push(cell)
  }
  return { kind: 'grid', cols: config.cols, rows: config.rows, cells }
}

/**
 * 控制项：只有「撤销」。
 * 重开/菜单由壳层自己渲染（壳层认识这些固定 id），游戏不要重复声明。
 * 撤销一次翻牌尝试，因此只要有翻牌日志就可点（终局后也允许退回重看）。
 */
export function buildControls(state: MemoryState): ControlSpec[] {
  return [
    {
      id: 'undo',
      labelKey: 'shell.game.undo',
      role: 'action',
      enabled: state.flips.length > 0,
      emphasis: 'normal',
    },
  ]
}

export function buildStats(state: MemoryState): StatView[] {
  const snapshot = snapshotOf(state)
  const total = pairCount(configFor(state.difficulty))
  // 两项正好占满窄屏统计栏：进度与尝试次数（值在这里拼好，壳层不参与计算）
  return [
    { labelKey: 'memory.stat.pairs', value: `${snapshot.matchedPairs}/${total}` },
    { labelKey: 'memory.stat.attempts', value: String(snapshot.attempts) },
  ]
}

export function buildView(state: MemoryState): GameView {
  const snapshot = snapshotOf(state)
  const won = gameStatus(state) === 'won'
  return {
    board: buildBoard(state),
    stats: buildStats(state),
    result: won
      ? {
          titleKey: 'memory.won.title',
          details: [{ key: 'memory.result.attempts', params: { count: snapshot.attempts } }],
        }
      : null,
    // 待盖回时给出稳定文字提示：墨水屏上没有自动翻回，必须让玩家知道「再点一张扣着的牌」
    notice: snapshot.pending.length === 2 ? { textKey: 'memory.notice.cover' } : null,
  }
}
