/**
 * 规则层测试：棋盘几何、胜负与和局判定、落子合法性、两拍应手、撤销/重开/提示。
 *
 * 两条原则：
 * - 胜负结论一律用**独立实现**的判定复核（`winner` / `lineIndexes`），不用被测实现验证被测实现；
 * - 非法动作必须抛 `IllegalActionError`（壳层据此给玩家明确文字反馈），不能静默通过。
 */
import { describe, expect, it } from 'vitest'
import { IllegalActionError } from '@eink/core'
import {
  CELLS,
  CENTER,
  EMPTY,
  FIRST,
  LINES,
  SECOND,
  boardOf,
  createState,
  decodeState,
  emptyCells,
  encodeState,
  gameStatus,
  legalActions,
  lineOf,
  outcomeOf,
  reduceState,
  selectAction,
  turnOf,
  winningLineOf,
  winningMoves,
  winnerOf,
  type TictactoeState,
} from '../src/index.js'
import { ascii, at, isFull, lineIndexes, settle, stateOf, winner } from './helpers.js'

/** 一局真实的和局（九格下满、双方都没连成线），既能重放也能当摆盘用 */
const DRAW_LOG = [0, 1, 2, 4, 3, 5, 8, 6, 7] as const

function place(state: TictactoeState, index: number): TictactoeState {
  return reduceState(state, { type: 'place', index })
}

describe('棋盘与连线', () => {
  it('3×3 九格、行优先索引、八条连线', () => {
    expect(CELLS).toBe(9)
    expect(LINES).toHaveLength(8)
    expect(at(0, 0)).toBe(0)
    expect(at(1, 1)).toBe(CENTER)
    expect(at(2, 2)).toBe(8)
  })

  it('先手横线、后手竖线都判为获胜，与独立实现一致', () => {
    // X：0,1,2（第一行）赢
    const firstWins = stateOf([0, 3, 1, 4, 2])
    expect(winner(boardOf(firstWins))).toBe(FIRST)
    expect(winnerOf(boardOf(firstWins))).toBe(FIRST)
    expect(outcomeOf(firstWins)).toBe('first')
    expect(lineOf(boardOf(firstWins), FIRST)).toEqual([0, 1, 2])
    expect(winningLineOf(firstWins)).toEqual([0, 1, 2])

    // O：3,4,5（第二行）赢
    const secondWins = stateOf([0, 3, 1, 4, 8, 5])
    expect(winner(boardOf(secondWins))).toBe(SECOND)
    expect(outcomeOf(secondWins)).toBe('second')
    expect(lineIndexes(boardOf(secondWins))).toEqual([3, 4, 5])
  })

  it('斜线也算：先手走 0/4/8、后手走 2/4/6', () => {
    const diagonal = stateOf([0, 1, 4, 2, 8])
    expect(outcomeOf(diagonal)).toBe('first')
    const antiDiagonal = stateOf([1, 2, 3, 4, 5, 6])
    expect(outcomeOf(antiDiagonal)).toBe('second')
    expect(lineIndexes(boardOf(antiDiagonal))).toEqual([2, 4, 6])
  })

  it('九格下满且无人连线 = 和局（独立复核：盘满、无人成线）', () => {
    const state = stateOf(DRAW_LOG)
    const board = boardOf(state)
    expect(ascii(board)).toEqual(['XOX', 'XOO', 'OXX'])
    expect(winner(board)).toBeNull()
    expect(isFull(board)).toBe(true)
    expect(winningLineOf(state)).toBeNull()
    expect(outcomeOf(state)).toBe('draw')
    // 和局并入 won：壳层只在 status 非 playing 时才展示结果面板（真实结果由 view 的标题说明）
    expect(gameStatus(state)).toBe('won')
  })

  it('还没结束就没有结果', () => {
    expect(outcomeOf(createState(1, 'starter'))).toBeNull()
    expect(gameStatus(createState(1, 'starter'))).toBe('playing')
  })

  it('winningMoves 给出「再落一手就连成线」的空点（升序）', () => {
    const board = boardOf(stateOf([0, 4, 1]))
    expect(emptyCells(board)).toEqual([2, 3, 5, 6, 7, 8])
    expect(winningMoves(board, FIRST)).toEqual([2])
    expect(winningMoves(board, SECOND)).toEqual([])
  })
})

