/**
 * 对决面板：双方轮流行动、各有血量与道具的玩法（恶魔轮盘赌）的呈现层，与格子棋盘 / 牌桌平级。
 *
 *   [上方一家：头像 · 名字 / 角标 / 胜局 · 血量 · 道具]
 *   [枪（锯短时枪管变短）+ 状态标签]
 *   [弹仓：已打出 | 枪里]  [剩余：实弹 n · 空包弹 m]  [一行说明]
 *   [整场记录（可滚动，默认停在最新一条；对手回合的几条合进一个框）]
 *   [下方一家：名字 · 血量 · 道具（点了就是使用）]
 *
 * 1-bit：血量是爱心（实心 / 空心），实弹实心、空包空心，已打出的实弹画斜纹、空包打叉；
 * 没有动画 —— 发生了什么全靠记录用文字交代。尺寸由 CSS 按棋盘区（容器查询）算。
 */
import { useLayoutEffect, useRef, type ReactNode, useState } from 'react'
import type { DuelFireScene, DuelItem, DuelLine, DuelSide, DuelToken, DuelView } from '@eink/core'
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
    case 'adrenaline':
      // 一支注射器：药管 + 推杆 + 针头（1-bit 下靠线宽区分，不靠颜色）
      body = (
        <>
          <rect x="3.5" y="9" width="12" height="6" rx="1" {...stroke} />
          <path d="M15.5 12h4.2" stroke="#000" strokeWidth="2.6" strokeLinecap="round" />
          <path d="M19.7 12h1.8" stroke="#000" strokeWidth="1.4" />
          <path d="M7 9v6M10 9v6M13 9v6" stroke="#000" strokeWidth="1.1" />
          <path d="M3.5 9.6V6.8M3.5 14.4v2.8" stroke="#000" strokeWidth="2.2" strokeLinecap="round" />
        </>
      )
      break
    default:
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
      // 道具名（如「抢走了恶魔的放大镜」里的那件）：i18n key 也要先翻好再当参数传进去
      ...(line.itemKey ? { item: i18n.t(line.itemKey) } : {}),
    })
}

const HEART = 'M12 21 C5 15.6 1.6 12 1.6 7.8 1.6 4.6 4.1 2.4 7 2.4 9.1 2.4 10.9 3.6 12 5.4 13.1 3.6 14.9 2.4 17 2.4 19.9 2.4 22.4 4.6 22.4 7.8 22.4 12 19 15.6 12 21Z'

/** 血量：一格一颗爱心，有血实心、没血空心 */
function Hp({ hp, max }: { hp: number; max: number }): ReactNode {
  const { i18n } = useUi()
  return (
    <span className="eink-duel__hp" role="img" aria-label={i18n.t('shell.duel.hp', { hp, max })}>
      {Array.from({ length: max }, (_, index) => {
        const full = index < hp
        return (
          <svg key={index} className="eink-duel__heart" data-full={full ? 'yes' : 'no'} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d={HEART} fill={full ? '#000' : '#fff'} stroke="#000" strokeWidth="2.2" strokeLinejoin="round" />
          </svg>
        )
      })}
    </span>
  )
}

/** 把连续的高亮行（对手回合）合成一组，壳层给整组画一个框 */
function groupLog(log: readonly DuelLine[]): Array<{ highlight: boolean; lines: Array<{ line: DuelLine; index: number }> }> {
  const groups: Array<{ highlight: boolean; lines: Array<{ line: DuelLine; index: number }> }> = []
  log.forEach((line, index) => {
    const highlight = line.highlight === true
    const last = groups.at(-1)
    if (last && last.highlight === highlight) last.lines.push({ line, index })
    else groups.push({ highlight, lines: [{ line, index }] })
  })
  return groups
}

/** 整场记录：可以往上翻；有新记录时自动停到最新一条 */
function Log({ log }: { log: readonly DuelLine[] }): ReactNode {
  const { i18n } = useUi()
  const line = useLine()
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
  }, [log.length])
  const lastIndex = log.length - 1
  return (
    <div ref={ref} className="eink-duel__log" role="log" aria-label={i18n.t('shell.duel.recent')}>
      {groupLog(log).map((group) => {
        const items = group.lines.map(({ line: entry, index }) => (
          <li key={index} data-latest={index === lastIndex ? 'yes' : 'no'}>
            {line(entry)}
          </li>
        ))
        const key = group.lines[0]!.index
        return group.highlight ? (
          <ol key={key} className="eink-duel__turnbox">
            {items}
          </ol>
        ) : (
          <ol key={key} className="eink-duel__plain">
            {items}
          </ol>
        )
      })}
    </div>
  )
}

