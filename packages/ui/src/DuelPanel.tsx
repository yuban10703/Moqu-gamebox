/**
 * 对决面板：双方轮流行动、各有血量与道具的玩法（恶魔轮盘赌）的呈现层，与格子棋盘 / 牌桌平级。
 *
 *   [上方一家：头像 · 名字 / 角标 / 胜局 · 血量 · 道具]
 *   [枪（锯短时枪管变短）+ 状态标签]
 *   [弹仓：已打出 | 枪里]  [一行说明]
 *   [最近记录（最多 4 条）]
 *   [下方一家：名字 · 血量 · 道具（点了就是使用）]
 *
 * 1-bit：血量是电池格（实心 / 空心），实弹实心、空包空心，已打出的实弹画斜纹、空包打叉；
 * 没有动画 —— 发生了什么全靠「最近」记录用文字交代。尺寸由 CSS 按棋盘区（容器查询）算。
 */
import type { ReactNode } from 'react'
import type { DuelItem, DuelLine, DuelSide, DuelToken, DuelView } from '@eink/core'
import { useUi } from './contexts.js'

/** 道具图标（24×24 线条，黑白）：未知名字回退成一个空方框 */
function ItemIcon({ icon }: { icon: string }): ReactNode {
  const stroke = { fill: 'none', stroke: '#000', strokeWidth: 2.2 } as const
  let body: ReactNode
  switch (icon) {
    case 'magnifier':
      body = (
        <>
          <circle cx="10" cy="10" r="6.5" {...stroke} />
          <path d="M15 15l6.5 6.5" stroke="#000" strokeWidth="3" strokeLinecap="round" />
        </>
      )
      break
    case 'cigarettes':
      body = (
        <>
          <rect x="2.5" y="13" width="19" height="5" {...stroke} />
          <rect x="17" y="13" width="4.5" height="5" fill="#000" />
          <path d="M7 10c-1.6-2.4 1.6-3.2 0-5.6M11 10c-1.6-2.4 1.6-3.2 0-5.6" {...stroke} strokeWidth="1.6" />
        </>
      )
      break
    case 'beer':
      body = (
        <>
          <rect x="7" y="4.5" width="10" height="17" rx="1.5" {...stroke} />
          <path d="M7 9h10M7 17h10" stroke="#000" strokeWidth="1.4" />
          <rect x="9.5" y="2" width="5" height="2.5" fill="#000" />
        </>
      )
      break
    case 'handcuffs':
      body = (
        <>
          <circle cx="7" cy="14" r="4.8" {...stroke} />
          <circle cx="17" cy="14" r="4.8" {...stroke} />
          <path d="M11 11.5h2" stroke="#000" strokeWidth="2.4" />
        </>
      )
      break
    case 'saw':
      body = (
        <>
          <path d="M2 15h14l-1.5 5h-11z" fill="#000" />
          <path d="M3.5 15l1.5-2.4 1.5 2.4 1.5-2.4 1.5 2.4 1.5-2.4 1.5 2.4 1.5-2.4" {...stroke} strokeWidth="1.3" />
          <rect x="16" y="8" width="5.5" height="10" rx="1.5" {...stroke} />
        </>
      )
      break
    case 'phone':
      body = (
        <>
          <rect x="7" y="2.5" width="10" height="19" rx="2" {...stroke} />
          <rect x="9" y="5.5" width="6" height="9" fill="#000" />
          <circle cx="12" cy="18" r="1.3" fill="#000" />
        </>
      )
      break
    case 'inverter':
      body = (
        <>
          <path d="M4 9h13l-3-3M20 15H7l3 3" {...stroke} />
          <circle cx="12" cy="12" r="10" {...stroke} strokeWidth="1.4" />
        </>
      )
      break
    case 'medicine':
      body = (
        <>
          <rect x="4" y="8" width="16" height="8" rx="4" {...stroke} />
          <path d="M12 8v8" stroke="#000" strokeWidth="2" />
          <path d="M12 8h4a4 4 0 0 1 0 8h-4z" fill="#000" />
        </>
      )
      break
    default:
      body = <rect x="5" y="5" width="14" height="14" {...stroke} />
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {body}
    </svg>
  )
}

