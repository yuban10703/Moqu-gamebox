/**
 * 牌桌：扑克类玩法（斗地主）的呈现层，与格子棋盘（Board）平级。
 *
 * 布局（styles.css 的 .eink-cardtable，一张网格）：
 *   [左家]   [底牌]    [右家]
 *   [左家出的牌] [提示] [右家出的牌]
 *   [      自己出的牌 / 状态       ]
 *   [            手牌             ]
 *
 * 1-bit 约定：牌面只有黑白 —— 黑桃 / 梅花实心符号、红桃 / 方块空心符号，王用 ★（大）/ ☆（小）区分；
 * 选中的手牌**抬高一截**（没有动画，位置直接变）；正在出牌的那家头像框加粗；没有任何灰度。
 * 尺寸全部由 CSS 按棋盘区（容器查询）算，JS 只给「每排几张」这种形状信息。
 */
import type { CSSProperties, ReactNode } from 'react'
import type { CardFace, CardTableSeat, CardTableView } from '@eink/core'
import { useUi } from './contexts.js'

const SUIT_GLYPHS: Record<NonNullable<CardFace['suit']>, string> = {
  spade: '♠',
  club: '♣',
  heart: '♡',
  diamond: '♢',
}

function useCardLabel(): (card: CardFace) => string {
  const { i18n } = useUi()
  return (card) => {
    if (card.joker) return i18n.t(card.joker === 'big' ? 'shell.cards.jokerBig' : 'shell.cards.jokerSmall')
    return `${card.suit ? i18n.t(`shell.cards.suit.${card.suit}`) : ''} ${card.rank}`.trim()
  }
}

/** 一张牌的牌面（手牌与桌面上的小牌共用；尺寸由外层 class 决定） */
function Face({ card }: { card: CardFace }): ReactNode {
  const { i18n } = useUi()
  if (card.joker) {
    return (
      <span className="eink-card__corner" aria-hidden="true">
        <span className="eink-card__rank eink-card__rank--joker">{i18n.t('shell.cards.joker')}</span>
        <span className="eink-card__suit">{card.joker === 'big' ? '★' : '☆'}</span>
      </span>
    )
  }
  return (
    <span className="eink-card__corner" aria-hidden="true">
      <span className="eink-card__rank">{card.rank}</span>
      <span className="eink-card__suit">{card.suit ? SUIT_GLYPHS[card.suit] : ''}</span>
    </span>
  )
}

/** 桌面上的一排小牌（底牌 / 各家出的牌）：互相叠压、可折行 */
function CardRow({ cards, hidden = 0 }: { cards: readonly CardFace[]; hidden?: number }): ReactNode {
  const label = useCardLabel()
  const { i18n } = useUi()
  return (
    <span className="eink-cardrow">
      {cards.map((card) => (
        <span
          key={card.id}
          className="eink-card eink-card--small"
          data-joker={card.joker ?? undefined}
          role="img"
          aria-label={label(card)}
        >
          <Face card={card} />
        </span>
      ))}
      {Array.from({ length: hidden }, (_, index) => (
        <span
          key={`hidden-${index}`}
          className="eink-card eink-card--small eink-card--back"
          role="img"
          aria-label={i18n.t('shell.cards.hidden')}
        />
      ))}
    </span>
  )
}

/**
 * 1-bit 头像（自绘线条，不用位图）：编号 1 戴帽子、编号 2 戴兜帽。
 * 只为区分「这是哪一家」，不承载任何状态。
 */
function Avatar({ variant }: { variant: number }): ReactNode {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      {variant % 2 === 1 ? (
        <>
          <path d="M8 47c1.5-9 8-13.5 16-13.5S38.5 38 40 47" fill="none" stroke="#000" strokeWidth="2.4" />
          <circle cx="24" cy="23" r="10" fill="#fff" stroke="#000" strokeWidth="2.4" />
          <path d="M13 20a11 9.5 0 0 1 22 0z" fill="#000" />
          <rect x="11" y="18.5" width="26" height="3" fill="#000" />
          <circle cx="20" cy="25" r="1.7" fill="#000" />
          <circle cx="28" cy="25" r="1.7" fill="#000" />
        </>
      ) : (
        <>
          <path d="M6 47c1-12 8-18 18-18s17 6 18 18z" fill="#000" />
          <path d="M11 30c0-11 5.5-18 13-18s13 7 13 18z" fill="#000" />
          <circle cx="24" cy="25" r="8.5" fill="#fff" />
          <circle cx="20.5" cy="25" r="1.6" fill="#000" />
          <circle cx="27.5" cy="25" r="1.6" fill="#000" />
          <path d="M15 31h18v3H15z" fill="#fff" />
        </>
      )}
    </svg>
  )
}

