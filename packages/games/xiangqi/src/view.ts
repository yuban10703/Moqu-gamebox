/**
 * 展示模型：把局面翻译成「与呈现技术无关」的棋盘与控制项描述。
 *
 * 1-bit 墨水屏约束（全部复用壳层已有的 kind / 字段，不发明新字段）：
 * - 棋子用**汉字字形**：红方「帅仕相马车炮兵」、黑方「将士象马车炮卒」——
 *   两方字形一一对应且互不相同，靠字形就能分辨，不依赖灰阶（中英界面都用汉字，用户已拍板）；
 * - 最后一手：**不做放大**（1-bit 下放大字号会把笔画密的字糊掉），改成两个位置痕迹 ——
 *   起点格 `lastFrom: true`（壳层点一个小圆点）+ 终点格 `lastTo: true`（壳层加一圈内描边），
 *   都不改字号、不反白，棋子本身保持与其它棋子同样的观感；
 * - 选中自己的棋子：该格 `selected: true`（壳层整格反白）；
 * - 合法落点：空格用 `kind: 'goal'`（壳层画圆环，1-bit 下最清晰）；
 *   可以吃子的落点保留棋子字形并标 `selected: true`（反白＝目标），避免把棋子本身藏掉；
 * - **河界**用 `groups: { cols: 9, rows: 5 }` 表达：壳层只在 5 行一组的组边界画更粗的分隔线，
 *   于是行 4 与行 5 之间多出一条粗线 —— 正好是楚河汉界；列方向按 9 列分组，因此不会多出竖线。
 * - **九宫**（斜线、「米」字）棋盘契约里没有对应字段，不硬造：九宫的三列三行与其它格子画得一样，
 *   规则层照常限制仕/帅只在九宫内走，界面不额外标注。
 */
import type { BoardView, CellKind, CellView, ControlSpec, GameView, StatView } from '@eink/core'
import {
  BLACK,
  CELLS,
  COLS,
  EMPTY,
  RED,
  ROWS,
  countPieces,
  legalMoves,
  moveFrom,
  moveTo,
  sideOf,
  typeOf,
  type Side,
} from './board.js'
import { gameStatus, inCheck, isDrawnByRepetition, type XiangqiState } from './rules.js'

/** 红方七子的字形（下标 = 兵种 - 1）：帅仕相马车炮兵 */
const RED_GLYPHS: readonly string[] = [
  '帅', // i18n-exempt
  '仕', // i18n-exempt
  '相', // i18n-exempt
  '马', // i18n-exempt
  '车', // i18n-exempt
  '炮', // i18n-exempt
  '兵', // i18n-exempt
]

/**
 * 黑方七子的字形：将士象马车炮卒（简体，与红方对称）。
 *
 * 两方的「马/车/炮」是同一个字 —— 这没问题，**靠棋子的底色区分**：
 * 红子画成白底黑字的圆片（双边框），黑子画成黑底白字的圆片（粗边框），
 * 见 `disc` 字段与壳层的 `[data-disc]` 样式。帅/将、仕/士、相/象、兵/卒
 * 本来字形就不同，等于多一重区分。
 *
 * 曾经试过给黑方换繁体（將士象馬車砲卒）来避免重字，用户否掉了这条路：
 * 明确要求"马/车/炮 通过棋子底色区分"。
 */
const BLACK_GLYPHS: readonly string[] = [
  '将', // i18n-exempt
  '士', // i18n-exempt
  '象', // i18n-exempt
  '马', // i18n-exempt
  '车', // i18n-exempt
  '炮', // i18n-exempt
  '卒', // i18n-exempt
]

/** 棋子字形（空格返回空串）。中英界面都显示同样的汉字，因此标 i18n-exempt */
export function pieceGlyph(piece: number): string {
  if (piece === EMPTY) return ''
  const table = sideOf(piece) === RED ? RED_GLYPHS : BLACK_GLYPHS
  return table[typeOf(piece) - 1] ?? ''
}

/** 壳层无障碍标签用的 key（apps/web 的约定：`<namespace>.cell.<kind>`） */
export const CELL_LABEL_KEYS: Partial<Record<CellKind, string>> = {
  tile: 'xiangqi.cell.piece',
  goal: 'xiangqi.cell.target',
  empty: 'xiangqi.cell.empty',
}

/** 注册表用：把 kind 映射到文案 key（壳层不硬编码玩法文案） */
export function cellLabelKey(kind: CellKind): string | undefined {
  return CELL_LABEL_KEYS[kind]
}

