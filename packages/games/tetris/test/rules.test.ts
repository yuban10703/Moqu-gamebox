/**
 * 规则层测试。重点覆盖验收点名的边界：
 *   - 确定性：同 seed + 同「玩家输入 + tick」序列 → 完全同状态（7-bag 出块序列由 seed 复算，不碰 Math.random）；
 *   - 自动下落：tick 是普通动作，规则层里没有任何定时器（间隔由壳层按 tickMs 驱动）；
 *   - 固化 / 消行 / 计分 / 等级；
 *   - 胜负：堆到顶部即 lost，且除撤销/重开外一律拒绝；
 *   - 撤销：逆操作回退（棋盘、当前块、出块游标、分数、消行全部一致回退），无历史时抛错；
 *     自动下落（tick）**不占撤销层级**：一次撤销退回玩家上一次操作之前；
 *   - 存档：encode/decode 严格往返，坏数据一律拒绝，缺 history 按空栈。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { IllegalActionError, MIN_TICK_MS, createRng, type MoveDir, type Rng } from '@eink/core'
import { ALL_PIECES, cellsOf, type PieceId } from '../src/pieces.js'
import {
  ALL_DIRS,
  CELL_FILLED,
  CLEAR_HOLD_MS,
  DIFFICULTIES,
  LINE_SCORES,
  LINES_PER_LEVEL,
  MAX_HISTORY_ENTRIES,
  MAX_LINE_CLEAR,
  bagAt,
  canUndo,
  isAutoEntry,
  cellIndex,
  createState,
  decodeState,
  difficultyOf,
  emptyBoard,
  encodeState,
  fits,
  garbageHole,
  isLegal,
  legalActions,
  levelOf,
  nextPieceId,
  pieceAt,
  pieceCells,
  reduceState,
  scoreForLines,
  spawnPiece,
  statusOf,
  undoTetris,
  type ActivePiece,
  type TetrisAction,
  type TetrisState,
} from '../src/rules.js'
import { tetrisGame } from '../src/index.js'

const COLS = 10
const ROWS = 18

/** 手动局面：只关心棋盘与方块，计数给稳定默认值（cursor 与 pieces 保持不变式） */
function manual(board: readonly number[], piece: ActivePiece, overrides: Partial<TetrisState> = {}): TetrisState {
  const seed = overrides.seed ?? 1
  const pieces = overrides.pieces ?? 0
  return {
    difficulty: 'starter',
    seed,
    board,
    piece,
    cursor: overrides.cursor ?? pieces + 1,
    score: 0,
    lines: 0,
    pieces,
    clearing: null,
    history: [],
    ...overrides,
  }
}

/** 找一个「第 index 块正好是指定形状」的 seed：用于构造与出块序列一致的手动局面 */
function seedWithPiece(index: number, id: PieceId): number {
  for (let seed = 1; seed < 20000; seed++) {
    if (pieceAt(seed, index) === id) return seed
  }
  throw new Error(`no seed gives ${id} at ${index}`)
}

/**
 * 让方块一路下落直到固化（0 次或多次下落；最多 rows 次以内必然固化），
 * 并**走完消行定格那一拍**（见 settleClear）—— 断言"消行之后"的局面用它。
 */
function dropUntilLocked(state: TetrisState): TetrisState {
  return settleClear(dropUntilBeat(state))
}

/** 落到"固化那一瞬间"：消行定格还没结清（满行还在棋盘上、分数还没加） */
function dropUntilBeat(state: TetrisState): TetrisState {
  let current = state
  for (let step = 0; step <= ROWS; step++) {
    const before = current
    current = reduceState(current, { type: 'move', dir: 'down' })
    // 固化有两种样子：没满行（pieces 立刻 +1）与满行（进入消行定格，pieces 还没加）
    if (current.pieces > before.pieces || current.clearing) return current
  }
  throw new Error('piece never locked')
}

/**
 * 结清消行定格：定格分两拍（反色 → 出文字），第二拍结束的那个 tick 才真正消掉、加分、出下一块。
 * 断言「消行之后」的局面都要先走完这两拍。
 */
function settleClear(state: TetrisState): TetrisState {
  let current = state
  for (let step = 0; step < 4 && current.clearing; step++) current = reduceState(current, { type: 'tick' })
  return current
}

/**
 * 「像真人那样」挑下一步：偏向下落（离散玩法里玩家按得最多的就是它），
 * 偶尔左右/旋转；四成左右的动作交给 legal 里的随机项（含撤销、重开）。
 * 只用传入的确定性 rng，因此整段序列可复现。
 */
function pickPlayAction(rng: Rng, state: TetrisState): TetrisAction {
  const roll = rng.next()
  const dir: MoveDir | null =
    roll < 0.5 ? 'down' : roll < 0.66 ? 'left' : roll < 0.82 ? 'right' : roll < 0.9 ? 'up' : null
  if (dir) {
    const action: TetrisAction = { type: 'move', dir }
    if (isLegal(state, action)) return action
  }
  const actions = legalActions(state)
  return actions[rng.int(actions.length)]!
}