function SeatBlock({ seat }: { seat: CardTableSeat }): ReactNode {
  const { i18n } = useUi()
  return (
    <div
      className="eink-cardtable__seat"
      data-position={seat.position}
      data-active={seat.active ? 'yes' : 'no'}
      aria-current={seat.active ? 'true' : undefined}
    >
      <span className="eink-cardtable__avatar">
        <Avatar variant={seat.avatar} />
        {seat.badgeKey ? <span className="eink-cardtable__badge">{i18n.t(seat.badgeKey)}</span> : null}
      </span>
      <span className="eink-cardtable__name">{i18n.t(seat.nameKey)}</span>
      {seat.count !== null ? (
        <span className="eink-cardtable__count">{i18n.plural('shell.cards.count', seat.count)}</span>
      ) : null}
    </div>
  )
}

/** 某一家本轮出的牌，或文字状态（不出 / 不叫 / 2 分） */
function Played({ seat }: { seat: CardTableSeat }): ReactNode {
  const { i18n } = useUi()
  return (
    <div className="eink-cardtable__played" data-position={seat.position}>
      {seat.position === 'bottom' && seat.badgeKey ? (
        <span className="eink-cardtable__selftag">
          {i18n.t(seat.nameKey)} · {i18n.t(seat.badgeKey)}
        </span>
      ) : null}
      {seat.played ? <CardRow cards={seat.played} /> : null}
      {seat.statusKey ? (
        <span className="eink-cardtable__status">{i18n.t(seat.statusKey, seat.statusParams)}</span>
      ) : null}
    </div>
  )
}

export interface CardTableProps {
  table: CardTableView
  /** 点手牌：交给游戏的 selectAction（壳层不知道选中意味着什么） */
  onCardSelect?: (id: number) => void
}

export function CardTable({ table, onCardSelect }: CardTableProps): ReactNode {
  const { i18n } = useUi()
  const label = useCardLabel()
  const seat = (position: CardTableSeat['position']): CardTableSeat | undefined =>
    table.seats.find((candidate) => candidate.position === position)
  const left = seat('left')
  const right = seat('right')
  const self = seat('bottom')

  // 手牌超过 10 张分两排（前一排是大牌），两排叠压：上一排露出点数与花色那一截，
  // 并给下一排的选中牌留出抬高的余量（选中的牌不能压住上一排）
  const hand = table.hand
  const perRow = hand.length <= 10 ? Math.max(1, hand.length) : Math.ceil(hand.length / 2)
  const rows = hand.length <= 10 ? [hand] : [hand.slice(0, perRow), hand.slice(perRow)]

  return (
    <div
      className="eink-cardtable"
      data-hand-rows={rows.length}
      style={{ ['--hand-cols' as string]: perRow, ['--hand-total' as string]: Math.max(1, hand.length) } as CSSProperties}
    >
      {left ? <SeatBlock seat={left} /> : null}
      <div className="eink-cardtable__center">
        {table.center ? <CardRow cards={table.center.cards} hidden={table.center.hidden} /> : null}
      </div>
      {right ? <SeatBlock seat={right} /> : null}

      {left ? <Played seat={left} /> : null}
      <div className="eink-cardtable__banner-slot">
        {table.bannerKey ? (
          <span className="eink-cardtable__banner" role="status">
            {i18n.t(table.bannerKey, table.bannerParams)}
          </span>
        ) : null}
      </div>
      {right ? <Played seat={right} /> : null}

      {self ? <Played seat={self} /> : <div className="eink-cardtable__played" data-position="bottom" />}

      <div className="eink-cardtable__hand" role="group" aria-label={i18n.t('shell.cards.hand')}>
        {rows.map((row, rowIndex) => (
          <div className="eink-cardtable__handrow" key={rowIndex}>
            {row.map((card) => (
              <button
                key={card.id}
                type="button"
                className="eink-card eink-card--hand"
                data-selected={card.selected ? 'yes' : 'no'}
                data-joker={card.joker ?? undefined}
                aria-pressed={card.selected ? 'true' : 'false'}
                aria-label={label(card)}
                {...(onCardSelect ? { onClick: () => onCardSelect(card.id) } : {})}
              >
                <Face card={card} />
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
