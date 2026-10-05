/**
 * GameDef 外壳集成测试：view / controls / encode / decode / i18n / 元信息。
 *
 * 重点：
 *   - 1-bit 呈现约定（汉字字形、河界分组线、选中反白、最后一手加粗放大、不靠灰阶）；
 *   - `encode`/`decode` 严格往返，坏数据一律抛 IllegalActionError
 *     （项目曾因「decode 拒绝游戏自己产生的状态」出过事故，属性测试是第一道闸门）；
 *   - ≥100 步随机合法动作不崩、不漂移。
 */
import { describe, expect, it } from 'vitest'
import {
  IllegalActionError,
  baseKeys,
  compareDicts,
  coreDictEn,
  coreDictZh,
  createI18n,
  createRng,
  type Dict,
} from '@eink/core'
import {
  BLACK,
  CELLS,
  DIFFICULTY_IDS,
  EMPTY,
  RED,
  buildBoard,
  buildControls,
  buildStats,
  cellGlyphAt,
  cellKindAt,
  countPieces,
  createInitialBoard,
  encodeState,
  gameStatus,
  legalActions,
  legalMoves,
  moveTo,
  moveFrom,
  packMove,
  reduceXiangqi,
  xiangqiEn,
  xiangqiGame,
  xiangqiZh,
  type XiangqiState,
} from '../src/index.js'
import { CELL_LABEL_KEYS } from '../src/view.js'
import {
  at,
  blankBoard,
  boardOf,
  destsOf,
  makePiece,
  movesOf,
  positionState,
  stateOf,
  settle,
} from './helpers.js'

const zh: Dict = { ...coreDictZh, ...xiangqiZh }
const en: Dict = { ...coreDictEn, ...xiangqiEn }
const i18nZh = createI18n('zh-CN', { 'zh-CN': zh, 'en-US': en })
const i18nEn = createI18n('en-US', { 'zh-CN': zh, 'en-US': en })

function fresh(difficulty = 'starter'): XiangqiState {
  return xiangqiGame.create(20240607, difficulty)
}

/** 走 n 手（每手都取当前第一个合法着法），得到真实的中盘状态 */
function advance(state: XiangqiState, plies: number): XiangqiState {
  let current = state
  let played = 0
  let guard = 0
  while (played < plies && guard++ < 1000) {
    // 先推进到落定：AI 应手是两拍（先选中棋子、500ms 后落子），settle 会发完该发的 tick
    current = settle(current)
    const move = legalActions(current).find(
      (action): action is { type: 'move'; from: number; to: number } => action.type === 'move',
    )
    if (!move) break
    current = reduceXiangqi(current, move)
    played++
  }
  // 收尾也推进到落定，保证返回的不会是「AI 正在挑子」的中间态
  current = settle(current)
  return current
}

/** 用固定种子的随机策略走若干步（动作从 legal() 里等概率取，含 select/undo/restart） */
function walkRandom(state: XiangqiState, steps: number, seed: number): XiangqiState[] {
  const rng = createRng(seed)
  const trail: XiangqiState[] = [state]
  let current = state
  for (let step = 0; step < steps; step++) {
    const actions = legalActions(current)
    const action = actions[rng.int(actions.length)]
    if (!action) break
    current = reduceXiangqi(current, action)
    trail.push(current)
  }
  return trail
}

