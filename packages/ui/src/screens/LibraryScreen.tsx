/**
 * 首页 / 游戏库：继续游戏 + 全部游戏 + 设置入口。
 * 首批游戏少，保持短列表；不使用滚动跟随的复杂导航。
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { SaveEnvelope } from '@eink/core'
import { ActionButton } from '../components.js'
import { GameIcon } from '../GameIcon.js'
import { useUi } from '../contexts.js'
import type { GameRegistryEntry } from '../registry.js'

/**
 * 每页游戏数的兜底值。
 *
 * 真实每页数量是**按实际可用空间算出来的**（见下面的 measure）：
 * 卡片没铺满就分页会让人困惑（用户反馈过），所以先在渲染后量一次
 * 「内容区还能放下几行 × 网格有几列」，只有条目真的超过这个数才分页。
 * 这个常量只在测量前作为首帧值使用。
 */
const PAGE_SIZE_FALLBACK = 24

export interface LibraryScreenProps {
  entries: ReadonlyArray<GameRegistryEntry<unknown, unknown>>
  saves: Readonly<Record<string, SaveEnvelope>>
  /** 存在损坏/不兼容存档的游戏：必须显式提示，不能让用户以为没有进度 */
  corruptGameIds: readonly string[]
  onOpenCorrupt: (gameId: string) => void
  onContinue: (gameId: string) => void
  onOpenDetail: (gameId: string) => void
  onSettings: () => void
  onDiagnostics: () => void
  onHelp: () => void
}

