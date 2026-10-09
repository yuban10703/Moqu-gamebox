/**
 * 牌桌：扑克类玩法（斗地主）的呈现层，与格子棋盘（Board）平级。
 *
 * 两套布局，由 `CardTableView.piles` 选（**可选**，缺省还是老样子）：
 *
 * 1) 老布局 —— 手牌制（斗地主等）：
 *   [左家]   [底牌]    [右家]
 *   [左家出的牌] [提示] [右家出的牌]
 *   [      自己出的牌 / 状态       ]
 *   [            手牌             ]
 *
 * 2) 牌堆布局 —— 一桌多个可点牌堆（空当接龙；见下面的 Piles）：
 *   [            提示             ]
 *   [ 横排牌堆: 抽牌堆 弃牌堆 基础堆… ]   ← layout:'row'
 *   [ 竖排牌列 × 7（各自可点）        ]   ← layout:'stack'
 *
 * 1-bit 约定：牌面只有黑白 —— 黑桃 / 梅花实心符号、红桃 / 方块空心符号，王用 ★（大）/ ☆（小）区分；
 * 选中的手牌**抬高一截**（没有动画，位置直接变）；正在出牌的那家头像框加粗；牌背是斜纹不是字符；
 * 选中的牌堆靠线型 / 线宽 / 反白，不靠灰度。没有任何灰度。
 * 尺寸全部由 CSS 按棋盘区（容器查询）算，JS 只给「每排几张」「这一堆第几张」这种形状信息。
 */
import type { CSSProperties, ReactNode } from 'react'
import type { CardFace, CardPileView, CardTableSeat, CardTableView } from '@eink/core'
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

/**
 * 一个牌堆（`CardTableView.piles` 里的一项）：小标题 + 张数 + 这一堆的牌。
 *
 * 画法（1-bit：靠形状与线宽，不靠灰度）：
 *   - `row`（横排牌堆：抽牌堆 / 弃牌堆 / 基础堆）：一排 6 个堆**均分**这一行的宽度
 *     （不会因为"这堆 24 张、那堆 1 张"就忽宽忽窄），牌宽取「均分宽 × 0.78」并夹 48px 触摸下限；
 *     省下来的那截宽度就是同一堆里后面几张露出来的部分 —— 439 竖屏每个堆 64.7px、牌 49px，
 *     弃牌堆的 3 张各露约 5px；1248 横屏每个堆 191px、牌 84px（封顶），各露约 38px。
 *     张数另外写在小标题下面（窄屏上牌缝可能只有几像素，张数是唯一的"这一堆有多厚"）。
 *   - `stack`（竖排牌列：7 个牌列）：牌自上而下叠，每一步的位移由 CSS 算
 *     `min(牌高 × 0.34, (可用高 − 牌高) / (槽位数 − 1))` 再夹 0 —— 牌再多也只会越叠越紧，
 *     绝不会把牌顶出棋盘区（19 张的长列也一样）。
 *   - **数组第一张在最上层**（用 z-index，后画的先被压住）：这与空当接龙 `clickTargets()`
 *     的顺序一致 —— 牌列按「从列顶往里」排，第一张就是那张能拿走的明牌，它必须完整可见、可点；
 *     其余每张露在下方的那一截就是它的可点区域（点它 = 从这一张开始提起来）。
 *   - 牌背（`faceDown` 的牌 + `hidden` 那几张）只画斜纹（styles.css 的 .eink-card--back），
 *     不画点数花色，也**不用字符冒充**（`▨` 在 1-bit 上会被读成「这张牌面就是 ▨」）。
 *   - `hidden` 那几张没有 id、点不动：它们是 `<span>`（本来也没有事件），
 *     CSS 里再补一条 pointer-events: none，免得盖在底下的可点牌上把点击吃掉。
 *   - **空堆**（`cards: []`）给了 `id` 时，空位本身渲染成一个 `<button>`（虚线、整块牌区），
 *     点击回传这个 id —— 空当接龙「把 K 放到空列」「把 A 放进空基础堆」靠它才有下手的地方；
 *     没给 `id` 的空堆保持原来的虚线占位（不可点）。
 */
