/**
 * 牌桌主机：联机时运行在服务器（或房主设备）上的权威牌局。
 *
 * - 持有完整牌局，按座位接收动作（submit），用 table.ts 的同一份规则校验；
 * - 每次局面变化通知订阅者，订阅者再按座位取视角（viewFor）下发 —— 永远不下发别人的手牌；
 * - 三家都不叫时自动重新发牌（dealNo + 1）；
 * - serveSeat 把一条传输通道接到某个座位上：收 join / move，回 joined / state / rejected。
 *
 * 单机版不经过这里（GameDef 直接调 table.ts），但两条路径共用同一份规则与视角，
 * 测试里用三个回环客户端（loopback）跑通整局，证明「换成联机只需补传输层」。
 */
import { IllegalActionError } from '@eink/core'
import { observe, type SeatView } from '../observe.js'
import { applyMove, startTable, type LoggedMove, type Move, type Seat, type TableState } from '../table.js'
import type { ClientMessage, ServerMessage, Transport } from './protocol.js'
import { parseClientMessage } from './protocol.js'

export type SubmitResult = { ok: true } | { ok: false; reason: string }

export interface TableHost {
  /** 当前完整牌局（只在主机内部使用，绝不直接下发） */
  readonly table: TableState
  readonly dealNo: number
  readonly log: readonly LoggedMove[]
  /** 局面序号：每次变化 +1 */
  readonly seq: number
  viewFor(seat: Seat): SeatView
  submit(seat: Seat, move: Move): SubmitResult
  /** 局面变化时回调（参数为新的序号） */
  subscribe(listener: (seq: number) => void): () => void
}

export function createTableHost(options: { seed: number; dealNo?: number }): TableHost {
  let dealNo = options.dealNo ?? 0
  let table = startTable(options.seed, dealNo)
  let log: LoggedMove[] = []
  let seq = 0
  const listeners = new Set<(seq: number) => void>()
  const emit = (): void => {
    seq++
    for (const listener of [...listeners]) listener(seq)
  }

  return {
    get table() {
      return table
    },
    get dealNo() {
      return dealNo
    },
    get log() {
      return log
    },
    get seq() {
      return seq
    },
    viewFor: (seat) => observe(table, seat),
    submit(seat, move) {
      try {
        const next = applyMove(table, seat, move)
        if (next.phase === 'redeal') {
          dealNo++
          table = startTable(options.seed, dealNo)
          log = []
        } else {
          table = next
          log = [...log, { seat, move }]
        }
        emit()
        return { ok: true }
      } catch (error) {
        if (error instanceof IllegalActionError) return { ok: false, reason: error.reason }
        throw error
      }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

/** 把一条服务器端传输通道接到某个座位：处理入座与动作，局面变化时推送该座位的视角 */
export function serveSeat(
  host: TableHost,
  seat: Seat,
  transport: Transport<ServerMessage, unknown>,
): () => void {
  const push = (): void => transport.send({ type: 'state', seq: host.seq, view: host.viewFor(seat) })
  const stopMessages = transport.onMessage((raw) => {
    const message: ClientMessage | null = parseClientMessage(raw)
    if (!message) return
    if (message.type === 'join') {
      transport.send({ type: 'joined', seat })
      push()
      return
    }
    const result = host.submit(seat, message.move)
    if (!result.ok) transport.send({ type: 'rejected', seq: message.seq, reason: result.reason })
  })
  const stopHost = host.subscribe(push)
  return () => {
    stopMessages()
    stopHost()
  }
}

/**
 * 本机回环：一对互通的传输通道（客户端一端 + 服务器一端），消息同步投递。
 * 用于测试与「同一台设备上的热座 / 机器人席位」；真正联机时换成网络实现即可。
 */
export function createLoopback(): {
  client: Transport<ClientMessage, ServerMessage>
  server: Transport<ServerMessage, unknown>
} {
  const toServer = new Set<(message: unknown) => void>()
  const toClient = new Set<(message: ServerMessage) => void>()
  let closed = false
  // 走一遍 JSON：保证消息真的是可序列化的纯数据（与网络传输同样的约束）
  const clone = <T>(message: T): T => JSON.parse(JSON.stringify(message)) as T
  return {
    client: {
      send(message) {
        if (!closed) for (const listener of [...toServer]) listener(clone(message))
      },
      onMessage(listener) {
        toClient.add(listener)
        return () => toClient.delete(listener)
      },
      close() {
        closed = true
      },
    },
    server: {
      send(message) {
        if (!closed) for (const listener of [...toClient]) listener(clone(message))
      },
      onMessage(listener) {
        toServer.add(listener)
        return () => toServer.delete(listener)
      },
      close() {
        closed = true
      },
    },
  }
}
