/**
 * 游戏库：分页列出全部玩法（不滚动）。
 *
 * 与 React 版的差异：
 * - 只保留「一页 N 个、翻页」这一条路径（墨水屏上滚动会整屏闪烁，且老引擎的惯性滚动不可控）；
 * - 每行显示名字 + 进度，点行进详情页；
 * - 物理方向键（Kindle 的翻页键上报 Up/Down 或 Left/Right）也能移动选择。
 */
import { el, clear, on } from '../dom.js'
import type { Screen, ScreenCtx } from '../screen-ctx.js'
import { loadProgress } from '../store.js'
import { topBar, button, pager, progressBar } from './common.js'

/** 每页条数：按可用高度算，保证一屏放得下（不出现滚动条） */
function pageSizeFor(height: number): number {
  // 顶栏约 56、分页器约 44、底部导航约 48；每行约 56
  const usable = height - 56 - 44 - 48 - 16
  const rows = Math.floor(usable / 56)
  if (rows < 3) return 3
  if (rows > 12) return 12
  return rows
}

export const renderLibrary: Screen = function renderLibrary(root: HTMLElement, ctx: ScreenCtx): () => void {
  const entries = ctx.library.entries
  const pageSize = pageSizeFor(ctx.height)
  const pageCount = Math.max(1, Math.ceil(entries.length / pageSize))
  let page = 0
  let selected = 0
  const unbinds: Array<() => void> = []

  function draw(): void {
    const start = page * pageSize
    const slice = entries.slice(start, start + pageSize)
    if (selected >= slice.length) selected = slice.length - 1
    if (selected < 0) selected = 0

    clear(root)

    root.appendChild(
      topBar(ctx, {
        title: ctx.t('shell.app.title'),
        subtitle: ctx.t('shell.library.page', { page: page + 1, total: pageCount }),
        onBack: null,
        actions: [{ label: ctx.t('shell.nav.settings'), onClick: function toSettings(): void { ctx.navigate('settings') } }],
      }),
    )

    if (entries.length === 0) {
      root.appendChild(el('div', { style: 'padding:24px;text-align:center;font-size:15px;' }, ctx.t('shell.library.empty')))
      return
    }

    const main = el('div', { class: 'k-main' })
    const list = el('div', { class: 'k-list', style: 'padding:4px 8px;' })
    for (let i = 0; i < slice.length; i++) {
      const entry = slice[i]
      const ns = entry.game.i18nNamespace
      const isSelected = i === selected
      const rowCss =
        'padding:8px 10px;border:1px solid #000;border-radius:4px;margin-bottom:6px;' +
        'min-height:44px;box-sizing:border-box;overflow:hidden;' +
        (isSelected ? 'background:#000;color:#fff;' : 'background:#fff;color:#000;')
      const row = el('div', { class: 'k-list__item' + (isSelected ? ' k-list__item--selected' : ''), style: rowCss })
      row.appendChild(el('div', { class: 'k-list__title', style: 'font-size:16px;font-weight:700;line-height:1.3;' }, ctx.t(ns + '.title')))
      const meta = progressSummary(ctx, entry.game.id, entry.levels ? entry.levels.length : 0, entry.game.difficulties.length)
      const metaText = meta.total > 0
        ? ctx.t('shell.library.progress', { done: meta.done, total: meta.total })
        : ctx.t('shell.detail.none')
      row.appendChild(el('div', { class: 'k-list__meta', style: 'font-size:12px;line-height:1.6;' }, metaText))
      const bar = progressBar(meta.done, meta.total, ctx.width)
      if (meta.total > 0) row.appendChild(bar)
      unbinds.push(
        on(row, 'click', function rowClick(): void {
          ctx.navigate('detail', { gameId: entry.game.id })
        }),
      )
      list.appendChild(row)
    }
    main.appendChild(list)
    main.appendChild(
      pager(ctx, page, pageCount, function go(next: number): void {
        page = next
        selected = 0
        draw()
      }),
    )
    root.appendChild(main)

    const nav = el('div', { class: 'k-footer', style: 'padding:4px 8px;text-align:center;border-top:1px solid #000;' })
    nav.appendChild(button(ctx.t('shell.nav.about'), function toAbout(): void { ctx.navigate('about') }, { small: true }))
    nav.appendChild(button(ctx.t('shell.nav.diagnostics'), function toDiag(): void { ctx.navigate('diagnostics') }, { small: true }))
    root.appendChild(nav)
  }

  // 物理键：上下移动、回车进入、左右翻页
  unbinds.push(
    on(document, 'keydown', function keydown(event: Event): void {
      const e = event as KeyboardEvent
      const code = e.keyCode || 0
      if (code === 38) {
        e.preventDefault()
        if (selected > 0) { selected--; draw() }
      } else if (code === 40) {
        e.preventDefault()
        if (selected < pageSize - 1) { selected++; draw() }
      } else if (code === 13) {
        e.preventDefault()
        const entry = entries[page * pageSize + selected]
        if (entry) ctx.navigate('detail', { gameId: entry.game.id })
      } else if (code === 37) {
        e.preventDefault()
        if (page > 0) { page--; selected = 0; draw() }
      } else if (code === 39) {
        e.preventDefault()
        if (page < pageCount - 1) { page++; selected = 0; draw() }
      }
    }),
  )

  draw()

  return function cleanup(): void {
    for (let i = 0; i < unbinds.length; i++) unbinds[i]()
  }
}

/** 进度：有关卡按关卡算，无关卡按难度算（与 Web 端的口径一致） */
export function progressSummary(
  ctx: ScreenCtx,
  gameId: string,
  levelCount: number,
  difficultyCount: number,
): { done: number; total: number } {
  void ctx
  const completed = readCompleted()
  if (levelCount > 0) {
    let done = 0
    for (let i = 0; i < completed.length; i++) {
      if (completed[i].indexOf(gameId + ':') === 0) done++
    }
    return { done: done, total: levelCount }
  }
  let done = 0
  for (let i = 0; i < completed.length; i++) {
    if (completed[i].indexOf(gameId + ':') === 0) done++
  }
  return { done: done, total: difficultyCount }
}

/**
 * 已通关内容 id 列表（形如 `sudoku:starter`）。
 * 一律从 store 的战绩里读 —— 不要在别处另开一个键，否则两边会各说各话。
 */
export function readCompleted(): string[] {
  const progress = loadProgress()
  return progress.completed ? progress.completed : []
}
