/**
 * 对局屏幕：顶栏 + 统计 + 棋盘/牌桌/对决 + 提示 + 控制区 + 暂停菜单 + 结果面板。
 *
 * 布局策略（与 React 版最大的不同）：所有尺寸在这里算成像素，用表格摆。
 * 老引擎上没有容器查询单位，`calc()` 也不可靠 —— 与其写一堆降级 CSS，不如把几何交给 JS，
 * 这样「棋盘永远填满可用宽高且不溢出」是算出来的、可断言的。
 */
import type { CardTableView, ControlSpec, DuelView, GameDef, MoveDir } from '@eink/core'
import { el, clear, on } from '../dom.js'
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
    onSaveStatus: function onSaveStatus(): void {
      /* 保存状态画在顶栏，draw() 里读 session.saveStatus */
    },
    onFinished: function onFinished(outcome: 'won' | 'lost' | 'draw', view): void {
      draw()
      showResult(outcome, view)
    },
  })

  let pendingStatus: string | null = null

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

  function draw(): void {
    clear(root)
    const view = session.view

    // 顶栏：标题（含难度/关卡）、菜单、保存状态
    const titleParts: string[] = [ctx.t(ns + '.title')]
    if (!entry.hideDifficulty && session.difficulty) titleParts.push(ctx.t(ns + '.difficulty.' + session.difficulty))
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
        const detail = view.result.details[i]
        detailTexts.push(ctx.t(detail.key, detail.params))
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
      const detail = view.result.details[i]
      lines.push(ctx.t(detail.key, detail.params))
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
      body: lines.join('\n'),
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
    session.dispose()
  }
}

/** 未使用的占位，保持 progressBar 的引用（棋盘类玩法在库页用） */
void progressBar
