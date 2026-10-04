/**
 * 壳层组件。全部遵守墨水屏交互规范：
 * - 无动画、无过渡、无透明度叠加；
 * - 状态区分靠符号 + 线型 + 文字，不只靠灰阶；
 * - 主操作是可见按钮，且不小于 48px；
 * - 计时等每秒变化的内容隔离在小组件里，不驱动整页重绘。
 */
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import {
  type BoardView,
  type CellKind,
  type ControlSpec,
  type DpadLayout,
  type MoveDir,
} from '@eink/core'
import { useUi } from './contexts.js'

export interface ActionButtonProps {
  labelKey?: string
  text?: string
  onSelect: () => void
  disabled?: boolean
  emphasis?: 'primary' | 'normal'
  tone?: 'normal' | 'muted'
  size?: 'normal' | 'large'
  titleKey?: string
}

export function ActionButton({
  labelKey,
  text,
  onSelect,
  disabled = false,
  emphasis = 'normal',
  tone = 'normal',
  size = 'normal',
}: ActionButtonProps): ReactNode {
  const { i18n } = useUi()
  const label = text ?? (labelKey ? i18n.t(labelKey) : '')
  return (
    <button
      type="button"
      className="eink-button"
      data-emphasis={emphasis}
      data-tone={tone}
      data-size={size}
      disabled={disabled}
      onClick={onSelect}
    >
      {label}
    </button>
  )
}

export interface TopBarProps {
  title: string
  subtitle?: string
  onBack?: () => void
  children?: ReactNode
}

export function TopBar({ title, subtitle, onBack, children }: TopBarProps): ReactNode {
  const { i18n } = useUi()
  return (
    <header className="eink-topbar">
      {onBack ? (
        <button type="button" className="eink-button eink-button--back" onClick={onBack}>
          ‹ {i18n.t('shell.nav.back')}
        </button>
      ) : null}
      <div className="eink-topbar__title">
        <h1>{title}</h1>
        {subtitle ? <p className="eink-topbar__subtitle">{subtitle}</p> : null}
      </div>
      <div className="eink-topbar__actions">{children}</div>
    </header>
  )
}

export interface StatBarProps {
  /**
   * 固定列数。用于游戏页：统计栏若用 flex-wrap，数值从 0:00 涨到 0:07 就可能多出一行，
   * 高度一变棋盘就被顶动（实测竖屏下「用时」会换行导致画面移动）。
   */
  columns?: number
  stats: ReadonlyArray<{ labelKey: string; value: string; text?: string }>
  children?: ReactNode
}

export function StatBar({ stats, children, columns }: StatBarProps): ReactNode {
  const { i18n } = useUi()
  // 指定列数时用固定网格：行数不再随数值宽度变化，高度因此恒定。
  // 不指定则沿用 flex-wrap（普通信息页可以接受换行）。
  const fixed = columns !== undefined && columns > 0
  const style = fixed
    ? ({ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } as CSSProperties)
    : undefined
  return (
    <dl
      className={fixed ? 'eink-stats eink-stats--fixed' : 'eink-stats'}
      {...(style ? { style } : {})}
    >
      {stats.map((stat) => (
        <div className="eink-stats__item" key={stat.labelKey}>
          <dt>{stat.text ?? i18n.t(stat.labelKey)}</dt>
          <dd>{stat.value}</dd>
        </div>
      ))}
      {children}
    </dl>
  )
}

/** 计时器：自带 1 秒节拍，只有它自己重渲染 */
export function Timer({
  elapsedRef,
  levelStartRef,
  active,
  labelKey = 'shell.common.time',
}: {
  elapsedRef: { current: number }
  levelStartRef: { current: number }
  active: boolean
  labelKey?: string
}): ReactNode {
  const { i18n } = useUi()
  const [, force] = useState(0)

  useEffect(() => {
    if (!active) return
    let last = Date.now()
    const interval = window.setInterval(() => {
      const tick = Date.now()
      elapsedRef.current += tick - last
      last = tick
      force((value) => value + 1)
    }, 1000)
    return () => {
      const tick = Date.now()
      elapsedRef.current += tick - last
      window.clearInterval(interval)
    }
  }, [active, elapsedRef])

  const seconds = Math.max(0, Math.floor((elapsedRef.current - levelStartRef.current) / 1000))
  const minutes = Math.floor(seconds / 60)
  const text = `${minutes}:${String(seconds % 60).padStart(2, '0')}`
  return (
    <div className="eink-stats__item">
      <dt>{i18n.t(labelKey)}</dt>
      <dd>{text}</dd>
    </div>
  )
}