export function LibraryScreen({
  entries,
  saves,
  corruptGameIds,
  onOpenCorrupt,
  onContinue,
  onOpenDetail,
  onSettings,
  onDiagnostics,
  onHelp,
}: LibraryScreenProps): ReactNode {
  const { i18n, platform } = useUi()
  // 分页状态；current 做 clamp，条目数/每页数变化时不会停在空页
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(PAGE_SIZE_FALLBACK)
  const pageCount = Math.max(1, Math.ceil(entries.length / pageSize))
  const current = Math.min(page, pageCount - 1)
  const pageEntries = entries.slice(current * pageSize, current * pageSize + pageSize)
  const gridRef = useRef<HTMLUListElement | null>(null)

  /*
   * 量「这屏能放多少张卡」：列数 = 网格宽 / 卡宽，行数 = 内容区可用高 / 卡高。
   *
   * 关键：**只观察内容区与窗口，绝不观察网格自身**。
   * 之前观察网格导致翻页后重算（页数从 2 变 3）、页码自己跳 —— 真机上实测到的 bug。
   * 另外可用高度用「内容区高度 − 网格相对内容区的偏移」算，与网格当页有几张卡无关。
   */
  useEffect(() => {
    const measure = (): void => {
      const grid = gridRef.current
      if (!grid) return
      const content = grid.closest('.eink-screen__content') as HTMLElement | null
      const tile = grid.querySelector('.eink-tile') as HTMLElement | null
      if (!content || !tile) return
      const tileRect = tile.getBoundingClientRect()
      if (tileRect.height < 1 || tileRect.width < 1) return
      const style = getComputedStyle(grid)
      const gap = Number.parseFloat(style.rowGap || '8') || 8
      const columns = Math.max(1, Math.round((grid.clientWidth + gap) / (tileRect.width + gap)))
      const gridOffset = grid.getBoundingClientRect().top - content.getBoundingClientRect().top
      const available = content.clientHeight - gridOffset - 4
      const rows = Math.max(1, Math.floor((available + gap) / (tileRect.height + gap)))
      const next = Math.max(1, columns * rows)
      setPageSize((prev) => (prev === next ? prev : next))
    }
    measure()
    window.addEventListener('resize', measure)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    // 观察内容区（尺寸随视口/字号变化），**不观察网格**（它会随翻页变化 → 页数自跳）
    const content = gridRef.current?.closest('.eink-screen__content')
    if (observer && content) observer.observe(content)
    return () => {
      window.removeEventListener('resize', measure)
      observer?.disconnect()
    }
  }, [entries.length])
  const offline = platform.offline.state()
  /**
   * 「继续上一局」选**最近玩过**的那一款，而不是注册顺序里第一个有存档的。
   * 原先用 entries.find(...)，于是玩了 2048 之后首页卡片还显示推箱子（探索式测试发现）。
   */
  const continued = entries
    .filter((entry) => saves[entry.game.id])
    .sort((a, b) => (saves[b.game.id]?.updatedAt ?? 0) - (saves[a.game.id]?.updatedAt ?? 0))[0]

  return (
    <div className="eink-screen eink-screen--sticky-footer">
      <header className="eink-screen__header">
        <h1>{i18n.t('shell.app.title')}</h1>
        <p className="eink-badges">
          {/* 离线状态不再显示（用户要求）：安装包内置全部资源，装好即可离线，
              常驻一个「已可离线」徽标只是噪音。真正的异常仍会提示。 */}
          {offline === 'unavailable' ? (
            <span className="eink-badge eink-badge--warning">{i18n.t('shell.offline.unavailable')}</span>
          ) : null}
          {platform.storage.persistent ? null : (
            <span className="eink-badge eink-badge--warning">{i18n.t('shell.storage.notPersistent')}</span>
          )}
        </p>
      </header>

      {/* 游戏列表可滚动，但页脚（设置/帮助/诊断）固定 —— 游戏变多时也不会把它顶出屏幕 */}
      <div className="eink-screen__content">
      {corruptGameIds.length > 0 ? (
        <section className="eink-section eink-section--warning" role="alert">
          <h2>{i18n.t('shell.storage.reason.corrupt')}</h2>
          <p className="eink-text">{i18n.t('shell.storage.corruptHint')}</p>
          <div className="eink-card__actions">
            {corruptGameIds.map((gameId) => {
              const target = entries.find((candidate) => candidate.game.id === gameId)
              const title = target ? i18n.t(`${target.game.i18nNamespace}.title`) : gameId
              return (
                <ActionButton
                  key={gameId}
                  text={`${title} · ${i18n.t('shell.diagnostics.saves')}`}
                  onSelect={() => onOpenCorrupt(gameId)}
                />
              )
            })}
          </div>
        </section>
      ) : null}

      {continued ? (
        /*
         * 「继续上一局」压缩成**一条细栏**（原来是一张全宽大卡：标题 + 统计 + 两个大按钮，
         * 在小屏上占掉近三行高度）。整栏可点即继续；「玩法说明」不再重复出现
         * （下面同一款游戏的卡片点进去就是说明页）。
         */
        (() => {
          const envelope = saves[continued.game.id]!
          const contentId = continued.game.contentId?.(envelope.state) ?? levelIdOf(envelope)
          const index = continued.indexOfLevel?.(contentId, envelope.state) ?? 0
          return (
            <button
              type="button"
              className="eink-continue"
              onClick={() => onContinue(continued.game.id)}
              aria-label={`${i18n.t('shell.library.continue')} ${i18n.t(`${continued.game.i18nNamespace}.title`)}`}
            >
              <GameIcon namespace={continued.game.i18nNamespace} size={22} />
              <span className="eink-continue__title">{i18n.t(`${continued.game.i18nNamespace}.title`)}</span>
              <span className="eink-continue__meta">
                {i18n.t('shell.library.continue')} · {i18n.t('shell.common.level')} {index + 1}
              </span>
            </button>
          )
        })()
      ) : null}

      <section className="eink-section">
        {/* 翻页而不是滚动：多游戏时高度/宽度都不变；硬件翻页键也接管（useHardwarePageKeys） */}
        <div className="eink-section__head">
          <h2>{i18n.t('shell.library.all')}</h2>
          {pageCount > 1 ? (
            <div className="eink-pager">
              <button
                type="button"
                className="eink-pager__btn"
                data-page="prev"
                disabled={current === 0}
                onClick={() => setPage(current - 1)}
              >
                {i18n.t('shell.library.prevPage')}
              </button>
              <span className="eink-pager__info">
                {i18n.t('shell.library.page', { index: current + 1, total: pageCount })}
              </span>
              <button
                type="button"
                className="eink-pager__btn"
                data-page="next"
                disabled={current >= pageCount - 1}
                onClick={() => setPage(current + 1)}
              >
                {i18n.t('shell.library.nextPage')}
              </button>
            </div>
          ) : null}
        </div>
        {entries.length === 0 ? (
          <p className="eink-muted">{i18n.t('shell.library.empty')}</p>
        ) : (
          <ul className="eink-grid" ref={gridRef}>
            {pageEntries.map((entry) => {
              return (
                <li key={entry.game.id} className="eink-grid__item">
                  <button type="button" className="eink-tile" onClick={() => onOpenDetail(entry.game.id)}>
                    <GameIcon namespace={entry.game.i18nNamespace} />
                    {/*
                      标题用内联样式定死"在图标右侧的剩余空间里水平+垂直居中"。
                      原因：styles.css 里同一选择器有多轮历史规则互相覆盖（display/min-height 等），
                      已连续被旧规则盖住三次；这里先用内联样式保证效果，
                      后续应把 CSS 里的重复规则清掉再改回类样式。
                    */}
                    <span
                      className="eink-tile__title"
                      style={{
                        flex: '1 1 auto',
                        minWidth: 0,
                        minHeight: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        textAlign: 'center',
                        lineHeight: 1.25,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {i18n.t(`${entry.game.i18nNamespace}.title`)}
                    </span>

                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      </div>

      <footer className="eink-footer">
        <ActionButton labelKey="shell.nav.settings" onSelect={onSettings} />
        <ActionButton labelKey="shell.nav.help" onSelect={onHelp} />
        <ActionButton labelKey="shell.nav.diagnostics" onSelect={onDiagnostics} />
      </footer>
    </div>
  )
}

/** 关卡制玩法：注册表里登记了 levels 的才算（推箱子/华容道） */
export function progressOf(envelope: SaveEnvelope | undefined): { completed: string[]; bestMoves: Record<string, number> } {
  const progress = (envelope?.progress ?? {}) as { completed?: string[]; bestMoves?: Record<string, number> }
  return { completed: progress.completed ?? [], bestMoves: progress.bestMoves ?? {} }
}

export function levelIdOf(envelope: SaveEnvelope | undefined): string {
  const state = envelope?.state as { levelId?: string } | undefined
  return state?.levelId ?? ''
}