describe('view / 1-bit 呈现约定', () => {
  it('9×10 棋盘、90 格、行优先索引，河界用 5 行一组的粗线表达', () => {
    const view = xiangqiGame.view(fresh())
    expect(view.board).not.toBeNull()
    expect(view.board!.kind).toBe('grid')
    expect(view.board!.cols).toBe(9)
    expect(view.board!.rows).toBe(10)
    expect(view.board!.cells).toHaveLength(CELLS)
    view.board!.cells.forEach((cell, index) => expect(cell.index).toBe(index))
    // 河界：5 行一组 → 壳层只在行 4/5 之间画粗线；列方向按整宽分组，不会多出竖线
    expect(view.board!.groups).toEqual({ cols: 9, rows: 5 })
  })

  it('棋子用汉字字形 + 圆片底色（红：帅仕相马车炮兵／白底 / 黑：将士象马车炮卒／黑底）', () => {
    const state = advance(fresh(), 6)
    const cells = xiangqiGame.view(state).board!.cells
    // 红黑靠**圆片底色**区分（用户指定）：红=白底黑字双边框（disc: light），
    // 黑=黑底白字粗边框（disc: dark）。马/车/炮两方同字，全靠这个底色分。
    const redGlyphs = new Set(['帅', '仕', '相', '马', '车', '炮', '兵'])
    const blackGlyphs = new Set(['将', '士', '象', '马', '车', '炮', '卒'])
    let redCount = 0
    let blackCount = 0
    for (let index = 0; index < CELLS; index++) {
      const piece = state.board[index] as number
      if (piece === EMPTY) {
        expect(['empty', 'goal']).toContain(cells[index]!.kind)
        expect(cells[index]!.glyph).toBe('')
        expect(cells[index]!.disc).toBeUndefined()
        continue
      }
      const glyph = cells[index]!.glyph
      expect(glyph).toBe(cellGlyphAt(state, index))
      if ((piece >> 3) & 1) {
        expect(blackGlyphs, `黑子字形 ${glyph}`).toContain(glyph)
        expect(cells[index]!.disc, `黑子 ${glyph} 的底色`).toBe('dark')
        blackCount++
      } else {
        expect(redGlyphs, `红子字形 ${glyph}`).toContain(glyph)
        expect(cells[index]!.disc, `红子 ${glyph} 的底色`).toBe('light')
        redCount++
      }
    }
    expect(redCount).toBe(countPieces(state.board, 0))
    expect(blackCount).toBe(countPieces(state.board, 1))
    // 底色是区分红黑的唯一手段，必须整盘一致：不存在"没底色的棋子"
    expect(cells.every((cell) => cell.glyph === '' || cell.disc !== undefined)).toBe(true)
    // 帅/将、仕/士、相/象、兵/卒 本来就是不同字（多一重区分）
    const pairs: ReadonlyArray<readonly [string, string]> = [
      ['帅', '将'],
      ['仕', '士'],
      ['相', '象'],
      ['兵', '卒'],
    ]
    for (const [red, black] of pairs) {
      expect(redGlyphs.has(red), `红方缺字形 ${red}`).toBe(true)
      expect(blackGlyphs.has(black), `黑方缺字形 ${black}`).toBe(true)
    }
    // 马/车/炮 两方同字是**有意的**（用户指定靠底色区分）—— 把这条约定钉住，
    // 免得以后有人"顺手"把它们改成不同字
    // 用集合比较（不依赖码位排序）
    expect(new Set([...redGlyphs].filter((glyph) => blackGlyphs.has(glyph)))).toEqual(new Set(['马', '车', '炮']))
  })

  it('吃子盘：被吃的子按兵种顺序排成一行（红方战果在下、黑方战果在上）', () => {
    // 开局：两边都还没吃到子，但**字段要在**（壳层靠它常驻高度，避免布局跳动）
    const opening = xiangqiGame.view(fresh())
    expect(opening.captured).toEqual({ top: '', bottom: '' })

    // 拿掉黑方的 车(0,0)、炮(2,1)、两个卒(3,0)(3,2) —— 相当于红方吃掉的
    const board = createInitialBoard()
    for (const index of [at(0, 0), at(2, 1), at(3, 0), at(3, 2)]) board[index] = EMPTY
    // 再拿掉红方一个马(9,1) —— 相当于黑方吃掉的
    board[at(9, 1)] = EMPTY
    const view = xiangqiGame.view(positionState(board))
    // 兵种顺序按 帅仕相马车炮兵（黑方对应 将士象马车炮卒）：车 → 炮 → 卒
    expect(view.captured!.bottom).toBe('车炮卒卒')
    expect(view.captured!.top).toBe('马')
  })

  it('双方各自的最后一手都标出来，并用方号区分红黑（起点/终点都不放大字号）', () => {
    const state = advance(fresh(), 4)
    expect(state.history.length).toBeGreaterThan(0)
    const board = xiangqiGame.view(state).board!
    const lastTurn = state.history[state.history.length - 1]!
    expect(lastTurn.black, '这一局应当已经应过手').not.toBeNull()
    const redFrom = moveFrom(lastTurn.red)
    const redTo = moveTo(lastTurn.red)
    const blackFrom = moveFrom(lastTurn.black!)
    const blackTo = moveTo(lastTurn.black!)

    // 方号：0 = 红、1 = 黑（壳层据此换形状，不靠颜色）
    expect(board.cells[redFrom]!.lastFrom).toBe(0)
    expect(board.cells[redTo]!.lastTo).toBe(0)
    expect(board.cells[blackFrom]!.lastFrom).toBe(1)
    expect(board.cells[blackTo]!.lastTo).toBe(1)

    // 红黑各一个起点、各一个终点（同格冲突时黑方——更近的一手——胜出，故用集合比）
    const marks = (side: 0 | 1, field: 'lastFrom' | 'lastTo') =>
      new Set(board.cells.filter((cell) => cell[field] === side).map((cell) => cell.index))
    expect(marks(0, 'lastFrom')).toEqual(new Set([redFrom]))
    expect(marks(0, 'lastTo')).toEqual(new Set([redTo]))
    expect(marks(1, 'lastFrom')).toEqual(new Set([blackFrom]))
    expect(marks(1, 'lastTo')).toEqual(new Set([blackTo]))

    // 关键：任何一格都不会同时挂着红黑两个终点框（值是单值字段，后写者胜）
    expect(board.cells.filter((cell) => cell.lastTo !== undefined).length).toBeLessThanOrEqual(2)

    // 不放大：走完的棋子仍是普通棋子，全盘没有 textScale
    expect(board.cells.every((cell) => cell.textScale === undefined)).toBe(true)
    expect(board.cells.some((cell) => cell.kind === 'given')).toBe(false)
    expect(board.cells.every((cell) => cell.selected === undefined)).toBe(true)
    expect(cellKindAt(state, redTo)).toBe('tile')
    expect(cellGlyphAt(state, redTo)).not.toBe('')
  })

  it('选中：自己的子反白，空落点画圆环（goal），可吃的敌子反白', () => {
    const board = blankBoard()
    board[at(4, 4)] = makePiece(RED, 5) // 红车
    board[at(4, 7)] = makePiece(BLACK, 7) // 可吃的黑卒
    board[at(6, 4)] = makePiece(RED, 7) // 己方子：不能吃
    board[at(9, 4)] = makePiece(RED, 1)
    board[at(0, 3)] = makePiece(BLACK, 1)
    const state = positionState(board, { selected: at(4, 4) })
    const view = xiangqiGame.view(state).board!
    const targets = destsOf(board, RED, at(4, 4))
    expect(targets.length).toBeGreaterThan(0)
    expect(view.cells[at(4, 4)]!.selected).toBe(true)
    expect(view.cells[at(4, 7)]!.selected).toBe(true) // 吃子目标：保留字形 + 反白
    expect(view.cells[at(4, 7)]!.glyph).toBe('卒')
    for (const to of targets) {
      if (to === at(4, 7)) continue
      expect(view.cells[to]!.kind, `落点 ${to}`).toBe('goal')
      expect(view.cells[to]!.glyph).toBe('')
    }
    // 非法落点是普通空格（吃子线后面的格子走不到），己方子不能被标成目标
    expect(view.cells[at(4, 8)]!.kind).toBe('empty')
    expect(view.cells[at(4, 6)]!.kind).toBe('goal')
    expect(view.cells[at(6, 4)]!.kind).toBe('tile')
    expect(view.cells[at(6, 4)]!.selected).toBeUndefined()
    // 非选中子的落点不会被误标
    expect(view.cells[at(8, 0)]!.kind).toBe('empty')
    expect(buildBoard(state).cells[at(4, 4)]!.selected).toBe(true)
  })

  it('没选中 / 非红方回合 / 终局时不显示任何落点提示', () => {
    const state = advance(fresh(), 2)
    expect(xiangqiGame.view(state).board!.cells.some((cell) => cell.kind === 'goal')).toBe(false)
    const board = blankBoard()
    board[at(9, 4)] = makePiece(RED, 1)
    board[at(0, 3)] = makePiece(BLACK, 1)
    board[at(4, 4)] = makePiece(RED, 5)
    // 选中一颗子，但盘面已经是终局（红方被将死）→ 不提示
    const mated = positionState(boardOf([
      '...k.....',
      '.........',
      '.........',
      '.........',
      '.........',
      '.........',
      '.........',
      '.........',
      '.....r...',
      'r...K....',
    ]))
    expect(xiangqiGame.view(mated).board!.cells.some((cell) => cell.kind === 'goal')).toBe(false)
    expect(xiangqiGame.view(positionState(board, { selected: at(4, 4) })).board!.cells.some((c) => c.kind === 'goal')).toBe(true)
  })

  it('stats 恰好三项：红子 / 黑子 / 步数', () => {
    const state = advance(fresh(), 5)
    expect(xiangqiGame.view(state).stats).toEqual([
      { labelKey: 'xiangqi.stat.red', value: String(countPieces(state.board, 0)) },
      { labelKey: 'xiangqi.stat.black', value: String(countPieces(state.board, 1)) },
      { labelKey: 'xiangqi.stat.moves', value: String(state.moves) },
    ])
    expect(buildStats(state)).toHaveLength(3)
  })

  it('进行中没有结果也没有提示', () => {
    const view = xiangqiGame.view(fresh())
    expect(view.result).toBeNull()
    expect(view.notice).toBeNull()
  })

  it('被将军时给一句稳定文字提示', () => {
    const board = blankBoard()
    board[at(9, 4)] = makePiece(RED, 1)
    board[at(0, 4)] = makePiece(BLACK, 5)
    board[at(0, 0)] = makePiece(BLACK, 1)
    const state = positionState(board)
    expect(xiangqiGame.view(state).notice).toEqual({ textKey: 'xiangqi.notice.check' })
  })

  it('红方将死黑方：标题写赢，明细带步数与「将死」', () => {
    // 红车 (1,7) 走到 (0,7) 即成杀：黑将 (0,4) 被吊在行 0，(1,4) 也被 (1,0) 的车封住
    const board = boardOf([
      '...a.k...',
      'R......R.',
      '.........',
      '.........',
      '.........',
      '.........',
      '.........',
      '.........',
      '.........',
      '...K.....',
    ])
    const state = positionState(board)
    const over = reduceXiangqi(state, { type: 'move', from: at(1, 7), to: at(0, 7) })
    expect(gameStatus(over)).toBe('won')
    // 黑方被将死 → 不再应手
    expect(over.history[0]!.black).toBeNull()
    expect(over.sideToMove).toBe(BLACK)
    const result = xiangqiGame.view(over).result!
    expect(result.titleKey).toBe('xiangqi.won.title')
    expect(result.details).toEqual([
      { key: 'xiangqi.result.moves', params: { count: 1 } },
      { key: 'xiangqi.result.checkmate' },
    ])
  })

  it('红方被困毙：标题写输，明细写「困毙」', () => {
    const board = boardOf([
      '...k.....',
      '.........',
      '.........',
      '.........',
      '.........',
      '.........',
      '.........',
      '.....r...',
      '...r.....',
      '....K....',
    ])
    const state = positionState(board)
    const result = xiangqiGame.view(state).result!
    expect(gameStatus(state)).toBe('lost')
    expect(result.titleKey).toBe('xiangqi.lost.title')
    expect(result.details).toEqual([
      { key: 'xiangqi.result.moves', params: { count: 0 } },
      { key: 'xiangqi.result.stalemate' },
    ])
  })

  it('三次重复判和：标题如实写和棋，并带一条「同一局面出现三次」的明细', () => {
    const loop = [
      { red: packMove(at(9, 0), at(8, 0)), black: packMove(at(0, 0), at(1, 0)) },
      { red: packMove(at(8, 0), at(9, 0)), black: packMove(at(1, 0), at(0, 0)) },
      { red: packMove(at(9, 0), at(8, 0)), black: packMove(at(0, 0), at(1, 0)) },
      { red: packMove(at(8, 0), at(9, 0)), black: packMove(at(1, 0), at(0, 0)) },
    ]
    const state = stateOf(loop)
    const view = xiangqiGame.view(state)
    expect(xiangqiGame.status(state)).toBe('won') // 和棋并入 won，壳层才会渲染结果面板
    expect(view.result!.titleKey).toBe('xiangqi.draw.title')
    expect(view.result!.details).toEqual([
      { key: 'xiangqi.result.moves', params: { count: 4 } },
      { key: 'xiangqi.result.repetition' },
    ])
  })
})

