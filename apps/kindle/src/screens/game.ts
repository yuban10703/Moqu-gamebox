/**
 * 对局屏幕：顶栏 + 统计 + 棋盘/牌桌/对决 + 提示 + 控制区 + 暂停菜单 + 结果面板。
 *
 * 布局策略（与 React 版最大的不同）：所有尺寸在这里算成像素，用表格摆。
 * 老引擎上没有容器查询单位，`calc()` 也不可靠 —— 与其写一堆降级 CSS，不如把几何交给 JS，
 * 这样「棋盘永远填满可用宽高且不溢出」是算出来的、可断言的。
 */
import type { CardTableView, ControlSpec, DuelView, GameDef, MoveDir } from '@eink/core'
import { el, clear, on } from '../dom.js'
import { supportsSwipe } from '@eink/ui'
import { findEntry, type Screen, type ScreenCtx } from '../screen-ctx.js'
import { createSession, type Session } from '../session.js'
import { renderBoard, localizeBoard } from '../render/board.js'
import { renderCards } from '../render/cards.js'
import { renderDuel } from '../render/duel.js'
import { renderControls } from '../render/controls.js'
import type { RenderCtx } from '../render/types.js'
import { topBar, button, showDialog, progressBar } from './common.js'

/** 顶栏 + 统计 + 控制区占掉的高度（像素）；棋盘用剩下的 */
const CHROME_TOP = 52
const CHROME_STATS = 30
const CHROME_BOTTOM_TEE = 150
const CHROME_BOTTOM_ROW = 110
const CHROME_BOTTOM_MIN = 60

/**
 * 棋盘上的触摸滑动 → 方向操作。
 *
 * 为什么必须有：Kindle 是触摸屏，而这个版本又把「关掉方向键、用滑动、棋盘更大」
 * 写进了提示文案 —— 提示写了却不实现，等于界面在骗人（用户会反复地滑，然后认为"卡了"）。
 *
 * 判据与 React 版一致（`supportsSwipe`）：**只在没有 selectAction 的玩法上开启**。
 * 点格子的玩法绝不能开 —— 墨水屏触摸有抖动，轻点很容易被判成滑动，
 * 真机反馈过"点到的不是我想点的那块"。
 */
function bindSwipe(target: HTMLElement, onSwipe: (dir: MoveDir) => void): () => void {
  // 阈值取大一些：墨水屏的触摸抖动比手机明显，太小会把"点按"吃成"滑动"
  const THRESHOLD = 40
  // 主轴要明显压过另一轴才认，避免斜着划一下方向就猜错
  const DOMINANCE = 1.2
  let startX = 0
  let startY = 0
  let tracking = false

  function onStart(event: Event): void {
    const touch = (event as TouchEvent).touches
    if (!touch || touch.length !== 1) return
    startX = touch[0].clientX
    startY = touch[0].clientY
    tracking = true
  }

  function onMove(event: Event): void {
    if (!tracking) return
    const e = event as TouchEvent
    const touch = e.touches
    if (!touch || touch.length !== 1) return
    const dx = touch[0].clientX - startX
    const dy = touch[0].clientY - startY
    // 只有确认是"滑动"之后才阻止页面跟随移动；点按阶段不拦，免得吃掉 click
    if (Math.abs(dx) < THRESHOLD && Math.abs(dy) < THRESHOLD) return
    if (e.cancelable) e.preventDefault()
  }

  function onEnd(event: Event): void {
    if (!tracking) return
    tracking = false
    const e = event as TouchEvent
    const touch = e.changedTouches
    if (!touch || touch.length === 0) return
    const dx = touch[0].clientX - startX
    const dy = touch[0].clientY - startY
    const ax = Math.abs(dx)
    const ay = Math.abs(dy)
    // 距离不够 = 这是一次点按：什么都不做，交给原本的 click 逻辑
    if (ax < THRESHOLD && ay < THRESHOLD) return
    if (ax >= ay * DOMINANCE) onSwipe(dx > 0 ? 'right' : 'left')
    else if (ay >= ax * DOMINANCE) onSwipe(dy > 0 ? 'down' : 'up')
  }

  function onCancel(): void {
    tracking = false
  }

  target.addEventListener('touchstart', onStart, false)
  target.addEventListener('touchmove', onMove, false)
  target.addEventListener('touchend', onEnd, false)
  target.addEventListener('touchcancel', onCancel, false)
  return function unbind(): void {
    target.removeEventListener('touchstart', onStart, false)
    target.removeEventListener('touchmove', onMove, false)
    target.removeEventListener('touchend', onEnd, false)
    target.removeEventListener('touchcancel', onCancel, false)
  }
}

