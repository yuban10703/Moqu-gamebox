/**
 * 联机框架：协议 + 权威主机 + 回环传输。
 *
 * 用三个回环客户端（各坐一个座位、各自只看服务器下发的 SeatView 做决定）跑完整局，
 * 证明「换成联机只需补传输层」：规则校验、座位视角、电脑决策两端共用，客户端拿不到隐藏信息。
 */
import { describe, expect, it } from 'vitest'
import { createRng } from '@eink/core'
import { decideMove } from '../src/ai.js'
import type { SeatView } from '../src/observe.js'
import type { Seat } from '../src/table.js'
import { createLoopback, createTableHost, parseClientMessage, serveSeat, type ServerMessage } from '../src/net/index.js'

describe('牌桌主机 + 回环客户端', () => {
  it('三个客户端各自只凭下发的视角出牌，能打完整局；任何时候都看不到别人的手牌', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const host = createTableHost({ seed: seed * 1013 })
      const latest: Array<SeatView | null> = [null, null, null]
      const rejected: string[] = []
      const clients = ([0, 1, 2] as Seat[]).map((seat) => {
        const { client, server } = createLoopback()
        serveSeat(host, seat, server)
        client.onMessage((message: ServerMessage) => {
          if (message.type === 'state') {
            // 隐藏信息检查：手牌只有自己的，别人只有张数；底牌在定地主前为空
            expect(message.view.seat).toBe(seat)
            expect(message.view.hand).toHaveLength(message.view.counts[seat])
            if (message.view.landlord === null) expect(message.view.bottom).toBeNull()
            latest[seat] = message.view
          }
          if (message.type === 'rejected') rejected.push(message.reason)
        })
        client.send({ type: 'join', protocol: 1, name: `p${seat}` })
        return client
      })

      let seq = 0
      for (let guard = 0; guard < 300; guard++) {
        const view = latest[0]!
        if (view.phase === 'over') break
        const turn = view.turn
        const own = latest[turn]!
        const move = decideMove(own, 'skilled', createRng(seed + guard))
        clients[turn]!.send({ type: 'move', seq: ++seq, move })
      }

      expect(rejected).toEqual([])
      const final = latest[0]!
      expect(final.phase).toBe('over')
      expect(final.counts[final.winner!]).toBe(0)
      // 三端看到的公开信息一致
      for (const seat of [1, 2] as Seat[]) {
        expect(latest[seat]!.played).toEqual(final.played)
        expect(latest[seat]!.winner).toBe(final.winner)
      }
    }
  })

  it('不是自己的回合 / 非法的牌 → rejected（主机局面不变）', () => {
    const host = createTableHost({ seed: 5 })
    const turn = host.table.turn
    const other = ((turn + 1) % 3) as Seat
    expect(host.submit(other, { kind: 'bid', value: 1 })).toEqual({ ok: false, reason: expect.stringContaining('turn') })
    expect(host.submit(turn, { kind: 'play', cards: [0] }).ok).toBe(false)
    expect(host.seq).toBe(0)
    expect(host.submit(turn, { kind: 'bid', value: 1 })).toEqual({ ok: true })
    expect(host.seq).toBe(1)
  })

  it('三家都不叫：主机自动重新发牌', () => {
    const host = createTableHost({ seed: 7 })
    for (let i = 0; i < 3; i++) host.submit(host.table.turn, { kind: 'bid', value: 0 })
    expect(host.dealNo).toBe(1)
    expect(host.log).toEqual([])
    expect(host.table.phase).toBe('bidding')
  })

  it('网络消息校验：结构不对一律丢弃（不可信输入）', () => {
    expect(parseClientMessage('not json')).toBeNull()
    expect(parseClientMessage({ type: 'move', seq: 1, move: { kind: 'play', cards: [99] } })).toBeNull()
    expect(parseClientMessage({ type: 'move', seq: -1, move: { kind: 'pass' } })).toBeNull()
    expect(parseClientMessage({ type: 'join', protocol: 2, name: 'x' })).toBeNull()
    expect(parseClientMessage({ type: 'hack' })).toBeNull()
    expect(parseClientMessage(JSON.stringify({ type: 'move', seq: 3, move: { kind: 'bid', value: 2 } }))).toEqual({
      type: 'move',
      seq: 3,
      move: { kind: 'bid', value: 2 },
    })
  })
})
