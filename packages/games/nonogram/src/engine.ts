/**
 * 数织规则层：状态派生与动作执行（纯函数、零副作用、零时间引用）。
 *
 * 与其它玩法一致的地方：状态不可变、`reduce` 是纯函数、非法动作抛 `IllegalActionError`、
 * `encode`/`decode` 严格往返。
 * 数织特有的三点：
 * 1. **没有随机、也没有 AI** —— 题号就是"种子"，一道题开局之后不会再变；
 *    存档只存「题号 + 每格的标记 + 上次检查的结果」；
 * 2. 每格是**三态**：空 → 黑 → 叉 → 空（点一下换下一态，循环）；
 * 3. 判错**不是实时的**：玩家点「检查」时才数「有几行/几列与线索不符」，
 *    而且只给**数量**，绝不标出是哪几行、更不会揭示答案（见 `wrongLineCount`）。
 */
import { IllegalActionError, type GameStatus } from '@eink/core'
import {
  NONOGRAM_ID,
  cellCountOf,
  clueOf,
  colLine,
  colsOf,
  difficultyOrThrow,
  puzzleAt,
  puzzleIndexFor,
  puzzlesFor,
  rowLine,
  rowsOf,
  solutionBits,
  type DifficultyId,
  type PuzzleDef,
} from './levels.js'

/** 格子标记：空 / 黑 / 叉 */
export const MARK_EMPTY = 0
export const MARK_BLACK = 1
export const MARK_CROSS = 2

/**
 * 一格的三态。
 *
 * 写成 0 | 1 | 2 而不是字符串：标记要逐格进存档，一位一个字符最省
 * （10×10 也才 100 个字符，见 encodeState）。**注意 0 是合法值**，
 * 任何地方都要按 `=== undefined` 判断"有没有"，不能写 `if (mark)`。
 */
export type CellMark = 0 | 1 | 2

/** 三态的循环顺序（点一下换下一态）：空 → 黑 → 叉 → 空 */
export const MARK_CYCLE: readonly CellMark[] = [MARK_EMPTY, MARK_BLACK, MARK_CROSS]

export type NonogramAction =
  /** 点第 index 个格子：空 → 黑 → 叉 → 空 */
  | { type: 'cycle'; index: number }
  /** 清屏：把所有标记清空（回到开局那一张白纸） */
  | { type: 'clearMarks' }
  /** 检查：数出「有几行/几列与线索不符」，只报数量 */
  | { type: 'check' }
  /** 重开本局（同一道题、标记清空）。壳层在没有关卡列表时走「丢掉存档换新题」，两条路都要能走 */
  | { type: 'restart' }

export interface NonogramState {
  difficulty: DifficultyId
  /** 题号：该难度题库里的下标 —— 也就是"种子"（存档只存它，不存位图） */
  puzzleIndex: number
  /** 每格的标记（行优先，长度 = 列数 × 行数） */
  marks: readonly CellMark[]
  /**
   * 上一次「检查」数出来的**不符行列数**（行 + 列）。
   * null = 还没检查过，或检查之后又动过标记 —— 数字一旦过期就必须消失，
   * 否则玩家会对着一个不再成立的数量做判断。
   */
  wrongLines: number | null
  /** 涂黑 / 打叉的**次数**（壳层据此记步数与最佳成绩；清屏与检查不计步） */
  moves: number
}

function illegal(reason: string): IllegalActionError {
  return new IllegalActionError(NONOGRAM_ID, reason)
}

export function puzzleOf(state: NonogramState): PuzzleDef {
  return puzzleAt(state.difficulty, state.puzzleIndex)
}

export function totalCells(state: NonogramState): number {
  return cellCountOf(puzzleOf(state))
}

/** 下一态：空 → 黑 → 叉 → 空（点一下换一态，循环） */
export function nextMark(mark: CellMark): CellMark {
  if (mark === MARK_EMPTY) return MARK_BLACK
  if (mark === MARK_BLACK) return MARK_CROSS
  return MARK_EMPTY
}

export function blackCount(state: NonogramState): number {
  let count = 0
  for (const mark of state.marks) if (mark === MARK_BLACK) count++
  return count
}

export function hasMarks(state: NonogramState): boolean {
  return state.marks.some((mark) => mark !== MARK_EMPTY)
}

/** 玩家这一行涂出来的黑格（叉与空都算"非黑"） */
function playerRow(state: NonogramState, row: number): boolean[] {
  const width = colsOf(puzzleOf(state))
  const line: boolean[] = []
  for (let col = 0; col < width; col++) line.push(state.marks[row * width + col] === MARK_BLACK)
  return line
}