describe('出块序列（7-bag，只由 seed 决定）', () => {
  it('每袋 7 种形状各一次', () => {
    for (let seed = 0; seed < 32; seed++) {
      for (let bag = 0; bag < 4; bag++) {
        const pieces = bagAt(seed, bag)
        expect(pieces).toHaveLength(ALL_PIECES.length)
        expect([...pieces].sort()).toEqual([...ALL_PIECES].sort())
      }
    }
  })

  it('pieceAt 就是「袋号 + 袋内序号」', () => {
    for (let index = 0; index < 40; index++) {
      const bag = Math.floor(index / ALL_PIECES.length)
      expect(pieceAt(20261004, index)).toBe(bagAt(20261004, bag)[index % ALL_PIECES.length])
    }
  })

  it('初始局面与首个方块都来自 seed，且同 (seed, 难度) 完全一致', () => {
    const a = createState(20261004, 'starter')
    const b = createState(20261004, 'starter')
    expect(a).toEqual(b)
    expect(a.piece.id).toBe(pieceAt(20261004, 0))
    expect(a.piece).toEqual(spawnPiece(pieceAt(20261004, 0), COLS))
    expect(a.cursor).toBe(1)
    expect(nextPieceId(a)).toBe(pieceAt(20261004, 1))
  })

  it('不同 seed 会给出不同的开局（不是恒定的第一块）', () => {
    const firsts = new Set<string>()
    for (let seed = 1; seed <= 24; seed++) firsts.add(createState(seed, 'starter').piece.id)
    expect(firsts.size).toBeGreaterThanOrEqual(3)
  })

  it('开局棋盘是空的；垃圾行只出现在对应难度，且洞位由 seed 决定', () => {
    expect(createState(7, 'starter').board.every((cell) => cell === 0)).toBe(true)
    const spec = difficultyOf('challenging')
    const state = createState(7, 'challenging')
    for (let index = 0; index < spec.garbageRows; index++) {
      const row = spec.rows - 1 - index
      const hole = garbageHole(7, index, spec.cols)
      for (let col = 0; col < spec.cols; col++) {
        expect(state.board[cellIndex(spec.cols, row, col)]).toBe(col === hole ? 0 : CELL_FILLED)
      }
    }
    // 垃圾行以上必须是空的（否则等于凭空多给了难度）
    for (let row = 0; row < spec.rows - spec.garbageRows; row++) {
      for (let col = 0; col < spec.cols; col++) {
        expect(state.board[cellIndex(spec.cols, row, col)]).toBe(0)
      }
    }
  })

  it('所有难度的开局都是可玩的（不是一上来就输）', () => {
    for (const spec of DIFFICULTIES) {
      const state = createState(20261004, spec.id)
      expect(statusOf(state), spec.id).toBe('playing')
      expect(fits(state.board, spec, state.piece), spec.id).toBe(true)
    }
  })

  it('源码里没有定时器与 Math.random / Date.now（自动下落由壳层按 tickMs 驱动）', () => {
    for (const name of ['rules.ts', 'view.ts', 'index.ts', 'pieces.ts']) {
      const text = readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8')
      const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
      expect(code, name).not.toMatch(/setInterval|setTimeout|requestAnimationFrame|performance\.now/)
      expect(code, name).not.toMatch(/Math\.random|Date\.now/)
    }
  })

  it('tickMs 是纯函数声明：同局面同间隔、不低于 400ms 硬下限、堆到顶返回 null', () => {
    for (const spec of DIFFICULTIES) {
      const state = createState(20261004, spec.id)
      expect(tetrisGame.tickMs!(state, spec.id)).toBe(spec.tickMs)
      expect(spec.tickMs).toBeGreaterThanOrEqual(MIN_TICK_MS)
      // 纯函数：只由 state 决定
      expect(tetrisGame.tickMs!(state, spec.id)).toBe(tetrisGame.tickMs!(state, spec.id))
    }
    // 越难越快，但都快不过刷新下限
    const speeds = DIFFICULTIES.map((spec) => spec.tickMs)
    expect(speeds).toEqual([...speeds].sort((a, b) => b - a))
    // 堆到顶（块放不下）之后返回 null —— 壳层据此停表
    const board = emptyBoard(COLS, ROWS).fill(CELL_FILLED)
    const lost = manual(board, spawnPiece('O', COLS))
    expect(statusOf(lost)).toBe('lost')
    expect(tetrisGame.tickMs!(lost, 'starter')).toBeNull()
  })
})

describe('平移与旋转', () => {
  it('左右各平移一格，棋盘不变', () => {
    const state = createState(20261004, 'starter')
    const left = reduceState(state, { type: 'move', dir: 'left' })
    expect(left.piece.col).toBe(state.piece.col - 1)
    expect(left.board).toEqual(state.board)
    const right = reduceState(left, { type: 'move', dir: 'right' })
    expect(right.piece).toEqual(state.piece)
    expect(right.history).toHaveLength(2)
  })

  it('撞到井壁时抛 IllegalActionError（而不是静默不动）', () => {
    const piece: ActivePiece = { id: 'T', row: 0, col: 0, rot: 0 }
    const state = manual(emptyBoard(COLS, ROWS), piece)
    expect(() => reduceState(state, { type: 'move', dir: 'left' })).toThrow(IllegalActionError)
    const atRight: ActivePiece = { id: 'T', row: 0, col: COLS - 3, rot: 0 }
    expect(() => reduceState(manual(emptyBoard(COLS, ROWS), atRight), { type: 'move', dir: 'right' })).toThrow(
      IllegalActionError,
    )
  })

  it('压在堆上时：还能左右平移，再按「落」就是固化', () => {
    const board = emptyBoard(COLS, ROWS)
    // 堆顶在 (3,3)：O 块从第 0 行还能落一格，再落就撞上
    board[cellIndex(COLS, 3, 3)] = CELL_FILLED
    const state = manual(board, { id: 'O', row: 0, col: 3, rot: 0 })
    const down = reduceState(state, { type: 'move', dir: 'down' })
    expect(down.piece.row).toBe(1)
    const locked = reduceState(down, { type: 'move', dir: 'down' })
    expect(locked.pieces).toBe(1)
    expect(locked.board[cellIndex(COLS, 1, 3)]).toBe(CELL_FILLED)
    // 落不下去时才谈得上「再按一次就固化」；平移在任何时候都还能做
    const shifted = reduceState(down, { type: 'move', dir: 'left' })
    expect(shifted.piece.col).toBe(2)
  })

  it('旋转改变朝向，4 个格子按方框旋转', () => {
    const state = createState(11, 'starter')
    const rotated = reduceState(state, { type: 'move', dir: 'up' })
    expect(rotated.piece.rot).toBe(1)
    expect(rotated.piece.id).toBe(state.piece.id)
    expect(pieceCells(rotated.piece)).toEqual(
      cellsOf(state.piece.id, 1).map(([row, col]) => ({ row: state.piece.row + row, col: state.piece.col + col })),
    )
    // 四次旋转回到原朝向
    let spin = state
    for (let step = 0; step < 4; step++) spin = reduceState(spin, { type: 'move', dir: 'up' })
    expect(spin.piece).toEqual(state.piece)
  })

  it('贴墙旋转会用左右微调，而不是直接失败', () => {
    // 竖直的 I 贴在右墙（方框第 2 列 → 棋盘第 9 列）：转横后必然探出井壁，需要向左让一格
    const piece: ActivePiece = { id: 'I', row: 5, col: 7, rot: 1 }
    expect(pieceCells(piece)).toContainEqual({ row: 5, col: 9 })
    const rotated = reduceState(manual(emptyBoard(COLS, ROWS), piece), { type: 'move', dir: 'up' })
    expect(rotated.piece.rot).toBe(2)
    expect(rotated.piece.col).toBe(6)
    for (const cell of pieceCells(rotated.piece)) {
      expect(cell.col).toBeLessThan(COLS)
      expect(cell.col).toBeGreaterThanOrEqual(0)
    }
  })

  it('转不动时抛错：O 块转了等于没转，被围死的方块也让不开', () => {
    expect(() =>
      reduceState(manual(emptyBoard(COLS, ROWS), { id: 'O', row: 0, col: 4, rot: 0 }), { type: 'move', dir: 'up' }),
    ).toThrow(IllegalActionError)
    // 整盘只留第 5 行第 3~6 列这 4 格，横着的 I 只能原地待着，转竖后上下都撞死
    const board = new Array<number>(COLS * ROWS).fill(CELL_FILLED)
    for (let col = 3; col <= 6; col++) board[cellIndex(COLS, 5, col)] = 0
    const piece: ActivePiece = { id: 'I', row: 4, col: 3, rot: 0 }
    expect(pieceCells(piece).every((cell) => cell.row === 5)).toBe(true)
    expect(() => reduceState(manual(board, piece), { type: 'move', dir: 'up' })).toThrow(IllegalActionError)
  })
})

