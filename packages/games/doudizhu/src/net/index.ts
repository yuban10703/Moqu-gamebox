/**
 * 联机框架（预留）：协议 + 权威牌桌主机 + 本机回环。
 *
 * 现在的单机版：真人 0 号位 + 两个电脑，GameDef 直接驱动 table.ts。
 * 以后接联机，需要补的只有两件事：
 *   1. 传输层：实现 Transport（例如 WebSocket），服务器端用 serveSeat(host, seat, transport) 接到座位上；
 *   2. 客户端：把服务器下发的 SeatView 交给 view.ts 渲染，把按钮翻译成 move 发出去。
 * 规则校验（table.ts）、座位视角（observe.ts）、电脑决策（ai.ts，可用来补空位）都已就绪、两端共用。
 */
export * from './protocol.js'
export * from './host.js'