describe('controls / controlAction', () => {
  it('只声明撤销（重开由壳层渲染），没有历史时禁用', () => {
    const state = fresh()
    const controls = xiangqiGame.controls(state)
    expect(controls).toHaveLength(1)
    const undo = controls[0]!
    expect(undo.id).toBe('undo')
    expect(undo.role).toBe('action')
    expect(undo.labelKey).toBe('shell.game.undo')
    expect(undo.enabled).toBe(false)
    expect(controls.some((control) => control.id === 'restart')).toBe(false)
    expect(controls.some((control) => control.role === 'dpad')).toBe(false)

    const played = reduceXiangqi(state, { type: 'move', from: at(9, 0), to: at(8, 0) })
    expect(buildControls(played)[0]!.enabled).toBe(true)
  })

  it('controlAction 把按钮映射成动作，未知 id 返回 null', () => {
    const state = fresh()
    expect(xiangqiGame.controlAction!(state, 'undo')).toEqual({ type: 'undo' })
    expect(xiangqiGame.controlAction!(state, 'restart')).toEqual({ type: 'restart' })
    expect(xiangqiGame.controlAction!(state, 'next-level')).toBeNull()
  })

  it('壳层直接派发的 undo / restart 都被接受', () => {
    const played = reduceXiangqi(fresh(), { type: 'move', from: at(9, 0), to: at(8, 0) })
    expect(encodeState(reduceXiangqi(played, { type: 'undo' }))).toEqual(encodeState(fresh()))
    expect(encodeState(reduceXiangqi(played, { type: 'restart' }))).toEqual(encodeState(fresh()))
  })
})