export const renderGame: Screen = function renderGame(root: HTMLElement, ctx: ScreenCtx): () => void {
  const found = findEntry(ctx.library, ctx.params.gameId)
  if (!found) {
    ctx.navigate('library')
    return function noop(): void {}
  }
  // 绑定到非空常量：下面的 draw() 是闭包，收窄不会穿过闭包边界
  const entry: NonNullable<ReturnType<typeof findEntry>> = found
  const game = entry.game
  const ns = game.i18nNamespace
  const unbinds: Array<() => void> = []

  const dpadOn = ctx.settings.dpad && entry.dpadDefault !== false
  const dpadLayout = entry.dpadLayout ?? 'tee'
  // 能不能滑动由登记表决定（点格子的玩法一律不能滑），与提示文案同一判据
  const canSwipe = supportsSwipe(entry)

  // 'unavailable' = 这台设备根本不让写；'quota' = 空间满；'io' = 其它写失败
  let saveFailure: 'unavailable' | 'quota' | 'io' | null = null

  const session = createSession<unknown, unknown>({
    game: game as GameDef<unknown, unknown>,
    difficulty: ctx.params.difficulty ?? entry.defaultDifficulty,
    startContentId: ctx.params.contentId ?? (entry.levels && entry.levels.length > 0 ? entry.levels[0].id : null),
    resume: ctx.params.fresh !== true,
    autoTick: ctx.settings.autoTick,
    onRender: function rerender(): void {
      draw()
    },
    onStatus: function onStatus(textKey: string | null): void {
      pendingStatus = textKey
    },
    onSaveStatus: function onSaveStatus(status): void {
      // 写入成功后把"保存失败"那条常驻提示收掉（否则玩家修好了空间也不知道）
      if (status === 'saved') saveFailure = null
    },
    onSaveFailed: function onSaveFailed(reason): void {
      /*
       * 保存失败**必须常驻显示**，不能只闪一条提示：
       * 提示会在下一次成功操作时被清掉，而"写不进去"是会一直持续的状态 ——
       * 玩家可能读了一小时才发现进度全丢。所以这里记成状态，由 draw() 常驻渲染，
       * 并给一个「重试」入口。
       */
      saveFailure = reason
    },
    onFinished: function onFinished(outcome: 'won' | 'lost' | 'draw', view): void {
      draw()
      showResult(outcome, view)
    },
  })

  let pendingStatus: string | null = null

  /**
   * 结果明细的文案：与 React 版同一规则 ——
   * **带 params 的走 plural**（数量类文案在字典里只有 __one/__other），不带的走 t。
   * 之前一律用 t()，导致「本局共下了 N 手」这类明细在屏幕上显示成 ⟦tictactoe.result.moves⟧。
   */
  function detailText(detail: { key: string; params?: Record<string, string | number> }): string {
    if (!detail.params) return ctx.t(detail.key)
    const count = Number(detail.params.count !== undefined ? detail.params.count : 0)
    return ctx.plural(detail.key, count, detail.params)
  }

  function renderCtx(width: number, height: number): RenderCtx {
    return {
      t: ctx.t,
      width: width,
      height: height,
      dpad: dpadOn,
      onCell: function onCell(index: number): void {
        session.selectCell(index)
      },
      onCard: function onCard(id: number): void {
        session.selectCell(id)
      },
      onItem: function onItem(id: number): void {
        session.selectCell(id)
      },
      onSteal: function onSteal(slot: number): void {
        session.steal(slot)
      },
    }
  }

  // 每次重画都会重建棋盘 DOM，所以滑动的监听要跟着重绑（否则会挂在已移除的节点上）
  let unbindSwipe: (() => void) | null = null

  function draw(): void {
    if (unbindSwipe) {
      unbindSwipe()
      unbindSwipe = null
    }
    clear(root)
    const view = session.view

    // 顶栏：标题（含难度/关卡）、菜单、保存状态
    /*
     * 标题 = 玩法名 + 当前进度。
     *
     * 关卡制玩法必须显示「第 N/M 关」：推箱子的统计栏里**没有**关卡项，
     * 不显示的话玩家既看不出自己在第几关，也发现不了"选了第 4 关却进了第 1 关"
     * 这类缺陷（React 版就是把关卡位置放标题里、统计栏不再重复一项）。
     */
    const titleParts: string[] = [ctx.t(ns + '.title')]
    const levelTotal = entry.levels ? entry.levels.length : 0
    if (levelTotal > 0) {
      let levelIndex = 1
      if (entry.indexOfLevel) {
        const found = entry.indexOfLevel(session.contentId(), session.state)
        levelIndex = (found === undefined || found === null ? 0 : found) + 1
      }
      titleParts.push(ctx.t(ns + '.level.position', { index: levelIndex, total: levelTotal }))
    } else if (!entry.hideDifficulty && session.difficulty) {
      titleParts.push(ctx.t(ns + '.difficulty.' + session.difficulty))
    }
    const saveMark =
      session.saveStatus === 'saved' ? ' ✓' : session.saveStatus === 'saving' ? ' …' : session.saveStatus === 'failed' ? ' ✗' : ''
    root.appendChild(
      topBar(ctx, {
        title: titleParts.join(' · '),
        subtitle: saveMark ? ctx.t('shell.storage.title') + saveMark : undefined,
        onBack: function openMenu(): void {
          openPauseMenu()
        },
        actions: [{ label: ctx.t('shell.game.menu'), onClick: openPauseMenu }],
      }),
    )

    const statusText = pendingStatus ? ctx.t(pendingStatus) : session.noticeKey ? ctx.t(session.noticeKey) : null
    if (statusText) {
      root.appendChild(
        el('div', { class: 'k-notice', style: 'padding:6px 10px;border-bottom:1px solid #000;font-size:13px;line-height:1.4;' }, statusText),
      )
    }

    /*
     * 存档写不进去：常驻一行警告 + 重试。
     * 这条**不跟着 notice 走**（notice 会被下一次成功操作清掉，而这个问题不会自己好），
     * 也不靠顶栏那个小小的 ✗ —— 那太容易被忽略，而代价是玩家整局的进度。
     */
    if (saveFailure !== null) {
      const warn = el('div', { class: 'k-notice k-notice--save', style: 'padding:6px 10px;border-bottom:1px solid #000;font-size:13px;line-height:1.4;' })
      const text =
        saveFailure === 'unavailable'
          ? ctx.t('shell.storage.notPersistent')
          : ctx.t('shell.storage.failed', { reason: ctx.t('shell.storage.reason.' + saveFailure) })
      warn.appendChild(el('span', {}, text + ' '))
      warn.appendChild(
        button(ctx.t('shell.storage.retry'), function retry(): void {
          // 重试前重新探一次可用性：玩家可能刚清出空间
          saveFailure = null
          session.retrySave()
          draw()
        }, { small: true }),
      )
      root.appendChild(warn)
    }

    // 统计
    if (view.stats.length > 0) {
      const stats = el('div', { class: 'k-stats', style: 'padding:4px 8px;font-size:13px;line-height:1.5;border-bottom:1px solid #000;' })
      for (let i = 0; i < view.stats.length; i++) {
        const stat = view.stats[i]
        stats.appendChild(el('span', { class: 'k-stat', style: 'margin-right:12px;white-space:nowrap;' },
          el('span', { class: 'k-stat__label', style: 'font-weight:700;' }, ctx.t(stat.labelKey) + ' '),
          el('span', { class: 'k-stat__value' }, stat.value),
        ))
      }
      root.appendChild(stats)
    }

    // 吃子盘（象棋）：棋盘外侧的空白处，常驻固定高度以免第一次吃子时棋盘跳一下
    if (view.captured) {
      root.appendChild(
        el('div', { class: 'k-captured k-captured--top', style: 'min-height:20px;padding:2px 8px;font-size:15px;letter-spacing:2px;' },
          view.captured.top ? view.captured.top : ''),
      )
    }

    // 棋盘 / 牌桌 / 对决
    // 棋盘/牌桌/对决都放进 .k-main：页脚是绝对定位的预算栏，靠它让位
    const body = el('div', { class: 'k-main', style: 'padding:4px 6px;' })
    const chromeBottom = dpadOn && hasDpad() ? (dpadLayout === 'row' ? CHROME_BOTTOM_ROW : CHROME_BOTTOM_TEE) : CHROME_BOTTOM_MIN
    const statsH = view.stats.length > 0 ? CHROME_STATS : 0
    const boardHeight = Math.max(120, ctx.height - CHROME_TOP - statsH - chromeBottom - 24)

    if (view.board) {
      renderBoard(body, localizeBoard(view.board, ctx.t), renderCtx(ctx.width - 12, boardHeight))
      // 只有"方向键驱动"的玩法才接管滑动；终局后不再响应（棋盘还在，但不该再动）
      if (canSwipe && !session.finished) {
        unbindSwipe = bindSwipe(body, function onSwipe(dir: MoveDir): void {
          session.move(dir)
        })
      }
    } else if (view.table) {
      renderCards(body, view.table as CardTableView, renderCtx(ctx.width - 12, boardHeight))
    } else if (view.duel) {
      renderDuel(body, view.duel as DuelView, renderCtx(ctx.width - 12, boardHeight))
    }
    root.appendChild(body)

    if (view.captured) {
      root.appendChild(
        el('div', { class: 'k-captured k-captured--bottom', style: 'min-height:20px;padding:2px 8px;font-size:15px;letter-spacing:2px;text-align:right;' },
          view.captured.bottom ? view.captured.bottom : ''),
      )
    }

    // 结果（view.result 存在且已终局时，底部给一行简洁说明；完整面板由 showResult 弹）
    if (view.result && session.finished) {
      const detailTexts: string[] = []
      for (let i = 0; i < view.result.details.length; i++) {
        detailTexts.push(detailText(view.result.details[i]))
      }
      root.appendChild(
        el('div', { style: 'padding:8px;text-align:center;font-size:14px;line-height:1.5;' },
          el('div', { style: 'font-weight:700;font-size:16px;' }, ctx.t(view.result.titleKey)),
          detailTexts.length > 0 ? el('div', {}, detailTexts.join(' · ')) : null,
        ),
      )
    }

    // 控制区
    const undoHidden = (entry.hideShellControls ?? []).indexOf('undo') >= 0
    const restartHidden = (entry.hideShellControls ?? []).indexOf('restart') >= 0
    const controlBar = renderControls(session.controls, renderCtx(ctx.width - 12, boardHeight), {
      dpad: dpadOn && !session.finished,
      layout: dpadLayout,
      size: dpadLayout === 'row' ? 44 : 52,
      padLabelKey: ns + '.dpad.label',
      onMove: function onMove(dir: MoveDir): void {
        session.move(dir)
      },
      onControl: function onControl(id: string): void {
        if (id === 'undo') {
          session.undo()
          return
        }
        if (id === 'restart') {
          session.restart()
          return
        }
        if (!session.runControl(id)) {
          // 游戏不认这个 id：回落到壳层约定（例如 pause）
          if (id === 'pause') openPauseMenu()
        }
      },
      cornerLeft: undoHidden ? null : button('↶', function undo(): void { session.undo() }, { small: true, disabled: !session.hasControl('undo') }),
      cornerRight: restartHidden ? null : button('↻', function restart(): void { session.restart() }, { small: true }),
    })
    root.appendChild(el('div', { class: 'k-footer', style: 'border-top:1px solid #000;padding:4px 8px;' }, controlBar))
  }

  function hasDpad(): boolean {
    const controls = session.controls
    for (let i = 0; i < controls.length; i++) {
      if (controls[i].role === 'dpad') return true
    }
    return false
  }

  function openPauseMenu(): void {
    session.pause()
    const undoHidden = (entry.hideShellControls ?? []).indexOf('undo') >= 0
    const restartHidden = (entry.hideShellControls ?? []).indexOf('restart') >= 0
    const actions: Array<{ label: string; onClick: () => void; primary?: boolean }> = []
    actions.push({
      label: ctx.t('shell.game.resume'),
      primary: true,
      onClick: function resume(): void {
        session.resume()
      },
    })
    if (!undoHidden) {
      actions.push({
        label: ctx.t('shell.game.undo') ?? ctx.t('shell.common.confirm'),
        onClick: function undo(): void {
          session.resume()
          session.undo()
        },
      })
    }
    if (!restartHidden) {
      actions.push({
        label: ctx.t('shell.game.restart'),
        onClick: function restart(): void {
          session.resume()
          session.restart()
        },
      })
    }
    actions.push({
      label: ctx.t('shell.settings.title'),
      onClick: function settings(): void {
        ctx.navigate('settings')
      },
    })
    actions.push({
      label: ctx.t('shell.game.libraryShort'),
      onClick: function quit(): void {
        ctx.navigate('library')
      },
    })
    showDialog({ title: ctx.t('shell.game.paused'), actions: actions })
  }

  function showResult(outcome: 'won' | 'lost' | 'draw', view: { result: { titleKey: string; details: Array<{ key: string; params?: Record<string, string | number> }> } | null }): void {
    if (!view.result) return
    const lines: string[] = []
    for (let i = 0; i < view.result.details.length; i++) {
      lines.push(detailText(view.result.details[i]))
    }
    const actions: Array<{ label: string; onClick: () => void; primary?: boolean }> = []
    const hasNext = hasControlId('nextLevel') || hasControlId('next-level')
    if (hasNext) {
      actions.push({
        label: ctx.t('shell.result.next'),
        primary: true,
        onClick: function next(): void {
          session.nextLevel()
        },
      })
    }
    actions.push({
      label: ctx.t('shell.result.again'),
      onClick: function again(): void {
        // 回本关初始局面（关卡制）；无关卡玩法由游戏自己的 restart 语义决定。
        // 不要用 restartFresh：那会换种子，对关卡制等于把玩家踢回第 1 关。
        session.restart()
      },
    })
    actions.push({
      label: ctx.t('shell.result.library'),
      onClick: function library(): void {
        ctx.navigate('library')
      },
    })
    showDialog({
      title: ctx.t(view.result.titleKey),
      bodyLines: lines,
      actions: actions,
    })
  }

  function hasControlId(id: string): boolean {
    const controls = session.controls
    for (let i = 0; i < controls.length; i++) {
      if (controls[i].id === id) return true
    }
    return false
  }

  // 物理键：方向键 = 方向 / U = 撤销 / R = 重开 / Esc = 菜单
  unbinds.push(
    on(document, 'keydown', function keydown(event: Event): void {
      const e = event as KeyboardEvent
      const code = e.keyCode || 0
      if (code >= 37 && code <= 40) {
        e.preventDefault()
        const dir: MoveDir = code === 37 ? 'left' : code === 38 ? 'up' : code === 39 ? 'right' : 'down'
        session.move(dir)
        return
      }
      if (code === 85) {
        e.preventDefault()
        session.undo()
        return
      }
      if (code === 82) {
        e.preventDefault()
        session.restart()
        return
      }
      if (code === 27) {
        e.preventDefault()
        openPauseMenu()
      }
    }),
  )

  draw()

  return function cleanup(): void {
    for (let i = 0; i < unbinds.length; i++) unbinds[i]()
    if (unbindSwipe) {
      unbindSwipe()
      unbindSwipe = null
    }
    session.dispose()
  }
}

/** 未使用的占位，保持 progressBar 的引用（棋盘类玩法在库页用） */
void progressBar