describe('下落、固化与出新块', () => {
  it('按一次「落」直接落到底：不中途停、不固化、只占一层撤销', () => {
    /*
     * 用户要求：把「落」从「下落一格」改成「直接落到底」。
     * 这里守三件事：① 真的到底（再往下放不下）；② 没固化（还归玩家，可继续左右平移）；
     * ③ **只占一层撤销** —— 硬降若按一格一层记录，撤销一次要按十几次，等于不能撤销。
     */
    const state = createState(20261004, 'starter')
    const spec = difficultyOf(state.difficulty)
    const dropped = reduceState(state, { type: 'move', dir: 'down' })
    expect(dropped.piece.id).toBe(state.piece.id)
    expect(dropped.piece.row).toBeGreaterThan(state.piece.row)
    expect(fits(dropped.board, spec, { ...dropped.piece, row: dropped.piece.row + 1 })).toBe(false)
    expect(dropped.pieces).toBe(0)
    // 到底之后还能继续调整（没被固化）
    expect(isLegal(dropped, { type: 'move', dir: 'left' })).toBe(true)
    // 一层撤销就回到按「落」之前
    const back = reduceState(dropped, { type: 'undo' })
    expect(back.piece).toEqual(state.piece)
    expect(back.board).toEqual(state.board)
  })

  it('落到底后再按一次「落」：固化 + 出新块', () => {
    const state = createState(20261004, 'starter')
    const lockedPiece = (() => {
      let current = state
      let previous = current
      while (true) {
        previous = current
        current = reduceState(current, { type: 'move', dir: 'down' })
        if (current.pieces === 1) return previous.piece
      }
    })()
    const locked = dropUntilLocked(state)
    expect(locked.pieces).toBe(1)
    expect(locked.cursor).toBe(2)
    expect(locked.piece.id).toBe(pieceAt(state.seed, 1))
    expect(locked.piece).toEqual(spawnPiece(pieceAt(state.seed, 1), COLS))
    expect(locked.lines).toBe(0)
    // 棋盘上只多了这一块的 4 格
    const filled = locked.board.reduce((sum, cell) => sum + cell, 0)
    expect(filled).toBe(4)
    for (const cell of pieceCells(lockedPiece)) {
      expect(locked.board[cellIndex(COLS, cell.row, cell.col)]).toBe(CELL_FILLED)
    }
  })

  it('方块放在堆上：固化的位置就是玩家最后看到的位置', () => {
    const board = emptyBoard(COLS, ROWS)
    // 底行第 3 列是已有的堆顶
    board[cellIndex(COLS, ROWS - 1, 3)] = CELL_FILLED
    const state = manual(board, { id: 'O', row: 14, col: 4, rot: 0 })
    let previous = state
    let current = state
    while (current.pieces === 0) {
      previous = current
      current = reduceState(current, { type: 'move', dir: 'down' })
    }
    // 固化前玩家看到的那 4 格，就是固化后棋盘上多出来的 4 格
    for (const cell of pieceCells(previous.piece)) {
      expect(current.board[cellIndex(COLS, cell.row, cell.col)]).toBe(CELL_FILLED)
    }
    expect(current.board[cellIndex(COLS, ROWS - 2, 4)]).toBe(CELL_FILLED)
    expect(current.board[cellIndex(COLS, ROWS - 1, 5)]).toBe(CELL_FILLED)
  })
})

