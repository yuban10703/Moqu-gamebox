/**
 * 空当接龙的 GameDef 实现 —— 游戏盒子唯一需要认识的东西。
 *
 * - 状态 = 难度 + 种子 + 局号 + 动作日志（见 engine.ts）：牌面由 (seed, dealNo) 复算，
 *   局面由日志重放，所以「继续」「撤销」「同种子同牌序」都是白送的；
 * - 一局 = 一副牌收满 4 个基础堆（status 变 won，壳层弹结果面板并记「最佳步数」）；
 * - 撤销交给壳层（每步移动都进日志，`{ type: 'undo' }` 就是丢掉最后一条），
 *   注册时**不要**隐藏撤销按钮；
 * - 不做自动步进：单人排牌全靠玩家点，一分钟不动也不会自己走（因此不声明 tickMs）。
 */
import type { GameDef } from '@eink/core'
import {
  CONTENT_VERSION,
  DIFFICULTY_IDS,
  GAME_ID,
  RULES_VERSION,
  createState,
  decodeState,
  encodeState,
  legalActions,
  movesOf,
  reduceState,
  statusOf,
  type KlondikeAction,
  type KlondikeState,
} from './engine.js'
import { buildControls, buildView, isClickable } from './view.js'

export { klondikeEn, klondikeZh } from './i18n.js'
export * from './cards.js'
export * from './engine.js'
export * from './view.js'

export const klondikeGame: GameDef<KlondikeState, KlondikeAction> = {
  id: GAME_ID,
  rulesVersion: RULES_VERSION,
  contentVersion: CONTENT_VERSION,
  i18nNamespace: 'klondike',
  illegalNoticeKey: 'klondike.illegal.notice',
  difficulties: DIFFICULTY_IDS.map((id) => ({ id, labelKey: `klondike.difficulty.${id}` })),

  create: (seed, difficulty) => createState(seed, difficulty),
  reduce: (state, action) => reduceState(state, action),
  legal: (state) => legalActions(state),
  status: (state) => statusOf(state),
  view: (state) => buildView(state),
  controls: (state) => buildControls(state),
  encode: (state) => encodeState(state),
  decode: (raw) => decodeState(raw),
  movesOf: (state) => movesOf(state),

  /**
   * 点一张牌 = 「点源 → 点目标」里的第一下或第二下：
   * 规则层自己记住点的是「哪一堆的第几张」（编号由 cards.clickIdOf 编出来），
   * 第二下才真的搬牌（整段合法序列一起搬）。壳层只把编号原样递进来。
   */
  selectAction(state, index) {
    // 画出来的 / 点得动的是同一批（见 view.isClickable）：抽牌堆入口永远可点，
    // 牌背只有在已经提起一段时能当目标，其余一律返回 null（壳层据此给出明确提示）
    if (!isClickable(state, index)) return null
    return { type: 'tap', id: index }
  },

  controlAction(_state, controlId) {
    switch (controlId) {
      case 'collect':
        return { type: 'collect' }
      case 'restart-deal':
        return { type: 'restart' }
      case 'next-deal':
        return { type: 'nextDeal' }
      case 'undo':
        return { type: 'undo' }
      default:
        return null
    }
  },

  /** 无关卡：内容 id 就是难度，通关进度与「最佳步数」都按难度归类 */
  contentId: (state) => state.difficulty,
}