function Items({

  side,

  onSelect,

  onSteal,

  stealMode,

}: {

  side: DuelSide

  onSelect?: ((id: number) => void) | undefined

  onSteal?: ((id: number) => void) | undefined

  /** 正处在「用肾上腺素抢一件」的选择状态：对手那几件可选的就成了按钮 */

  stealMode?: boolean | undefined

}): ReactNode {
  const { i18n } = useUi()
  const empty = Math.max(0, side.itemCapacity - side.items.length)
  return (
    <div className="eink-duel__items" data-position={side.position} {...(stealMode ? { 'data-steal': 'yes' } : {})}>
      {side.items.map((item: DuelItem) => {
        const stealing = stealMode === true && item.stealable === true
        const usable = stealing || item.selectable
        const handler = stealing ? onSteal : onSelect
        return (
          <button
            key={item.id}
            type="button"
            className="eink-duel__slot"
            disabled={!usable}
            data-selectable={usable ? 'yes' : 'no'}
            {...(stealing ? { 'data-stealable': 'yes' } : {})}
            {...(handler && usable ? { onClick: () => handler(item.id) } : {})}
          >
          <ItemIcon icon={item.icon} />
          <span className="eink-duel__slotlabel">{i18n.t(item.labelKey)}</span>
          {item.fresh ? <span className="eink-duel__fresh">{i18n.t('shell.duel.fresh')}</span> : null}
        </button>
          )
      })}
      {Array.from({ length: empty }, (_, index) => (
        <span key={`empty-${index}`} className="eink-duel__slot eink-duel__slot--empty" aria-hidden="true" />
      ))}
    </div>
  )
}