/**
 * 棋盘格子的图形。
 *
 * 从文本符号（○ □ ◼ ▲ △）改成内联 SVG 的原因：文本字形随系统字体变化、无法加纹理、
 * 也无法保证在任意格子尺寸下形状稳定。
 *
 * 状态区分靠形状与填充（不靠灰度，墨水屏面板只有 1-bit）：
 *   箱子      = 空心板条箱（对角线交叉）   箱子在目标点 = 实心板条箱 + 白斜线
 *   角色      = 人形剪影                   角色在目标点 = 目标圆环 + 缩小的剪影
 *   目标点    = 圆环
 *
 * 箱子会**占满整个格子**（见 styles.css 里 `.eink-board__cell[data-kind='box'] > svg`）：
 * 推箱子的箱体本来就是格子的内容，留白反而让箱子和地板混淆；占满后「箱体/通道」一眼可分。
 */
/** 以「文字」呈现的格子：数字/符号在墨水屏上比图形更清楚，且天然是 1-bit */
// floor 也纳入：迷宫用 `floor` + `·` 标记已走过的路径（推箱子的 floor glyph 为空，不受影响）
const TEXT_KINDS: ReadonlySet<CellKind> = new Set<CellKind>(['tile', 'given', 'number', 'flag', 'mine', 'floor'])

/** 身体一节朝各方向伸出的那一段（管宽 18/24，从格子中心伸到格边） */
const SEGMENT_ARMS: Record<MoveDir, { x: number; y: number; width: number; height: number }> = {
  up: { x: 3, y: 0, width: 18, height: 12 },
  down: { x: 3, y: 12, width: 18, height: 12 },
  left: { x: 0, y: 3, width: 12, height: 18 },
  right: { x: 12, y: 3, width: 12, height: 18 },
}

/** 有朝向的图形都按「朝上」画好，再整体旋转（SVG 坐标系 y 向下，顺时针为正） */
const FACING_DEGREES: Record<MoveDir, number> = { up: 0, right: 90, down: 180, left: 270 }

function BoardGlyph({
  kind,
  bold,
  facing,
  links,
}: {
  kind: CellKind
  bold: boolean
  facing?: MoveDir | undefined
  links?: readonly MoveDir[] | undefined
}): ReactNode {
  if (kind === 'floor' || kind === 'wall' || TEXT_KINDS.has(kind)) return null
  const stroke = bold ? 2.6 : 1.6
  const thin = bold ? 2 : 1.1
  // 尺寸交给 CSS（.eink-board__cell > svg 按格子的百分比给），因此只写 viewBox
  const common = {
    viewBox: '0 0 24 24',
    'aria-hidden': true,
    focusable: false,
  } as const

  /*
   * 贪吃蛇的三段（纯黑实心，1-bit 下最稳），都是同一根宽 18/24 的「管」：
   * - 身体（segment + links）：中心一个圆，朝每个相连的方向伸到格边 —— 相邻格接成连续的管，
   *   拐弯处外角是圆的、内角是直的；两侧各留 3/24 白边，蛇身贴着自己走时两段仍分得开；
   * - 头（head + facing）：后端平直、接住身体，前端半圆；两只白色圆眼睛靠前 —— 一眼看出往哪走；
   * - 尾（tail + facing）：从接身体的宽底收成尖，尖端指向远离身体的方向。
   */
  if (kind === 'segment') {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="9" fill="#000" />
        {(links ?? []).map((dir) => (
          <rect key={dir} {...SEGMENT_ARMS[dir]} fill="#000" />
        ))}
      </svg>
    )
  }
  if (kind === 'head' || kind === 'tail') {
    const rotate = `rotate(${FACING_DEGREES[facing ?? 'up']} 12 12)`
    return (
      <svg {...common}>
        <g transform={rotate}>
          {kind === 'head' ? (
            <>
              <path d="M3 24V12a9 9 0 0 1 18 0v12z" fill="#000" />
              <circle cx="8.3" cy="10.8" r="2.3" fill="#fff" />
              <circle cx="15.7" cy="10.8" r="2.3" fill="#fff" />
            </>
          ) : (
            <path d="M3 24C4.5 15.5 8.5 8 12 2.5 15.5 8 19.5 15.5 21 24z" fill="#000" />
          )}
        </g>
      </svg>
    )
  }
  if (kind === 'goal') {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="6.5" fill="none" stroke="#000" strokeWidth={stroke} />
      </svg>
    )
  }
  if (kind === 'box') {
    return (
      <svg {...common}>
        {/* 板条箱：外框 + 对角线，外框贴着格子边（占满） */}
        <rect x="1" y="1" width="22" height="22" fill="none" stroke="#000" strokeWidth={stroke} />
        <path d="M1 1 L23 23 M23 1 L1 23" stroke="#000" strokeWidth={thin} />
      </svg>
    )
  }
  if (kind === 'boxOnGoal') {
    return (
      <svg {...common}>
        {/* 已就位：实心箱体 + 白斜线，与空心箱子一眼可分 */}
        <rect x="1" y="1" width="22" height="22" fill="#000" />
        <path d="M1 1 L23 23 M23 1 L1 23" stroke="#fff" strokeWidth={thin} />
      </svg>
    )
  }
  if (kind === 'player') {
    return (
      <svg {...common}>
        {/* 人形剪影：头 + 肩 */}
        <circle cx="12" cy="7.4" r="4" fill="#000" />
        <path d="M4.6 21c0-4.1 3.3-7 7.4-7s7.4 2.9 7.4 7z" fill="#000" />
      </svg>
    )
  }
  if (kind === 'playerOnGoal') {
    // 目标圆环 + 缩小的人形，语义就是「站在目标点上」
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="10" fill="none" stroke="#000" strokeWidth={stroke} />
        <circle cx="12" cy="8.6" r="3.2" fill="#000" />
        <path d="M6.6 19.4c0-3.2 2.4-5.4 5.4-5.4s5.4 2.2 5.4 5.4z" fill="#000" />
      </svg>
    )
  }
  // 其余 kind（empty / hidden / flag / mine / number / tile / given 等通用格子）不画图形。
  // 这里**必须显式返回 null**：原先用的是兜底 return，落进「人形+圆环」分支，
  // 导致数独、扫雷、2048 的空白格都画上了推箱子的人物图标。
  return null
}