describe('消行与计分', () => {
  it('消行基准分与等级倍率', () => {
    expect(LINE_SCORES[1]).toBe(100)
    expect(LINE_SCORES[2]).toBe(300)
    expect(LINE_SCORES[3]).toBe(500)
    expect(LINE_SCORES[4]).toBe(800)
    expect(scoreForLines(0, 3)).toBe(0)
    expect(scoreForLines(1, 1)).toBe(100)
    expect(scoreForLines(4, 1)).toBe(800)
    expect(scoreForLines(1, 3)).toBe(300)
    expect(levelOf(0)).toBe(1)
    expect(levelOf(LINES_PER_LEVEL - 1)).toBe(1)
    expect(levelOf(LINES_PER_LEVEL)).toBe(2)
    expect(levelOf(LINES_PER_LEVEL * 3 + 4)).toBe(4)
  })

  it('填满一行即消除并得分', () => {
    const board = emptyBoard(COLS, ROWS)
    for (let col = 0; col < COLS; col++) {
      if (col !== 4 && col !== 5) board[cellIndex(COLS, ROWS - 1, col)] = CELL_FILLED
    }
    // O 块正好补上底行第 4、5 列
    const state = manual(board, { id: 'O', row: ROWS - 2, col: 4, rot: 0 })
    const locked = dropUntilLocked(state)
    expect(locked.lines).toBe(1)
    expect(locked.score).toBe(100)
    expect(locked.pieces).toBe(1)
    // 消行后：底行只剩这一块的上半部分（第 4、5 列），其余行清空
    expect(locked.board[cellIndex(COLS, ROWS - 1, 4)]).toBe(CELL_FILLED)
    expect(locked.board[cellIndex(COLS, ROWS - 1, 5)]).toBe(CELL_FILLED)
    expect(locked.board.reduce((sum, cell) => sum + cell, 0)).toBe(2)
  })

  it('一次消 4 行（竖着的 I 插进 1 格宽的槽）', () => {
    const board = emptyBoard(COLS, ROWS)
    // 底下 4 行只留最右一列的空槽
    for (let row = ROWS - 4; row < ROWS; row++) {
      for (let col = 0; col < COLS - 1; col++) board[cellIndex(COLS, row, col)] = CELL_FILLED
    }
    // 竖直的 I：方框第 2 列 → 方框左上角 col=7 时落在第 9 列（方框可以探出井壁）
    const state = manual(board, { id: 'I', row: ROWS - 4, col: COLS - 3, rot: 1 })
    expect(pieceCells(state.piece).map((cell) => cell.col)).toEqual([COLS - 1, COLS - 1, COLS - 1, COLS - 1])
    const locked = dropUntilLocked(state)
    expect(locked.lines).toBe(4)
    expect(locked.score).toBe(800)
    expect(locked.board.every((cell) => cell === 0)).toBe(true)
  })

  it('消行后等级提高，之后的消行按新倍率计分', () => {
    const board = emptyBoard(COLS, ROWS)
    for (let col = 0; col < COLS; col++) {
      if (col !== 4 && col !== 5) board[cellIndex(COLS, ROWS - 1, col)] = CELL_FILLED
    }
    const state = manual(board, { id: 'O', row: ROWS - 2, col: 4, rot: 0 }, { lines: LINES_PER_LEVEL - 1, score: 0 })
    const locked = dropUntilLocked(state)
    // 消行前等级 1 → 100 分；消完这一行正好满 10 行，升到 2 级
    expect(locked.score).toBe(100)
    expect(levelOf(locked.lines)).toBe(2)
  })

  it('同时消多行时行下面不动、上面的整体下移', () => {
    const board = emptyBoard(COLS, ROWS)
    // 第 15、17 行只缺第 0 列，第 16 行有一个孤立的方块
    for (const row of [ROWS - 3, ROWS - 1]) {
      for (let col = 1; col < COLS; col++) board[cellIndex(COLS, row, col)] = CELL_FILLED
    }
    board[cellIndex(COLS, ROWS - 2, 7)] = CELL_FILLED
    const state = manual(board, { id: 'I', row: ROWS - 5, col: -2, rot: 1 })
    const locked = dropUntilLocked(state)
    expect(locked.lines).toBe(2)
    expect(locked.score).toBe(300)
    // 被消掉的两行之上还有一行孤立方块：消行后它落到更靠下的行（行号 +2）
    expect(locked.board[cellIndex(COLS, ROWS - 1, 7)]).toBe(CELL_FILLED)
  })
})

/**
 * 消行定格（打击感）：满行先留一拍、整盘反色，下一拍才真正消掉。
 *
 * 这一拍在规则层里就是**一个 tick**，没有任何时间引用 ——
 * 面板约 2 次全屏刷新/秒，做不出消行动画，能做的只有「离散状态的对比度 + 停留时间」。
 */
