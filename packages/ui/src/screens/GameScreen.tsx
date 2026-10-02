/**
 * 游戏界面：棋盘 + 控制 + 结果页 + 暂停层 + 损坏存档处理。
 *
 * 结果页不覆盖棋盘（「查看过程不改变结果」）：过关面板与棋盘同时可见。
 */
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { computeBoardLayout, computeRootLayout, type CellKind, type MoveDir, type SaveEnvelope } from '@eink/core'
import {
  ActionButton,
  Board,
  Dialog,
  Dpad,
  NoticeLine,
  SaveBadge,
  StatBar,
  Timer,
  TopBar,
  useKeyboardControls,
} from '../components.js'
import { useUi } from '../contexts.js'
import type { GameRegistryEntry } from '../registry.js'
import { useSession } from '../session.js'

export interface GameScreenProps {
  entry: GameRegistryEntry<unknown, unknown>
  difficulty: string
  onExit: () => void
  onCommitted: (envelope: SaveEnvelope) => void
}


export function GameScreen({ entry, difficulty, onExit, onCommitted }: GameScreenProps): ReactNode {
  const { i18n, settings, platform, viewport, layoutConfig } = useUi()
  const session = useSession({
    game: entry.game,
    storage: platform.storage,
    difficulty,
    onCommitted,
  })
  const [confirmRestart, setConfirmRestart] = useState(false)
  /**
   * 棋盘区的**实测**尺寸。
   *
   * 为什么不直接用 computeRootLayout 的推算值：那个公式与真实 DOM 的结构并不一致 ——
   * 它把统计栏高度算进了控制区，而 StatBar 实际是棋盘上方的一个独立兄弟节点，
   * 同一块高度被算了两次（实测竖屏下累计超出视口 69px，把「撤销/重新开始/菜单」挤出屏幕）。
   * 改为：控制区固定不缩、棋盘区按剩余空间收缩、格子尺寸由实测盒子反算 —— 结构怎么变都不会再顶出去。
   */
  const [boardBox, setBoardBox] = useState<{ width: number; height: number } | null>(null)
  const boardAreaRef = useRef<HTMLDivElement | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  const root = useMemo(
    () =>
      computeRootLayout(viewport, layoutConfig, {
        // 过关后方向盘不显示（showDpad 必须跟着改，否则会白留一大块高度），
        // 同时给结果面板与状态条预留高度：否则按钮会被挤出首屏，
        // 玩家得滚动才能点到「下一关」（墨水屏上不该这样）。
        // 这两个只作为**首帧兜底**（实测尺寸出来前用）；真实布局由 flex + 实测反算决定，
        // 因此不再需要 extraBottom 预留结果面板高度 —— 棋盘区会自动收缩。
        showDpad: settings.dpad && !session.solved,
        showStats: true,
      }),
    [viewport, layoutConfig, settings.dpad, session.solved],
  )
  useLayoutEffect(() => {
    const element = boardAreaRef.current
    if (!element) return
    const measure = (): void => {
      const rect = element.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) {
        setBoardBox({ width: Math.round(rect.width), height: Math.round(rect.height) })
      }
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // 统计栏列数：横屏一行放得下就一行；竖屏固定两列（行数恒定，不会因数值变宽而多出一行）
  const statCount = session.view.stats.length + (settings.timer ? 1 : 0)
  const statColumns = viewport.width > viewport.height ? statCount : Math.min(2, statCount)

  const boardArea = boardBox ?? root.boardArea

  const boardLayout = useMemo(() => {
    const board = session.view.board
    if (!board) return null
    return computeBoardLayout(boardArea, board.cols, board.rows, layoutConfig)
  }, [session.view.board, boardArea, layoutConfig])

  /**
   * 走一步之后不再调用区域刷新。
   *
   * 原因：真机实测（Note X2）传入区域矩形后**面板仍然整屏刷新**，
   * 与整屏全刷在观感上无差别 —— 也就是说这个 API 在这台设备上并没有「只刷一块」的效果。
   * 既然没有收益，就不该每一步都去驱动一次面板；离屏内容交由系统自身的刷新策略处理，
   * 需要清残影时用户可以在暂停菜单里手动「立即整屏全刷」。
   */

  const onMove = (dir: MoveDir): void => {
    session.clearNotice()
    session.dispatch({ type: 'move', dir } as never)
  }

  useKeyboardControls({
    onMove,
    onUndo: () => session.undo(),
    onRestart: () => setConfirmRestart(true),
    onEscape: () => (session.paused ? session.resume() : session.pause()),
    enabled: session.ready && !session.corrupt,
  })

  const cellLabel = (kind: CellKind, index: number): string => {
    const row = cellLabelRow(session.view.board, index)
    return `${i18n.t(`sokoban.cell.${kind}`)}${row}`
  }

  const levelLabel = i18n.t('sokoban.level.label', {
    index: entry.indexOfLevel?.(extractLevelId(session.state), session.state) !== undefined
      ? (entry.indexOfLevel(extractLevelId(session.state), session.state) ?? 0) + 1
      : 1,
  })
  const best = (session.progress.bestMoves ?? {})[extractLevelId(session.state)]

  return (
    <div className="eink-screen eink-screen--game">
      <TopBar
        title={`${i18n.t(`${entry.game.i18nNamespace}.title`)} · ${levelLabel}`}
        onBack={() => {
          session.pause()
          onExit()
        }}
      >
        <ActionButton
          labelKey={session.paused ? 'shell.game.resume' : 'shell.game.pause'}
          onSelect={() => (session.paused ? session.resume() : session.pause())}
        />
      </TopBar>

      <StatBar stats={session.view.stats} columns={statColumns}>
        {settings.timer ? (
          <Timer
            elapsedRef={session.elapsedRef}
            levelStartRef={session.levelStartRef}
            active={session.clockActive}
          />
        ) : null}
      </StatBar>

      {session.corrupt ? (
        <section className="eink-section eink-section--warning" role="alert">
          <h2>{i18n.t('shell.storage.reason.corrupt')}</h2>
          <p>{i18n.t('shell.storage.notPersistent')}</p>
          <div className="eink-card__actions">
            <ActionButton labelKey="shell.storage.export" onSelect={() => void exportBackup()} />
            <ActionButton
              labelKey="shell.storage.clear"
              text={i18n.t('shell.detail.start')}
              emphasis="primary"
              onSelect={() => setConfirmDiscard(true)}
            />
            <ActionButton labelKey="shell.nav.back" onSelect={onExit} />
          </div>
        </section>
      ) : (
        <>
          {/* 尺寸由 CSS flex 决定（可收缩），格子大小按实测盒子算 —— 不写死像素 */}
          <div className="eink-board-area" ref={boardAreaRef}>
            {session.view.board && boardLayout ? (
              <Board
                board={session.view.board}
                cell={boardLayout.cell}
                labelFor={cellLabel}
                bold={settings.boldLines}
              />
            ) : null}
          </div>

          <div
            className="eink-statusstrip"
            data-expanded={session.failureReason ? 'yes' : 'no'}
          >
            <NoticeLine {...(session.view.notice ? { textKey: session.view.notice.textKey } : {})} />
            <SaveBadge
              status={session.saveStatus}
              failureText={
                session.failureReason ? i18n.t(`shell.storage.reason.${session.failureReason}`) : undefined
              }
              onRetry={session.retrySave}
              onExport={() => void exportBackup()}
            />
          </div>

          {session.solved && session.view.result ? (
            <section className="eink-section eink-section--result" role="status">
              <h2>{i18n.t(session.view.result.titleKey)}</h2>
              <ul className="eink-result-details">
                {session.view.result.details.map((detail) => (
                  <li key={detail.key}>
                    {detail.params
                      ? i18n.plural(detail.key, Number(detail.params.count ?? 0), {
                          ...detail.params,
                          count: Number(detail.params.count ?? 0),
                        })
                      : i18n.t(detail.key)}
                  </li>
                ))}
                {best !== undefined ? (
                  <li>{i18n.t('sokoban.solved.best', { count: best })}</li>
                ) : null}
              </ul>
              <div className="eink-card__actions">
                <ActionButton
                  labelKey="shell.result.next"
                  emphasis="primary"
                  size="large"
                  disabled={!session.controls.some((control) => control.id === 'next-level' && control.enabled)}
                  onSelect={() => session.nextLevel()}
                />
                <ActionButton labelKey="shell.result.again" onSelect={() => setConfirmRestart(true)} />
                <ActionButton labelKey="shell.result.library" onSelect={onExit} />
              </div>
            </section>
          ) : null}

          {/* 过关后方向盘让位给结果面板：此时它没有用处，而结果面板必须与棋盘一起
              落在首屏内（墨水屏上不该为了看结果去滚动）。 */}
          {!session.solved && settings.dpad ? (
            <div className="eink-controls">
              <Dpad
                controls={session.controls}
                onMove={onMove}
                size={root.buttonHeight}
                labelKey="sokoban.dpad.label"
              />
              <div className="eink-controls__actions">
                <ActionButton
                  labelKey="shell.game.undo"
                  size="large"
                  disabled={!session.controls.some((control) => control.id === 'undo' && control.enabled)}
                  onSelect={() => {
                    session.clearNotice()
                    session.undo()
                  }}
                />
                <ActionButton
                  labelKey="shell.game.restart"
                  size="large"
                  onSelect={() => setConfirmRestart(true)}
                />
                <ActionButton labelKey="shell.game.menu" onSelect={() => setMenuOpen(true)} />
              </div>
            </div>
          ) : null}
        </>
      )}

      {session.paused && !session.corrupt ? (
        <div className="eink-overlay" role="dialog" aria-modal="true" aria-label={i18n.t('shell.game.paused')}>
          <div className="eink-overlay__panel">
            <h2>{i18n.t('shell.game.paused')}</h2>
            <p className="eink-muted">{i18n.t('shell.game.review')}</p>
            <div className="eink-dialog__actions">
              <ActionButton labelKey="shell.game.resume" emphasis="primary" size="large" onSelect={session.resume} />
              <ActionButton labelKey="shell.game.restart" onSelect={() => setConfirmRestart(true)} />
              {platform.refresh.capability().fullRefresh ? (
                <ActionButton labelKey="shell.settings.fullRefreshNow" onSelect={() => platform.refresh.fullRefresh()} />
              ) : null}
              <ActionButton labelKey="shell.result.library" onSelect={onExit} />
            </div>
          </div>
        </div>
      ) : null}

      {menuOpen ? (
        <div className="eink-dialog" role="dialog" aria-modal="true" aria-label={i18n.t('shell.game.menu')}>
          <div className="eink-dialog__panel">
            <h2>{i18n.t('shell.game.menu')}</h2>
            <div className="eink-dialog__actions">
              {platform.refresh.capability().fullRefresh ? (
                <ActionButton labelKey="shell.settings.fullRefreshNow" onSelect={() => platform.refresh.fullRefresh()} />
              ) : null}
              <ActionButton labelKey="shell.storage.export" onSelect={() => void exportBackup()} />
              <ActionButton labelKey="shell.common.close" emphasis="primary" onSelect={() => setMenuOpen(false)} />
            </div>
          </div>
        </div>
      ) : null}

      {confirmRestart ? (
        <Dialog
          titleKey="shell.game.restart"
          bodyKey="sokoban.rules.body2"
          confirmKey="shell.game.restart"
          cancelKey="shell.common.cancel"
          danger
          onConfirm={() => {
            setConfirmRestart(false)
            session.resume()
            session.restart()
          }}
          onCancel={() => setConfirmRestart(false)}
        />
      ) : null}

      {confirmDiscard ? (
        <Dialog
          titleKey="shell.storage.clear"
          bodyKey="shell.storage.clearConfirm"
          confirmKey="shell.detail.start"
          cancelKey="shell.common.cancel"
          danger
          onConfirm={() => {
            setConfirmDiscard(false)
            void session.discardAndRestart()
          }}
          onCancel={() => setConfirmDiscard(false)}
        />
      ) : null}
    </div>
  )

  async function exportBackup(): Promise<void> {
    const text = await platform.storage.createBackupText(platform.baseline(), Date.now())
    await platform.exportBackup(`eink-gamebox-${Date.now()}.json`, text)
  }
}

function extractLevelId(state: unknown): string {
  return (state as { levelId?: string } | undefined)?.levelId ?? ''
}

function cellLabelRow(
  board: { cols: number; rows: number } | null,
  index: number,
): string {
  if (!board) return ''
  const row = Math.floor(index / board.cols) + 1
  const col = (index % board.cols) + 1
  return ` ${row},${col}`
}
