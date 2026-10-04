/**
 * 座位视角：某个座位**能看到**的信息。
 *
 * 隐藏信息只有：枪里弹的顺序（装填时只公开数量，界面上把「实弹在前、空包在后」排好再亮出，不泄露顺序），
 * 以及放大镜 / 手机看到的结果（只有使用者知道）。电脑（ai.ts）与界面（view.ts）都只吃 SeatView。
 * 双人同屏时界面取「当前行动者」的视角 —— 同一块屏幕上本来也藏不住，规则说明里写明了这一点。
 */
import type { DuelEvent, DuelState, ItemId, Mode, Phase, Seat, SpentShell } from './engine.js'
import { shellsLeft } from './engine.js'

export interface SeatView {
  seat: Seat
  mode: Mode
  phase: Phase
  round: number
  roundWins: [number, number]
  maxHp: number
  hp: [number, number]
  /** 道具是公开的（原作里双方都看得到对方的道具） */
  items: [ItemId[], ItemId[]]
  fresh: [number, number]
  turn: Seat
  saw: boolean
  cuffed: [boolean, boolean]
  loadTotal: number
  loadLive: number
  loadBlank: number
  /** 枪里还剩几发 */
  left: number
  spent: SpentShell[]
  /** 当前这一发被逆转过（公开） */
  inverted: boolean
  /** 装填阶段亮出的组成（实弹在前、空包在后，不代表顺序）；其余阶段为 null */
  revealed: boolean[] | null
  /** 自己知道的剩余弹：下标 0 = 当前这一发 */
  known: Array<boolean | null>
  events: DuelEvent[]
  winner: Seat | null
}

export function observe(state: DuelState, seat: Seat): SeatView {
  const left = shellsLeft(state)
  return {
    seat,
    mode: state.mode,
    phase: state.phase,
    round: state.round,
    roundWins: [...state.roundWins] as [number, number],
    maxHp: state.maxHp,
    hp: [...state.hp] as [number, number],
    items: [[...state.items[0]], [...state.items[1]]],
    fresh: [...state.fresh] as [number, number],
    turn: state.turn,
    saw: state.saw,
    cuffed: [...state.cuffed] as [boolean, boolean],
    loadTotal: state.load.length,
    loadLive: state.loadLive,
    loadBlank: state.loadBlank,
    left,
    spent: state.spent.map((shell) => ({ ...shell })),
    inverted: state.inverted,
    revealed:
      state.phase === 'load'
        ? [...Array<boolean>(state.loadLive).fill(true), ...Array<boolean>(state.loadBlank).fill(false)]
        : null,
    known: state.known[seat].slice(state.pos),
    events: state.events.filter((event) => !('privateTo' in event) || event.privateTo === seat),
    winner: state.winner,
  }
}

/**
 * 枪里还剩的实弹 / 空包弹数量 —— 只用公开信息就能算准：装填时的数量减去已打出 / 退出的弹
 * （被逆转过的弹按它**原本**的身份扣）。逆转器只作用于当前这一发，所以：
 *   - 当前一发没被逆转：这就是真实的剩余数量；
 *   - 当前一发被逆转过（approx = true）：这是「按逆转前」的数量，当前这一发的实空与它原本的身份相反。
 */
export function remainingShells(view: SeatView): { live: number; blank: number; approx: boolean } {
  let spentLive = 0
  for (const shell of view.spent) if (shell.flipped ? !shell.live : shell.live) spentLive++
  return {
    live: Math.max(0, view.loadLive - spentLive),
    blank: Math.max(0, view.loadBlank - (view.spent.length - spentLive)),
    approx: view.inverted,
  }
}

/**
 * 从这个座位的角度估计「当前这一发是实弹」的概率：知道就是 0 / 1；
 * 否则在剩余弹（按原本身份）里扣掉已知的后续弹再算；当前一发被逆转过时取反面的概率。
 */
export function liveChance(view: SeatView): number {
  const known = view.known[0]
  if (known !== null && known !== undefined) return known ? 1 : 0
  const left = remainingShells(view)
  // 已知的后续弹（逆转器碰不到它们，原本身份 = 真实身份）从未知池里扣掉
  let knownLive = 0
  let knownBlank = 0
  for (let i = 1; i < view.known.length; i++) {
    if (view.known[i] === true) knownLive++
    else if (view.known[i] === false) knownBlank++
  }
  const liveLeft = Math.max(0, left.live - knownLive)
  const blankLeft = Math.max(0, left.blank - knownBlank)
  const pool = liveLeft + blankLeft
  if (pool === 0) return 0.5
  const originallyLive = liveLeft / pool
  return view.inverted ? 1 - originallyLive : originallyLive
}
