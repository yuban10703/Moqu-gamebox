/**
 * 壳层组件。全部遵守墨水屏交互规范：
 * - 无动画、无过渡、无透明度叠加；
 * - 状态区分靠符号 + 线型 + 文字，不只靠灰阶；
 * - 主操作是可见按钮，且不小于 48px；
 * - 计时等每秒变化的内容隔离在小组件里，不驱动整页重绘。
 */
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import type { BoardView, CellKind, ControlSpec, MoveDir } from '@eink/core'
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
  stats: ReadonlyArray<{ labelKey: string; value: string; text?: string }>
  children?: ReactNode
}

export function StatBar({ stats, children }: StatBarProps): ReactNode {
  const { i18n } = useUi()
  return (
    <dl className="eink-stats">
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

const CELL_GLYPH: Record<CellKind, string> = {
  floor: '',
  wall: '',
  goal: '○',
  box: '□',
  boxOnGoal: '◼',
  player: '▲',
  playerOnGoal: '△',
}

export interface BoardProps {
  board: BoardView
  cell: number
  labelFor: (kind: CellKind, index: number) => string
  onCellSelect?: (index: number) => void
}

/**
 * 棋盘：DOM 网格渲染。
 * 选择 DOM 而不是 Canvas 的原因：网页侧无法承诺像素级局部刷新，
 * 而 DOM 让系统自己做最小重绘；文字用系统字体，中文不会缺字。
 */
export function Board({ board, cell, labelFor, onCellSelect }: BoardProps): ReactNode {
  const style = {
    gridTemplateColumns: `repeat(${board.cols}, ${cell}px)`,
    gridTemplateRows: `repeat(${board.rows}, ${cell}px)`,
    // 供 CSS 计算格子内符号的字号
    ['--cell' as string]: `${cell}px`,
  } as CSSProperties
  return (
    <div
      className="eink-board"
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
          aria-label={labelFor(cellView.kind, cellView.index)}
          {...(onCellSelect ? { onClick: () => onCellSelect(cellView.index) } : {})}
        >
          <span aria-hidden="true">{CELL_GLYPH[cellView.kind]}</span>
        </div>
      ))}
    </div>
  )
}

export interface DpadProps {
  controls: readonly ControlSpec[]
  onMove: (dir: MoveDir) => void
  size: number
  labelKey: string
}

/** 方向盘：四个方向始终可点（走不通时给文字反馈），符合「明确模式、不静默」的要求 */
export function Dpad({ controls, onMove, size, labelKey }: DpadProps): ReactNode {
  const { i18n } = useUi()
  const buttonStyle: CSSProperties = { width: size, height: size }
  const find = (dir: MoveDir): ControlSpec | undefined => controls.find((control) => control.dir === dir)
  const render = (dir: MoveDir, className: string): ReactNode => {
    const control = find(dir)
    if (!control) return <span className="eink-dpad__empty" />
    return (
      <button
        type="button"
        className={`eink-button eink-dpad__button ${className}`}
        style={buttonStyle}
        data-tone={control.tone ?? 'normal'}
        aria-label={i18n.t(control.labelKey)}
        onClick={() => onMove(dir)}
      >
        {i18n.t(control.labelKey)}
      </button>
    )
  }
  return (
    <div className="eink-dpad" role="group" aria-label={i18n.t(labelKey)}>
      <span className="eink-dpad__empty" />
      {render('up', 'eink-dpad__up')}
      <span className="eink-dpad__empty" />
      {render('left', 'eink-dpad__left')}
      <span className="eink-dpad__center" aria-hidden="true" />
      {render('right', 'eink-dpad__right')}
      <span className="eink-dpad__empty" />
      {render('down', 'eink-dpad__down')}
      <span className="eink-dpad__empty" />
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