/** 玩家这一列涂出来的黑格 */
function playerCol(state: NonogramState, col: number): boolean[] {
  const puzzle = puzzleOf(state)
  const width = colsOf(puzzle)
  const line: boolean[] = []
  for (let row = 0; row < rowsOf(puzzle); row++) line.push(state.marks[row * width + col] === MARK_BLACK)
  return line
}

/** 玩家这一行**涂出来的线索**与题面给的线索是否一致（段长一一对应） */
export function rowMatches(state: NonogramState, row: number): boolean {
  return sameClue(clueOf(playerRow(state, row)), rowLine(puzzleOf(state), row))
}

export function colMatches(state: NonogramState, col: number): boolean {
  return sameClue(clueOf(playerCol(state, col)), colLine(puzzleOf(state), col))
}

/** 比的是**线索（段长序列）**，不是逐格位置 —— 见 wrongLineCount 的说明 */
function sameClue(player: readonly number[], answer: readonly boolean[]): boolean {
  const target = clueOf(answer)
  return player.length === target.length && player.every((value, index) => value === target[index])
}

export function wrongRowCount(state: NonogramState): number {
  let count = 0
  for (let row = 0; row < rowsOf(puzzleOf(state)); row++) if (!rowMatches(state, row)) count++
  return count
}

export function wrongColCount(state: NonogramState): number {
  let count = 0
  for (let col = 0; col < colsOf(puzzleOf(state)); col++) if (!colMatches(state, col)) count++
  return count
}

/**
 * 「检查」要报的数量：**行 + 列**里与线索不符的条数。
 *
 * 两件事必须说清楚：
 *
 * 1. **只报数量、不报位置**。报出"第 3 行不对"等于白送一条线索（玩家可以拿它反推出
 *    第 3 行的图该长什么样），那就不是检查而是提示了。数量足够让玩家知道"还没对"，
 *    又不泄露任何位置信息 —— 题面本来就写着每行的线索，玩家自己也能逐行核对。
 *
 * 2. **比的是线索（段长序列），不是与答案逐格比对**。
 *    逐格比对会泄露答案：某行"对了"意味着这一行的黑格位置与答案完全一致，
 *    而题面线索往往给不出这么强的结论（例如线索 [1] 在宽 3 的行里有 3 种摆法），
 *    等于逐行替玩家把位置定死。
 *    比对线索则只回答"我涂的这行符不符合题面写的线索"—— 玩家拿纸笔也能自己核，
 *    因此不泄露任何题面之外的信息。又因为每道题都保证唯一解（见 levels.countSolutions），
 *    「没有一行/一列不符」与「涂出了答案」是同一件事，检查结果不会与判胜打架。
 */
export function wrongLineCount(state: NonogramState): number {
  return wrongRowCount(state) + wrongColCount(state)
}

/** 黑格与答案逐格一致才算过关（叉与空一律算"非黑"） */
export function isSolved(state: NonogramState): boolean {
  const answer = solutionBits(puzzleOf(state))
  for (let index = 0; index < answer.length; index++) {
    if ((state.marks[index] === MARK_BLACK) !== answer[index]) return false
  }
  return true
}

export function gameStatus(state: NonogramState): GameStatus {
  return isSolved(state) ? 'won' : 'playing'
}

export function createState(seed: number, difficulty: DifficultyId): NonogramState {
  const puzzleIndex = puzzleIndexFor(seed, difficulty)
  const puzzle = puzzleAt(difficulty, puzzleIndex)
  return {
    difficulty,
    puzzleIndex,
    marks: new Array<CellMark>(cellCountOf(puzzle)).fill(MARK_EMPTY),
    wrongLines: null,
    moves: 0,
  }
}

function assertPlaying(state: NonogramState): void {
  if (gameStatus(state) !== 'playing') throw illegal('nonogram.illegal.finished')
}

function assertIndex(state: NonogramState, index: number): void {
  const total = totalCells(state)
  if (!Number.isInteger(index) || index < 0 || index >= total) {
    throw illegal(`nonogram.illegal.index:${String(index)}`)
  }
}

export function reduceNonogram(state: NonogramState, action: NonogramAction): NonogramState {
  switch (action?.type) {
    case 'cycle': {
      assertPlaying(state)
      assertIndex(state, action.index)
      const marks = state.marks.slice()
      marks[action.index] = nextMark(marks[action.index]!)
      return {
        ...state,
        marks,
        // 动过标记之后上一次的检查结果就过期了：宁可显示"未检查"，也不要显示一个错的数
        wrongLines: null,
        moves: state.moves + 1,
      }
    }
    case 'clearMarks': {
      assertPlaying(state)
      if (!hasMarks(state)) return state // 已经是白纸：无事发生，不算非法
      return {
        ...state,
        marks: new Array<CellMark>(state.marks.length).fill(MARK_EMPTY),
        wrongLines: null,
      }
    }
    case 'check': {
      assertPlaying(state)
      return { ...state, wrongLines: wrongLineCount(state) }
    }
    case 'restart': {
      // 同一道题重来（丢掉存档换新题是壳层的路径，不走这里）
      return {
        ...state,
        marks: new Array<CellMark>(state.marks.length).fill(MARK_EMPTY),
        wrongLines: null,
      }
    }
    default: {
      // 运行期拿到未知动作（旧存档 / 壳层的固定按钮）时明确报错，而不是静默无响应
      throw illegal(`nonogram.illegal.action:${String((action as { type?: unknown })?.type)}`)
    }
  }
}

