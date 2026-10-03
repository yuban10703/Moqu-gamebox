/**
 * 首页 / 游戏库：继续游戏 + 全部游戏 + 设置入口。
 * 首批游戏少，保持短列表；不使用滚动跟随的复杂导航。
 */
import { useState, type ReactNode } from 'react'
import type { SaveEnvelope } from '@eink/core'
import { ActionButton } from '../components.js'
import { GameIcon } from '../GameIcon.js'
import { useUi } from '../contexts.js'
import type { GameRegistryEntry } from '../registry.js'

/**
 * 每页显示的游戏数（用户要求：为全部游戏预留**翻页**而不是滑动）。
 * 6 = 2 列 × 3 行，在 439×847、26px 字号下也放得下（每张卡约 90px）。
 */
const PAGE_SIZE = 6

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
  // 分页状态；current 做 clamp，条目数变化时不会停在空页
  const [page, setPage] = useState(0)
  const pageCount = Math.max(1, Math.ceil(entries.length / PAGE_SIZE))
  const current = Math.min(page, pageCount - 1)
  const pageEntries = entries.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE)
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
          <ul className="eink-grid">
            {pageEntries.map((entry) => {
              const envelope = saves[entry.game.id]
              const progress = entry.progressFor?.(progressOf(envelope).completed)
              return (
                <li key={entry.game.id} className="eink-grid__item">
                  <button type="button" className="eink-tile" onClick={() => onOpenDetail(entry.game.id)}>
                    <GameIcon namespace={entry.game.i18nNamespace} />
                    <span className="eink-tile__title">{i18n.t(`${entry.game.i18nNamespace}.title`)}</span>
                    {/* 没有进度概念的玩法（2048）不显示进度行，避免出现「0/0」这种噪音 */}
                    {progress ? (
                      <span className="eink-tile__meta">
                        {i18n.t('shell.library.progress', { done: progress.done, total: progress.total })}
                      </span>
                    ) : null}
                    {progress && progress.done >= progress.total && progress.total > 0 ? (
                      <span className="eink-tile__done">{i18n.t('shell.library.completed')}</span>
                    ) : null}
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

export function progressOf(envelope: SaveEnvelope | undefined): { completed: string[]; bestMoves: Record<string, number> } {
  const progress = (envelope?.progress ?? {}) as { completed?: string[]; bestMoves?: Record<string, number> }
  return { completed: progress.completed ?? [], bestMoves: progress.bestMoves ?? {} }
}

export function levelIdOf(envelope: SaveEnvelope | undefined): string {
  const state = envelope?.state as { levelId?: string } | undefined
  return state?.levelId ?? ''
}

