/**
 * 测试专用工具：由落子日志造自洽局面、独立的连线复核、把两拍应手走完。
 *
 * 注意两点：
 * 1. `stateOf` 与生产代码同一口径 —— 只给日志，盘面由日志推出（引擎自己重放），
 *    因此它造出的状态与 `reduce` 真实产生的状态同构，`decode` 会接受；
 * 2. `winner` / `lineIndexes` 是**独立实现**的连线判定（按行列对角逐格数，不用生产代码的 LINES 表），
 *    用来复核生产代码的胜负结论，避免「用被测实现验证被测实现」。
 */
import {
  CELLS,
  EMPTY,
  FIRST,
  SECOND,
  SIZE,
  createState,
  encodeState,
  isFull,
  legalActions,
  outcomeOf,
  reduceState,
  turnOf,
  type Mark,
  type OpponentLevel,
  type Side,
  type TictactoeState,
} from '../src/index.js'

/** 行列 → 索引（与生产代码的 indexOf 同义，测试里单独写一份更直观） */
export function at(row: number, col: number): number {
  return row * SIZE + col
}

/** 由落子日志造状态：只给日志与难度，其余字段用默认值 */
export function stateOf(log: readonly number[], extra: Partial<TictactoeState> = {}): TictactoeState {
  return {
    difficulty: 'hotseat',
    seed: 7,
    log,
    opponentPick: null,
    hint: null,
    ...extra,
  }
}

/** 盘面转 ASCII，断言失败时的可读输出 */
export function ascii(board: readonly Mark[]): string[] {
  const glyphs = ['.', 'X', 'O']
  const rows: string[] = []
  for (let row = 0; row < SIZE; row++) {
    rows.push(
      board
        .slice(row * SIZE, row * SIZE + SIZE)
        .map((mark) => glyphs[mark]!)
        .join(''),
    )
  }
  return rows
}

const CHARS: Record<string, Mark> = { '.': EMPTY, X: FIRST, O: SECOND }

/** 3 行 × 3 列摆盘：'.' 空、'X' 先手、'O' 后手（AI 用例里比日志直观得多） */
export function boardFrom(rows: readonly string[]): Mark[] {
  if (rows.length !== SIZE) throw new Error(`expected ${SIZE} rows, got ${rows.length}`)
  const board: Mark[] = []
  for (const row of rows) {
    if (row.length !== SIZE) throw new Error(`expected ${SIZE} columns, got ${row.length}`)
    for (const char of row) {
      const mark = CHARS[char]
      if (mark === undefined) throw new Error(`unknown cell char ${char}`)
      board.push(mark)
    }
  }
  return board
}

/** 独立实现的胜负判定：按行、列、两条对角逐条数 */
export function winner(board: readonly Mark[]): Side | null {
  for (let row = 0; row < SIZE; row++) {
    const head = board[at(row, 0)]!
    if (head !== EMPTY && board[at(row, 1)] === head && board[at(row, 2)] === head) return head
  }
  for (let col = 0; col < SIZE; col++) {
    const head = board[at(0, col)]!
    if (head !== EMPTY && board[at(1, col)] === head && board[at(2, col)] === head) return head
  }
  const center = board[at(1, 1)]!
  if (center !== EMPTY && board[at(0, 0)] === center && board[at(2, 2)] === center) return center
  if (center !== EMPTY && board[at(0, 2)] === center && board[at(2, 0)] === center) return center
  return null
}

/** 独立实现：成线的那三格（升序）；没人成线返回空数组 */
export function lineIndexes(board: readonly Mark[]): number[] {
  const side = winner(board)
  if (side === null) return []
  const candidates: number[][] = []
  for (let row = 0; row < SIZE; row++) candidates.push([at(row, 0), at(row, 1), at(row, 2)])
  for (let col = 0; col < SIZE; col++) candidates.push([at(0, col), at(1, col), at(2, col)])
  candidates.push([at(0, 0), at(1, 1), at(2, 2)], [at(0, 2), at(1, 1), at(2, 0)])
  for (const line of candidates) {
    if (line.every((index) => board[index] === side)) return line.sort((a, b) => a - b)
  }
  return []
}

/** 空格（升序） */
export function emptyCellsOf(board: readonly Mark[]): number[] {
  const out: number[] = []
  for (let index = 0; index < CELLS; index++) {
    if (board[index] === EMPTY) out.push(index)
  }
  return out
}

/**
 * 把「等对手应手」的中间态推进到落定。
 *
 * 应手是**两拍**（先亮出目标格、500ms 后落子），测试里不能只发一次 tick ——
 * 循环发到 legal() 里没有 tick 为止，将来加拍数也不用改测试。
 */
export function settle(state: TictactoeState): TictactoeState {
  let current = state
  for (let guard = 0; guard < 8; guard++) {
    const tick = legalActions(current).find((action) => action.type === 'tick')
    if (!tick) break
    current = reduceState(current, tick)
  }
  return current
}

/**
 * 与电脑走完一局：轮到先手时由 `chooseX` 决定落点，轮到后手时把两拍应手走完。
 * 返回终局状态（九格上限，走满一定结束）。
 */
export function playVsComputer(
  difficulty: OpponentLevel,
  seed: number,
  chooseX: (state: TictactoeState) => number,
): TictactoeState {
  let state = createState(seed, difficulty)
  for (let guard = 0; guard <= CELLS && outcomeOf(state) === null; guard++) {
    if (turnOf(state) === FIRST) {
      state = reduceState(state, { type: 'place', index: chooseX(state) })
    } else {
      state = settle(state)
    }
  }
  return state
}

/** 存档指纹：用来比较两个状态是否完全一致 */
export function fingerprint(state: TictactoeState): string {
  return JSON.stringify(encodeState(state))
}

export { CELLS, EMPTY, FIRST, SIZE, createState, encodeState, isFull, legalActions, outcomeOf, reduceState, turnOf }
export type { Mark, OpponentLevel, Side, TictactoeState }
