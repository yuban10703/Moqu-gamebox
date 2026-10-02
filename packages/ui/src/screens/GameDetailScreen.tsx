/**
 * 游戏详情：玩法说明、难度、当前进度、关卡列表、开始/继续。
 * 「已有存档时开新局」必须明确询问，绝不静默丢局。
 */
import { useState, type ReactNode } from 'react'
import type { SaveEnvelope } from '@eink/core'
import { computeRootLayout } from '@eink/core'
import { ActionButton, Dialog, Pager, StatBar, TopBar } from '../components.js'
import { useUi } from '../contexts.js'
import type { GameRegistryEntry } from '../registry.js'
import { levelIdOf, progressOf } from './LibraryScreen.js'

const LEVELS_PER_PAGE = 12

export interface GameDetailScreenProps {
  entry: GameRegistryEntry<unknown, unknown>
  envelope: SaveEnvelope | undefined
  /** 该游戏存在损坏/不兼容存档：开新局前必须明确确认，避免静默删除 */
  corrupt?: boolean
  onBack: () => void
  onResume: () => void
  onStartNew: (difficulty: string) => void
}

export function GameDetailScreen({
  entry,
  envelope,
  corrupt = false,
  onBack,
  onResume,
  onStartNew,
}: GameDetailScreenProps): ReactNode {
  const { i18n, settings, updateGameSettings, viewport, layoutConfig } = useUi()
  const layout = computeRootLayout(viewport, layoutConfig, { showDpad: false })
  const progress = progressOf(envelope)
  const hasSave = (envelope !== undefined && envelope.moves > 0) || corrupt
  const [difficulty, setDifficulty] = useState<string>(
    settings.perGame[entry.game.id]?.difficulty ??
      (envelope?.difficulty ?? entry.defaultDifficulty),
  )
  const [confirmReplace, setConfirmReplace] = useState(false)
  const [page, setPage] = useState(0)

  const levels = entry.levels ?? []
  const pageCount = Math.max(1, Math.ceil(levels.length / LEVELS_PER_PAGE))
  const pageLevels = levels.slice(page * LEVELS_PER_PAGE, (page + 1) * LEVELS_PER_PAGE)
  const summary = entry.progressFor(progress.completed)
  const currentLevelId = levelIdOf(envelope)

  const start = (): void => {
    void updateGameSettings(entry.game.id, { difficulty })
    onStartNew(difficulty)
  }

  return (
    <div className="eink-screen eink-screen--sticky-footer">
      <TopBar title={i18n.t(`${entry.game.i18nNamespace}.title`)} onBack={onBack} />

      {/* 主操作固定在页脚（永远在首屏内），说明与关卡选择放在这个可滚动区里 */}
      <div className="eink-screen__content">
        {corrupt ? (
        <section className="eink-section eink-section--warning" role="alert">
          <h2>{i18n.t('shell.storage.reason.corrupt')}</h2>
          <p className="eink-text">{i18n.t('shell.storage.corruptHint')}</p>
        </section>
      ) : null}

        <section className="eink-section">
          <h2>{i18n.t('shell.detail.rules')}</h2>
        {entry.rulesKeys.map((key) => (
          <p key={key} className="eink-text">
            {i18n.t(key)}
          </p>
        ))}
      </section>

      <section className="eink-section">
        <h2>{i18n.t('shell.detail.difficulty')}</h2>
        <div className="eink-choice-row">
          {entry.game.difficulties.map((option) => (
            <ActionButton
              key={option.id}
              labelKey={option.labelKey}
              emphasis={option.id === difficulty ? 'primary' : 'normal'}
              onSelect={() => setDifficulty(option.id)}
            />
          ))}
        </div>
      </section>

      <section className="eink-section">
        <h2>{i18n.t('shell.detail.levels')}</h2>
        <StatBar
          stats={[
            {
              labelKey: 'shell.library.progressLabel',
              value: `${summary.done}/${summary.total}`,
            },
          ]}
        />
        {levels.length === 0 ? (
          <p className="eink-muted">{i18n.t('shell.detail.none')}</p>
        ) : (
          <>
            <ul className="eink-levels">
              {pageLevels.map((level, offset) => {
                const index = page * LEVELS_PER_PAGE + offset
                const done = progress.completed.includes(level.id)
                const isCurrent = level.id === currentLevelId
                const best = progress.bestMoves[level.id]
                return (
                  <li
                    key={level.id}
                    className="eink-levels__item"
                    data-done={done ? 'yes' : 'no'}
                    data-current={isCurrent ? 'yes' : 'no'}
                  >
                    <span className="eink-levels__index">{index + 1}</span>
                    <span className="eink-levels__state" aria-hidden="true">
                      {done ? '◼' : isCurrent ? '▲' : '□'}
                    </span>
                    <span className="eink-levels__meta">
                      {done
                        ? i18n.t('shell.library.completed')
                        : isCurrent
                          ? i18n.t('shell.detail.progress')
                          : i18n.t('sokoban.progress.notSolved')}
                      {best !== undefined ? ` · ${i18n.t('shell.common.moves')} ${best}` : ''}
                    </span>
                  </li>
                )
              })}
            </ul>
            {pageCount > 1 ? (
              <Pager
                page={page}
                pageCount={pageCount}
                onPrev={() => setPage((value) => Math.max(0, value - 1))}
                onNext={() => setPage((value) => Math.min(pageCount - 1, value + 1))}
              />
            ) : null}
          </>
        )}
      </section>

      </div>

      <footer className="eink-footer" style={{ minHeight: layout.buttonHeight + 16 }}>
        {hasSave ? (
          <ActionButton labelKey="shell.detail.resume" emphasis="primary" size="large" onSelect={onResume} />
        ) : null}
        <ActionButton
          labelKey="shell.detail.start"
          emphasis={hasSave ? 'normal' : 'primary'}
          size="large"
          onSelect={() => (hasSave ? setConfirmReplace(true) : start())}
        />
      </footer>

      {confirmReplace ? (
        <Dialog
          titleKey="shell.detail.replace.title"
          bodyKey="shell.detail.replace.body"
          confirmKey="shell.detail.replace.confirm"
          cancelKey="shell.detail.replace.cancel"
          danger
          onConfirm={() => {
            setConfirmReplace(false)
            start()
          }}
          onCancel={() => setConfirmReplace(false)}
        />
      ) : null}
    </div>
  )
}
