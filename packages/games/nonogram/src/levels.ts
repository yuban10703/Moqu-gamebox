/**
 * 数织（Nonogram）题库：**手写答案位图，线索由程序推导**。
 *
 * 为什么手写位图而不是手写线索：
 * 线索写错一处，题目就自相矛盾 —— 玩家按线索严格推出来的图与答案对不上，永远赢不了；
 * 而位图是"照着画的图"，人眼一看就知道对不对。线索是位图的**函数**，写成常量只会多出
 * 一份需要人工同步的数据，所以一律由 `clueOf` 现推（位图与线索一致由 test/levels.test.ts 守）。
 *
 * 题目不含任何随机：数织是纯推理玩法，**题号就是"种子"** —— `create(seed, difficulty)`
 * 用 seed 在本题库里取一道（见 index.ts），同一 seed 双端一定开出同一道题。
 * 因此源码里不出现 Math.random / Date.now（tools/scripts/check-games.mjs 会拦）。
 *
 * 难度与尺寸：入门 5×5（线索少、图能一眼认出来）、熟练 10×10（完整规则）、
 * 挑战 10×10（同样的尺寸，但线段更碎、对称性更低，要靠推理而不是"看图猜"）。
 */
import { IllegalActionError } from '@eink/core'

export const NONOGRAM_ID = 'nonogram'

export const DIFFICULTY_IDS = ['starter', 'skilled', 'challenging'] as const
export type DifficultyId = (typeof DIFFICULTY_IDS)[number]

const DIFFICULTY_SET: ReadonlySet<string> = new Set(DIFFICULTY_IDS)

export function isDifficultyId(value: unknown): value is DifficultyId {
  return typeof value === 'string' && DIFFICULTY_SET.has(value)
}

/** 难度不认就明确抛错（照 minesweeper/sudoku 的 difficultyOrThrow） */
export function difficultyOrThrow(value: string): DifficultyId {
  if (!isDifficultyId(value)) {
    throw new IllegalActionError(NONOGRAM_ID, `unknown difficulty ${value}`)
  }
  return value
}

/** 难度名的文案 key（详情页的难度区直接用） */
export function difficultyLabelKey(difficulty: DifficultyId): string {
  return `${NONOGRAM_ID}.difficulty.${difficulty}`
}

/**
 * 一道题：`#` 是黑格、`.` 是白格，一行一个字符串。
 *
 * 用字符画而不是位数组：题面是**手工画的图**，字符画能直接看出画的是什么，
 * 改一格也只需要动一个字符（位数组改错了根本看不出来）。
 */
export interface PuzzleDef {
  /** 题号：难度内唯一，也是内容 id（`encode` 只存它，见 engine.ts） */
  readonly id: string
  readonly difficulty: DifficultyId
  /** 答案位图：行数 = 棋盘行数，每行字符串长度 = 棋盘列数 */
  readonly solution: readonly string[]
}

/** 入门 5×5：线段长、对称，第一眼就能上手 */
const STARTER: readonly PuzzleDef[] = [
  {
    id: 'starter-1',
    difficulty: 'starter',
    solution: ['..#..', '..#..', '#####', '..#..', '..#..'],
  },
  {
    id: 'starter-2',
    difficulty: 'starter',
    solution: ['.#.#.', '#####', '#####', '.###.', '..#..'],
  },
  {
    id: 'starter-3',
    difficulty: 'starter',
    solution: ['..#..', '.###.', '#####', '##.##', '##.##'],
  },
  {
    id: 'starter-4',
    difficulty: 'starter',
    solution: ['..#..', '.###.', '#####', '..#..', '..#..'],
  },
  {
    id: 'starter-5',
    difficulty: 'starter',
    solution: ['#####', '.###.', '..#..', '.###.', '#####'],
  },
  {
    id: 'starter-6',
    difficulty: 'starter',
    solution: ['#...#', '.###.', '#.#.#', '.###.', '#...#'],
  },
]