describe('消行定格（满行先留一拍，再消）', () => {
  /** 底行只缺 4、5 两列，O 块正好补上 → 一落就满一行 */
  function oneRowFromClear(): TetrisState {
    const board = emptyBoard(COLS, ROWS)
    for (let col = 0; col < COLS; col++) {
      if (col !== 4 && col !== 5) board[cellIndex(COLS, ROWS - 1, col)] = CELL_FILLED
    }
    return manual(board, { id: 'O', row: ROWS - 2, col: 4, rot: 0 }, { score: 500, lines: 3, seed: seedWithPiece(0, 'O') })
  }

  it('固化那一刻：满行还在棋盘上，分数 / 消行 / 已固化块数都还没动', () => {
    const before = oneRowFromClear()
    const hold = dropUntilBeat(before)
    expect(hold.clearing).toEqual({ rows: [ROWS - 1], points: 100, phase: 'flash' })
    // 满行还在（这正是"看得见的那一拍"）
    for (let col = 0; col < COLS; col++) {
      expect(hold.board[cellIndex(COLS, ROWS - 1, col)]).toBe(CELL_FILLED)
    }
    // 计数与分数都没动 —— 它们和满行一起在定格结束的那一刻跳
    expect(hold.lines).toBe(3)
    expect(hold.score).toBe(500)
    expect(hold.pieces).toBe(before.pieces)
    // 存档不变式（decode 校验依赖它们）在定格中也成立
    expect(hold.cursor).toBe(hold.pieces + 1)
    expect(hold.piece.id).toBe(pieceAt(hold.seed, hold.cursor - 1))
    // 当前块就是刚固化那一块：它的 4 个格子全都在棋盘里
    expect(pieceCells(hold.piece).every((cell) => hold.board[cellIndex(COLS, cell.row, cell.col)] === CELL_FILLED)).toBe(true)
  })

  it('第一拍反色、第二拍出文字、第三拍才真正消行', () => {
    const hold = dropUntilBeat(oneRowFromClear())
    expect(hold.clearing?.phase).toBe('flash')
    // 第一拍：还是那几行，只是相位翻到 label（视图据此先反色、再写字）
    const labelled = reduceState(hold, { type: 'tick' })
    expect(labelled.clearing?.phase).toBe('label')
    expect(labelled.lines).toBe(3)
    expect(labelled.score).toBe(500)
    expect(labelled.board).toEqual(hold.board)
    // 第二拍：才真正消行
    const after = reduceState(labelled, { type: 'tick' })
    expect(after.clearing).toBeNull()
    expect(after.lines).toBe(4)
    expect(after.score).toBe(600)
    expect(after.pieces).toBe(hold.pieces + 1)
    expect(after.cursor).toBe(hold.cursor + 1)
    // 底行只剩这一块的上半部分（第 4、5 列），其余行清空
    expect(after.board[cellIndex(COLS, ROWS - 1, 4)]).toBe(CELL_FILLED)
    expect(after.board[cellIndex(COLS, ROWS - 1, 5)]).toBe(CELL_FILLED)
    expect(after.board.reduce((sum, cell) => sum + cell, 0)).toBe(2)
    // 新块就是出块序列里的下一块
    expect(after.piece.id).toBe(pieceAt(after.seed, after.cursor - 1))
  })

  it('定格期间不接受移动 / 旋转 / 落（两拍都拒绝，不静默吞输入）', () => {
    const hold = dropUntilBeat(oneRowFromClear())
    const labelled = reduceState(hold, { type: 'tick' })
    for (const phaseState of [hold, labelled]) {
      for (const dir of ALL_DIRS) {
        expect(() => reduceState(phaseState, { type: 'move', dir })).toThrow(IllegalActionError)
        expect(isLegal(phaseState, { type: 'move', dir })).toBe(false)
      }
      // 定格中局面仍是"进行中"（不能因为方块已并盘就误报失败）
      expect(statusOf(phaseState)).toBe('playing')
      // 定格中只允许 tick / 撤销 / 重开
      expect(legalActions(phaseState).map((action) => action.type).sort()).toEqual(['restart', 'tick', 'undo'])
    }
  })

  it('定格长度：tickMs 给固定的一拍（面板一帧），与难度无关', () => {
    const hold = dropUntilBeat(oneRowFromClear())
    expect(tetrisGame.tickMs?.(hold, 'starter')).toBe(CLEAR_HOLD_MS)
    expect(CLEAR_HOLD_MS).toBeGreaterThanOrEqual(MIN_TICK_MS)
    // 出文字那一拍同样是固定值（两拍加起来才是完整的一下）
    expect(tetrisGame.tickMs?.(reduceState(hold, { type: 'tick' }), 'starter')).toBe(CLEAR_HOLD_MS)
    // 结清之后立刻回到难度自己的间隔
    const after = settleClear(hold)
    expect(tetrisGame.tickMs?.(after, 'starter')).toBe(difficultyOf('starter').tickMs)
  })

  it('定格期间撤销：直接回到"方块还没落下来"之前（满行与方块一起退回）', () => {
    const before = oneRowFromClear()
    const hold = dropUntilBeat(before)
    const back = reduceState(hold, { type: 'undo' })
    expect(back.board).toEqual(before.board)
    expect(back.piece).toEqual(before.piece)
    expect(back.clearing).toBeNull()
    expect(back.score).toBe(500)
    expect(back.lines).toBe(3)
    expect(back.history).toEqual([])
    // 走完两拍之后再撤销，结果必须完全一致（同一个撤销层级，不会"退一半"）
    const settled = settleClear(hold)
    expect(reduceState(settled, { type: 'undo' })).toEqual(back)
    // 第二拍（已出文字）里撤销同样干净
    expect(reduceState(reduceState(hold, { type: 'tick' }), { type: 'undo' })).toEqual(back)
  })

  it('定格中的状态能原样存档（encode → JSON → decode）', () => {
    const hold = dropUntilBeat(oneRowFromClear())
    for (const phaseState of [hold, reduceState(hold, { type: 'tick' })]) {
      const raw = encodeState(phaseState)
      expect(raw.clearing?.phase).toBe(phaseState.clearing?.phase)
      const decoded = decodeState(JSON.parse(JSON.stringify(raw)))
      expect(decoded).toEqual(phaseState)
      expect(decoded.clearing).toEqual(phaseState.clearing)
    }
    // 上一版（还没分两拍）写下的存档没有 phase 字段：按 flash 读，不判损坏
    const legacy = encodeState(hold) as unknown as Record<string, unknown>
    delete (legacy.clearing as Record<string, unknown>).phase
    expect(decodeState(legacy).clearing?.phase).toBe('flash')
  })

  it('坏掉的定格字段一律拒绝（行不满 / 越界 / 方块没并盘 / 上限）', () => {
    const hold = dropUntilBeat(oneRowFromClear())
    const good = encodeState(hold) as unknown as Record<string, unknown>
    const boardFilled = hold.board.slice()
    const holeIndex = cellIndex(COLS, ROWS - 1, 0)
    const boardWithHole = hold.board.slice()
    boardWithHole[holeIndex] = 0
    const cases: Array<[string, unknown]> = [
      ['clearing 不是对象', { ...good, clearing: 7 }],
      ['行号列表为空', { ...good, clearing: { rows: [], points: 100 } }],
      ['行号越界', { ...good, clearing: { rows: [ROWS], points: 100 } }],
      ['行号重复', { ...good, clearing: { rows: [ROWS - 1, ROWS - 1], points: 100 } }],
      ['超过一次能消的上限', { ...good, clearing: { rows: [0, 1, 2, 3, 4], points: 100 } }],
      ['这一行并不是满的', { ...good, board: boardWithHole, clearing: { rows: [ROWS - 1], points: 100 } }],
      ['分数不是自然数', { ...good, clearing: { rows: [ROWS - 1], points: -1 } }],
      ['相位未知', { ...good, clearing: { rows: [ROWS - 1], points: 100, phase: 'nope' } }],
      ['棋盘与满行对不上（整盘清空）', { ...good, board: emptyBoard(COLS, ROWS), clearing: { rows: [ROWS - 1], points: 100 } }],
    ]
    for (const [name, payload] of cases) {
      expect(() => decodeState(payload), name).toThrow(IllegalActionError)
    }
    // 方块没并进棋盘的"定格"也是坏的：把那一块从棋盘上抹掉
    const boardWithoutPiece = boardFilled.slice()
    for (const cell of pieceCells(hold.piece)) boardWithoutPiece[cellIndex(COLS, cell.row, cell.col)] = 0
    expect(() =>
      decodeState({ ...good, board: boardWithoutPiece, clearing: { rows: [ROWS - 1], points: 100 } } as unknown),
    ).toThrow(IllegalActionError)
  })
})

/**
 * 「堆到顶」前一手：井口已经被下一块的出生格占住（= 堆到顶），当前块竖直贴在左下角，
 * 再落一次就会固化并让新块放不下。
 */
function boardBeforeTopOut(): TetrisState {
  const seed = seedWithPiece(0, 'I')
  const board = emptyBoard(COLS, ROWS)
  for (const cell of pieceCells(spawnPiece(pieceAt(seed, 1), COLS))) {
    board[cellIndex(COLS, cell.row, cell.col)] = CELL_FILLED
  }
  return manual(board, { id: 'I', row: ROWS - 4, col: -2, rot: 1 }, { seed })
}

