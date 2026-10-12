/**
 * legal() 与 reduce() 的一致性契约。
 *
 * 评审发现：斗地主的 `legalActions` 曾经「只要选了牌就给 play」，而 `applyMove` 会以
 * `does not beat the current play` 拒绝它 —— 契约测试的随机漫步撞上这条就抛 IllegalActionError，
 * 界面上「出牌」按钮也在压不过时亮着。现在两边共用 `canPlaySelected`（= `asPlayAgainst`）。
 */
import { describe, expect, it } from 'vitest'
import { createRng } from '@eink/core'
import { doudizhuGame } from '../src/index.js'
import { DIFFICULTY_IDS, HUMAN_SEAT, hintOptions, legalActions, tableOf, type DoudizhuState } from '../src/rules.js'
import { buildControls } from '../src/view.js'

type Action = ReturnType<typeof legalActions>[number]

function accepts(state: DoudizhuState, action: Action): boolean {
  try {
    doudizhuGame.reduce(state, action)
    return true
  } catch {
    return false
  }
}

function playControlEnabled(state: DoudizhuState): boolean {
  return buildControls(state).find((item) => item.id === 'play')?.enabled ?? false
}

/** 走到「真人需要压上家」的局面：先叫 0 分，再一路 tick 让机器人叫分 / 领出 / 出牌 */
function tryAdvanceToHumanBeat(seed: number): DoudizhuState | null {
  let state = doudizhuGame.create(seed, DIFFICULTY_IDS[0])
  for (let step = 0; step < 400; step++) {
    const table = tableOf(state)
    if (
      table.phase === 'playing' &&
      table.turn === HUMAN_SEAT &&
      table.top &&
      table.top.seat !== HUMAN_SEAT &&
      // 真人手里得**真的有能压的牌**，否则「提示」给不出方案，第三条用例无从成立
      hintOptions(table).length > 0
    ) {
      return state
    }
    if (doudizhuGame.status(state) !== 'playing') return null
    const actions = legalActions(state)
    const next =
      actions.find((action) => action.type === 'tick') ??
      actions.find((action) => action.type === 'bid' && action.value === 0) ??
      actions.find((action) => action.type === 'pass') ??
      actions.find((action) => action.type === 'play') ??
      actions[0]
    if (!next) return null
    state = doudizhuGame.reduce(state, next)
  }
  return null
}

function humanBeatState(): DoudizhuState {
  for (let seed = 1; seed <= 60; seed++) {
    const state = tryAdvanceToHumanBeat(seed)
    if (state) return state
  }
  throw new Error('未能构造出「真人需要压上家」的局面')
}

describe('斗地主 legal() 与 reduce() 的一致性', () => {
  it('随机漫步：任何状态下 legal() 给出的每个动作都能被 reduce() 接受', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      for (const seed of [3, 17, 98]) {
        let state = doudizhuGame.create(seed, difficulty)
        const rng = createRng(seed * 31 + difficulty.length)
        for (let step = 0; step < 60 && doudizhuGame.status(state) === 'playing'; step++) {
          const actions = legalActions(state)
          for (const action of actions) {
            expect(
              accepts(state, action),
              `${difficulty}/${seed} 第 ${step} 步：${action.type} 被 legal() 给出却被 reduce() 拒绝`,
            ).toBe(true)
          }
          if (actions.length === 0) break
          state = doudizhuGame.reduce(state, actions[Math.floor(rng.next() * actions.length)]!)
        }
      }
    }
  })

  it('选中的牌压不过桌面时不给 play：legal 里没有、reduce 拒绝、按钮也是灰的', () => {
    const state = humanBeatState()
    const table = tableOf(state)
    let blocked = 0
    for (const card of table.hands[HUMAN_SEAT]) {
      const selected = doudizhuGame.reduce(state, { type: 'toggle', card })
      const offersPlay = legalActions(selected).some((action) => action.type === 'play')
      const reduceAccepts = accepts(selected, { type: 'play' })
      // 三者必须永远一致：legal 给出的 == reduce 接受的 == 按钮可点的
      expect(offersPlay, `选中 ${card} 后 legal 与 reduce 不一致`).toBe(reduceAccepts)
      expect(playControlEnabled(selected), `选中 ${card} 后「出牌」按钮与 legal 不一致`).toBe(offersPlay)
      if (!reduceAccepts) blocked += 1
    }
    // 这一局必须真的存在「压不过」的选法，否则这条用例等于没测（旧代码正是在这里放行了 play）
    expect(blocked, '这局每张单牌都压得过，达不到回归目的').toBeGreaterThan(0)
  })

  it('「提示」给出的合法一手：legal 里有 play、reduce 接受、按钮可点', () => {
    const state = humanBeatState()
    const hinted = doudizhuGame.reduce(state, { type: 'hint' })
    expect(hinted.selected.length).toBeGreaterThan(0)
    expect(legalActions(hinted).some((action) => action.type === 'play')).toBe(true)
    expect(accepts(hinted, { type: 'play' })).toBe(true)
    expect(playControlEnabled(hinted)).toBe(true)
  })
})