/** 头像（1-bit 自绘）：恶魔 / 玩家；未知名字画一个通用人像 */
function Portrait({ name }: { name: string }): ReactNode {
  if (name === 'devil') {
    return (
      <svg viewBox="0 0 96 96" aria-hidden="true" focusable="false">
        <path d="M22 30 L12 6 L34 22 Z M74 30 L84 6 L62 22 Z" fill="#000" />
        <path d="M18 44c0-20 13-30 30-30s30 10 30 30v12c0 18-13 30-30 30S18 74 18 56z" fill="#000" />
        <path d="M30 42l12 6-12 4z M66 42l-12 6 12 4z" fill="#fff" />
        <path d="M30 64c6 8 30 8 36 0l-4 10c-8 5-20 5-28 0z" fill="#fff" />
        <path d="M36 66v6M42 67v7M48 67v7M54 67v7M60 66v6" stroke="#000" strokeWidth="2" />
      </svg>
    )
  }
  const mark = name === 'player2' ? '2' : name === 'player1' ? '1' : ''
  return (
    <svg viewBox="0 0 96 96" aria-hidden="true" focusable="false">
      <circle cx="48" cy="36" r="18" fill="none" stroke="#000" strokeWidth="5" />
      <path d="M16 92c2-20 16-30 32-30s30 10 32 30" fill="none" stroke="#000" strokeWidth="5" />
      {mark ? (
        <text x="48" y="44" textAnchor="middle" fontSize="24" fontWeight="700" fontFamily="system-ui, sans-serif">
          {mark}
        </text>
      ) : null}
    </svg>
  )
}

function useLine(): (line: DuelLine) => string {
  const { i18n } = useUi()
  return (line) =>
    i18n.t(line.key, {
      ...line.params,
      ...(line.subjectKey ? { subject: i18n.t(line.subjectKey) } : {}),
      ...(line.objectKey ? { object: i18n.t(line.objectKey) } : {}),
    })
}

function Hp({ hp, max }: { hp: number; max: number }): ReactNode {
  const { i18n } = useUi()
  return (
    <span className="eink-duel__hp" role="img" aria-label={i18n.t('shell.duel.hp', { hp, max })}>
      {Array.from({ length: max }, (_, index) => (
        <span key={index} className="eink-duel__cell" data-full={index < hp ? 'yes' : 'no'} />
      ))}
    </span>
  )
}

function Items({
  side,
  onSelect,
}: {
  side: DuelSide
  onSelect?: ((id: number) => void) | undefined
}): ReactNode {
  const { i18n } = useUi()
  const empty = Math.max(0, side.itemCapacity - side.items.length)
  return (
    <div className="eink-duel__items" data-position={side.position}>
      {side.items.map((item: DuelItem) => (
        <button
          key={item.id}
          type="button"
          className="eink-duel__slot"
          disabled={!item.selectable}
          data-selectable={item.selectable ? 'yes' : 'no'}
          {...(onSelect && item.selectable ? { onClick: () => onSelect(item.id) } : {})}
        >
          <ItemIcon icon={item.icon} />
          <span className="eink-duel__slotlabel">{i18n.t(item.labelKey)}</span>
          {item.fresh ? <span className="eink-duel__fresh">{i18n.t('shell.duel.fresh')}</span> : null}
        </button>
      ))}
      {Array.from({ length: empty }, (_, index) => (
        <span key={`empty-${index}`} className="eink-duel__slot eink-duel__slot--empty" aria-hidden="true" />
      ))}
    </div>
  )
}

function Side({ side, onSelect }: { side: DuelSide; onSelect?: ((id: number) => void) | undefined }): ReactNode {
  const { i18n } = useUi()
  const head = (
    <div className="eink-duel__head">
      <span className="eink-duel__name">{i18n.t(side.nameKey)}</span>
      {side.statusKey ? <span className="eink-duel__status">{i18n.t(side.statusKey)}</span> : null}
      {side.wins > 0 ? <span className="eink-duel__wins">{i18n.t('shell.duel.wins', { count: side.wins })}</span> : null}
      <Hp hp={side.hp} max={side.maxHp} />
    </div>
  )
  return (
    <section
      className="eink-duel__side"
      data-position={side.position}
      data-active={side.active ? 'yes' : 'no'}
      aria-current={side.active ? 'true' : undefined}
    >
      {side.position === 'top' ? (
        <span className="eink-duel__portrait">
          <Portrait name={side.portrait} />
        </span>
      ) : null}
      <div className="eink-duel__info">
        {head}
        <Items side={side} onSelect={onSelect} />
      </div>
    </section>
  )
}