/** 熟练 10×10：完整规则的常规题 */
const SKILLED: readonly PuzzleDef[] = [
  {
    id: 'skilled-1',
    difficulty: 'skilled',
    solution: [
      '....##....',
      '...####...',
      '..######..',
      '.########.',
      '##########',
      '#........#',
      '#..####..#',
      '#..#..#..#',
      '#..####..#',
      '#........#',
    ],
  },
  {
    id: 'skilled-2',
    difficulty: 'skilled',
    /*
     * 蘑菇：菌盖是实心的（原来的"笑脸"是空心轮廓 —— 轮廓题的线索太松，
     * 边角上有第二种摆法，唯一性测试当场把它拦下来了，见 test/levels.test.ts）。
     */
    solution: [
      '..######..',
      '.########.',
      '##########',
      '##########',
      '..######..',
      '...##.....',
      '...##.....',
      '...##.....',
      '..####....',
      '..####....',
    ],
  },
  {
    id: 'skilled-3',
    difficulty: 'skilled',
    solution: [
      '....##....',
      '...####...',
      '..######..',
      '.########.',
      '..######..',
      '...####...',
      '....##....',
      '....##....',
      '....##....',
      '..######..',
    ],
  },
  {
    id: 'skilled-4',
    difficulty: 'skilled',
    solution: [
      '.##....##.',
      '####..####',
      '##########',
      '##########',
      '##########',
      '.########.',
      '..######..',
      '...####...',
      '....##....',
      '....##....',
    ],
  },
  {
    id: 'skilled-5',
    difficulty: 'skilled',
    solution: [
      '....##....',
      '....##....',
      '....##....',
      '..######..',
      '##########',
      '##########',
      '..######..',
      '....##....',
      '....##....',
      '....##....',
    ],
  },
  {
    id: 'skilled-6',
    difficulty: 'skilled',
    solution: [
      '##########',
      '.########.',
      '..######..',
      '...####...',
      '....##....',
      '....##....',
      '...####...',
      '..######..',
      '.########.',
      '##########',
    ],
  },
]

/** 挑战 10×10：同样的尺寸，但要靠推理（线段碎、空白多、对称性低） */
const CHALLENGING: readonly PuzzleDef[] = [
  {
    id: 'challenging-1',
    difficulty: 'challenging',
    solution: [
      '..####....',
      '.##..##...',
      '.#....#...',
      '.#....#...',
      '..####....',
      '...##.....',
      '...##.....',
      '...####...',
      '...##.....',
      '...##.....',
    ],
  },
  {
    id: 'challenging-2',
    difficulty: 'challenging',
    solution: [
      '....##....',
      '...####...',
      '...####...',
      '...####...',
      '...####...',
      '..######..',
      '.########.',
      '....##....',
      '....##....',
      '...####...',
    ],
  },
  {
    id: 'challenging-3',
    difficulty: 'challenging',
    solution: [
      '....#.....',
      '....##....',
      '....###...',
      '....####..',
      '....#####.',
      '....######',
      '....#.....',
      '##########',
      '.########.',
      '..######..',
    ],
  },
  {
    id: 'challenging-4',
    difficulty: 'challenging',
    solution: [
      '#.##..##.#',
      '#.##..##.#',
      '##########',
      '#........#',
      '#..####..#',
      '#..#..#..#',
      '#..#..#..#',
      '#..####..#',
      '#........#',
      '##########',
    ],
  },
]

export const PUZZLES_BY_DIFFICULTY: Readonly<Record<DifficultyId, readonly PuzzleDef[]>> = {
  starter: STARTER,
  skilled: SKILLED,
  challenging: CHALLENGING,
}

/** 全部题目（按难度顺序），测试与内容自检用 */
export const PUZZLES: readonly PuzzleDef[] = [...STARTER, ...SKILLED, ...CHALLENGING]

export function puzzlesFor(difficulty: DifficultyId): readonly PuzzleDef[] {
  return PUZZLES_BY_DIFFICULTY[difficulty]
}

export function puzzleById(id: string): PuzzleDef | undefined {
  return PUZZLES.find((puzzle) => puzzle.id === id)
}

/**
 * 按**题号**取题；越界明确抛错。
 *
 * 存档里存的是题号而不是位图：位图是代码常量，存进存档只会让存档变胖、
 * 还能被改出"答案与线索不符"的坏档（decode 只需校验题号在范围内，见 engine.ts）。
 */