/*
 * 曾经这里有个 `LAST_MOVE_SCALE = 1.1`（照五子棋的做法把最后一手放大一档）。
 * 用户否掉了放大：1-bit 屏上字号一变，笔画密的字（象/馬）边缘就糊，
 * 反而看不出走的是哪一手。现在改用位置痕迹（起点圆点 + 终点描边），
 * 由壳层的 `lastFrom` / `lastTo` 渲染，规则层只报告"哪一格是起点/终点"。
 */

/** 河界：按 5 行一组分组 → 壳层只在行 4/5 之间画一条更粗的线 */
export const RIVER_GROUP_ROWS = 5

/** 选中棋子的所有合法落点（升序）；没有选中 / 不在对局中时为空 */
export function selectedTargets(state: XiangqiState): number[] {
  if (state.selected === null || gameStatus(state) !== 'playing') return []
  const out: number[] = []
  for (const move of legalMoves(state.board, RED)) {
    if (moveFrom(move) === state.selected) out.push(moveTo(move))
  }
  return out
}

export function cellKindAt(state: XiangqiState, index: number): CellKind {
  // 最后一手不改变 kind：走完的子仍是普通棋子（tile），"刚走过"由 lastFrom/lastTo 表达
  if ((state.board[index] as number) !== EMPTY) return 'tile'
  return selectedTargets(state).includes(index) ? 'goal' : 'empty'
}

export function cellGlyphAt(state: XiangqiState, index: number): string {
  return pieceGlyph(state.board[index] as number)
}

export function buildBoard(state: XiangqiState): BoardView {
  const targets = new Set(selectedTargets(state))
  /*
   * 双方**各自**的最后一手：都在最后一回合里（红先走、黑应手，黑方也可能还没应）。
   * 直接从 history 推导，不改状态：撤销后 history 变短，标记自动跟着回退。
   * 键是格子索引，值是方号（0 红 / 1 黑）—— 1-bit 屏上靠形状区分双方。
   */
  const fromSide = new Map<number, 0 | 1>()
  const toSide = new Map<number, 0 | 1>()
  const lastTurn = state.history.length > 0 ? state.history[state.history.length - 1] : null
  if (lastTurn) {
    fromSide.set(moveFrom(lastTurn.red), 0)
    toSide.set(moveTo(lastTurn.red), 0)
    if (lastTurn.black !== null) {
      // 黑方后走：同格冲突时黑方（更近的一手）覆盖红方，这是"更晚发生"的正确语义
      fromSide.set(moveFrom(lastTurn.black), 1)
      toSide.set(moveTo(lastTurn.black), 1)
    }
  }
  const cells: CellView[] = []
  for (let index = 0; index < CELLS; index++) {
    const piece = state.board[index] as number
    const from = fromSide.get(index)
    const to = toSide.get(index)
    if (piece === EMPTY) {
      // 空格：合法落点画圆环（goal），其余是空格
      const cell: CellView = { index, kind: targets.has(index) ? 'goal' : 'empty', glyph: '' }
      // 刚走掉的那一格留一个圆点：棋子不在了，只能靠位置痕迹说明"从哪来"
      if (from !== undefined) cell.lastFrom = from
      if (to !== undefined) cell.lastTo = to
      cells.push(cell)
      continue
    }
    const cell: CellView = {
      index,
      kind: 'tile',
      glyph: pieceGlyph(piece),
      // 圆片底色 = 区分红黑的唯一手段（两方的马/车/炮是同一个字）：
      // 红子白底黑字（双边框），黑子黑底白字（粗边框）
      disc: sideOf(piece) === RED ? 'light' : 'dark',
    }
    // 终点只加一圈描边，**不放大字号**；起点圆点也可能落在有子的格上
    // （红子从这里走掉、黑子随后落到这里）
    if (from !== undefined) cell.lastFrom = from
    if (to !== undefined) cell.lastTo = to
    // 选中的子 + 可以吃掉的敌子都标 selected（壳层整格反白）：前者是「我选的」，
    // 后者是「这里能吃」——吃子目标若换成 goal 就会把棋子字形藏掉，反而看不出要吃什么
    if (index === state.selected || targets.has(index)) cell.selected = true
    // AI 两拍式应手的第一拍：把它选中的那枚黑子也标成选中态（玩家看得到它在挑子）
    if (state.opponentPick !== null && moveFrom(state.opponentPick) === index) cell.selected = true
    cells.push(cell)
  }
  return {
    kind: 'grid',
    cols: COLS,
    rows: ROWS,
    cells,
    // 河界：5 行一组 → 行 4/5 之间一条粗线；列方向按整宽分组，不会多出竖线
    groups: { cols: COLS, rows: RIVER_GROUP_ROWS },
  }
}