describe('堆到顶部即失败', () => {
  it('井口被占住 → lost，且除撤销/重开外的动作都被拒绝', () => {
    const seed = seedWithPiece(0, 'I')
    const board = emptyBoard(COLS, ROWS)
    for (const cell of pieceCells(spawnPiece('I', COLS))) board[cellIndex(COLS, cell.row, cell.col)] = CELL_FILLED
    const state = manual(board, spawnPiece('I', COLS), { seed })
    expect(statusOf(state)).toBe('lost')
    for (const dir of ['up', 'down', 'left', 'right'] as MoveDir[]) {
      expect(() => reduceState(state, { type: 'move', dir })).toThrow(IllegalActionError)
      expect(isLegal(state, { type: 'move', dir })).toBe(false)
    }
    expect(legalActions(state).some((action) => action.type === 'move')).toBe(false)
    // 重开永远可用
    expect(reduceState(state, { type: 'restart' }).pieces).toBe(0)
  })

  it('固化后新块在井口放不下 → 立刻失败，但撤销能把那一手退回来', () => {
    const state = boardBeforeTopOut()
    expect(statusOf(state)).toBe('playing')
    const lost = dropUntilLocked(state)
    expect(lost.pieces).toBe(1)
    expect(statusOf(lost)).toBe('lost')
    expect(tetrisGame.status(lost)).toBe('lost')
    // 结果面板上的撤销：回到固化之前，局面重新可玩
    const back = reduceState(lost, { type: 'undo' })
    expect(statusOf(back)).toBe('playing')
    expect(back.pieces).toBe(0)
    expect(back.cursor).toBe(1)
    expect(back.board).toEqual(state.board)
    expect(back.piece).toEqual(state.piece)
  })

  it('失败局面也能存档往返（decode 不能把游戏自己走出来的状态判成损坏）', () => {
    const lost = dropUntilLocked(boardBeforeTopOut())
    expect(statusOf(lost)).toBe('lost')
    const raw = encodeState(lost)
    const restored = decodeState(JSON.parse(JSON.stringify(raw)))
    expect(restored).toEqual(lost)
    expect(statusOf(restored)).toBe('lost')
    expect(JSON.stringify(encodeState(restored))).toBe(JSON.stringify(raw))
  })

  it('本玩法没有胜利条件：status 只会是 playing / lost', () => {
    let state = createState(20261004, 'starter')
    const rng = createRng(7)
    for (let step = 0; step < 120; step++) {
      expect(tetrisGame.status(state)).not.toBe('won')
      const actions = legalActions(state)
      state = reduceState(state, actions[rng.int(actions.length)]!)
    }
  })

  it('不认识的动作名一律拒绝（不是静默忽略）', () => {
    const state = createState(20261004, 'starter')
    for (const action of [
      { type: 'slide', dir: 'left' },
      { type: 'reveal', index: 3 },
      { type: 'nextLevel' },
      { type: 'startLevel', levelId: 'starter' },
    ]) {
      expect(() => tetrisGame.reduce(state, action as unknown as TetrisAction)).toThrow(IllegalActionError)
    }
    // 会话固定派发的两个壳层动作必须接受
    expect(() => tetrisGame.reduce(state, { type: 'undo' })).toThrow(IllegalActionError) // 无历史 → 拒绝
    expect(tetrisGame.reduce(state, { type: 'restart' })).toEqual(state)
  })
})

describe('自动下落（tick）', () => {
  /** 连续自动下落 n 格 */
  function ticks(state: TetrisState, count: number): TetrisState {
    let next = state
    for (let step = 0; step < count; step++) next = reduceState(next, { type: 'tick' })
    return next
  }

  it('一次 tick 下落一格：形状 / 列 / 旋转都不变，棋盘也不变', () => {
    const state = createState(20261004, 'starter')
    const down = reduceState(state, { type: 'tick' })
    expect(down.piece).toEqual({ ...state.piece, row: state.piece.row + 1 })
    expect(down.board).toEqual(state.board)
    expect(down.pieces).toBe(0)
    expect(down.history).toHaveLength(1)
    expect(isAutoEntry(down.history[0]!)).toBe(true)
  })

  it('落到底不会当帧固化：先停在堆上一格，下一次 tick 才固化并出新块', () => {
    let state = manual(emptyBoard(COLS, ROWS), { id: 'O', row: 0, col: 4, rot: 0 })
    state = ticks(state, ROWS - 2) // O 块占两行，最高只能落到第 ROWS-2 行
    expect(state.piece.row).toBe(ROWS - 2)
    expect(state.pieces).toBe(0)
    expect(statusOf(state)).toBe('playing')
    // 这一格就是墨水屏上的"锁定缓冲"：玩家还有整个间隔可以平移/旋转
    const shifted = reduceState(state, { type: 'move', dir: 'left' })
    expect(shifted.piece.col).toBe(3)
    // 再一个 tick 才固化
    const locked = reduceState(shifted, { type: 'tick' })
    expect(locked.pieces).toBe(1)
    expect(locked.board.filter((cell) => cell === CELL_FILLED)).toHaveLength(4)
    expect(locked.piece.id).toBe(pieceAt(locked.seed, 1))
  })

  it('自动落到底与手动「落」落在同一位置：固化结果一致（只差撤销记录的 auto 标记）', () => {
    /*
     * 「落」改成直接落到底之后，这条不变量仍然成立：
     * 自动一格一格走到底 与 手动一次硬降到底，落在**同一格**、固化后的棋盘完全相同。
     * 有意保留的差别只有撤销记录：硬降只占一层（cursor 小得多）。
     */
    const board = emptyBoard(COLS, ROWS)
    for (let col = 0; col < COLS; col++) {
      if (col !== 4 && col !== 5) board[cellIndex(COLS, ROWS - 1, col)] = CELL_FILLED
    }
    const state = manual(board, { id: 'O', row: ROWS - 4, col: 4, rot: 0 }, { score: 0, lines: 0 })
    // 自动：两格走到底 + 第三次 tick 固化
    const byTick = ticks(state, 3)
    // 手动：一次「落」到底 + 第二次「落」固化
    const byHand = reduceState(reduceState(state, { type: 'move', dir: 'down' }), { type: 'move', dir: 'down' })
    expect(byHand.board).toEqual(byTick.board)
    expect(byHand.piece).toEqual(byTick.piece)
    expect(byHand.lines).toBe(byTick.lines)
    expect(byHand.score).toBe(byTick.score)
    expect(byHand.pieces).toBe(byTick.pieces)
    // 硬降不管落多深都只留一条记录；自动下落则是一格一条
    expect(byHand.history.length).toBeLessThan(byTick.history.length)
    expect(isAutoEntry(byTick.history[byTick.history.length - 1]!)).toBe(true)
    expect(isAutoEntry(byHand.history[byHand.history.length - 1]!)).toBe(false)
  })

  it('已经堆到顶之后 tick 抛错（壳层据此安全停表）', () => {
    const lost = manual(emptyBoard(COLS, ROWS).fill(CELL_FILLED), spawnPiece('O', COLS))
    expect(statusOf(lost)).toBe('lost')
    expect(() => reduceState(lost, { type: 'tick' })).toThrow(IllegalActionError)
    expect(isLegal(lost, { type: 'tick' })).toBe(false)
  })

  it('tick 也在 legal 里（回放校验需要它），且不动撤销按钮的可用性', () => {
    const state = createState(20261004, 'starter')
    expect(legalActions(state).some((action) => action.type === 'tick')).toBe(true)
    const fallen = ticks(state, 3)
    expect(fallen.history).toHaveLength(3)
    // 玩家一步都没走过：撤销按钮不该亮着（自动下落不是玩家操作）
    expect(canUndo(fallen)).toBe(false)
    expect(legalActions(fallen).some((action) => action.type === 'undo')).toBe(false)
  })
})

