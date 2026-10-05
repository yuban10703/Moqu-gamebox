/**
 * 恶魔轮盘赌的 GameDef 实现。
 *
 * - 对恶魔（入门 / 熟练 / 挑战）：恶魔的每一步靠 tickMs + { type: 'tick' } 推进（规则层零时间引用）；
 * - 无尽（endless）：对恶魔一轮接一轮，输一轮才结束；成绩（赢下的轮数）经 scoreOf 交给壳层记最高纪录；
 * - 双人同屏（hotseat）：按钮与道具永远替当前行动者操作；
 * - 装填后按「开始」才进入回合（墨水屏上先看清这一管装了什么）；轮与轮之间按「下一轮」；
 * - 不提供撤销（撤销等于看过结果再重来）—— 注册时隐藏壳层的撤销按钮。
 */
import type { GameDef } from '@eink/core'
import {
  CONTENT_VERSION,
  DIFFICULTY_IDS,
  GAME_ID,
  RULES_VERSION,
  createState,
  decodeState,
  duelOf,
  encodeState,
  humanActor,
  itemUsable,
  legalActions,
  reduceState,
  scoreOf,
  statusOf,
  tickMsOf,
  type BuckshotAction,
  type BuckshotState,
} from './rules.js'
import { buildControls, buildView } from './view.js'

export { buckshotEn, buckshotZh } from './i18n.js'
export * from './engine.js'
export * from './observe.js'
export { decideMove } from './ai.js'
export * from './rules.js'
export * from './view.js'

export const buckshotGame: GameDef<BuckshotState, BuckshotAction> = {
  id: GAME_ID,
  rulesVersion: RULES_VERSION,
  contentVersion: CONTENT_VERSION,
  i18nNamespace: 'buckshot',
  illegalNoticeKey: 'buckshot.illegal.notice',
  difficulties: DIFFICULTY_IDS.map((id) => ({ id, labelKey: `buckshot.difficulty.${id}` })),

  create: (seed, difficulty) => createState(seed, difficulty),
  reduce: (state, action) => reduceState(state, action),
  legal: (state) => legalActions(state),
  status: (state) => statusOf(state),
  view: (state) => buildView(state),
  controls: (state) => buildControls(state),
  encode: (state) => encodeState(state),
  decode: (raw) => decodeState(raw),
  tickMs: (state) => tickMsOf(state),
  /*
   * tick 走的是**恶魔**的回合。等待期间玩家点道具的落空点击不该把恶魔的思考一直往后推
   * （双人同屏档没有 AI，tickMsOf 返回 null，因此这条声明在那里不产生任何影响）。
   */
  tickActor: 'opponent',

  /** 点道具 = 立即使用（只对当前能操作、且现在用得上的道具生效） */
  selectAction(state, index) {
    const actor = humanActor(state)
    const duel = duelOf(state)
    if (actor === null || duel.phase !== 'turn' || !itemUsable(duel, actor, index)) return null
    return { type: 'item', slot: index }
  },

  controlAction(_state, controlId) {
    switch (controlId) {
      case 'begin':
        return { type: 'begin' }
      case 'next-round':
        return { type: 'nextRound' }
      case 'shoot-self':
        return { type: 'shoot', target: 'self' }
      case 'shoot-opponent':
        return { type: 'shoot', target: 'opponent' }
      default:
        return null
    }
  },

  contentId: (state) => state.difficulty,
  /** 无尽模式的成绩 = 赢下的轮数，壳层据此记最高纪录（其它模式返回 null，不记） */
  scoreOf: (state) => scoreOf(state),
}