export interface BoardProps {
  /** 「加粗线条」设置：加粗 SVG 线宽，方便墨水屏上辨认 */
  bold?: boolean
  board: BoardView
  /** 无障碍标签：优先用游戏包提供的 i18n key；缺省时回退到 glyph */
  labelFor?: (kind: CellKind, index: number, glyph: string) => string
  onCellSelect?: (index: number) => void
}

/**
 * 棋盘：DOM 网格渲染。
 * 选择 DOM 而不是 Canvas 的原因：网页侧无法承诺像素级局部刷新，
 * 而 DOM 让系统自己做最小重绘；文字用系统字体，中文不会缺字。
 *
 * 尺寸：格子大小、棋盘宽高、外框线宽**全部由 CSS 决定**（styles.css 的 .eink-board：
 * 容器查询 100cqw/100cqh + min()）。这里只给出棋盘的**形状**（列数/行数）——
 * 那是数据，不是布局。JS 不再参与任何像素计算。
 */
export function Board({ board, labelFor, onCellSelect, bold = false }: BoardProps): ReactNode {
  /*
   * 有"未翻开"的格子（扫雷未翻格 / 记忆配对扣着的牌）时，在棋盘上打一个标记：
   * 斜纹底纹**画在棋盘这一层**（styles.css 的 .eink-board[data-cover='yes']），未翻格透明透出底纹、
   * 翻开的格子白底/黑底盖住底纹。逐格铺底纹会让每个格子的图案各从一个原点开始 ——
   * 45° 线在格边错位（用户报「斜纹斜着对不齐」），所以只能整盘铺一份。
   */
  const hasCovered = board.cells.some((cell) => cell.kind === 'hidden')
  const style = {
    ['--board-cols' as string]: board.cols,
    ['--board-rows' as string]: board.rows,
  } as CSSProperties
  // 组边界（例如数独每 3 格）画更粗的分隔线，否则分组结构看不出来
  const groups = board.groups
  /*
   * 同块合并：只去掉**共享的那条边**两侧的格线。
   * 棋子朝外的那条边必须留着，否则一整块就没有外框了。
   */
  const mergeLeft = (index: number): boolean => {
    const col = index % board.cols
    return col > 0 && board.cells[index - 1]?.mergeRight === true
  }
  const mergeTop = (index: number): boolean => {
    const row = Math.floor(index / board.cols)
    return row > 0 && board.cells[index - board.cols]?.mergeBottom === true
  }

  const isGroupRight = (index: number): boolean => {
    if (!groups) return false
    const col = index % board.cols
    return (col + 1) % groups.cols === 0 && col + 1 < board.cols
  }
  const isGroupBottom = (index: number): boolean => {
    if (!groups) return false
    const row = Math.floor(index / board.cols)
    return (row + 1) % groups.rows === 0 && row + 1 < board.rows
  }

  return (
    <div
      className="eink-board"
      {...(hasCovered ? { 'data-cover': 'yes' } : {})}
      /*
       * 行内只给**形状**（--board-cols/--board-rows，来自棋盘数据），尺寸一律由 CSS 算。
       * 注意：元素一律**按格**渲染，不再有绝对定位的覆盖层 —— 覆盖层与网格是两套坐标系，
       * 真机上名字位置与可点区域对不上（用户反馈"点到的不是我想点的那块 / 完全乱了"）。
       */
      style={style}
      role="grid"
      aria-rowcount={board.rows}
      aria-colcount={board.cols}
    >
      {board.cells.map((cellView) => (
        <div
          key={cellView.index}
          role="gridcell"
          className="eink-board__cell"
          data-kind={cellView.kind}
          {...(isGroupRight(cellView.index) ? { 'data-sep-right': 'yes' } : {})}
          {...(isGroupBottom(cellView.index) ? { 'data-sep-bottom': 'yes' } : {})}
          {...(cellView.selected ? { 'data-selected': 'yes' } : {})}
          {...(cellView.wrong ? { 'data-wrong': 'yes' } : {})}
          {...(cellView.facing ? { 'data-facing': cellView.facing } : {})}
          {...(cellView.links?.length ? { 'data-links': cellView.links.join(' ') } : {})}
          {...(cellView.mergeRight ? { 'data-merge-right': 'yes' } : {})}
          {...(cellView.mergeBottom ? { 'data-merge-bottom': 'yes' } : {})}
          {...(mergeLeft(cellView.index) ? { 'data-merge-left': 'yes' } : {})}
          {...(mergeTop(cellView.index) ? { 'data-merge-top': 'yes' } : {})}
          aria-label={labelFor ? labelFor(cellView.kind, cellView.index, cellView.glyph) : cellView.glyph}
          {...(onCellSelect ? { onClick: () => onCellSelect(cellView.index) } : {})}
        >
          {TEXT_KINDS.has(cellView.kind) && cellView.glyph ? (
            <span
              className="eink-board__text"
              aria-hidden="true"
              {...(cellView.textScale
                ? { style: { fontSize: `calc(var(--cell, 40px) * ${cellView.textScale})` } }
                : {})}
            >
              {cellView.glyph}
            </span>
          ) : null}
          <BoardGlyph kind={cellView.kind} bold={bold} facing={cellView.facing} links={cellView.links} />
        </div>
      ))}

    </div>
  )
}