describe('撤销（逆操作，不存整盘快照）', () => {
  it('没有可撤销的动作时抛错', () => {
    const state = createState(20261004, 'starter')
    expect(() => reduceState(state, { type: 'undo' })).toThrow(IllegalActionError)
    expect(() => undoTetris(state)).toThrow(IllegalActionError)
    expect(isLegal(state, { type: 'undo' })).toBe(false)
  })

  it('平移 / 旋转 / 下落各撤销一步，局面逐字回到原样', () => {
    const state = createState(20261004, 'starter')
    const steps: TetrisAction[] = [
      { type: 'move', dir: 'left' },
      { type: 'move', dir: 'up' },
      { type: 'move', dir: 'down' },
      { type: 'move', dir: 'right' },
    ]
    let current = state
    const seen: TetrisState[] = [current]
    for (const action of steps) {
      current = reduceState(current, action)
      seen.push(current)
    }
    for (let index = steps.length; index > 0; index--) {
      current = reduceState(current, { type: 'undo' })
      expect(current).toEqual(seen[index - 1])
    }
    expect(current).toEqual(state)
  })

  it('固化并消行之后撤销：棋盘、当前块、出块游标、分数、消行全部一致回退', () => {
    const board = emptyBoard(COLS, ROWS)
    for (let col = 0; col < COLS; col++) {
      if (col !== 4 && col !== 5) board[cellIndex(COLS, ROWS - 1, col)] = CELL_FILLED
    }
    const state = manual(board, { id: 'O', row: ROWS - 2, col: 4, rot: 0 }, { score: 500, lines: 3 })
    const locked = dropUntilLocked(state)
    expect(locked.lines).toBe(4)
    expect(locked.score).toBe(600)
    const back = reduceState(locked, { type: 'undo' })
    expect(back.board).toEqual(state.board)
    expect(back.piece).toEqual(state.piece)
    expect(back.cursor).toBe(state.cursor)
    expect(back.pieces).toBe(state.pieces)
    expect(back.score).toBe(500)
    expect(back.lines).toBe(3)
    expect(back.history).toEqual([])
  })

  it('连续撤销能一路回到初始局面（包括消行与多处固化）', () => {
    let state = createState(4242, 'skilled')
    const initial = state
    const rng = createRng(99)
    const snapshots: TetrisState[] = [state]
    for (let step = 0; step < 60; step++) {
      const actions = legalActions(state).filter((action) => action.type === 'move')
      // 消行定格那一拍没有任何可走的棋步（只有 tick 能结清它）——先结清再继续走
      if (actions.length === 0) {
        state = settleClear(state)
        continue
      }
      state = reduceState(state, actions[rng.int(actions.length)]!)
      snapshots.push(state)
    }
    expect(state.history.length).toBeGreaterThan(30)
    for (let index = snapshots.length - 1; index > 0; index--) {
      state = reduceState(state, { type: 'undo' })
      expect(state).toEqual(snapshots[index - 1]!)
    }
    expect(state).toEqual(initial)
  })

  it('自动下落不占撤销层级：一次撤销退回玩家上一次操作之前（不是半格）', () => {
    const start = createState(20261004, 'starter')
    const shifted = reduceState(start, { type: 'move', dir: 'left' }) // 玩家操作
    let fallen = shifted
    for (let step = 0; step < 5; step++) fallen = reduceState(fallen, { type: 'tick' })
    expect(fallen.piece.row).toBe(shifted.piece.row + 5)
    const back = reduceState(fallen, { type: 'undo' })
    expect(back).toEqual(start)
    expect(back.piece).toEqual(start.piece)
  })

  it('自动落到底并固化之后撤销：棋盘、游标、已固化块数整段还原', () => {
    const start = createState(20261004, 'starter')
    const shifted = reduceState(start, { type: 'move', dir: 'left' })
    let fallen = shifted
    while (fallen.pieces === 0) fallen = reduceState(fallen, { type: 'tick' })
    expect(fallen.pieces).toBe(1)
    const back = reduceState(fallen, { type: 'undo' })
    expect(back).toEqual(start)
    expect(back.board).toEqual(start.board)
    expect(back.cursor).toBe(start.cursor)
  })

  it('撤销栈封顶：超过上限时裁掉最旧的一段，并且裁到一条玩家操作上', () => {
    const base = createState(20261004, 'starter')
    const autoEntry = (): { kind: 'piece'; piece: ActivePiece; auto: true } => ({
      kind: 'piece',
      piece: base.piece,
      auto: true,
    })
    // 玩家操作放在中间：裁剪必须停在它上面（否则最老的一次撤销会变成"退回半格"）
    const playerIndex = 5
    const history = Array.from({ length: MAX_HISTORY_ENTRIES }, (_, index) =>
      index === playerIndex
        ? ({ kind: 'piece', piece: base.piece } as const)
        : autoEntry(),
    )
    const stuffed: TetrisState = { ...base, history }
    const after = reduceState(stuffed, { type: 'move', dir: 'left' })
    expect(after.history.length).toBeLessThanOrEqual(MAX_HISTORY_ENTRIES)
    expect(isAutoEntry(after.history[0]!)).toBe(false)
    expect(after.history[0]).toEqual(history[playerIndex])
    // 裁剪过的局面照样能存档往返（自动记录带 auto 标记）
    const restored = decodeState(JSON.parse(JSON.stringify(encodeState(after))))
    expect(restored).toEqual(after)
  })

  it('重开会清空撤销历史（不能撤销回重开之前）', () => {
    let state = createState(20261004, 'starter')
    state = reduceState(state, { type: 'move', dir: 'left' })
    state = reduceState(state, { type: 'move', dir: 'down' })
    const restarted = reduceState(state, { type: 'restart' })
    expect(restarted).toEqual(createState(20261004, 'starter'))
    expect(() => reduceState(restarted, { type: 'undo' })).toThrow(IllegalActionError)
  })
})