export function puzzleAt(difficulty: DifficultyId, index: number): PuzzleDef {
  const pack = puzzlesFor(difficulty)
  if (!Number.isInteger(index) || index < 0 || index >= pack.length) {
    throw new IllegalActionError(NONOGRAM_ID, `puzzle index out of range: ${String(index)}`)
  }
  return pack[index]!
}

/**
 * 题号 ← 种子。
 *
 * 数织没有随机性，所以"第几题"完全由 seed 决定（同一 seed 双端同题）。
 * 取模前先归一化：seed 可能是负数 / 小数 / NaN（壳层的种子是 uint32，但规则层不该假设）。
 */
export function puzzleIndexFor(seed: number, difficulty: DifficultyId): number {
  const pack = puzzlesFor(difficulty)
  const normalized = Number.isFinite(seed) ? Math.trunc(seed) : 0
  return ((normalized % pack.length) + pack.length) % pack.length
}

export function colsOf(puzzle: PuzzleDef): number {
  return puzzle.solution[0]?.length ?? 0
}

export function rowsOf(puzzle: PuzzleDef): number {
  return puzzle.solution.length
}

export function cellCountOf(puzzle: PuzzleDef): number {
  return colsOf(puzzle) * rowsOf(puzzle)
}

/** 答案位图拍平成一维（行优先），与棋盘格索引同一套顺序 */
export function solutionBits(puzzle: PuzzleDef): boolean[] {
  const bits: boolean[] = []
  for (const row of puzzle.solution) {
    for (const char of row) bits.push(char === '#')
  }
  return bits
}

/** 答案里一共有多少黑格（统计栏用；这个数玩家自己按线索也能算出来） */
export function blackTotal(puzzle: PuzzleDef): number {
  let total = 0
  for (const row of puzzle.solution) {
    for (const char of row) if (char === '#') total++
  }
  return total
}

/**
 * 一行（或一列）的线索：连续黑格的段长，从左（上）到右（下）。
 * 全白 → 空数组。
 */
export function clueOf(line: readonly boolean[]): number[] {
  const out: number[] = []
  let run = 0
  for (const filled of line) {
    if (filled) {
      run++
      continue
    }
    if (run > 0) {
      out.push(run)
      run = 0
    }
  }
  if (run > 0) out.push(run)
  return out
}

/**
 * 线索的显示文本。
 *
 * 全白行写成 `['0']` 而不是空数组：界面上"什么都没有"看不出这一行**必须是全白**
 * （玩家会以为线索没显示出来）。0 是数织的通行写法，也提示"这一行不用涂"。
 */
export function clueText(clue: readonly number[]): string[] {
  return clue.length === 0 ? ['0'] : clue.map((value) => String(value))
}

export function rowLine(puzzle: PuzzleDef, row: number): boolean[] {
  const text = puzzle.solution[row]
  if (text === undefined) {
    throw new IllegalActionError(NONOGRAM_ID, `row out of range: ${String(row)}`)
  }
  return [...text].map((char) => char === '#')
}

export function colLine(puzzle: PuzzleDef, col: number): boolean[] {
  const width = colsOf(puzzle)
  if (!Number.isInteger(col) || col < 0 || col >= width) {
    throw new IllegalActionError(NONOGRAM_ID, `col out of range: ${String(col)}`)
  }
  return puzzle.solution.map((row) => row[col] === '#')
}

export function rowCluesOf(puzzle: PuzzleDef): number[][] {
  return puzzle.solution.map((_, row) => clueOf(rowLine(puzzle, row)))
}

export function colCluesOf(puzzle: PuzzleDef): number[][] {
  const width = colsOf(puzzle)
  const out: number[][] = []
  for (let col = 0; col < width; col++) out.push(clueOf(colLine(puzzle, col)))
  return out
}

/** 一组线索里最长的一条（壳层据此给线索带留多厚，见 view.ts 的 --clue-*-count） */
export function maxClueLength(clues: readonly (readonly number[])[]): number {
  let max = 0
  for (const clue of clues) max = Math.max(max, clue.length)
  return max
}

/* ------------------------------------------------------------------ 内容自检 */

