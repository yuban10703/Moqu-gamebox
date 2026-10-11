/**
 * 游戏详情：难度 / 关卡 / 规则 / 进度 / 最佳成绩 + 开始（或继续）。
 *
 * 语义对齐 packages/ui/src/screens/GameDetailScreen.tsx：
 * - `hideDifficulty` 的玩法（推箱子 / 华容道）只显示关卡，不显示「难度」区
 *   —— 那里的"难度"只是"从第几关开始"的快捷方式；
 * - 有存档且未结束时按钮是「继续」，否则是「开始」；
 * - 覆盖已有进度要二次确认（`shell.detail.replace.*`）。
 */
import { el, clear, on } from '../dom.js'
import { findEntry, type Screen, type ScreenCtx } from '../screen-ctx.js'
import { loadProgress, loadSave } from '../store.js'
import { topBar, button, showDialog, field } from './common.js'

export const renderDetail: Screen = function renderDetail(root: HTMLElement, ctx: ScreenCtx): () => void {
  const found = findEntry(ctx.library, ctx.params.gameId)
  if (!found) {
    ctx.navigate('library')
    return function noop(): void {}
  }
  // 绑定到非空常量：后面 draw() 是闭包，TS 不会把 findEntry 的收窄带进闭包
  const entry: NonNullable<ReturnType<typeof findEntry>> = found
  const game = entry.game
  const ns = game.i18nNamespace
  const difficulties = game.difficulties
  const levels = entry.levels ?? null
  const unbinds: Array<() => void> = []

  let difficulty = ctx.params.difficulty ?? entry.defaultDifficulty ?? (difficulties.length > 0 ? difficulties[0].id : '')
  let contentId = ctx.params.contentId ?? (levels && levels.length > 0 ? levels[0].id : null)

  const saved = loadSave(game.id)
  const hasSave = saved.status === 'ok' && game.status(safeDecode(game, saved.envelope ? saved.envelope.state : null)) === 'playing'

  function draw(): void {
    clear(root)

    root.appendChild(
      topBar(ctx, {
        title: ctx.t(ns + '.title'),
        subtitle: !entry.hideDifficulty && difficulty ? ctx.t(ns + '.difficulty.' + difficulty) : undefined,
        onBack: function back(): void {
          ctx.navigate('library')
        },
      }),
    )

    const body = el('div', { class: 'k-main' })

    // 坏档提示：这一条必须显眼，否则用户以为「进度没了」
    if (saved.status === 'corrupt') {
      body.appendChild(
        el('div', { style: 'border:1px dashed #000;padding:8px;margin-bottom:10px;font-size:13px;line-height:1.5;' },
          (saved.reason === 'unsupported-version' ? ctx.t('shell.storage.unsupportedHint') : ctx.t('shell.storage.corruptHint')),
        ),
      )
    }

    // 难度
    if (!entry.hideDifficulty && difficulties.length > 1) {
      body.appendChild(el('div', { class: 'k-section__title', style: 'font-size:15px;font-weight:700;margin:6px 0;' }, ctx.t('shell.detail.difficulty')))
      const row = el('div', {})
      for (let i = 0; i < difficulties.length; i++) {
        const item = difficulties[i]
        const active = item.id === difficulty
        const btn = button(ctx.t(ns + '.difficulty.' + item.id), function pick(): void {
          difficulty = item.id
          draw()
        }, { small: true, primary: active })
        row.appendChild(btn)
      }
      body.appendChild(row)
    }

    // 关卡
    if (levels && levels.length > 0) {
      body.appendChild(el('div', { class: 'k-section__title', style: 'font-size:15px;font-weight:700;margin:10px 0 6px;' }, ctx.t('shell.detail.levels')))
      const grid = el('div', {})
      const completed = loadProgress().completed ?? []
      for (let i = 0; i < levels.length; i++) {
        const level = levels[i]
        const active = level.id === contentId
        const done = completed.indexOf(game.id + ':' + level.id) >= 0
        // 已过关的关卡在 1-bit 下用实心圆点标出来（不靠颜色）
        const label = (done ? '● ' : '') + level.id
        grid.appendChild(
          button(label, function pickLevel(): void {
            contentId = level.id
            draw()
          }, { small: true, primary: active }),
        )
      }
      body.appendChild(grid)
    }

    // 规则
    const rulesKeys = entry.rulesKeys ?? []
    if (rulesKeys.length > 0) {
      body.appendChild(el('div', { class: 'k-section__title', style: 'font-size:15px;font-weight:700;margin:12px 0 6px;' }, ctx.t('shell.detail.rules')))
      const rules = el('div', { style: 'font-size:13px;line-height:1.6;' })
      for (let i = 0; i < rulesKeys.length; i++) {
        rules.appendChild(el('p', { style: 'margin:0 0 8px;' }, ctx.t(rulesKeys[i])))
      }
      body.appendChild(rules)
    }

    // 进度 / 最佳
    const progress = loadProgress()
    const completedList = progress.completed ?? []
    let done = 0
    const total = levels && levels.length > 0 ? levels.length : difficulties.length
    for (let i = 0; i < completedList.length; i++) {
      if (completedList[i].indexOf(game.id + ':') === 0) done++
    }
    if (total > 0) {
      body.appendChild(field(ctx.t('shell.detail.progress'), ctx.t('shell.library.progress', { done: done, total: total })))
    }
    const contentForBest = contentId ?? difficulty
    const bestMoves = (progress.bestMoves ?? {})[contentForBest]
    if (bestMoves !== undefined) {
      body.appendChild(field(ctx.t('shell.result.stats'), ctx.t(ns + '.result.best', { count: bestMoves })))
    }

    // 历史（最多 5 条）
    const history = progress.history ?? []
    if (history.length > 0) {
      body.appendChild(el('div', { class: 'k-section__title', style: 'font-size:15px;font-weight:700;margin:12px 0 6px;' }, ctx.t('shell.detail.history')))
      for (let i = 0; i < history.length; i++) {
        const record = history[i]
        if (record.gameId !== game.id) continue
        const label = record.outcome === 'won' ? ctx.t('shell.result.won') : ctx.t('shell.detail.historyLost')
        body.appendChild(el('div', { style: 'font-size:13px;line-height:1.5;' }, label + ' · ' + ctx.t('shell.common.moves') + ' ' + record.moves))
      }
    }

    root.appendChild(body)

    // 底部动作
    const footer = el('div', { class: 'k-footer', style: 'padding:8px 10px;border-top:1px solid #000;' })
    const startLabel = hasSave ? ctx.t('shell.detail.resume') : ctx.t('shell.detail.start')
    footer.appendChild(
      button(startLabel, function start(): void {
        if (hasSave) {
          ctx.navigate('game', { gameId: game.id, difficulty: difficulty, contentId: contentId ?? undefined })
          return
        }
        ctx.navigate('game', {
          gameId: game.id,
          difficulty: difficulty,
          contentId: contentId ?? undefined,
          fresh: true,
        })
      }, { primary: true, block: true }),
    )
    if (hasSave) {
      footer.appendChild(
        button(ctx.t('shell.detail.replace.confirm'), function restartFresh(): void {
          showDialog({
            title: ctx.t('shell.detail.replace.title'),
            body: ctx.t('shell.detail.replace.body'),
            actions: [
              { label: ctx.t('shell.detail.replace.cancel'), onClick: function cancel(): void {} },
              {
                label: ctx.t('shell.detail.replace.confirm'),
                primary: true,
                onClick: function confirm(): void {
                  ctx.navigate('game', {
                    gameId: game.id,
                    difficulty: difficulty,
                    contentId: contentId ?? undefined,
                    fresh: true,
                  })
                },
              },
            ],
          })
        }, { block: true, danger: true }),
      )
    }
    root.appendChild(footer)
  }

  unbinds.push(
    on(document, 'keydown', function keydown(event: Event): void {
      const code = (event as KeyboardEvent).keyCode || 0
      if (code === 27 || code === 8) {
        event.preventDefault()
        ctx.navigate('library')
      }
    }),
  )

  draw()

  return function cleanup(): void {
    for (let i = 0; i < unbinds.length; i++) unbinds[i]()
  }
}

/** decode 失败时回落到新局（只在「判断存档是否还在进行中」时用，不写回） */
function safeDecode(game: { decode(raw: unknown): unknown; create(seed: number, difficulty: string): unknown }, raw: unknown): unknown {
  try {
    return game.decode(raw)
  } catch (e) {
    return game.create(0, 'starter')
  }
}