describe('确定性重放', () => {
  it('同 seed + 同操作序列 → 完全相同的局面', () => {
    const script: TetrisAction[] = []
    const rng = createRng(20261004)
    let probe = createState(777, 'skilled')
    for (let step = 0; step < 80; step++) {
      const actions = legalActions(probe)
      if (actions.length === 0) break
      const action = actions[rng.int(actions.length)]!
      script.push(action)
      probe = reduceState(probe, action)
    }
    expect(script.length).toBeGreaterThan(50)

    const replay = (): TetrisState => {
      let state = createState(777, 'skilled')
      for (const action of script) state = reduceState(state, action)
      return state
    }
    const first = replay()
    const second = replay()
    expect(JSON.stringify(encodeState(first))).toBe(JSON.stringify(encodeState(second)))
    expect(first).toEqual(second)
    expect(first).toEqual(probe)
  })

  it('>=100 步随机合法动作：计数不漂移、棋盘始终合法、每步都能存档往返', () => {
    let state = createState(31337, 'challenging')
    const rng = createRng(4242)
    const spec = difficultyOf(state.difficulty)
    let lockedSeen = 0
    for (let step = 0; step < 150; step++) {
      // 不变式
      expect(state.board).toHaveLength(spec.cols * spec.rows)
      expect(state.board.every((cell) => cell === 0 || cell === 1)).toBe(true)
      expect(state.cursor).toBe(state.pieces + 1)
      // 定格那一拍里当前块已经并进棋盘（fits 必然为 false），此时状态固定是 playing
      const inHold = state.clearing !== null
      expect(fits(state.board, spec, state.piece) || statusOf(state) === 'lost' || inHold).toBe(true)
      const clearedRows = state.history.reduce((sum, entry) => sum + (entry.kind === 'lock' ? entry.cleared.length : 0), 0)
      // 撤销栈里记的"已填满行数" = 已经消掉的 + 正定格等着消的
      expect(clearedRows).toBe(state.lines + (state.clearing?.rows.length ?? 0))
      if (state.pieces > lockedSeen) lockedSeen = state.pieces

      const raw = encodeState(state)
      const decoded = decodeState(JSON.parse(JSON.stringify(raw)))
      expect(decoded).toEqual(state)

      const actions = legalActions(state)
      expect(actions.length).toBeGreaterThan(0)
      state = reduceState(state, pickPlayAction(rng, state))
    }
    expect(lockedSeen).toBeGreaterThan(0)
  })
})

describe('存档 encode / decode', () => {
  it('往返一致（含撤销栈）', () => {
    let state = createState(20261004, 'challenging')
    const rng = createRng(5)
    for (let step = 0; step < 40; step++) {
      const actions = legalActions(state).filter((action) => action.type === 'move')
      if (actions.length === 0) break
      state = reduceState(state, actions[rng.int(actions.length)]!)
    }
    const raw = encodeState(state)
    expect(decodeState(JSON.parse(JSON.stringify(raw)))).toEqual(state)
    expect(JSON.stringify(encodeState(decodeState(raw)))).toBe(JSON.stringify(raw))
    expect(raw.board).toHaveLength(10 * 16)
    expect(raw.history.length).toBeGreaterThan(0)
  })

  it('缺 history 字段的老存档按空栈处理，不判损坏', () => {
    const raw = encodeState(createState(11, 'starter')) as unknown as Record<string, unknown>
    delete raw.history
    const decoded = decodeState(raw)
    expect(decoded.history).toEqual([])
    expect(decoded.piece.id).toBe(pieceAt(11, 0))
    expect(() => reduceState(decoded, { type: 'undo' })).toThrow(IllegalActionError)
  })

  it('坏数据一律拒绝', () => {
    const good = encodeState(createState(20261004, 'starter')) as unknown as Record<string, unknown>
    const cases: Array<[string, unknown]> = [
      ['不是对象', 42],
      ['数组', []],
      ['null', null],
      ['难度未知', { ...good, difficulty: 'nope' }],
      ['seed 为负', { ...good, seed: -1 }],
      ['cursor 为 0', { ...good, cursor: 0 }],
      ['cursor 与已固化块数不匹配', { ...good, cursor: 9 }],
      ['棋盘长度不对', { ...good, board: [0, 1, 0] }],
      ['棋盘里有非法值', { ...good, board: good.board instanceof Array ? [2, ...good.board.slice(1)] : [] }],
      ['方块形状未知', { ...good, piece: { id: 'Q', row: 0, col: 3, rot: 0 } }],
      ['方块朝向非法', { ...good, piece: { id: 'T', row: 0, col: 3, rot: 9 } }],
      ['方块整体在棋盘外', { ...good, piece: { id: 'T', row: 99, col: 3, rot: 0 } }],
      ['方块与 seed 序列不符', { ...good, piece: { id: pieceAt(20261004, 0) === 'T' ? 'L' : 'T', row: 0, col: 3, rot: 0 } }],
      ['history 不是数组', { ...good, history: { kind: 'piece' } }],
      ['history 项类型未知', { ...good, history: [{ kind: 'nope', piece: { id: 'T', row: 0, col: 3, rot: 0 } }] }],
      [
        'history 里的行号越界',
        {
          ...good,
          history: [
            { kind: 'lock', piece: { id: 'T', row: 0, col: 3, rot: 0 }, cursor: 1, score: 0, lines: 0, pieces: 0, cleared: [99] },
          ],
        },
      ],
      [
        'history 里消掉的行重复',
        {
          ...good,
          history: [
            { kind: 'lock', piece: { id: 'T', row: 0, col: 3, rot: 0 }, cursor: 1, score: 0, lines: 0, pieces: 0, cleared: [3, 3] },
          ],
        },
      ],
      [
        'history 里消掉的行超过 4 行',
        {
          ...good,
          history: [
            {
              kind: 'lock',
              piece: { id: 'T', row: 0, col: 3, rot: 0 },
              cursor: 1,
              score: 0,
              lines: 5,
              pieces: 0,
              cleared: [0, 1, 2, 3, 4].slice(0, MAX_LINE_CLEAR + 1),
            },
          ],
        },
      ],
    ]
    for (const [name, value] of cases) {
      expect(() => decodeState(value), name).toThrow(IllegalActionError)
    }
  })

  it('decode 接受「方块探出井口」的合法局面（竖直 I 贴左墙）', () => {
    const seed = seedWithPiece(0, 'I')
    const state = manual(emptyBoard(COLS, ROWS), { id: 'I', row: 5, col: -2, rot: 1 }, { seed })
    const decoded = decodeState(JSON.parse(JSON.stringify(encodeState(state))))
    expect(decoded.piece).toEqual({ id: 'I', row: 5, col: -2, rot: 1 })
    expect(decoded).toEqual(state)
  })
})
