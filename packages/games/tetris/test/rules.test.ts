/**
 * 规则层测试。重点覆盖验收点名的边界：
 *   - 确定性：同 seed + 同动作序列 → 完全同状态（7-bag 出块序列由 seed 复算，不碰 Math.random）；
 *   - 离散步进：唯一的下落来源是「落」这个动作，规则层里没有任何定时器；
 *   - 固化 / 消行 / 计分 / 等级；
 *   - 胜负：堆到顶部即 lost，且除撤销/重开外一律拒绝；
 *   - 撤销：逆操作回退（棋盘、当前块、出块游标、分数、消行全部一致回退），无历史时抛错；
 *   - 存档：encode/decode 严格往返，坏数据一律拒绝，缺 history 按空栈。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { IllegalActionError, createRng, type MoveDir, type Rng } from '@eink/core'
import { ALL_PIECES, cellsOf, type PieceId } from '../src/pieces.js'
import {
  CELL_FILLED,
  DIFFICULTIES,
  LINE_SCORES,
  LINES_PER_LEVEL,
  MAX_LINE_CLEAR,
  bagAt,
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

/** 让方块一路下落直到固化（0 次或多次下落；最多 rows 次以内必然固化） */
function dropUntilLocked(state: TetrisState): TetrisState {
  let current = state
  for (let step = 0; step <= ROWS; step++) {
    const before = current
    current = reduceState(current, { type: 'move', dir: 'down' })
    if (current.pieces > before.pieces) return current
  }
  throw new Error('piece never locked')
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

  it('源码里没有定时器与 Math.random / Date.now（墨水屏不能有自动下落）', () => {
    for (const name of ['rules.ts', 'view.ts', 'index.ts', 'pieces.ts']) {
      const text = readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8')
      const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
      expect(code, name).not.toMatch(/setInterval|setTimeout|requestAnimationFrame/)
      expect(code, name).not.toMatch(/Math\.random|Date\.now/)
    }
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
  it('按一次「落」走一格', () => {
    const state = createState(20261004, 'starter')
    const down = reduceState(state, { type: 'move', dir: 'down' })
    expect(down.piece.row).toBe(state.piece.row + 1)
    expect(down.piece.id).toBe(state.piece.id)
    expect(down.pieces).toBe(0)
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
      if (actions.length === 0) break
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
      expect(fits(state.board, spec, state.piece) || statusOf(state) === 'lost').toBe(true)
      const clearedRows = state.history.reduce((sum, entry) => sum + (entry.kind === 'lock' ? entry.cleared.length : 0), 0)
      expect(clearedRows).toBe(state.lines)
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