describe('encode / decode', () => {
  it('初始局面往返一致（含 JSON 往返）', () => {
    const state = fresh()
    expect(xiangqiGame.decode(xiangqiGame.encode(state))).toEqual(state)
    expect(xiangqiGame.decode(JSON.parse(JSON.stringify(xiangqiGame.encode(state))))).toEqual(state)
  })

  it('中盘状态（含回合日志）往返一致，且解码后还能继续走', () => {
    const state = advance(fresh('skilled'), 8)
    expect(state.history).toHaveLength(8)
    expect(gameStatus(state)).toBe('playing')
    const decoded = xiangqiGame.decode(xiangqiGame.encode(state))
    expect(decoded).toEqual(state)
    expect(xiangqiGame.encode(decoded)).toEqual(xiangqiGame.encode(state))

    const move = legalActions(decoded).find(
      (action): action is { type: 'move'; from: number; to: number } => action.type === 'move',
    )!
    expect(encodeState(reduceXiangqi(decoded, move))).toEqual(encodeState(reduceXiangqi(state, move)))
  })

  it('带选中态的状态也能往返（选中是界面状态，但存档必须自洽）', () => {
    const played = advance(fresh(), 2)
    const selected = reduceXiangqi(played, { type: 'select', index: at(9, 1) })
    const decoded = xiangqiGame.decode(JSON.parse(JSON.stringify(xiangqiGame.encode(selected))))
    expect(decoded).toEqual(selected)
    expect(decoded.selected).toBe(at(9, 1))
    // 撤销之后 selection 也许已经失效 —— 那份状态同样必须能被自己接受
    const undone = reduceXiangqi(decoded, { type: 'undo' })
    expect(xiangqiGame.decode(xiangqiGame.encode(undone))).toEqual(undone)
    expect(xiangqiGame.decode(xiangqiGame.encode(played))).toEqual(played)
  })

  it('终局与和棋状态往返一致，结果页文案也一致', () => {
    const drawn = stateOf([
      { red: packMove(at(9, 0), at(8, 0)), black: packMove(at(0, 0), at(1, 0)) },
      { red: packMove(at(8, 0), at(9, 0)), black: packMove(at(1, 0), at(0, 0)) },
      { red: packMove(at(9, 0), at(8, 0)), black: packMove(at(0, 0), at(1, 0)) },
      { red: packMove(at(8, 0), at(9, 0)), black: packMove(at(1, 0), at(0, 0)) },
    ])
    const decoded = xiangqiGame.decode(xiangqiGame.encode(drawn))
    expect(decoded).toEqual(drawn)
    expect(xiangqiGame.encode(decoded)).toEqual(xiangqiGame.encode(drawn))
    expect(xiangqiGame.view(decoded).result).toEqual(xiangqiGame.view(drawn).result)
    expect(xiangqiGame.status(decoded)).toBe(xiangqiGame.status(drawn))
  })

  /**
   * 属性测试：随机执行若干「合法动作」（move / select / undo / restart）后，
   * encode→decode 必须往返一致，且解码出来的状态可以继续对局。
   * 这条用例专门盯住「decode 拒绝游戏自己产生的状态」这类事故。
   */
  it('属性：随机合法动作序列的任意一步都能 encode→decode 往返一致', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      // 挑战档每手都要跑一次 3 层搜索，步数少一些（耗时而非正确性的取舍）
      const steps = difficulty === 'challenging' ? 12 : 40
      for (const seed of [11, 21]) {
        const trail = walkRandom(xiangqiGame.create(seed, difficulty), steps, seed * 31 + 7)
        expect(trail.length).toBeGreaterThan(8)
        for (const state of trail) {
          const raw = xiangqiGame.encode(state)
          const decoded = xiangqiGame.decode(JSON.parse(JSON.stringify(raw)))
          expect(decoded, `${difficulty} seed=${seed} moves=${state.moves}`).toEqual(state)
          expect(xiangqiGame.encode(decoded)).toEqual(raw)
        }
        // 解码后的状态继续对局：与原始状态分头走同样的玩家动作，结果必须一致
        let restored = xiangqiGame.decode(xiangqiGame.encode(trail[trail.length - 1]!))
        let original = trail[trail.length - 1]!
        const rng = createRng(seed)
        for (let step = 0; step < 6 && gameStatus(original) === 'playing'; step++) {
          // AI 待应手（两拍：先选中再落子）：两个状态一起推进到落定
          if (original.sideToMove !== RED) {
            restored = settle(restored)
            original = settle(original)
            expect(xiangqiGame.encode(restored)).toEqual(xiangqiGame.encode(original))
            continue
          }
          const moves = legalMoves(original.board, RED)
          if (moves.length === 0) break
          const move = moves[rng.int(moves.length)] as number
          const action = { type: 'move' as const, from: move & 0x7f, to: (move >> 7) & 0x7f }
          restored = reduceXiangqi(restored, action)
          original = reduceXiangqi(original, action)
          expect(xiangqiGame.encode(restored)).toEqual(xiangqiGame.encode(original))
        }
      }
    }
  })

  it('≥100 步随机合法动作：不崩、不漂移，每一步都能往返一致', () => {
    let state = xiangqiGame.create(4242, 'starter')
    const trail = walkRandom(state, 140, 99)
    expect(trail.length).toBeGreaterThanOrEqual(120)
    let moveActions = 0
    for (const current of trail) {
      const raw = xiangqiGame.encode(current)
      const decoded = xiangqiGame.decode(raw)
      expect(xiangqiGame.encode(decoded)).toEqual(raw)
      // 计数不变量：日志长度 == 步数，游标 == 黑方应手数，步数不会倒退
      expect(current.history.length).toBe(current.moves)
      expect(current.rngCursor).toBe(current.history.filter((turn) => turn.black !== null).length)
      expect(current.rngCursor).toBeLessThanOrEqual(current.moves)
      // 盘面与日志重放一致（decode 会复核，这里再确认一次红子数单调不增）
      const redCount = countPieces(current.board, RED)
      expect(redCount).toBeLessThanOrEqual(16)
      expect(countPieces(current.board, BLACK)).toBeLessThanOrEqual(16)
      // 双方将帅始终都在盘上（将不会被吃掉）
      expect(current.board.filter((piece) => piece === makePiece(RED, 1))).toHaveLength(1)
      expect(current.board.filter((piece) => piece === makePiece(BLACK, 1))).toHaveLength(1)
    }
    for (const action of trail.flatMap((item) => legalActions(item))) {
      if (action.type === 'move') moveActions++
    }
    expect(moveActions).toBeGreaterThan(0)
    state = trail[trail.length - 1]!
    expect(gameStatus(state)).toBe(gameStatus(state))
  })

  it('同一动作序列重放得到同一局面（双端一致），encode 也逐字节稳定', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      const script: Array<{ type: 'move'; from: number; to: number } | { type: 'tick' }> = []
      let state = xiangqiGame.create(7, difficulty)
      const rng = createRng(7)
      for (let step = 0; step < 10 && gameStatus(state) === 'playing'; step++) {
        // AI 待应手（两拍）：脚本里把该发的 tick 都记下来，重放才一致
        if (state.sideToMove !== RED) {
          let guard = 0
          while (guard++ < 8) {
            const tick = legalActions(state).find((action) => action.type === 'tick')
            if (!tick) break
            script.push({ type: 'tick' })
            state = reduceXiangqi(state, tick)
          }
          continue
        }
        const moves = legalMoves(state.board, RED)
        if (moves.length === 0) break
        const move = moves[rng.int(moves.length)] as number
        const action = { type: 'move' as const, from: move & 0x7f, to: (move >> 7) & 0x7f }
        script.push(action)
        state = reduceXiangqi(state, action)
      }
      let replay = xiangqiGame.create(7, difficulty)
      for (const action of script) replay = reduceXiangqi(replay, action)
      expect(xiangqiGame.encode(replay)).toEqual(xiangqiGame.encode(state))
      expect(xiangqiGame.decode(JSON.parse(JSON.stringify(xiangqiGame.encode(state))))).toEqual(state)
    }
  })

  it('坏数据一律抛 IllegalActionError', () => {
    const state = advance(fresh(), 3)
    const raw = xiangqiGame.encode(state) as {
      board: number[]
      sideToMove: string
      history: Array<Record<string, unknown>>
      lastMove: number | null
      selected: number | null
    }
    const bad: unknown[] = [
      null,
      undefined,
      42,
      'state',
      [],
      {},
      { ...raw, difficulty: 'impossible' },
      { ...raw, difficulty: undefined },
      // 错种子：负数 / 小数 / 超过 uint32
      { ...raw, seed: -1 },
      { ...raw, seed: 1.5 },
      { ...raw, seed: 0x1_0000_0000 },
      { ...raw, seed: '7' },
      // 错日志长度
      { ...raw, moves: raw.history.length + 1 },
      { ...raw, moves: raw.history.length - 1 },
      { ...raw, moves: -1 },
      { ...raw, moves: 1.5 },
      { ...raw, history: 'nope' },
      { ...raw, history: raw.history.slice(1) },
      { ...raw, history: [...raw.history, { red: 0, black: null }] },
      { ...raw, rngCursor: -1 },
      { ...raw, rngCursor: 99 },
      // 乱改字段
      { ...raw, sideToMove: 'green' },
      { ...raw, sideToMove: 'black' },
      { ...raw, board: 'nope' },
      { ...raw, board: raw.board.slice(0, CELLS - 1) },
      { ...raw, board: [...raw.board, EMPTY] },
      { ...raw, board: raw.board.map((cell, index) => (index === 0 ? 8 : cell)) }, // 8 不是合法棋子编码
      { ...raw, board: raw.board.map((cell, index) => (index === 0 ? 99 : cell)) },
      { ...raw, lastMove: CELLS + 1 },
      { ...raw, lastMove: raw.lastMove === 7 ? 8 : 7 },
      { ...raw, lastMove: packMove(3, 3) }, // 原地不动的「着法」
      { ...raw, selected: CELLS },
      { ...raw, selected: 1.5 },
      // 盘面被手改：多塞一颗红兵
      (() => {
        const board = raw.board.slice()
        const empty = board.indexOf(EMPTY)
        board[empty] = makePiece(RED, 7)
        return { ...raw, board }
      })(),
      // 回合日志里红方着法非法（马走田）
      {
        ...raw,
        history: raw.history.map((entry, index) =>
          index === 0 ? { ...entry, red: packMove(at(9, 1), at(7, 3)) } : entry,
        ),
      },
      // 回合日志里黑方着法非法（红方的子）
      {
        ...raw,
        history: raw.history.map((entry, index) =>
          index === 0 ? { ...entry, black: packMove(at(9, 0), at(8, 0)) } : entry,
        ),
      },
      // 回合日志条目不是对象 / 字段缺失
      { ...raw, history: raw.history.map((entry, index) => (index === 0 ? 7 : entry)) },
      { ...raw, history: raw.history.map((entry, index) => (index === 0 ? {} : entry)) },
      { ...raw, history: raw.history.map((entry, index) => (index === 0 ? { ...entry, red: undefined } : entry)) },
      // 被篡改成「红方已经将死黑方之后黑方还应手」的日志
      (() => {
        const turns = raw.history.map((entry) => ({
          red: Number(entry.red),
          black: entry.black === null || entry.black === undefined ? null : Number(entry.black),
        }))
        // 最后再加一回合：红方走完后黑方本来不该应手（用同一手重复构造一个终局日志）
        turns.push({ red: packMove(at(9, 0), at(8, 0)), black: packMove(at(0, 0), at(1, 0)) })
        return { ...raw, history: turns, moves: turns.length, rngCursor: turns.length }
      })(),
    ]
    for (const candidate of bad) {
      expect(() => xiangqiGame.decode(candidate), JSON.stringify(candidate)?.slice(0, 120)).toThrow(
        IllegalActionError,
      )
    }
  })

  it('被篡改成「三次重复判和之后还继续走」的日志会被拒绝', () => {
    const loop = [
      { red: packMove(at(9, 0), at(8, 0)), black: packMove(at(0, 0), at(1, 0)) },
      { red: packMove(at(8, 0), at(9, 0)), black: packMove(at(1, 0), at(0, 0)) },
      { red: packMove(at(9, 0), at(8, 0)), black: packMove(at(0, 0), at(1, 0)) },
      // 第 4 回合黑方应手后回到初始局面（第三次）→ 判和，对局结束
      { red: packMove(at(8, 0), at(9, 0)), black: packMove(at(1, 0), at(0, 0)) },
    ]
    const drawn = stateOf(loop)
    expect(gameStatus(drawn)).toBe('won')
    const raw = xiangqiGame.encode(drawn) as { history: Array<{ red: number; black: number | null }> }
    // 和棋之后再下一手 → 拒绝
    const extra = {
      ...(xiangqiGame.encode(drawn) as Record<string, unknown>),
      history: [...raw.history, { red: packMove(at(9, 0), at(8, 0)), black: null }],
      moves: raw.history.length + 1,
    }
    expect(() => xiangqiGame.decode(extra)).toThrow(IllegalActionError)
  })

  it('被篡改成「红方应手之后黑方也走了同一手」的日志会被拒绝（同色走两手）', () => {
    const state = advance(fresh(), 2)
    const raw = xiangqiGame.encode(state) as { history: Array<{ red: number; black: number | null }> }
    const tampered = {
      ...(xiangqiGame.encode(state) as Record<string, unknown>),
      history: raw.history.map((turn, index) => (index === 1 ? { ...turn, black: turn.red } : turn)),
    }
    expect(() => xiangqiGame.decode(tampered)).toThrow(IllegalActionError)
  })
})