function Token({ kind, spent = false }: { kind: DuelToken | 'live' | 'blank'; spent?: boolean }): ReactNode {
  const { i18n } = useUi()
  const label = i18n.t(`shell.duel.token.${spent ? `spent-${kind}` : kind}`)
  return (
    <span className="eink-duel__token" data-kind={kind} data-spent={spent ? 'yes' : 'no'} role="img" aria-label={label}>
      {kind === 'unknown' ? '?' : null}
    </span>
  )
}

function Gun({ sawn }: { sawn: boolean }): ReactNode {
  const barrel = sawn ? 70 : 120
  return (
    <svg className="eink-duel__gun" viewBox="0 0 300 64" aria-hidden="true" focusable="false" preserveAspectRatio="xMinYMid meet">
      <path d="M6 44 Q28 30 76 28 L116 26 L116 44 L94 44 Q88 52 78 52 L68 46 Q38 50 14 58 Z" fill="#000" />
      <rect x="116" y="20" width="56" height="26" rx="3" fill="#000" />
      <path d="M126 46 q6 12 18 10" fill="none" stroke="#000" strokeWidth="3" />
      <rect x="172" y="22" width={barrel} height="9" fill="#000" />
      <rect x="172" y="34" width={barrel} height="9" fill="#000" />
      {sawn ? (
        <path d={`M${172 + barrel} 20 l6 6 -6 6 6 6 -6 6`} fill="none" stroke="#000" strokeWidth="2.4" />
      ) : null}
    </svg>
  )
}

export interface DuelPanelProps {
  duel: DuelView
  /** 点道具：交给游戏的 selectAction（编号由游戏给） */
  onItemSelect?: (id: number) => void
}

export function DuelPanel({ duel, onItemSelect }: DuelPanelProps): ReactNode {
  const { i18n } = useUi()
  const line = useLine()
  const top = duel.sides.find((side) => side.position === 'top')
  const bottom = duel.sides.find((side) => side.position === 'bottom')
  return (
    <div className="eink-duel">
      {top ? <Side side={top} onSelect={onItemSelect} /> : null}

      <section className="eink-duel__table">
        <div className="eink-duel__gunrow">
          <Gun sawn={duel.sawn} />
          {duel.tags.length > 0 ? (
            <span className="eink-duel__tags">
              {duel.tags.map((tag) => (
                <span key={tag.key} className="eink-duel__tag">
                  {line(tag)}
                </span>
              ))}
            </span>
          ) : null}
        </div>
        <div className="eink-duel__chamber">
          {duel.spent.length > 0 ? (
            <>
              <span className="eink-duel__label">{i18n.t('shell.duel.spent')}</span>
              {duel.spent.map((kind, index) => (
                <Token key={`s-${index}`} kind={kind} spent />
              ))}
              <span className="eink-duel__sep" aria-hidden="true" />
            </>
          ) : null}
          <span className="eink-duel__label">{i18n.t('shell.duel.chamber')}</span>
          {duel.chamber.map((kind, index) => (
            <Token key={`c-${index}`} kind={kind} />
          ))}
        </div>
        <p className="eink-duel__caption" role="status">
          {line(duel.caption)}
        </p>
      </section>

      <ol className="eink-duel__log" aria-label={i18n.t('shell.duel.recent')}>
        {duel.log.map((entry, index) => (
          <li key={`${index}-${entry.key}`} data-latest={index === duel.log.length - 1 ? 'yes' : 'no'}>
            {line(entry)}
          </li>
        ))}
      </ol>

      {bottom ? <Side side={bottom} onSelect={onItemSelect} /> : null}
    </div>
  )
}
