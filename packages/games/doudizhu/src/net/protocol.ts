/**
 * 联机协议（v1）：客户端只发「我这个座位想做什么」，服务器只回「你这个座位能看到什么」。
 *
 *   客户端 → 服务器：join（入座）、move（叫分 / 出牌 / 不出）
 *   服务器 → 客户端：joined（分到的座位）、state（该座位视角 SeatView + 序号）、rejected（动作被拒及原因）
 *
 * 设计要点：
 * - 服务器是唯一权威：持有完整牌局（table.ts），每个动作都用同一份规则校验后才生效；
 * - 下发的永远是 SeatView（observe），别人的手牌只有张数 —— 客户端拿不到隐藏信息，也就无从作弊；
 * - 消息是纯 JSON，传输层（WebSocket / 局域网 / 蓝牙…）不关心内容，见 Transport；
 * - seq 单调递增：客户端据此丢弃过期的 state、把 rejected 对应到自己发出的那一条 move。
 */
import { isCardId } from '../cards.js'
import type { SeatView } from '../observe.js'
import type { Move, Seat } from '../table.js'

export const PROTOCOL_VERSION = 1

export type ClientMessage =
  | { type: 'join'; protocol: typeof PROTOCOL_VERSION; name: string }
  | { type: 'move'; seq: number; move: Move }

export type ServerMessage =
  | { type: 'joined'; seat: Seat }
  | { type: 'state'; seq: number; view: SeatView }
  | { type: 'rejected'; seq: number; reason: string }

/** 双向消息通道（具体用什么传输由接入方实现；单机测试用 loopback） */
export interface Transport<Out, In> {
  send(message: Out): void
  onMessage(listener: (message: In) => void): () => void
  close(): void
}

function isMove(value: unknown): value is Move {
  if (!value || typeof value !== 'object') return false
  const move = value as { kind?: unknown; value?: unknown; cards?: unknown }
  if (move.kind === 'pass') return true
  if (move.kind === 'bid') return move.value === 0 || move.value === 1 || move.value === 2 || move.value === 3
  if (move.kind === 'play') return Array.isArray(move.cards) && move.cards.length > 0 && move.cards.every(isCardId)
  return false
}

/** 校验来自网络的客户端消息（不可信输入：结构不对一律丢弃） */
export function parseClientMessage(raw: unknown): ClientMessage | null {
  let value: unknown = raw
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw)
    } catch {
      return null
    }
  }
  if (!value || typeof value !== 'object') return null
  const message = value as { type?: unknown; protocol?: unknown; name?: unknown; seq?: unknown; move?: unknown }
  if (message.type === 'join') {
    if (message.protocol !== PROTOCOL_VERSION || typeof message.name !== 'string') return null
    return { type: 'join', protocol: PROTOCOL_VERSION, name: message.name.slice(0, 32) }
  }
  if (message.type === 'move') {
    if (typeof message.seq !== 'number' || !Number.isInteger(message.seq) || message.seq < 0) return null
    if (!isMove(message.move)) return null
    return { type: 'move', seq: message.seq, move: message.move }
  }
  return null
}