describe('元信息与注册表接口', () => {
  it('GameDef 元信息符合契约', () => {
    expect(xiangqiGame.id).toBe('xiangqi')
    expect(xiangqiGame.i18nNamespace).toBe('xiangqi')
    expect(xiangqiGame.rulesVersion).toBeGreaterThanOrEqual(1)
    expect(xiangqiGame.contentVersion).toBeGreaterThanOrEqual(1)
    expect(xiangqiGame.illegalNoticeKey).toBe('xiangqi.illegal.notice')
    expect(xiangqiGame.difficulties.map((item) => item.id)).toEqual([...DIFFICULTY_IDS])
    expect(xiangqiGame.difficulties.map((item) => item.labelKey)).toEqual([
      'xiangqi.difficulty.starter',
      'xiangqi.difficulty.skilled',
      'xiangqi.difficulty.challenging',
    ])
    // 声明了 tickMs：AI 落子前有延迟（450ms）。注意规则层仍然零时间引用 ——
    // 延时由壳层的会话计时器驱动，规则只在 tick 动作里落子。
    expect(typeof xiangqiGame.tickMs).toBe('function')
    expect(xiangqiGame.tickMs!(fresh(), 'starter')).toBeNull() // 轮到红方：不该步进
    // 无关卡玩法：不要声明 levels
    expect((xiangqiGame as { levels?: unknown }).levels).toBeUndefined()
  })

  it('contentId = 难度，movesOf = 玩家步数', () => {
    const state = advance(fresh(), 3)
    expect(xiangqiGame.contentId!(state)).toBe('starter')
    expect(xiangqiGame.movesOf!(state)).toBe(3)
    expect(xiangqiGame.contentId!(xiangqiGame.create(1, 'challenging'))).toBe('challenging')
  })

  it('create 对不同难度互不串味，未知难度被拒绝；开局完全一样', () => {
    expect(xiangqiGame.create(1, 'skilled').difficulty).toBe('skilled')
    expect(() => xiangqiGame.create(1, 'impossible')).toThrow(IllegalActionError)
    for (const difficulty of DIFFICULTY_IDS) {
      const state = xiangqiGame.create(5, difficulty)
      expect(state.difficulty).toBe(difficulty)
      expect(state.board).toEqual(createInitialBoard())
      expect(state.moves).toBe(0)
      expect(state.selected).toBeNull()
      expect(state.lastMove).toBeNull()
      // 开局双方各 44 种着法（与难度无关）
      expect(legalMoves(state.board, RED)).toHaveLength(44)
      expect(legalMoves(state.board, BLACK)).toHaveLength(44)
      expect(movesOf(state.board, RED)).toHaveLength(44)
    }
  })
})