describe('落子', () => {
  it('先手落子后轮到后手；对电脑时玩家不能替电脑落子', () => {
    const fresh = createState(11, 'skilled')
    expect(turnOf(fresh)).toBe(FIRST)
    const afterFirst = place(fresh, 0)
    expect(afterFirst.log).toEqual([0])
    expect(turnOf(afterFirst)).toBe(SECOND)
    expect(boardOf(afterFirst)[0]).toBe(FIRST)
    expect(() => place(afterFirst, 1)).toThrow(IllegalActionError)
  })

  it('越界与非整数一律拒绝', () => {
    const state = createState(3, 'hotseat')
    for (const index of [-1, CELLS, 1.5, Number.NaN]) {
      expect(() => place(state, index), String(index)).toThrow(IllegalActionError)
    }
  })

  it('已占用的格子不能再落子', () => {
    // 同屏：两人轮流，后手想下在先手那一格上
    expect(() => place(stateOf([0]), 0)).toThrow(IllegalActionError)
  })

  it('对局结束后不再接受落子', () => {
    const finished = stateOf([0, 3, 1, 4, 2])
    expect(outcomeOf(finished)).toBe('first')
    expect(() => place(finished, 5)).toThrow(IllegalActionError)
  })

  it('未知动作明确报错，不静默通过', () => {
    expect(() => reduceState(createState(1, 'hotseat'), { type: 'nope' } as never)).toThrow(
      IllegalActionError,
    )
  })

  it('selectAction：空格给 place；已占用 / 越界 / 等应手一律 null', () => {
    const fresh = createState(7, 'starter')
    expect(selectAction(fresh, 4)).toEqual({ type: 'place', index: 4 })
    expect(selectAction(fresh, 9)).toBeNull()
    expect(selectAction(fresh, -1)).toBeNull()

    const occupied = stateOf([0])
    expect(selectAction(occupied, 0)).toBeNull()

    // 等电脑应手：点了没反应（不是弹错误）
    expect(selectAction(place(fresh, 0), 1)).toBeNull()
  })
})

describe('两拍应手（tick）', () => {
  it('第一拍只亮出目标格（棋盘一格不动），第二拍才落子', () => {
    const afterFirst = place(createState(2026, 'starter'), 4)
    const picked = reduceState(afterFirst, { type: 'tick' })
    expect(picked.opponentPick).not.toBeNull()
    expect(picked.log).toEqual([4])
    // 关键：第一拍棋盘必须一格不动，玩家看到的是「对手要下这里」
    expect(boardOf(picked)).toEqual(boardOf(afterFirst))
    expect(boardOf(picked).filter((mark) => mark === EMPTY)).toHaveLength(8)

    const placed = reduceState(picked, { type: 'tick' })
    expect(placed.opponentPick).toBeNull()
    expect(placed.log).toHaveLength(2)
    expect(placed.log[0]).toBe(4)
    const reply = placed.log[1]!
    expect(boardOf(placed)[reply]).toBe(SECOND)
    // 应手必须落在空格上，且只能落在第一拍选中的那一格
    expect(reply).toBe(picked.opponentPick)
  })

  it('还没轮到电脑时不能 tick；同屏没有电脑，也不能 tick', () => {
    expect(() => reduceState(createState(3, 'starter'), { type: 'tick' })).toThrow(IllegalActionError)
    expect(() => reduceState(stateOf([0]), { type: 'tick' })).toThrow(IllegalActionError)
  })

  it('对局结束后 tick 被拒绝', () => {
    const finished = stateOf([0, 3, 1, 4, 2], { difficulty: 'starter' })
    expect(() => reduceState(finished, { type: 'tick' })).toThrow(IllegalActionError)
  })
})