export interface DpadProps {
  controls: readonly ControlSpec[]
  onMove: (dir: MoveDir) => void
  /** 方向键边长（px）：tee 用放大后的键（core 的 dpadTeeKeySize），row 用普通按钮高 */
  size: number
  labelKey: string
  /** 摆法，见 core 的 DpadLayout：`tee`（缺省）倒 T、`row` 平铺一行 */
  layout?: DpadLayout
  /**
   * 倒 T 上排两侧的格子（壳层放「撤销」「重开」）。
   * 它们**不在** `.eink-dpad` 元素里：那个元素只装方向键（role=group 的无障碍名是"方向控制"，
   * 探索脚本也按 `.eink-dpad button` 找方向键），这里只是借同一张网格摆位置。
   */
  corners?: { left?: ReactNode; right?: ReactNode }
}

/** 平铺时的键序：左右放两端（与平移方向一致），上 / 下居中 */
const ROW_ORDER: readonly MoveDir[] = ['left', 'up', 'down', 'right']

/** 倒 T 的 DOM 顺序：方向键在前（键盘焦点先走方向），位置由 CSS 的 grid-template-areas 决定 */
const TEE_ORDER: readonly MoveDir[] = ['up', 'left', 'down', 'right']

/** 方向盘：四个方向始终可点（走不通时给文字反馈），符合「明确模式、不静默」的要求 */
export function Dpad({ controls, onMove, size, labelKey, layout = 'tee', corners }: DpadProps): ReactNode {
  const { i18n } = useUi()
  const find = (dir: MoveDir): ControlSpec | undefined => controls.find((control) => control.dir === dir)
  // 没有方向控件（例如数独、扫雷）时整块不渲染，避免在窄屏上白占一块高度
  if (!controls.some((control) => control.role === 'dpad')) return null

  /*
   * 键的高度由 JS 给（一个与 DOM 无关的推算值），宽度只给下限：
   * 两种摆法都让键按列/按行平分可用宽度，比方键更好点。
   */
  const keyStyle: CSSProperties = { minWidth: size, height: size }
  const render = (dir: MoveDir): ReactNode => {
    const control = find(dir)
    if (!control) return <span key={dir} className={`eink-dpad__empty eink-dpad__${dir}`} />
    return (
      <button
        key={dir}
        type="button"
        className={`eink-button eink-dpad__button eink-dpad__${dir}`}
        style={keyStyle}
        data-tone={control.tone ?? 'normal'}
        aria-label={i18n.t(control.labelKey)}
        onClick={() => onMove(dir)}
      >
        {i18n.t(control.labelKey)}
      </button>
    )
  }
  if (layout === 'row') {
    // 平铺：只有一行按钮高，省下的两行全部让给棋盘
    return (
      <div className="eink-dpad eink-dpad--row" role="group" aria-label={i18n.t(labelKey)}>
        {ROW_ORDER.map(render)}
      </div>
    )
  }
  return (
    <div className="eink-dpad-tee" style={{ ['--dpad-key' as string]: `${size}px` } as CSSProperties}>
      <div className="eink-dpad eink-dpad--tee" role="group" aria-label={i18n.t(labelKey)}>
        {TEE_ORDER.map(render)}
      </div>
      {corners?.left ? <div className="eink-dpad-tee__corner eink-dpad-tee__corner--left">{corners.left}</div> : null}
      {corners?.right ? <div className="eink-dpad-tee__corner eink-dpad-tee__corner--right">{corners.right}</div> : null}
    </div>
  )
}