/**
 * 控制项：只有「撤销」。
 * 重开/菜单由壳层自己渲染（壳层认识这些固定 id），游戏不要重复声明。
 * 终局后仍允许撤销（可以退回关键一手重下），所以只按历史是否为空来禁用。
 */
export function buildControls(state: XiangqiState): ControlSpec[] {
  return [
    {
      id: 'undo',
      labelKey: 'shell.game.undo',
      role: 'action',
      enabled: state.history.length > 0,
      emphasis: 'normal',
    },
  ]
}

export function buildStats(state: XiangqiState): StatView[] {
  // 三项正好占满窄屏统计栏：双方子力与玩家的步数（黑方应手不计入步数）
  return [
    { labelKey: 'xiangqi.stat.red', value: String(countPieces(state.board, RED)) },
    { labelKey: 'xiangqi.stat.black', value: String(countPieces(state.board, BLACK)) },
    { labelKey: 'xiangqi.stat.moves', value: String(state.moves) },
  ]
}

/** 真实结果标题 key：`status()` 把和棋并进 won，结果页文案要如实说（见 rules.ts 的取舍说明） */
export function resultTitleKey(state: XiangqiState): string {
  if (isDrawnByRepetition(state)) return 'xiangqi.draw.title'
  return gameStatus(state) === 'lost' ? 'xiangqi.lost.title' : 'xiangqi.won.title'
}

/** 每种棋子的初始数量（下标 = 兵种 1..7：帅/仕/相/马/车/炮/兵） */
const INITIAL_COUNTS: readonly number[] = [0, 1, 2, 2, 2, 2, 2, 5]

/**
 * 某一方**被吃掉**的棋子字形（按兵种顺序拼成一行，顺序稳定）。
 *
 * 用"初始数量 - 盘上数量"推出来，不读历史：这样它天然跟着撤销/重开一起回退，
 * 也不会与 decode 的重放校验打架。
 */
export function capturedGlyphs(state: XiangqiState, side: Side): string {
  let out = ''
  const glyphs = side === RED ? RED_GLYPHS : BLACK_GLYPHS
  for (let type = 1; type <= 7; type++) {
    let alive = 0
    for (let index = 0; index < CELLS; index++) {
      const piece = state.board[index] as number
      if (piece !== EMPTY && sideOf(piece) === side && typeOf(piece) === type) alive++
    }
    const gone = (INITIAL_COUNTS[type] as number) - alive
    for (let i = 0; i < gone; i++) out += glyphs[type - 1] as string
  }
  return out
}

export function buildView(state: XiangqiState): GameView {
  const status = gameStatus(state)
  const details: Array<{ key: string; params?: Record<string, string | number> }> = []
  if (status !== 'playing') {
    // 带 params 的明细由壳层走 plural()，因此这个 key 必须提供复数形式
    details.push({ key: 'xiangqi.result.moves', params: { count: state.moves } })
    if (isDrawnByRepetition(state)) {
      details.push({ key: 'xiangqi.result.repetition' })
    } else {
      // 将死（正被将军）与困毙（不被将军但无子可动）都要如实说明：象棋里两者都判负
      details.push({
        key: inCheck(state, state.sideToMove)
          ? 'xiangqi.result.checkmate'
          : 'xiangqi.result.stalemate',
      })
    }
  }
  return {
    board: buildBoard(state),
    stats: buildStats(state),
    // 吃子盘：红方在下，所以红方的战果（黑子）放下方、黑方的战果（红子）放上方。
    // 空串也照给：壳层为这两行常驻固定高度，第一次吃子时棋盘不会突然缩一下。
    captured: { top: capturedGlyphs(state, RED), bottom: capturedGlyphs(state, BLACK) },
    result: status === 'playing' ? null : { titleKey: resultTitleKey(state), details },
    // 被将军时给一句稳定文字提示（不用动画）；对局结束后不再提示
    notice:
      status === 'playing' && state.sideToMove === RED && inCheck(state, RED)
        ? { textKey: 'xiangqi.notice.check' }
        : null,
  }
}