export function legalActions(state: NonogramState): NonogramAction[] {
  // 重开任何时候都成立；数织不会输，只有"还没好"与"好了"两种状态
  const out: NonogramAction[] = [{ type: 'restart' }]
  if (gameStatus(state) !== 'playing') return out
  out.push({ type: 'check' })
  if (hasMarks(state)) out.push({ type: 'clearMarks' })
  for (let index = 0; index < totalCells(state); index++) out.push({ type: 'cycle', index })
  return out
}

/** 「点了第 index 个格子」→ 一个动作；越界或已结束返回 null（壳层据此不派发） */
export function selectAction(state: NonogramState, index: number): NonogramAction | null {
  if (gameStatus(state) !== 'playing') return null
  const total = totalCells(state)
  if (!Number.isInteger(index) || index < 0 || index >= total) return null
  return { type: 'cycle', index }
}

/* ------------------------------------------------------------------ 存档 */

export function encodeState(state: NonogramState): unknown {
  return {
    difficulty: state.difficulty,
    puzzleIndex: state.puzzleIndex,
    // 一格一个字符（'0' 空 / '1' 黑 / '2' 叉）：10×10 也才 100 字节，且人眼能直接读
    marks: state.marks.map((mark) => String(mark)).join(''),
    wrongLines: state.wrongLines,
    moves: state.moves,
  }
}

export function decodeState(raw: unknown): NonogramState {
  if (!raw || typeof raw !== 'object') throw illegal('nonogram.illegal.state:root')
  const value = raw as Partial<{
    difficulty: unknown
    puzzleIndex: unknown
    marks: unknown
    wrongLines: unknown
    moves: unknown
  }>
  const difficulty = difficultyOrThrow(String(value.difficulty ?? ''))
  const puzzleIndex = value.puzzleIndex
  const pack = puzzlesFor(difficulty)
  if (!Number.isInteger(puzzleIndex) || (puzzleIndex as number) < 0 || (puzzleIndex as number) >= pack.length) {
    // 题号越界 = 坏存档：位图是代码常量，题号必须落在题库范围内（绝不"回退到第 0 题"，
    // 那样玩家会莫名其妙地换一道题，还看不出存档已经坏了）
    throw illegal(`nonogram.illegal.state:puzzle-index:${String(puzzleIndex)}`)
  }
  const puzzle = puzzleAt(difficulty, puzzleIndex as number)
  const total = cellCountOf(puzzle)
  const marksText = value.marks
  if (typeof marksText !== 'string' || marksText.length !== total) {
    throw illegal('nonogram.illegal.state:marks')
  }
  const marks: CellMark[] = []
  for (const char of marksText) {
    if (char !== '0' && char !== '1' && char !== '2') {
      throw illegal('nonogram.illegal.state:marks-char')
    }
    marks.push(Number(char) as CellMark)
  }
  const moves = value.moves === undefined ? 0 : value.moves
  if (!Number.isInteger(moves) || (moves as number) < 0) {
    throw illegal('nonogram.illegal.state:moves')
  }
  const rawWrong = value.wrongLines
  const wrongLines = rawWrong === null || rawWrong === undefined ? null : rawWrong
  if (
    wrongLines !== null &&
    (!Number.isInteger(wrongLines) ||
      (wrongLines as number) < 0 ||
      (wrongLines as number) > rowsOf(puzzle) + colsOf(puzzle))
  ) {
    throw illegal('nonogram.illegal.state:wrong-lines')
  }
  const state: NonogramState = {
    difficulty,
    puzzleIndex: puzzleIndex as number,
    marks,
    wrongLines: wrongLines as number | null,
    moves: moves as number,
  }
  /*
   * 检查结果必须与当前标记对得上。
   * 这一条不是吹毛求疵：wrongLines 与 marks 是同一份存档里的两个字段，
   * 被改过的存档若带着"不符 0 行"就能骗过界面（玩家看到"全对"却过不了关）。
   */
  if (state.wrongLines !== null && state.wrongLines !== wrongLineCount(state)) {
    throw illegal('nonogram.illegal.state:wrong-lines-stale')
  }
  return state
}