describe('字典', () => {
  it('中英基础 key 集合完全一致，没有缺失/多余/复数不完整', () => {
    expect(compareDicts({ 'zh-CN': xiangqiZh, 'en-US': xiangqiEn })).toEqual([])
    expect([...baseKeys(xiangqiZh)].sort()).toEqual([...baseKeys(xiangqiEn)].sort())
  })

  it('壳层必需的 key 都定义了', () => {
    const keys = [
      'xiangqi.title',
      'xiangqi.rules.body',
      'xiangqi.rules.body2',
      'xiangqi.rules.body3',
      'xiangqi.rules.restart',
      'xiangqi.illegal.notice',
      'xiangqi.won.title',
      'xiangqi.lost.title',
      'xiangqi.draw.title',
      'xiangqi.notice.check',
      'xiangqi.stat.red',
      'xiangqi.stat.black',
      'xiangqi.stat.moves',
      'xiangqi.result.checkmate',
      'xiangqi.result.stalemate',
      'xiangqi.result.repetition',
      ...DIFFICULTY_IDS.map((id) => `xiangqi.difficulty.${id}`),
    ]
    for (const key of keys) {
      expect(zh[key], key).toBeDefined()
      expect(en[key], key).toBeDefined()
      expect(i18nZh.t(key), key).not.toContain('⟦')
      expect(i18nEn.t(key), key).not.toContain('⟦')
      expect(i18nZh.t(key), key).not.toMatch(/\{\w+\}/)
      expect(i18nEn.t(key), key).not.toMatch(/\{\w+\}/)
    }
    // 结果明细与最佳成绩走 plural / 带 count 的 t()
    for (const key of ['xiangqi.result.moves']) {
      expect(en[`${key}__one`], key).toBeDefined()
      expect(en[`${key}__other`], key).toBeDefined()
      expect(zh[`${key}__other`], key).toBeDefined()
    }
    expect(i18nZh.t('xiangqi.solved.best', { count: 12 })).toContain('12')
    expect(i18nEn.t('xiangqi.solved.best', { count: 1 })).not.toMatch(/\{\w+\}/)
  })

  it('view / controls / 格子标签用到的 key 都能取到（两种语言都不缺）', () => {
    const state = advance(fresh(), 2)
    const view = xiangqiGame.view(state)
    const keys: string[] = [
      `${xiangqiGame.i18nNamespace}.title`,
      `${xiangqiGame.i18nNamespace}.rules.body`,
      `${xiangqiGame.i18nNamespace}.rules.restart`,
      xiangqiGame.illegalNoticeKey!,
      ...view.stats.map((stat) => stat.labelKey),
      ...xiangqiGame.controls(state).map((control) => control.labelKey),
      ...xiangqiGame.difficulties.map((difficulty) => difficulty.labelKey),
      ...(Object.values(CELL_LABEL_KEYS).filter(Boolean) as string[]),
    ]
    for (const key of keys) {
      expect(i18nZh.t(key), key).not.toContain('⟦')
      expect(i18nEn.t(key), key).not.toContain('⟦')
    }
    expect(i18nZh.missingKeys()).toEqual([])
    expect(i18nEn.missingKeys()).toEqual([])
  })

  it('结果标题与明细在两种语言里都能取到，且没有残留插值', () => {
    const mated = positionState(
      boardOf([
        '...k.....',
        '.........',
        '.........',
        '.........',
        '.........',
        '.........',
        '.........',
        '.........',
        '.....r...',
        'r...K....',
      ]),
    )
    for (const state of [mated, advance(fresh(), 2)]) {
      const view = xiangqiGame.view(state)
      if (!view.result) continue
      expect(i18nZh.t(view.result.titleKey)).not.toContain('⟦')
      expect(i18nEn.t(view.result.titleKey)).not.toContain('⟦')
      for (const detail of view.result.details) {
        if (detail.params) {
          expect(
            i18nZh.plural(detail.key, Number(detail.params.count), detail.params),
          ).not.toContain('⟦')
          expect(i18nEn.plural(detail.key, 1, { count: 1 })).not.toContain('⟦')
        } else {
          expect(i18nZh.t(detail.key)).not.toContain('⟦')
          expect(i18nEn.t(detail.key)).not.toContain('⟦')
        }
      }
    }
    // 提示文案两种语言都能取到
    expect(i18nZh.t('xiangqi.notice.check')).not.toContain('⟦')
    expect(i18nEn.t('xiangqi.notice.check')).not.toContain('⟦')
    expect(i18nZh.missingKeys()).toEqual([])
    expect(i18nEn.missingKeys()).toEqual([])
  })

  it('格子无障碍标签覆盖本作使用的四种 kind', () => {
    for (const kind of ['tile', 'goal', 'empty'] as const) {
      const key = CELL_LABEL_KEYS[kind]!
      expect(zh[key], kind).toBeDefined()
      expect(en[key], kind).toBeDefined()
    }
  })

  it('棋盘上的汉字字形不进字典：中英界面显示同一套字（i18n-exempt 的理由）', () => {
    for (const glyph of ['帅', '将', '兵', '卒']) {
      expect(zh[glyph]).toBeUndefined()
      expect(en[glyph]).toBeUndefined()
    }
  })
})