/**
 * 数出这道题有几种解（数到 `limit` 种就停）。
 *
 * 为什么内容层需要它：**手写位图可能不唯一** —— 线索推出来的图不止一张时，
 * 玩家严格按线索推理得到的"正确答案"可能不是我们写的那张，于是明明推对了却判不过关。
 * 因此每道题都要验证「恰好 1 解」（见 test/levels.test.ts）。
 *
 * 只在测试里用；规则层不调用它（数织的判胜是"黑格与答案一致"，不解题）。
 * 算法是逐行枚举 + 列前缀剪枝：10×10 的题量下是毫秒级。
 */
export function countSolutions(puzzle: PuzzleDef, limit = 2): number {
  const width = colsOf(puzzle)
  const height = rowsOf(puzzle)
  const colClues = colCluesOf(puzzle)
  const options = rowCluesOf(puzzle).map((clue) => placementsFor(clue, width))
  let found = 0

  /** row 行之前，每列已经完成的段数（done）与正在进行的段长（run） */
  const walk = (row: number, done: readonly number[], run: readonly number[]): void => {
    if (found >= limit) return
    if (row === height) {
      for (let col = 0; col < width; col++) {
        if (!columnFinished(colClues[col]!, done[col]!, run[col]!)) return
      }
      found++
      return
    }
    for (const filled of options[row]!) {
      const nextDone = done.slice()
      const nextRun = run.slice()
      if (!advanceColumns(colClues, filled, nextDone, nextRun, row, height)) continue
      walk(row + 1, nextDone, nextRun)
      if (found >= limit) return
    }
  }

  walk(0, new Array<number>(width).fill(0), new Array<number>(width).fill(0))
  return found
}

/** 一行的线索在 width 列里的所有合法摆法（每种摆法给出该行被涂黑的列下标） */
function placementsFor(clue: readonly number[], width: number): number[][] {
  const out: number[][] = []
  const cells: number[] = []
  const place = (index: number, start: number): void => {
    if (index === clue.length) {
      out.push(cells.slice())
      return
    }
    const size = clue[index]!
    // 本段之后还要放得下剩下的段与段间空格
    let tail = 0
    for (let k = index + 1; k < clue.length; k++) tail += clue[k]! + 1
    for (let at = start; at + size + tail <= width; at++) {
      for (let i = 0; i < size; i++) cells.push(at + i)
      place(index + 1, at + size + 1)
      for (let i = 0; i < size; i++) cells.pop()
    }
  }
  place(0, 0)
  return out
}

/** 把一行摆法推给各列的状态；出现矛盾返回 false（返回前不能改动入参之外的东西） */
function advanceColumns(
  colClues: readonly (readonly number[])[],
  filled: readonly number[],
  done: number[],
  run: number[],
  row: number,
  height: number,
): boolean {
  const black = new Set(filled)
  for (let col = 0; col < done.length; col++) {
    const clue = colClues[col]!
    if (black.has(col)) {
      if (run[col] === 0) {
        // 新开一段：线索里必须还有下一段
        if (done[col]! >= clue.length) return false
      }
      run[col]!++
      if (run[col]! > clue[done[col]!]!) return false
    } else if (run[col]! > 0) {
      // 一段结束：长度必须与线索完全一致
      if (run[col]! !== clue[done[col]!]!) return false
      done[col]!++
      run[col] = 0
    }
    // 剪枝：剩下的格子要放得下未完成的线索（含开放段之后必须的空隙）
    if (minimumRemaining(clue, done[col]!, run[col]!) > height - (row + 1)) return false
  }
  return true
}

/** 某一列从当前状态起**至少**还需要多少格 */
function minimumRemaining(clue: readonly number[], done: number, run: number): number {
  if (run > 0) {
    const rest = clue.slice(done + 1)
    if (rest.length === 0) return clue[done]! - run
    return clue[done]! - run + 1 + rest.reduce((sum, value) => sum + value, 0) + (rest.length - 1)
  }
  const rest = clue.slice(done)
  if (rest.length === 0) return 0
  return rest.reduce((sum, value) => sum + value, 0) + (rest.length - 1)
}

/** 一整列是否恰好推完自己的线索（全部行都放完之后才问） */
function columnFinished(clue: readonly number[], done: number, run: number): boolean {
  if (run > 0) return run === clue[done] && done + 1 === clue.length
  return done === clue.length
}