describe('撤销与重开', () => {
  it('对电脑：撤销退一整回合（自己的落子与对手的应手一起退回）', () => {
    const played = settle(place(createState(31, 'skilled'), 0))
    expect(played.log).toHaveLength(2)
    const undone = reduceState(played, { type: 'undo' })
    expect(undone.log).toEqual([])
    expect(turnOf(undone)).toBe(FIRST)
    expect(boardOf(undone).every((mark) => mark === EMPTY)).toBe(true)
  })

  it('对电脑：应手还没落（第一拍已亮出）时撤销，退掉玩家那一手', () => {
    const picked = reduceState(place(createState(31, 'skilled'), 0), { type: 'tick' })
    expect(picked.opponentPick).not.toBeNull()
    const undone = reduceState(picked, { type: 'undo' })
    expect(undone.log).toEqual([])
    expect(undone.opponentPick).toBeNull()
  })

  it('同屏：撤销只退最后一手（各自悔自己刚下的那一步）', () => {
    const state = stateOf([0, 1, 2])
    const undone = reduceState(state, { type: 'undo' })
    expect(undone.log).toEqual([0, 1])
    expect(turnOf(undone)).toBe(FIRST)
  })

  it('没有可撤销的手时抛错', () => {
    expect(() => reduceState(createState(1, 'hotseat'), { type: 'undo' })).toThrow(IllegalActionError)
  })

  it('终局后仍允许撤销（退回关键一手重下）', () => {
    const finished = stateOf([0, 3, 1, 4, 2])
    expect(reduceState(finished, { type: 'undo' }).log).toEqual([0, 3, 1, 4])
  })

  it('重开：回到空棋盘，难度与种子不变', () => {
    const played = settle(place(createState(99, 'challenging'), 4))
    const restarted = reduceState(played, { type: 'restart' })
    expect(restarted.log).toEqual([])
    expect(restarted.difficulty).toBe('challenging')
    expect(restarted.seed).toBe(played.seed)
    expect(restarted.opponentPick).toBeNull()
    // 终局后也能重开
    expect(reduceState(stateOf(DRAW_LOG), { type: 'restart' }).log).toEqual([])
  })
})

describe('提示', () => {
  it('提示落在空格上；有一步取胜时给的就是那一格', () => {
    // 先手已有 0 与 1：再下 2 就连成第一行
    const state = stateOf([0, 4, 1])
    const hinted = reduceState(state, { type: 'hint' })
    expect(hinted.hint).toBe(2)
    expect(boardOf(hinted)[2]).toBe(EMPTY)
  })

  it('开局提示一定是一个合法空点（不会给出已占用的格子）', () => {
    const hinted = reduceState(createState(5, 'starter'), { type: 'hint' })
    expect(hinted.hint).not.toBeNull()
    expect(boardOf(hinted)[hinted.hint!]).toBe(EMPTY)
  })

  it('对电脑时轮到电脑不给提示；终局后也不给', () => {
    expect(() => reduceState(stateOf([0], { difficulty: 'starter' }), { type: 'hint' })).toThrow(
      IllegalActionError,
    )
    expect(() => reduceState(stateOf([0, 3, 1, 4, 2]), { type: 'hint' })).toThrow(IllegalActionError)
  })

  it('落子与撤销都会清掉提示', () => {
    const hinted = reduceState(createState(5, 'hotseat'), { type: 'hint' })
    expect(hinted.hint).not.toBeNull()
    const played = place(hinted, hinted.hint!)
    expect(played.hint).toBeNull()
    const hintedAgain = reduceState(played, { type: 'hint' })
    expect(hintedAgain.hint).not.toBeNull()
    const undone = reduceState(hintedAgain, { type: 'undo' })
    expect(undone.hint).toBeNull()
    expect(undone.log).toEqual([])
  })
})

describe('legal：当前允许的动作', () => {
  it('轮到玩家：九个落点 + 提示 + 重开，没有 tick 也没有 undo', () => {
    const types = legalActions(createState(3, 'challenging')).map((action) => action.type)
    expect(types.filter((type) => type === 'place')).toHaveLength(9)
    expect(types).toContain('hint')
    expect(types).toContain('restart')
    expect(types).not.toContain('tick')
    expect(types).not.toContain('undo')
  })

  it('等电脑应手：只剩 tick（玩家这一手已经落在盘上）', () => {
    const waiting = place(createState(3, 'challenging'), 0)
    const types = legalActions(waiting).map((action) => action.type)
    expect(types).toContain('tick')
    expect(types).toContain('undo')
    expect(types).not.toContain('place')
    expect(types).not.toContain('hint')
  })

  it('同屏：两方都能落子，永远没有 tick', () => {
    const state = stateOf([0])
    expect(turnOf(state)).toBe(SECOND)
    const types = legalActions(state).map((action) => action.type)
    expect(types.filter((type) => type === 'place')).toHaveLength(8)
    expect(types).not.toContain('tick')
  })

  it('终局后只剩 undo / restart', () => {
    const types = legalActions(stateOf([0, 3, 1, 4, 2])).map((action) => action.type)
    expect(types.sort()).toEqual(['restart', 'undo'])
  })
})

