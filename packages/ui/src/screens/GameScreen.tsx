/**
 * 游戏界面：棋盘 + 控制 + 结果页 + 暂停层 + 损坏存档处理。
 *
 * 结果页不覆盖棋盘（「查看过程不改变结果」）：过关面板与棋盘同时可见。
 */
import { useMemo, useState, type ReactNode } from 'react'
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

/** 过关面板在底部预留的高度（CSS px）：标题 + 4 行统计 + 三个按钮 */
const RESULT_PANEL_RESERVE = 240
/** 「提示 + 保存状态」状态条的固定高度（CSS px），与 .eink-statusstrip 的 min-height 一致 */
const STATUS_STRIP_RESERVE = 84

export function GameScreen({ entry, difficulty, onExit, onCommitted }: GameScreenProps): ReactNode {
  const { i18n, settings, platform, viewport, layoutConfig } = useUi()
  const session = useSession({
    game: entry.game,
    storage: platform.storage,
    difficulty,
    onCommitted,
  })
  const [confirmRestart, setConfirmRestart] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  const root = useMemo(
    () =>
      computeRootLayout(viewport, layoutConfig, {
        // 过关后方向盘不显示（showDpad 必须跟着改，否则会白留一大块高度），
        // 同时给结果面板与状态条预留高度：否则按钮会被挤出首屏，
        // 玩家得滚动才能点到「下一关」（墨水屏上不该这样）。
        showDpad: settings.dpad && !session.solved,
        showStats: true,
        extraBottom:
          STATUS_STRIP_RESERVE + (session.solved ? RESULT_PANEL_RESERVE : 0),
      }),
    [viewport, layoutConfig, settings.dpad, session.solved],
  )
  const boardLayout = useMemo(() => {
    const board = session.view.board
    if (!board) return null
    return computeBoardLayout(root.boardArea, board.cols, board.rows, layoutConfig)
  }, [session.view.board, root.boardArea, layoutConfig])

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

      <StatBar stats={session.view.stats}>
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
          <div
            className="eink-board-area"
            style={{ width: root.boardArea.width, height: root.boardArea.height }}
          >
            {session.view.board && boardLayout ? (
              <Board
                board={session.view.board}
                cell={boardLayout.cell}
                labelFor={cellLabel}
              />
            ) : null}
          </div>

          <div className="eink-statusstrip">
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