function Side({

  side,

  onSelect,

  onSteal,

  stealMode,

}: {

  side: DuelSide

  onSelect?: ((id: number) => void) | undefined

  onSteal?: ((id: number) => void) | undefined

  stealMode?: boolean | undefined

}): ReactNode {
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
        <Items side={side} onSelect={onSelect} onSteal={onSteal} stealMode={stealMode} />
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

/** 枪口爆闪：实心多角星 —— 1-bit 下最醒目的「开火了」 */
function Blast(): ReactNode {
  return (
    <svg className="eink-duel__blast" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <path
        d="M50 1 L59 32 L90 14 L70 43 L99 50 L70 57 L90 86 L59 68 L50 99 L41 68 L10 86 L30 57 L1 50 L30 43 L10 14 L41 32 Z"
        fill="#000"
      />
    </svg>
  )
}

/** 空膛：空心膛口 + 打叉（空包弹那一声「咔」） */
function Dud(): ReactNode {
  return (
    <svg className="eink-duel__dud" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <circle cx="50" cy="50" r="36" fill="none" stroke="#000" strokeWidth="7" />
      <path d="M32 32 L68 68 M68 32 L32 68" stroke="#000" strokeWidth="9" strokeLinecap="round" />
    </svg>
  )
}

/**
 * 开枪定格画面：刚打出的那一枪单独占一屏。
 *
 * 墨水屏没有动画（面板约 2 次整屏刷新/秒），所以「开枪」的打击感只能靠三样东西给：
 * **对比度**（白底黑字 + 大字 + 粗框）、**图形**（实心爆闪 / 空心打叉）、**停多久**
 * （引擎在对手回合多停一拍，见 FIRE_HOLD_MS）。画面一直停到下一次行动为止。
 *
 * 为什么不是黑带白字：那是俄罗斯方块消行特效里试过、用户看过真机后否掉的做法
 * （docs/eink-guidelines.md 第 51 行），这里沿用留下的口径「白底黑字」。
 *
 * 覆盖范围**只有枪 / 弹仓 / 说明那一段**（`.eink-duel__stage` 只包 `.eink-duel__table`）：
 * 战斗记录与两侧的血量、道具始终露着 —— 用户明确要求「不要把战斗日志挡住」，
 * 而且记录里就有这一枪的那一条，翻得到才安心。为此画面压成两行（主行 + 信息行），
 * 高度对齐 table（真机实测 415×172），出现/消失都不会顶动下面的记录。
 */
/**
 * 开枪标记：**加在原来的枪旁边，不盖住任何东西**。
 *
 * 用户要求「画面在原本的基础上改，不要挡住原来的枪和子弹」——所以这里不再是铺满整块的
 * 覆盖层：枪、弹仓、说明照旧显示，标记只是枪右边的一个行内小块。
 * 打击感依旧靠三样东西给（墨水屏没有动画）：**对比度**（白底黑字 + 粗框）、
 * **图形**（实心爆闪 / 空心打叉）、**停多久**（对手回合多停一拍，见 FIRE_HOLD_MS）。
 * 谁打谁、掉几格血、是否击倒都写进下面那行说明里（说明行本来就占着位置，高度不会跳）。
 */
function FireScene({ fire }: { fire: DuelFireScene }): ReactNode {
  const { i18n } = useUi()
  return (
    <span className="eink-duel__fire" data-shell={fire.shell} data-lethal={fire.lethal ? 'yes' : 'no'} role="status">
      {fire.shell === 'live' ? <Blast /> : <Dud />}
      <span className="eink-duel__firetitle">
        {i18n.t(fire.shell === 'live' ? 'shell.duel.fire.live' : 'shell.duel.fire.blank')}
        {fire.damage > 0 ? ` ${i18n.t('shell.duel.fire.damage', { amount: fire.damage })}` : ''}
      </span>
    </span>
  )
}

/** 开枪那一下的说明行：击倒 · 谁打谁 · 掉几格（替换掉平时的说明） */
function fireCaption(
  fire: DuelFireScene,
  i18n: { t: (key: string, params?: Record<string, string | number>) => string },
  nameOf: (pos: 'top' | 'bottom') => string,
): string {
  const parts: string[] = []
  if (fire.lethal) parts.push(i18n.t('shell.duel.fire.knockdown'))
  parts.push(
    fire.shooter === fire.target
      ? i18n.t('shell.duel.fire.self', { subject: nameOf(fire.shooter) })
      : i18n.t('shell.duel.fire.at', { subject: nameOf(fire.shooter), object: nameOf(fire.target) }),
  )
  if (fire.damage > 0) parts.push(i18n.t('shell.duel.fire.lost', { amount: fire.damage }))
  return parts.join(' · ')
}

export interface DuelPanelProps {
  duel: DuelView
  onItemSelect?: (id: number) => void
  /** 肾上腺素选目标：壳层把它接到游戏的 stealAction 上 */
  onStealSelect?: (slot: number) => void
}

export function DuelPanel({ duel, onItemSelect, onStealSelect }: DuelPanelProps): ReactNode {

  const { i18n } = useUi()
  const line = useLine()
  /*
   * 「用肾上腺素抢一件」是**两步**操作：先点自己那件肾上腺素、再点对手那一格。
   * 这一步状态只活在面板里（不进存档、不进规则层）：点肾上腺素进入，点目标或再点一次退出。
   */
  const [stealMode, setStealMode] = useState(false)
  const armed = stealMode && duel.sides.some((side) => side.items.some((item) => item.stealable === true))
  const pick = (side: DuelSide | undefined) =>
    side
      ? (id: number) => {
          const item = side.items.find((entry) => entry.id === id)
          if (item?.labelKey === 'buckshot.item.adrenaline') {
            setStealMode((open) => !open)
            return
          }
          onItemSelect?.(id)
        }
      : undefined
  const steal = (id: number) => {
    setStealMode(false)
    onStealSelect?.(id)
  }
  const top = duel.sides.find((side) => side.position === 'top')
  const bottom = duel.sides.find((side) => side.position === 'bottom')
  return (
    <div className="eink-duel">
      {top ? <Side side={top} onSelect={pick(top)} onSteal={steal} stealMode={armed} /> : null}

      <div className="eink-duel__stage">
        {/* 定格画面盖住这一段时对读屏隐藏：内容由画面负责播报，免得同一枪念两遍 */}
        <section className="eink-duel__table">
          <div className="eink-duel__gunrow">
            <Gun sawn={duel.sawn} />
            {duel.fire ? <FireScene fire={duel.fire} /> : null}
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
            {/*
             * 「已打出」这一组**常驻**：还没开过枪时它只是不画（visibility: hidden），
             * 但位置一直占着 —— 否则首次开枪多出这一组、枪那一段变高，
             * 下面的战斗记录（flex: 1 1 auto）就会被挤矮一截（真机实测差 33px）。
             */}
            <span className="eink-duel__spent" data-empty={duel.spent.length > 0 ? 'no' : 'yes'}>
              <span className="eink-duel__label">{i18n.t('shell.duel.spent')}</span>
              {duel.spent.map((kind, index) => (
                <Token key={`s-${index}`} kind={kind} spent />
              ))}
              <span className="eink-duel__sep" aria-hidden="true" />
            </span>
            <span className="eink-duel__label">{i18n.t('shell.duel.chamber')}</span>
            {duel.chamber.map((kind, index) => (
              <Token key={`c-${index}`} kind={kind} />
            ))}
          </div>
          {/*
           * 「剩余」行同样常驻：装填阶段没有它，但空行要占着 —— 否则点「开始」时
           * 这一行凭空出现，日志又会被挤矮（真机实测 142 → 109）。
           */}
          <p className="eink-duel__remaining" {...(duel.remaining ? {} : { 'aria-hidden': true })}>
            {duel.remaining ? line(duel.remaining) : '\u00a0'}
          </p>
          <p className="eink-duel__caption" role="status">
            {armed
              ? i18n.t('buckshot.steal.pick')
              : duel.fire
                ? fireCaption(duel.fire, i18n, (pos) => i18n.t((pos === 'top' ? top : bottom)?.nameKey ?? ''))
                : line(duel.caption)}
          </p>
        </section>

      </div>

      <Log log={duel.log} />

      {bottom ? <Side side={bottom} onSelect={pick(bottom)} onSteal={steal} stealMode={armed} /> : null}
    </div>
  )
}