export interface DialogProps {
  titleKey: string
  bodyKey?: string
  bodyText?: string
  confirmKey: string
  cancelKey: string
  onConfirm: () => void
  onCancel: () => void
  danger?: boolean
}

export function Dialog({
  titleKey,
  bodyKey,
  bodyText,
  confirmKey,
  cancelKey,
  onConfirm,
  onCancel,
  danger = false,
}: DialogProps): ReactNode {
  const { i18n } = useUi()
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div className="eink-dialog" role="dialog" aria-modal="true" aria-label={i18n.t(titleKey)}>
      <div className="eink-dialog__panel">
        <h2>{i18n.t(titleKey)}</h2>
        {bodyKey || bodyText ? <p>{bodyText ?? i18n.t(bodyKey!)}</p> : null}
        <div className="eink-dialog__actions">
          <ActionButton labelKey={cancelKey} onSelect={onCancel} />
          <ActionButton labelKey={confirmKey} onSelect={onConfirm} emphasis={danger ? 'primary' : 'normal'} />
        </div>
      </div>
    </div>
  )
}

export function NoticeLine({ textKey, text }: { textKey?: string; text?: string }): ReactNode {
  const { i18n } = useUi()
  if (!textKey && !text) return null
  return (
    <p className="eink-notice" role="status" data-testid="notice">
      {text ?? i18n.t(textKey!)}
    </p>
  )
}

export interface SaveBadgeProps {
  status: 'idle' | 'saving' | 'saved' | 'failed'
  failureText?: string
  onRetry: () => void
  onExport: () => void
}

export function SaveBadge({ status, failureText, onRetry, onExport }: SaveBadgeProps): ReactNode {
  const { i18n } = useUi()
  if (status === 'failed') {
    return (
      <p className="eink-save eink-save--failed" role="alert">
        <span>{i18n.t('shell.storage.failed', { reason: failureText ?? '' })}</span>{' '}
        <button type="button" className="eink-link" onClick={onRetry}>
          {i18n.t('shell.storage.retry')}
        </button>{' '}
        <button type="button" className="eink-link" onClick={onExport}>
          {i18n.t('shell.storage.export')}
        </button>
      </p>
    )
  }
  // idle 表示「本局还没有需要写入的变化」，此时不能显示「已保存」——那是在宣称一件没发生过的事
  if (status === 'idle') {
    return <p className="eink-save" data-testid="save-badge" aria-hidden="true" />
  }
  const textKey = status === 'saving' ? 'shell.storage.saving' : 'shell.storage.saved'
  return (
    <p className="eink-save" role="status" data-testid="save-badge">
      {i18n.t(textKey)}
    </p>
  )
}