function Pile({ pile, onCardSelect }: { pile: CardPileView; onCardSelect?: (id: number) => void }): ReactNode {
  const { i18n } = useUi()
  const label = useCardLabel()
  const slots = pile.cards.length + pile.hidden
  // 空堆的空位编号：这一堆**一张牌都没画**（cards 为空）时才可能有空位 ——
  // 与其他堆一样，`hidden` 那几张只是画出来的牌背，不参与「有没有空位」这个判断。
  const emptyId = pile.cards.length === 0 ? pile.id : undefined
  return (
    <div
      className="eink-pile"
      data-layout={pile.layout}
      data-selected={pile.selected ? 'yes' : 'no'}
      data-empty={slots === 0 ? 'yes' : 'no'}
      role="group"
      aria-label={i18n.t(pile.labelKey)}
      // CSS 只拿「这一堆有几个槽位」算叠合步长；张数 − 1 至少为 1，免得出现除以 0 的 calc
      style={{ ['--pile-slots-1' as string]: Math.max(1, slots - 1) } as CSSProperties}
    >
      <span className="eink-pile__head">
        <span className="eink-pile__label">{i18n.t(pile.labelKey)}</span>
        <span className="eink-pile__count">{i18n.plural('shell.cards.count', slots)}</span>
      </span>
      <div className="eink-pile__cards">
        {/*
          空堆的空位（游戏给了 id）：整块牌区是一个可点按钮，点击回传这个 id。
          画在牌与牌背**之前**：万一这一堆还有 hidden 张牌背，它们（pointer-events: none、z-index 更高）
          会盖在空位上面，点击照样落到这个按钮上。
          无障碍名用「堆名 · 张数」—— 与堆名同名的空按钮读起来等于没说，加上「0 张」才知道这是个空位。
        */}
        {emptyId !== undefined ? (
          <button
            type="button"
            className="eink-card eink-card--pile"
            data-empty="yes"
            aria-label={`${i18n.t(pile.labelKey)} · ${i18n.plural('shell.cards.count', slots)}`}
            style={{ zIndex: 0 } as CSSProperties}
            {...(onCardSelect ? { onClick: () => onCardSelect(emptyId) } : {})}
          />
        ) : null}
        {pile.cards.map((card, index) => (
          <button
            key={card.id}
            type="button"
            className={card.faceDown ? 'eink-card eink-card--pile eink-card--back' : 'eink-card eink-card--pile'}
            data-selected={card.selected ? 'yes' : 'no'}
            data-face-down={card.faceDown ? 'yes' : undefined}
            data-joker={card.joker ?? undefined}
            aria-pressed={card.selected ? 'true' : 'false'}
            aria-label={card.faceDown ? i18n.t('shell.cards.hidden') : label(card)}
            // --i = 这一堆里的第几个槽位（CSS 用它乘出叠合位移）；z-index 让第一张压在最上面
            style={{ ['--i' as string]: index, zIndex: slots - index } as CSSProperties}
            {...(onCardSelect ? { onClick: () => onCardSelect(card.id) } : {})}
          >
            {card.faceDown ? null : <Face card={card} />}
          </button>
        ))}
        {Array.from({ length: pile.hidden }, (_, index) => (
          <span
            key={`back-${index}`}
            className="eink-card eink-card--pile eink-card--back"
            data-face-down="yes"
            role="img"
            aria-label={i18n.t('shell.cards.hidden')}
            style={
              {
                ['--i' as string]: pile.cards.length + index,
                zIndex: pile.hidden - index,
              } as CSSProperties
            }
          />
        ))}
      </div>
    </div>
  )
}

/**
 * 牌堆布局（只在游戏给了 `CardTableView.piles` 时走这条路）：
 *   上排 = `layout:'row'` 的牌堆横排；下排 = `layout:'stack'` 的牌堆按 7 列网格竖排。
 *
 * 提示行（「点一张牌 / 再点目标牌堆」）**常驻占位**：没有提示时它是空的、由 CSS 的 :empty 收掉高度，
 * 但网格行永远在同一位置 —— 提示出现 / 消失时下面两排不会跳一下（墨水屏上跳动很显眼）。
 */
function Piles({ table, onCardSelect }: CardTableProps): ReactNode {
  const { i18n } = useUi()
  const piles = table.piles ?? []
  const rows = piles.filter((pile) => pile.layout === 'row')
  const stacks = piles.filter((pile) => pile.layout !== 'row')
  return (
    <div className="eink-cardtable eink-cardtable--piles" data-piles={piles.length}>
      <div className="eink-cardpiles__hint-slot">
        {table.bannerKey ? (
          <span className="eink-cardpiles__hint" role="status">
            {i18n.t(table.bannerKey, table.bannerParams)}
          </span>
        ) : null}
      </div>
      <div className="eink-cardpiles__row">
        {rows.map((pile, index) => (
          <Pile key={`row-${index}-${pile.labelKey}`} pile={pile} {...(onCardSelect ? { onCardSelect } : {})} />
        ))}
      </div>
      <div className="eink-cardpiles__grid">
        {stacks.map((pile, index) => (
          <Pile key={`stack-${index}-${pile.labelKey}`} pile={pile} {...(onCardSelect ? { onCardSelect } : {})} />
        ))}
      </div>
    </div>
  )
}

export function CardTable({ table, onCardSelect }: CardTableProps): ReactNode {
  const { i18n } = useUi()
  const label = useCardLabel()
  const seat = (position: CardTableSeat['position']): CardTableSeat | undefined =>
    table.seats.find((candidate) => candidate.position === position)
  const left = seat('left')
  const right = seat('right')
  const self = seat('bottom')

  /*
   * 牌堆布局：**只有给了 piles 且非空**才走这条路。
   * 不给（其余玩法）时下面那段手牌布局一个字节都没变 —— 这条分支就是「缺省行为不变」的保证。
   */
  if (table.piles && table.piles.length > 0) return <Piles table={table} {...(onCardSelect ? { onCardSelect } : {})} />

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