describe('存档：decode 严格校验', () => {
  it('正常状态（含两拍中间态与提示）都能往返', () => {
    const states: TictactoeState[] = [
      createState(1, 'starter'),
      place(createState(1, 'starter'), 4),
      reduceState(place(createState(1, 'starter'), 4), { type: 'tick' }),
      reduceState(createState(1, 'skilled'), { type: 'hint' }),
      settle(place(createState(1, 'skilled'), 4)),
      stateOf([...DRAW_LOG]),
    ]
    for (const state of states) {
      // 存档要真的过一遍 JSON：encode 的产物必须是可承载的纯数据
      expect(decodeState(JSON.parse(JSON.stringify(encodeState(state))))).toEqual(state)
    }
  })

  it('日志里重复落子 / 终局后还有手 一律拒绝', () => {
    const base = { seed: 1, opponentPick: null, hint: null }
    // 4 与 4 重复：第二手落在已占用的格子上
    expect(() => decodeState({ ...base, difficulty: 'hotseat', log: [4, 4] })).toThrow(IllegalActionError)
    // 前五手已经连成线，第六手不该存在
    expect(() => decodeState({ ...base, difficulty: 'hotseat', log: [0, 3, 1, 4, 2, 5] })).toThrow(
      IllegalActionError,
    )
    // 索引越界
    expect(() => decodeState({ ...base, difficulty: 'hotseat', log: [9] })).toThrow(IllegalActionError)
  })

  it('字段类型 / 取值不对一律拒绝', () => {
    const ok = { difficulty: 'hotseat', seed: 1, log: [], opponentPick: null, hint: null }
    expect(() => decodeState(null)).toThrow(IllegalActionError)
    expect(() => decodeState('nope')).toThrow(IllegalActionError)
    expect(() => decodeState({ ...ok, difficulty: 'nightmare' })).toThrow(IllegalActionError)
    expect(() => decodeState({ ...ok, seed: -1 })).toThrow(IllegalActionError)
    expect(() => decodeState({ ...ok, seed: 2 ** 32 })).toThrow(IllegalActionError)
    expect(() => decodeState({ ...ok, log: 'nope' })).toThrow(IllegalActionError)
  })

  it('两个过程中的标记必须与局面自洽', () => {
    const pick = (extra: Record<string, unknown>) => ({
      difficulty: 'starter',
      seed: 1,
      log: [0],
      opponentPick: null,
      hint: null,
      ...extra,
    })
    // 同屏没有电脑，「对手已选中」不可能存在
    expect(() => decodeState({ ...pick({}), difficulty: 'hotseat', opponentPick: 1 })).toThrow(
      IllegalActionError,
    )
    // 轮到玩家自己（第二手已落，日志长度为偶数）时不该有「对手已选中」
    expect(() => decodeState({ ...pick({}), log: [0, 1], opponentPick: 2 })).toThrow(IllegalActionError)
    // 目标格已被占用
    expect(() => decodeState(pick({ opponentPick: 0 }))).toThrow(IllegalActionError)
    // 提示格已被占用 / 轮不到真人
    expect(() => decodeState(pick({ hint: 0 }))).toThrow(IllegalActionError)
    expect(() => decodeState({ ...pick({}), hint: 2 })).toThrow(IllegalActionError)
    // 合法的两个标记：等应手时的目标格、自己回合的提示
    expect(decodeState(pick({ opponentPick: 1 })).opponentPick).toBe(1)
    expect(decodeState({ ...pick({}), difficulty: 'hotseat', hint: 2 }).hint).toBe(2)
  })
})