export interface PagerProps {
  page: number
  pageCount: number
  onPrev: () => void
  onNext: () => void
  text?: string
}

/** 分页器：列表优先分页而不是跟随滚动（墨水屏规范第 6 条） */
export function Pager({ page, pageCount, onPrev, onNext, text }: PagerProps): ReactNode {
  const { i18n } = useUi()
  return (
    <div className="eink-pager">
      <ActionButton
        labelKey="shell.pager.prev"
        text={`‹ ${i18n.t('shell.pager.prev')}`}
        onSelect={onPrev}
        disabled={page <= 0}
      />
      <span className="eink-pager__status">{text ?? `${page + 1} / ${pageCount}`}</span>
      <ActionButton
        labelKey="shell.pager.next"
        text={`${i18n.t('shell.pager.next')} ›`}
        onSelect={onNext}
        disabled={page >= pageCount - 1}
      />
    </div>
  )
}

/** 键盘支持：方向键、U 撤销、R 重开、Esc 暂停/返回 */
/**
 * 实体翻页键（BOOX 等设备的 PageUp/PageDown）→ 滚动当前可滚动区域。
 *
 * 之前 `useKeyboardControls` 里写着「翻页键交给列表分页逻辑」，但那段逻辑并不存在，
 * 于是物理翻页键完全没反应（真机实测：WebView 收到了 PageDown/PageUp 事件，应用没处理）。
 * 对阅读器类设备来说，这两个键的预期行为就是翻页/滚动，因此在壳层统一处理。
 */
function findScrollableRegion(): HTMLElement | null {
  const candidates: HTMLElement[] = []
  for (const el of document.querySelectorAll<HTMLElement>('*')) {
    const cs = getComputedStyle(el)
    if (cs.overflowY !== 'auto' && cs.overflowY !== 'scroll') continue
    if (el.clientHeight < 40 || el.scrollHeight <= el.clientHeight + 4) continue
    candidates.push(el)
  }
  // 取「在视口里可见面积最大」的那个，避免误滚到被遮挡的容器
  let best: HTMLElement | null = null
  let bestArea = 0
  for (const el of candidates) {
    const r = el.getBoundingClientRect()
    const w = Math.max(0, Math.min(r.right, window.innerWidth) - Math.max(r.left, 0))
    const h = Math.max(0, Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0))
    if (w * h > bestArea) {
      bestArea = w * h
      best = el
    }
  }
  return bestArea > 2000 ? best : null
}

export function useHardwarePageKeys(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'PageDown' && event.key !== 'PageUp') return
      const target = findScrollableRegion()
      // 没有可滚动内容时不拦截：避免干扰将来可能添加的游戏内快捷键
      if (!target) return
      event.preventDefault()
      // 一次翻一屏（留 10% 重叠，便于接续阅读）；不用平滑滚动，墨水屏上动画只会造成残影
      const delta = Math.round(target.clientHeight * 0.9)
      target.scrollTop += event.key === 'PageDown' ? delta : -delta
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}

export function useKeyboardControls(handlers: {
  onMove?: (dir: MoveDir) => void
  onUndo?: () => void
  onRestart?: () => void
  onEscape?: () => void
  enabled?: boolean
}): void {
  const { onMove, onUndo, onRestart, onEscape, enabled = true } = handlers
  useEffect(() => {
    if (!enabled) return
    const onKeyDown = (event: KeyboardEvent): void => {
      const map: Record<string, MoveDir> = {
        ArrowUp: 'up',
        ArrowDown: 'down',
        ArrowLeft: 'left',
        ArrowRight: 'right',
      }
      const dir = map[event.key]
      if (dir && onMove) {
        event.preventDefault()
        onMove(dir)
        return
      }
      if (event.key === 'PageUp' || event.key === 'PageDown') {
        // 实体翻页键：此处不拦截，交给列表分页逻辑
        return
      }
      if ((event.key === 'u' || event.key === 'U') && onUndo) {
        onUndo()
        return
      }
      if ((event.key === 'r' || event.key === 'R') && onRestart) {
        onRestart()
        return
      }
      if (event.key === 'Escape' && onEscape) {
        onEscape()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onMove, onUndo, onRestart, onEscape, enabled])
}
