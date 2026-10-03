/**
 * 游戏界面：棋盘 + 控制 + 结果页 + 暂停层 + 损坏存档处理。
 *
 * 结果页不覆盖棋盘（「查看过程不改变结果」）：过关面板与棋盘同时可见。
 */
import type { PointerEvent as ReactPointerEvent } from 'react'
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode, useEffect } from 'react'
import {
  BOARD_FRAME_PX,
  computeBoardLayout,
  computeRootLayout,
  type CellKind,
  type MoveDir,
  type SaveEnvelope,
} from '@eink/core'
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
  /** 返回上一页（游戏详情）：顶栏「返回」用 */
  onBack: () => void
  /** 直接回到游戏库：暂停遮罩与结果面板里明确写着「返回游戏库」的按钮用 */
  onExit: () => void
  onCommitted: (envelope: SaveEnvelope) => void
  /** 新开局时从旧存档继承的进度（目前只有历史记录） */
  initialProgress?: Record<string, unknown>
  /** 自由选关：进入对局后直接跳到该关（详情页点关卡传入） */
  startLevelId?: string
}


export function GameScreen({
  entry,
  difficulty,
  onBack,
  onExit,
  onCommitted,
  initialProgress,
  startLevelId,
}: GameScreenProps): ReactNode {
  const { i18n, settings, platform, viewport, layoutConfig, updateGameSettings } = useUi()

  /*
   * 方向按钮是否显示：**按游戏各自记住**（settings.perGame[gameId].dpad），缺省跟随全局设置。
   *
   * 为什么不能直接用全局值：在 2048 里为了把棋盘留大而关掉方向键之后，
   * 推箱子也会跟着没有方向键 —— 而推箱子主要靠方向键玩（用户反馈："推箱子的方向键默认开启"）。
   * 现在各游戏互不影响，且每个游戏默认都是开。
   */
  const dpadOn = settings.perGame[entry.game.id]?.dpad ?? settings.dpad

  const session = useSession({
    game: entry.game,
    storage: platform.storage,
    difficulty,
    onCommitted,
    ...(initialProgress ? { initialProgress } : {}),
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

  const root = useMemo(
    () =>
      computeRootLayout(viewport, layoutConfig, {
        // 过关后方向盘不显示（showDpad 必须跟着改，否则会白留一大块高度），
        // 同时给结果面板与状态条预留高度：否则按钮会被挤出首屏，
        // 玩家得滚动才能点到「下一关」（墨水屏上不该这样）。
        // 这两个只作为**首帧兜底**（实测尺寸出来前用）；真实布局由 flex + 实测反算决定，
        // 因此不再需要 extraBottom 预留结果面板高度 —— 棋盘区会自动收缩。
        showDpad: dpadOn && !session.finished,
        showStats: true,
      }),
    [viewport, layoutConfig, dpadOn, session.finished],
  )
  useLayoutEffect(() => {
    const element = boardAreaRef.current
    if (!element) return
    const measure = (): void => {
      // 注：曾试过改用 clientWidth/Height（内容盒），但实测反而让被裁的游戏从 4 款变 5 款
      // （量到的盒子变小 → 棋盘变小 → 但 flex 分配随之变化，收敛结果更差），故保持边框盒。
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
    /*
     * 依赖里必须有 ready：棋盘区是在**加载完成之后**才渲染的，
     * 而这个 effect 首次运行时它还不存在（`boardAreaRef.current` 为 null → 直接 return）。
     * 只写 `[]` 的话观察器**永远不会挂上**，棋盘区从此不再被实测，
     * 布局只能一直用推算值 —— 实测后果：数字华容道在最大字号档下按约 430 的可用区算格子（105px），
     * 而真实容器只有 325px 高，棋盘横竖都被裁切（套件连续三次复现的 clip {t:33,b:33}）。
     */
  }, [session.ready, session.corrupt])

  // 统计栏列数：横屏一行放得下就一行；竖屏固定两列（行数恒定，不会因数值变宽而多出一行）
  const statCount = session.view.stats.length + (settings.timer ? 1 : 0)
  const statColumns = viewport.width > viewport.height ? statCount : Math.min(3, statCount)

  /**
   * 实测尺寸明显不合理（例如首帧测到 0 或几像素）时忽略它，回退到推算值。
   * 否则「格子由实测反算」会与真实布局形成反馈环，把棋盘永久锁在 minCell 最小尺寸。
   */
  const measuredUsable =
    boardBox !== null && boardBox.width >= 120 && boardBox.height >= 120 ? boardBox : null
  const boardArea = measuredUsable ?? root.boardArea

  const boardLayout = useMemo(() => {
    const board = session.view.board
    if (!board) return null
    // 不传 safety：在极矮横屏下它会把格子压得更小（真机实测会坍缩到不可玩）。
    // 见 layout.ts 里关于 minCell 的说明。
    const layout = computeBoardLayout(boardArea, board.cols, board.rows, layoutConfig, BOARD_FRAME_PX)
    /*
     * 安全夹紧：渲染出来的棋盘**绝不允许超过实测容器**。
     *
     * 起因（实测）：数字华容道在最大字号档下，棋盘区 415×325，但格子按约 430 的可用区算成 105px
     * （4×105 + 外框 ≈ 430），于是棋盘元素被 flex 容器压到 325 宽、内容却仍按 430 排 ——
     * 横竖两个方向都溢出、被裁切（探索套件报 clip {t:33,b:33}，连续三次复现）。
     * 用实测容器再夹一道，任何测量/推算偏差都不会再变成"看得见的裁切"。
     */
    if (!measuredUsable) return layout
    const maxCell = Math.floor(
      Math.min(
        (measuredUsable.width - 2 * BOARD_FRAME_PX) / board.cols,
        (measuredUsable.height - 2 * BOARD_FRAME_PX) / board.rows,
      ),
    )
    return maxCell > 0 && maxCell < layout.cell ? { ...layout, cell: maxCell } : layout
  }, [session.view.board, boardArea, layoutConfig, measuredUsable])

  /*
   * 棋盘放不下可用区（极矮横屏 + 密集棋盘时会这样，真机实测约 7 行以上）。
   * 这时给出「建议竖屏游玩」的提示 —— 复用已有的状态条，不新增 UI 元素；
   * 状态条高度固定，因此不会引起布局位移。优先级低于游戏的非法动作提示（即时反馈更重要）。
   */
  const boardOverflow =
    boardBox !== null && boardLayout !== null ? boardLayout.boardHeight > boardBox.height + 1 : false

  /**
   * 走一步之后不再调用区域刷新。
   *
   * 原因：真机实测（Note X2）传入区域矩形后**面板仍然整屏刷新**，
   * 与整屏全刷在观感上无差别 —— 也就是说这个 API 在这台设备上并没有「只刷一块」的效果。
   * 既然没有收益，就不该每一步都去驱动一次面板；离屏内容交由系统自身的刷新策略处理，
   * 需要清残影时用户可以在暂停菜单里手动「立即整屏全刷」。
   */

  /**
   * 方向键动作名由**游戏**决定：优先走 controlAction（游戏自己把 `move-<dir>` 控件映射成动作），
   * 例如数字华容道的规范动作是 `{ type:'slide', dir }` 而不是 `{ type:'move', dir }`。
   * 没有实现 controlAction 的游戏沿用既有约定 `{ type:'move', dir }`，行为完全不变。
   */
  const onMove = (dir: MoveDir): void => {
    session.clearNotice()
    // 游戏可以用 controlAction 自定义方向键的动作名（如数字华容道的 {type:'slide',dir}）；
    // 没映射时回落到既有约定 {type:'move',dir}，因此老游戏一行都不用改
    if (!session.runControl?.(`move-${dir}`)) {
      session.dispatch({ type: 'move', dir } as never)
    }
  }

  /**
   * 棋盘上**滑动 = 按方向**。
   *
   * 为什么加：2048 / 推箱子是纯方向键玩法，一旦把方向键关掉就没法操作了。
   * 有了滑动，这两个玩法也能"不要方向键、把棋盘留大"。
   *
   * 与点击不冲突：位移小于阈值就当作点击，交给格子自己的 selectAction 处理；
   * 方向键的动作名仍由游戏决定（走 onMove → session.runControl），因此数字华容道这类
   * 自定义动作名的玩法也一并支持。
   */
  /*
   * 滑动只在**纯方向键玩法**上启用（2048 / 推箱子：它们没有格子点击玩法，关掉方向键后只能靠滑动）。
   *
   * 为什么点击类玩法必须禁用：真机实测反馈"点到的不是我想点的那块 / 完全乱了" ——
   * 墨水屏触摸本身有抖动，24px 的阈值太松，一次轻点很容易被判成滑动，
   * 于是棋子被意外移动/换选。华容道、数独、扫雷这些玩法本身就能点，根本不需要滑动。
   */
  const swipeEnabled = entry.game.selectAction === undefined
  const swipeStart = useRef<{ x: number; y: number; id: number } | null>(null)
  const onBoardPointerDown = (event: ReactPointerEvent): void => {
    swipeStart.current = { x: event.clientX, y: event.clientY, id: event.pointerId }
  }
  const onBoardPointerUp = (event: ReactPointerEvent): void => {
    const start = swipeStart.current
    swipeStart.current = null
    if (!start || start.id !== event.pointerId) return
    const dx = event.clientX - start.x
    const dy = event.clientY - start.y
    const threshold = 24
    if (Math.abs(dx) < threshold && Math.abs(dy) < threshold) return // 点击：交给格子
    if (Math.abs(dx) >= Math.abs(dy)) onMove(dx > 0 ? 'right' : 'left')
    else onMove(dy > 0 ? 'down' : 'up')
  }
  const onBoardPointerCancel = (): void => {
    swipeStart.current = null
  }

  /**
   * 自由选关：进入对局后跳到指定关卡。
   *
   * 为什么放在"就绪之后"：新建会话会先加载存档（或新造一局，从第一关开始），
   * 必须等它 ready 再派发，否则会被随后的加载覆盖掉。
   * 只派发一次（依赖里带 startLevelId 与 ready），重复渲染不会反复跳。
   */
  const jumpedLevelRef = useRef<string | null>(null)
  useEffect(() => {
    if (!startLevelId || !session.ready || session.corrupt) return
    /*
     * 只跳一次（按关卡 id 记名）。
     * 起因：session.startLevel 每次渲染都是**新函数**，若只用依赖数组约束，
     * 每走一步都会重渲染 → effect 重跑 → 又跳回该关初始局面，
     * 表现就是"标题对但怎么点都不动"（实测踩到过）。
     */
    if (jumpedLevelRef.current === startLevelId) return
    jumpedLevelRef.current = startLevelId
    session.startLevel(startLevelId)
  }, [startLevelId, session.ready, session.corrupt, session.startLevel])

  useKeyboardControls({
    onMove,
    onUndo: () => session.undo(),
    onRestart: () => setConfirmRestart(true),
    onEscape: () => (session.paused ? session.resume() : session.pause()),
    enabled: session.ready && !session.corrupt,
  })

  // 无障碍标签：优先用游戏包声明的 key，缺省回退到格子自身的符号
  const cellLabel = (kind: CellKind, index: number, glyph: string): string => {
    const row = cellLabelRow(session.view.board, index)
    const key = entry.cellLabelKey?.(kind)
    return `${key ? i18n.t(key) : glyph}${row}`
  }

  // 内容 id：优先由游戏包提供（无关卡制游戏用难度等），否则回退到 state.levelId
  const contentId = entry.game.contentId?.(session.state) ?? fallbackLevelId(session.state)

  const levelIndex =
    entry.indexOfLevel?.(contentId, session.state) !== undefined
      ? (entry.indexOfLevel(contentId, session.state) ?? 0) + 1
      : 1
  const levelTotal = entry.levels?.length ?? 0
  // 标题带上「当前/总数」，因此统计栏里不再重复一项「关卡 12/16」
  const hasLevels = levelTotal > 0
  // 只在确实有关卡时才算关卡文案：否则会去取 <ns>.level.label，
  // 无关卡的游戏没定义这个 key，会往 i18n.missingKeys() 里留一个幽灵缺失项（诊断页可见）
  const levelLabel = hasLevels
    ? i18n.t(`${entry.game.i18nNamespace}.level.position`, { index: levelIndex, total: levelTotal })
    : ''
  const clearedCount = session.progress.completed?.length ?? 0
  // difficulty 是本组件的 prop（详情页选定的难度），直接使用
  const subtitleParts = [
    difficulty ? i18n.t(`${entry.game.i18nNamespace}.difficulty.${difficulty}`) : '',
    clearedCount > 0 && levelTotal > 0
      ? i18n.t('shell.game.cleared', { done: clearedCount, total: levelTotal })
      : '',
  ].filter(Boolean)
  const best = (session.progress.bestMoves ?? {})[contentId]
  /**
   * 游戏自定义按钮：`controls()` 里 role 为 action、且不由壳层代管的那些。
   * 壳层自己渲染 undo / restart / menu（id 固定），因此这里排除它们。
   */
  // 壳层自己渲染这些 id 的控件（撤销/重开/下一关），游戏声明它们只为传达 enabled 之类的状态，
  // 不能再被当成「游戏自定义按钮」渲染一遍
  const SHELL_CONTROL_IDS = new Set(['undo', 'restart', 'nextLevel', 'next-level'])
  const gameActions = session.controls.filter(
    (control) => control.role === 'action' && !SHELL_CONTROL_IDS.has(control.id),
  )

  return (
    <div className="eink-screen eink-screen--game" data-game={entry.game.id}>
      <TopBar
        title={
          hasLevels
            ? `${i18n.t(`${entry.game.i18nNamespace}.title`)} · ${levelLabel}`
            : i18n.t(`${entry.game.i18nNamespace}.title`)
        }
        {...(subtitleParts.length > 0 ? { subtitle: subtitleParts.join(' · ') } : {})}
        onBack={() => {
          session.pause()
          onBack()
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
          <h2>
            {i18n.t(
              session.corruptReason === 'unsupported-version'
                ? 'shell.storage.reason.unsupported-version'
                : 'shell.storage.reason.corrupt',
            )}
          </h2>
          <p>
            {i18n.t(
              session.corruptReason === 'unsupported-version'
                ? 'shell.storage.unsupportedHint'
                : 'shell.storage.notPersistent',
            )}
          </p>
          <div className="eink-card__actions">
            <ActionButton labelKey="shell.storage.export" onSelect={() => void exportBackup()} />
            <ActionButton
              labelKey="shell.storage.clear"
              text={i18n.t('shell.detail.start')}
              emphasis="primary"
              onSelect={() => setConfirmDiscard(true)}
            />
            <ActionButton labelKey="shell.nav.back" onSelect={onBack} />
          </div>
        </section>
      ) : (
        <>
          {/* 尺寸由 CSS flex 决定（可收缩），格子大小按实测盒子算 —— 不写死像素 */}
          <div
            className="eink-board-area"
            ref={boardAreaRef}
            {...(swipeEnabled
              ? {
                  onPointerDown: onBoardPointerDown,
                  onPointerUp: onBoardPointerUp,
                  onPointerCancel: onBoardPointerCancel,
                  /* 只有启用滑动的玩法才需要屏蔽页面滚动/缩放；点击类玩法保持默认，轻点更可靠 */
                  style: { touchAction: 'none' as const },
                }
              : {})}
          >
            {session.view.board && boardLayout ? (
              <Board
                board={session.view.board}
                cell={boardLayout.cell}
                labelFor={cellLabel}
                bold={settings.boldLines}
                {...(session.selectCell ? { onCellSelect: session.selectCell } : {})}
              />
            ) : null}
          </div>

          <div
            className="eink-statusstrip"
            data-expanded={session.failureReason ? 'yes' : 'no'}
            /*
             * 有游戏提示（非法动作 / 建议竖屏）时不能走"压缩成 28px"的样式：
             * 提示是一整句话，大字号档下 28px 装不下会被裁掉。
             */
            data-notice={session.view.notice || boardOverflow ? 'yes' : 'no'}
          >
            <NoticeLine
              {...(session.view.notice
                ? { textKey: session.view.notice.textKey }
                : boardOverflow
                  ? { textKey: 'shell.game.rotateHint' }
                  : {})}
            />
            <SaveBadge
              status={session.saveStatus}
              failureText={
                session.failureReason ? i18n.t(`shell.storage.reason.${session.failureReason}`) : undefined
              }
              onRetry={session.retrySave}
              onExport={() => void exportBackup()}
            />
          </div>

          {session.finished && session.view.result ? (
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
                  <li>{i18n.t(`${entry.game.i18nNamespace}.solved.best`, { count: best })}</li>
                ) : null}
              </ul>
              <div className="eink-card__actions">
                {/* 「下一关」由游戏自己声明（id: next-level）：无关卡的游戏不声明 → 这个按钮不渲染；
                    关卡制游戏在最后一关声明 enabled:false → 按钮显示为禁用。 */}
                {session.controls.some((control) => control.id === 'next-level') ? (
                  <ActionButton
                    labelKey="shell.result.next"
                    emphasis="primary"
                    size="large"
                    disabled={
                      !session.controls.some((control) => control.id === 'next-level' && control.enabled)
                    }
                    onSelect={() => session.nextLevel()}
                  />
                ) : null}
                <ActionButton labelKey="shell.result.again" onSelect={() => setConfirmRestart(true)} />
                <ActionButton labelKey="shell.result.library" onSelect={onExit} />
              </div>
            </section>
          ) : null}

          {/* 过关后控制区让位给结果面板：此时没有用处，而结果面板必须与棋盘一起
              落在首屏内（墨水屏上不该为了看结果去滚动）。
              注意：方向键受「显示方向按钮」设置控制，**游戏自定义按钮与壳层按钮不受它影响** ——
              否则数独、扫雷这类没有方向控件的游戏会连自己的按钮都不显示。 */}
          {!session.finished ? (
            <div className="eink-controls">
              {dpadOn ? (
                <Dpad
                  controls={session.controls}
                  onMove={onMove}
                  size={root.buttonHeight}
                  labelKey={`${entry.game.i18nNamespace}.dpad.label`}
                />
              ) : null}
              {gameActions.length > 0 ? (
                <div className="eink-controls__game">
                  {gameActions.map((control) => (
                    <ActionButton
                      key={control.id}
                      labelKey={control.labelKey}
                      size="large"
                      emphasis={control.emphasis}
                      disabled={!control.enabled}
                      onSelect={() => {
                        session.clearNotice()
                        session.runControl?.(control.id)
                      }}
                    />
                  ))}
                </div>
              ) : null}
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
              {/*
                Direction-pad toggle. Only offered when the game actually renders a pad:
                dpad-only games are unplayable once it is hidden, and games that never render
                a pad would get an option that changes nothing. Hiding the pad frees height,
                so the board grows.
              */}
              {session.controls.some((control) => control.role === 'dpad') ? (
                <ActionButton
                  text={`${i18n.t('shell.settings.dpad')}: ${dpadOn ? i18n.t('shell.common.on') : i18n.t('shell.common.off')}`}
                  emphasis={dpadOn ? 'primary' : 'normal'}
                  onSelect={() => void updateGameSettings(entry.game.id, { dpad: !dpadOn })}
                />
              ) : null}
              <ActionButton labelKey="shell.result.library" onSelect={onExit} />
            </div>
          </div>
        </div>
      ) : null}


      {confirmRestart ? (
        <Dialog
          titleKey="shell.game.restart"
          bodyKey={`${entry.game.i18nNamespace}.rules.restart`}
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

function fallbackLevelId(state: unknown): string {
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
