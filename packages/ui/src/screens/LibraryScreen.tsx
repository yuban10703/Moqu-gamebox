/**
 * 首页 / 游戏库：继续游戏 + 全部游戏 + 设置入口。
 * 首批游戏少，保持短列表；不使用滚动跟随的复杂导航。
 */
import type { ReactNode } from 'react'
import type { SaveEnvelope } from '@eink/core'
import { ActionButton, StatBar } from '../components.js'
import { useUi } from '../contexts.js'
import type { GameRegistryEntry } from '../registry.js'

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
          <span className="eink-badge" data-state={offline}>
            {i18n.t(
              offline === 'ready'
                ? 'shell.offline.ready'
                : offline === 'preparing'
                  ? 'shell.offline.preparing'
                  : 'shell.offline.unavailable',
            )}
          </span>
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
        <section className="eink-section">
          <h2>{i18n.t('shell.library.continue')}</h2>
          {(() => {
            const envelope = saves[continued.game.id]!
            const contentId = continued.game.contentId?.(envelope.state) ?? levelIdOf(envelope)
            const index = continued.indexOfLevel?.(contentId, envelope.state) ?? 0
            return (
              <div className="eink-card eink-card--continue">
                <div className="eink-card__main">
                  <h3>{i18n.t(`${continued.game.i18nNamespace}.title`)}</h3>
                  <StatBar
                    stats={[
                      { labelKey: 'shell.common.level', value: String(index + 1) },
                      { labelKey: 'shell.common.moves', value: String(envelope.moves) },
                    ]}
                  />
                  {/* 这里不再显示「进度 x/y」：下方同一款游戏的卡片上已经有它了，
                      重复信息会白白占掉一行高度（大字号 + 多游戏时直接顶出屏幕） */}
                </div>
                <div className="eink-card__actions">
                  <ActionButton
                    labelKey="shell.detail.resume"
                    emphasis="primary"
                    size="large"
                    onSelect={() => onContinue(continued.game.id)}
                  />
                  <ActionButton labelKey="shell.detail.rules" onSelect={() => onOpenDetail(continued.game.id)} />
                </div>
              </div>
            )
          })()}
        </section>
      ) : null}

      <section className="eink-section">
        <h2>{i18n.t('shell.library.all')}</h2>
        {entries.length === 0 ? (
          <p className="eink-muted">{i18n.t('shell.library.empty')}</p>
        ) : (
          <ul className="eink-grid">
            {entries.map((entry) => {
              const envelope = saves[entry.game.id]
              const progress = entry.progressFor?.(progressOf(envelope).completed)
              return (
                <li key={entry.game.id} className="eink-grid__item">
                  <button type="button" className="eink-tile" onClick={() => onOpenDetail(entry.game.id)}>
                    <span className="eink-tile__host" aria-hidden="true">{hostGlyph(entry.game.i18nNamespace)}</span>
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

/** 1-bit 友好的矢量字母标记，不使用位图封面 */
function hostGlyph(namespace: string): string {
  // 1-bit 友好（纯几何、无灰度）：每款游戏一个可辨认的字形
  const glyphs: Record<string, string> = {
    sokoban: '▣',
    sudoku: '▤',
    minesweeper: '☒',
    reversi: '◐',
    fifteen: '▦',
    gomoku: '⬤',
    memory: '◫',
    connect4: '▥',
    maze: '⊞',
    lightsout: '⊙',
    pegsolitaire: '⁙',
    checkers: '⋈',
    klotski: '▤',
    knightstour: '♞',
    dotsboxes: '⊹',
    battleship: '⌖',
    '2048': '▩',
  }
  return glyphs[namespace] ?? '◈'
}
