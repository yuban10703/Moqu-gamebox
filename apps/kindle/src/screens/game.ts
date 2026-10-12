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

/*
 * 顶栏 / 统计 / 控制区占掉的高度。
 *
 * 这几个常量**只是首帧的估值**：真实高度由 CSS 决定（实测顶栏 65px、统计栏 65px、
 * 页脚竖屏 156px / 横屏 100px、吃子盘 48px×2 —— 与这里的估值差得很远）。
 * 靠估值算棋盘尺寸会把棋盘算大：中国象棋/国际象棋竖屏会溢出 7~31px，
 * 数织更是被裁掉一半（全量审计量出来的）。
 * 所以渲染完还要**按实测的可用带子收敛一次**（见 fitToViewport）。
 */
const CHROME_TOP = 52
const CHROME_STATS = 30
/**
 * 提示条预留的一行高度（px）：13px 字 × 1.4 行高 + 上下内边距 12 + 下边框 1 ≈ 32，取 34 留余量。
 *
 * 这个值**必须够放下常见提示的一行**，否则"有提示"会比"没提示"高，棋盘又开始动。
 * 各玩法非法动作提示最长 19.2 个全角字（英文），在 600px 宽的屏上也只占一行。
 */
const NOTICE_LINE = 34
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

  /*
   * 「重开」对两类玩法的语义**不一样**（与现代版保持一致）：
   *   · 有关卡（推箱子/华容道）：回到**本关**初始局面 —— 布局是固定的，换种子没意义，
   *     而且用 restartFresh 会把玩家踢回第 1 关。
   *   · 无关卡（扫雷/2048/记忆/数织…）：**换一个种子重新生成** ——
   *     否则按多少次「重开」都是同一道题。
   *
   * 这一条有玩法自己的规则文案作证：数织写的是「重开会换一道题」、
   * 记忆写的是「重新洗牌」、扫雷写的是「重新放置地雷」——
   * 而壳层原先一律只调 session.restart()，等于把游戏自己承诺的语义做没了
   * （与现代版记录的用户反馈"重新开始并不会随机生成关卡"是同一件事）。
   */
  const hasLevels = !!(entry.levels && entry.levels.length > 0)

  const dpadOn = ctx.settings.dpad && entry.dpadDefault !== false
  const dpadLayout = entry.dpadLayout ?? 'tee'
  // 能不能滑动由登记表决定（点格子的玩法一律不能滑），与提示文案同一判据
  const canSwipe = supportsSwipe(entry)

  // 'unavailable' = 这台设备根本不让写；'quota' = 空间满；'io' = 其它写失败
  let saveFailure: 'unavailable' | 'quota' | 'io' | null = null
  // 棋盘高度的收敛：0 = 还没收敛（用估值），>0 = 实测后压小的预算
  let boardBudget = 0
  let usedBoardHeight = 0
  let fitAttempts = 0
  let nudged = false
  let scrollFallback = false

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
    /*
     * 顶栏保存状态用**状态词**：已保存 / 保存中… / 存档失败。
     * 原先借的是 shell.storage.title（「数据管理」）+ ✓ —— 用户看到的是一个
     * 莫名其妙的「数据管理 ✓」，既不是状态也不是动作（视觉检查发现的）。
     */
    const saveStatusText =
      session.saveStatus === 'saving' ? ctx.t('shell.storage.saving')
        : session.saveStatus === 'failed' ? ctx.t('shell.storage.statusFailed')
          : session.saveStatus === 'saved' ? ctx.t('shell.storage.saved')
            : undefined
    root.appendChild(
      topBar(ctx, {
        title: titleParts.join(' · '),
        subtitle: saveStatusText,
        onBack: function openMenu(): void {
          openPauseMenu()
        },
        actions: [{ label: ctx.t('shell.game.menu'), onClick: openPauseMenu }],
      }),
    )

    /*
     * 提示条：**高度先按一行预留，空着也占位**。
     *
     * 原先只在有内容时才把这行插进文档流，后果是每次「走不通」都把棋盘往下推 74px
     * （实测），而且 .k-main 的高度是钉死的、棋盘还会跟着缩小 ——
     * 墨水屏上这等于"眼睛刚对准就换了一屏"，玩家报的就是这个。
     * 现代版的做法同样是"状态条高度始终不变"（见 packages/ui/src/styles.css）。
     *
     * 用 min-height 而不是 height：常见提示（「这个方向走不通」7 字、各玩法的非法动作
     * 提示最长 19 字）一行足够，于是"有提示"和"没提示"的盒子高度**完全相同**，
     * 棋盘一动不动；坏档说明那类长文案（最长 96 字）允许把它撑高 ——
     * 那是一次性的、发生在开局，撑高一次可以接受，总比把字静默切掉好。
     */
    const statusText = pendingStatus ? ctx.t(pendingStatus) : session.noticeKey ? ctx.t(session.noticeKey) : null
    const noticeBand = el('div', {
      class: 'k-notice k-notice--band',
      style:
        'box-sizing:border-box;min-height:' + NOTICE_LINE + 'px;margin:0 0 6px 0;padding:6px 10px;' +
        'border:none;border-bottom:1px solid #000;font-size:13px;line-height:1.4;overflow:visible;',
    })
    if (statusText) noticeBand.appendChild(el('span', {}, statusText))
    root.appendChild(noticeBand)

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
      /*
       * 空的吃子盘画**虚线**：
       * 1-bit 界面里"虚线框 = 空位"是既定语言（空棋位、空牌堆、空槽位全都这么画）。
       * 开局没有人被吃，实线空框看起来像渲染残留；虚线则读得出"这是架子，还没东西"。
       * 常驻固定高度不变 —— 第一次吃子时棋盘依旧不跳。
       */
      const topStyle =
        'min-height:20px;padding:2px 8px;font-size:15px;letter-spacing:2px;' +
        (view.captured.top ? '' : 'border-style:dashed;')
      root.appendChild(
        el('div', { class: 'k-captured k-captured--top', style: topStyle },
          view.captured.top ? view.captured.top : ''),
      )
    }

    // 棋盘 / 牌桌 / 对决
    // 棋盘/牌桌/对决都放进 .k-main：页脚是绝对定位的预算栏，靠它让位
    const body = el('div', { class: 'k-main', style: 'padding:4px 6px;' })
    const chromeBottom = dpadOn && hasDpad() ? (dpadLayout === 'row' ? CHROME_BOTTOM_ROW : CHROME_BOTTOM_TEE) : CHROME_BOTTOM_MIN
    const statsH = view.stats.length > 0 ? CHROME_STATS : 0
    const estimated = ctx.height - CHROME_TOP - statsH - chromeBottom - 24
    // 收敛后的预算优先（fitToViewport 会把它压小）
    const boardHeight = Math.max(120, boardBudget > 0 ? Math.min(boardBudget, estimated) : estimated)
    usedBoardHeight = boardHeight

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

    // 战斗日志自动滚到最新一条：renderDuel 在容器挂进文档**之前**渲染，
    // 那时盒子高度还是 0，scrollTop 赋值无效——必须在挂进文档之后设（原实现就卡在这）。
    // 每次重绘都停到最新一条：战斗日志只会追加，最新的一条就是玩家最关心的。
    const duelLog = body.querySelector('.k-duel__log') as HTMLElement | null
    if (duelLog) duelLog.scrollTop = duelLog.scrollHeight

    if (view.captured) {
      const bottomStyle =
        'min-height:20px;padding:2px 8px;font-size:15px;letter-spacing:2px;text-align:right;' +
        (view.captured.bottom ? '' : 'border-style:dashed;')
      root.appendChild(
        el('div', { class: 'k-captured k-captured--bottom', style: bottomStyle },
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
          askRestart()
          return
        }
        if (!session.runControl(id)) {
          // 游戏不认这个 id：回落到壳层约定（例如 pause）
          if (id === 'pause') openPauseMenu()
        }
      },
      cornerLeft: undoHidden ? null : button('↶', function undo(): void { session.undo() }, { small: true, disabled: !session.hasControl('undo') }),
      cornerRight: restartHidden ? null : button('↻', function restart(): void { askRestart() }, { small: true }),
    })
    root.appendChild(el('div', { class: 'k-footer', style: 'border-top:1px solid #000;padding:4px 8px;' }, controlBar))

    // DOM 已经进文档，可以量真实高度了
    fitToViewport()
  }

  /**
   * 渲染完量一次：呈现区（棋盘/牌桌/对决）有没有超出**实测**的可用带子。
   *
   * 为什么必须实测：算棋盘高度要减掉顶栏、统计栏、吃子盘、控制区、页脚……
   * 这些高度全由 CSS 决定，而 CSS 是另一套可变的东西（横竖屏还不一样）。
   * 用常量估就会算大 —— 大出来的部分被 .k-main 的 overflow:hidden 静静裁掉，
   * 页面上不报任何错，只是棋盘底下一截看不见、手牌点不到。
   *
   * 收敛方式：按实测比例收缩预算后重画，最多两次（正常一次就够；两次仍不收敛说明
   * 不是尺寸问题，继续重画只会闪屏）。
   */
  /** 呈现区的根元素：棋盘 / 手牌布局 / 牌堆布局（空当接龙）/ 对决面板 */
  const SURFACE_SELECTOR = '.k-board, .k-cards, .k-piles, .k-duel'

  /**
   * 渲染完量一次：呈现区有没有超出**实测**的可用带子；超了就收缩再画一次。
   *
   * 为什么必须实测：棋盘高度要减掉顶栏、统计栏、吃子盘、控制区、页脚……
   * 这些高度全由 CSS 决定，横竖屏还不一样。用常量估就会算大，而大出来的部分
   * 被 .k-main 的 overflow:hidden 静静裁掉 —— 页面上不报任何错，
   * 只是棋盘底下一截看不见、手牌点不到。
   *
   * 收敛不了时（牌桌/对决渲染器按比例缩放，可能缩不动）走 applyNudge 兜底。
   * 最多收敛两次：两次还不行的，继续重画只会闪屏，问题不在预算上。
   */
  function fitToViewport(): void {
    const main = root.querySelector('.k-main') as HTMLElement | null
    const surface = root.querySelector(SURFACE_SELECTOR) as HTMLElement | null
    const footer = root.querySelector('.k-footer') as HTMLElement | null
    if (!main || !surface || !footer) return

    const mainRect = main.getBoundingClientRect()
    const surfaceRect = surface.getBoundingClientRect()
    const band = footer.getBoundingClientRect().top - mainRect.top
    if (band <= 40 || surfaceRect.height <= 0) return

    /*
     * 第一步：把 .k-main 的高度**钉死**在可用带子上。
     *
     * 这是结构性的修法：`.k-main` 的高度本来由内容撑开，内容一高它就钻到
     * 绝对定位的页脚底下（页脚白底一盖，底部那截看不见也点不到，而页面上不报错）。
     * 与其每次去猜"内容该多高"，不如直接告诉它"你就这么高"——
     * 于是"主内容伸到页脚下面"这一类问题从根上不可能再出现。
     *
     * 同时把 CSS 里给页脚预留的 margin-bottom 归零：高度已经钉死了，
     * 再留那 168px 只会把文档撑高（虽然被 .k-app 裁掉，但会让"整页不滚动"的断言变味）。
     */
    /*
     * **每次渲染都要重新钉**：draw() 会清空并重建 .k-main，钉死的内联样式随节点一起没了；
     * 用一个 mainPinned 标记挡住重复设置的话，重画之后就等于没钉
     * （实测：斗地主/空当接龙仍然压到页脚下面）。
     * 这一步是幂等的，而且不影响 band 的测量（band 只看 main 的顶边）。
     *
     * 必须连盒模型一起指定：.k-main 默认是 content-box，
     * 只给 height 的话内边距会加在它外面（实测每次多出 8px）。
     */
    main.style.boxSizing = 'border-box'
    main.style.height = Math.floor(band) + 'px'
    main.style.marginBottom = '0'

    /*
     * 可用高度还要再扣两样：
     *   offsetInside：呈现区上方压着的东西（.k-main 的上内边距等）
     *   tail：呈现区下方的内边距
     * 最初只扣了前一项，于是每次都在底部差 3~6px —— 差得不多，
     * 但正好是被页脚盖住的那几像素（审计每次都报）。
     */
    const offsetInside = Math.max(0, surfaceRect.top - mainRect.top)
    const computed = window.getComputedStyle(main)
    const padBottom = parseFloat(computed.paddingBottom ? computed.paddingBottom : '0') || 0
    const tail = padBottom + 2
    if (surfaceRect.height <= band - offsetInside - tail) return // 已经放得下

    if (fitAttempts < 4) {
      /*
       * 直接把**实测的可用高度**当作预算，而不是按比例缩放。
       * 比例缩放是错的：棋盘尺寸取"宽高两种约束的较小值"，对接近正方形的棋盘
       * （数织、象棋）**约束其实在宽度**，压高度预算它一点都不变小
       * （实测日志：预算 858 → 826，棋盘纹丝不动）。
       */
      const available = Math.max(120, Math.floor(band - offsetInside - tail - 4))
      if (available < usedBoardHeight) {
        fitAttempts++
        boardBudget = available
        draw()
        return
      }
    }

    /*
     * 收敛失败时先试"有让步空间的那一块"：对决面板里的**对战记录**。
     *
     * 实测（恶魔轮盘赌 @1024×760）：上家 102 + 枪台 177 + 记录 176 + 下家 115 ≈ 730，
     * 而可用只有 522 —— 记录区是唯一可以缩短而不影响操作的东西
     * （它只是"最近发生了什么"，最新几条仍在可见范围内，渲染器本来就会滚到底部）。
     * 先砍它，砍完还不够再走整体缩放。
     */
    if (shrinkDuelLog(surface, surfaceRect.height - (band - offsetInside - tail))) {
      const after = surface.getBoundingClientRect().height
      if (after <= band - offsetInside - tail + 2) return
    }

    // 还不行 → 兜底缩放（每个屏幕只做一次）
    applyNudge(band - offsetInside - tail - 2, surfaceRect.height, surface)
  }

  /**
   * 最后手段：把呈现区整体缩一点。
   *
   * 为什么需要：牌桌 / 对决渲染器的尺寸是**按比例**从 height 推的（卡宽、头像、字号），
   * 而斗地主这类布局的总高主要由**宽度**决定 —— 把 height 预算压下去，它纹丝不动
   * （实测：预算 858 → 720，渲染高度仍是 756）。与其为几个百分点去改上千行布局代码，
   * 不如整体缩：比例很小（通常 3~12%），触摸目标仍在 44px 以上，字也不会糊。
   *
   * 下限 0.88：超过 12% 说明布局结构上就放不下，再缩只会把字缩到读不清 ——
   * 那种情况该去改渲染器，而不是在这里假装解决了。
   */
  /**
   * 保底：让主内容可以滚动。
   *
   * 这个版本的设计原则是"不滚动、只翻页"，但在**极矮的屏幕**上（实测 900×520、
   * 600×800）有些布局就是放不下 —— 对决面板要 ~730px、斗地主的手牌要 ~620px，
   * 而可用带子只剩 390px。
   *
   * 两害相权：**缩到看不清**（缩放 <0.85）和**裁掉看不见**都不可接受，
   * 而"能滚一下够到底部"至少保证每个按钮都点得到。
   * 墨水屏上滚动体验不好，所以这是最后手段，不是常规做法 ——
   * 常规视口（竖屏 760×1024 / 横屏 1024×760）都由收敛与缩放在不滚动的前提下解决。
   */
  function allowScrollFallback(): void {
    if (scrollFallback) return
    scrollFallback = true
    const main = root.querySelector('.k-main') as HTMLElement | null
    if (!main) return
    main.style.height = 'auto'
    main.style.overflowY = 'auto'
    // 老 iOS/WebKit 的惯性滚动；属性名不在标准类型里，用 setProperty 写
    main.style.setProperty('-webkit-overflow-scrolling', 'touch')
  }

  /**
   * 缩短对决面板里的对战记录，给上面那几块腾出空间。
   * 记录区是"只读信息"，缩短它不会让任何操作变得点不到 —— 这是唯一该动的块。
   * 返回是否真的缩短了。
   */
  function shrinkDuelLog(surface: HTMLElement, need: number): boolean {
    if (need <= 0) return false
    const log = surface.querySelector('.k-duel__log') as HTMLElement | null
    if (!log) return false
    const current = log.getBoundingClientRect().height
    const floor = 46 // 大约两行，低于这个就只剩一条缝，不如不要
    if (current <= floor) return false
    const next = Math.max(floor, Math.round(current - need - 4))
    if (next >= current) return false
    log.style.maxHeight = next + 'px'
    log.style.overflow = 'hidden'
    return true
  }

  function applyNudge(band: number, actual: number, surface: HTMLElement): void {
    if (nudged) return
    const ratio = band / actual
    /*
     * 缩放下限 0.85。再往下字就糊了、触摸目标也掉到 44px 以下 ——
     * 那种情况不是"差一点"，而是**这个布局在这么矮的屏幕上就是放不下**，
     * 该走下面的保底（允许滚动），而不是把界面缩成看不清的样子。
     */
    if (ratio < 0.85) {
      allowScrollFallback()
      return
    }
    nudged = true
    const scale = ratio.toFixed(3)
    surface.setAttribute(
      'style',
      (surface.getAttribute('style') || '') +
        ';transform-origin:top left;-webkit-transform-origin:top left;' +
        'transform:scale(' + scale + ');-webkit-transform:scale(' + scale + ');',
    )
  }

  function hasDpad(): boolean {
    const controls = session.controls
    for (let i = 0; i < controls.length; i++) {
      if (controls[i].role === 'dpad') return true
    }
    return false
  }

  /** 真的重开（已经确认过） */
  function doRestart(): void {
    session.resume()
    if (hasLevels) session.restart()
    else session.restartFresh()
  }

  /**
   * 重开前先确认。
   *
   * 正文用**玩法自己**的 `<ns>.rules.restart` —— 它说明的是"这一款重开意味着什么"
   * （数织：换一道题；推箱子：清空本关进度），比壳层写一句通用话准确得多。
   * 20/20 款都定义了这个键，但仍然走 ctx.has 兜底。
   */
  function askRestart(): void {
    const bodyKey = ns + '.rules.restart'
    showDialog({
      title: ctx.t('shell.game.restart'),
      body: ctx.has(bodyKey) ? ctx.t(bodyKey) : undefined,
      actions: [
        { label: ctx.t('shell.game.restart'), primary: true, onClick: doRestart },
        { label: ctx.t('shell.common.cancel'), onClick: function cancel(): void {} },
      ],
    })
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
    /*
     * 撤销与结果面板/U 键共用同一套判据（未判胜 + 玩法未隐藏 + 此刻有一步可撤）。
     * 这个菜单在**终局后仍能被点开**（顶栏「菜单」还在），赢局玩家从这里撤销
     * 会跟刚落盘的通关记录打架 —— React 用同一个 undoAvailable 把这条路一并关掉。
     */
    if (
      !session.solved &&
      !undoHidden &&
      hasEnabledControl('undo')
    ) {
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
          askRestart()
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
    /*
     * **输/平之后给出撤销**（用户反馈：游戏输后不能撤销，与现代版不一致）。
     *
     * React 结果面板的同一条规则：
     *   · **已判胜不给** —— 通关记录刚刚落盘，撤回去会跟完成记录打架；
     *   · 玩法声明 hideShellControls:['undo'] 不给；
     *   · 游戏此刻必须自己给出一个**可用的** undo 控件（有一步可撤）。
     * 三个条件都满足时它是面板上的主按钮 —— 输掉的这一刻，玩家最想要的就是上一手。
     * 会话侧终局白名单本来就包含 undo：撤回到位后面板关闭、对局恢复进行中。
     */
    if (outcome !== 'won' && (entry.hideShellControls ?? []).indexOf('undo') < 0 && hasEnabledControl('undo')) {
      actions.push({
        label: ctx.t('shell.game.undo'),
        primary: true,
        onClick: function undoAfterLoss(): void {
          // dispatch 不放行 undo 之外的动作；撤完 status 回 playing，本面板已随点击关闭
          session.undo()
          draw()
        },
      })
    }
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
        // 走统一的 doRestart：关卡制回本关，无关卡玩法换新一局
        doRestart()
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

  /** 控件存在且**当前可用**（撤销入口要求"现在真的有一步可撤"） */
  function hasEnabledControl(id: string): boolean {
    const controls = session.controls
    for (let i = 0; i < controls.length; i++) {
      if (controls[i].id === id && controls[i].enabled === true) return true
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
        /*
         * U 键与结果面板的撤销共用同一套判据（React 的 undoAvailable 一个开关管两条路）：
         * 未判胜（赢之后不能撤，通关记录已落盘）+ 玩法未声明隐藏 + 此刻确实有一步可撤。
         * 判据在**按下时现算**——这里闭包存活整场对局，状态会一路变化，不能抓快照。
         */
        if (
          !session.solved &&
          (entry.hideShellControls ?? []).indexOf('undo') < 0 &&
          hasEnabledControl('undo')
        ) {
          e.preventDefault()
          session.undo()
        }
        return
      }
      if (code === 82) {
        e.preventDefault()
        askRestart()
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
