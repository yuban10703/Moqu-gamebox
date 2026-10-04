/**
 * 斗地主的 GameDef 实现 —— 游戏盒子唯一需要认识的东西。
 *
 * - 单机：真人 0 号位 + 两个电脑；电脑的回合靠 tickMs + { type: 'tick' } 一手一手推进（规则层零时间引用）；
 * - 每副牌是一「局」：打完 status 变成 won / lost（壳层弹结果面板、写历史记录），
 *   面板上的「下一局」（next-level 控件）发下一副牌，积分跨局累计；「重新开始」换种子、积分归零；
 * - 不提供撤销（撤销等于看过牌再重来）—— 注册时隐藏壳层的撤销按钮；
 * - 联机框架见 ./net（协议 + 权威主机 + 回环），规则与座位视角两端共用。
 */
import type { GameDef } from '@eink/core'
import { isCardId } from './cards.js'
import {
  CONTENT_VERSION,
  DIFFICULTY_IDS,
  GAME_ID,
  RULES_VERSION,
  createState,
  decodeState,
  encodeState,
  legalActions,
  reduceState,
  statusOf,
  tableOf,
  tickMsOf,
  type DoudizhuAction,
  type DoudizhuState,
} from './rules.js'
import { buildControls, buildView } from './view.js'

export { doudizhuEn, doudizhuZh } from './i18n.js'
export * from './cards.js'
export * from './patterns.js'
export * from './table.js'
export * from './observe.js'
export * from './ai.js'
export * from './rules.js'
export * from './view.js'
export * as net from './net/index.js'

export const doudizhuGame: GameDef<DoudizhuState, DoudizhuAction> = {
  id: GAME_ID,
  rulesVersion: RULES_VERSION,
  contentVersion: CONTENT_VERSION,
  i18nNamespace: 'doudizhu',
  illegalNoticeKey: 'doudizhu.illegal.notice',
  difficulties: DIFFICULTY_IDS.map((id) => ({ id, labelKey: `doudizhu.difficulty.${id}` })),

  create: (seed, difficulty) => createState(seed, difficulty),
  reduce: (state, action) => reduceState(state, action),
  legal: (state) => legalActions(state),
  status: (state) => statusOf(state),
  view: (state) => buildView(state),
  controls: (state) => buildControls(state),
  encode: (state) => encodeState(state),
  decode: (raw) => decodeState(raw),
  tickMs: (state) => tickMsOf(state),

  /** 点手牌 = 选中 / 取消选中（叫分与出牌阶段都可以；打完之后不再响应） */
  selectAction(state, index) {
    const table = tableOf(state)
    if (table.phase !== 'bidding' && table.phase !== 'playing') return null
    if (!isCardId(index) || !table.hands[0].includes(index)) return null
    return { type: 'toggle', card: index }
  },

  controlAction(_state, controlId) {
    if (controlId.startsWith('bid-')) {
      const value = Number(controlId.slice(4))
      return value === 0 || value === 1 || value === 2 || value === 3 ? { type: 'bid', value } : null
    }
    switch (controlId) {
      case 'pass':
        return { type: 'pass' }
      case 'clear':
        return { type: 'clear' }
      case 'hint':
        return { type: 'hint' }
      case 'play':
        return { type: 'play' }
      case 'next-level':
        return { type: 'nextLevel' }
      default:
        return null
    }
  },

  /** 无关卡：内容 id 就是难度（进度按「赢过的难度 / 3」算） */
  contentId: (state) => state.difficulty,
}
