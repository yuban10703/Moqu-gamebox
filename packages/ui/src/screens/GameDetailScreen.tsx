/**
 * 游戏详情：玩法说明、难度、当前进度、关卡列表、开始/继续。
 * 「已有存档时开新局」必须明确询问，绝不静默丢局。
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { SaveEnvelope } from '@eink/core'
import { computeRootLayout } from '@eink/core'
import { ActionButton, Dialog, Pager, StatBar, TopBar } from '../components.js'
import { useUi } from '../contexts.js'
import type { GameRegistryEntry } from '../registry.js'
import { levelIdOf, progressOf } from './LibraryScreen.js'

/** 测量失败时的兜底每页数量 */
const LEVELS_PER_PAGE_FALLBACK = 12

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
  /**
   * 每页关卡数：**按可用空间实测得出**，而不是写死。
   * 装得下就全部显示、不出现分页；装不下才分页（分页器的位置也一并预留）。
   */
  const [perPage, setPerPage] = useState(LEVELS_PER_PAGE_FALLBACK)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const listRef = useRef<HTMLUListElement | null>(null)

  const levels = entry.levels ?? []
  const [pagerNeeded, setPagerNeeded] = useState(false)

  useLayoutEffect(() => {
    const content = contentRef.current
    const list = listRef.current
    if (!content || !list) return
    const firstItem = list.querySelector('li')
    if (!firstItem) return

    const itemHeight = firstItem.getBoundingClientRect().height
    if (itemHeight <= 0) return
    const listStyle = getComputedStyle(list)
    const rowGap = Number.parseFloat(listStyle.rowGap || listStyle.gap || '0') || 0
    const columns = listStyle.gridTemplateColumns.split(/\s+/).filter(Boolean).length || 1

    // 可见高度 = 内容区底边 - 列表顶边（内容区是滚动容器，底边固定）
    const available = content.getBoundingClientRect().bottom - list.getBoundingClientRect().top
    const rowPitch = itemHeight + rowGap
    const rowsWithoutPager = Math.max(0, Math.floor((available + rowGap) / rowPitch))
    const capacityWithoutPager = rowsWithoutPager * columns

    if (levels.length <= capacityWithoutPager) {
      // 一屏能装下：全列出来，不显示分页
      setPerPage(Math.max(1, levels.length))
      setPagerNeeded(false)
      return
    }
    // 装不下：分页。分页器在固定页脚里（不在滚动区），
    // 它出现后内容区会变矮，content.bottom 自动上移，于是这里再算一次即可收敛。
    const rowsWithPager = Math.max(1, Math.floor((available + rowGap) / rowPitch))
    setPerPage(Math.max(columns, rowsWithPager * columns))
    setPagerNeeded(true)
  }, [
    levels.length,
    pagerNeeded,
    viewport.width,
    viewport.height,
    settings.fontScale,
    settings.boldLines,
  ])

  const pageCount = Math.max(1, Math.ceil(levels.length / perPage))
  // 容量变化后页码可能越界，这里夹紧（例如从第 2 页切回单页）
  const safePage = Math.min(page, pageCount - 1)
  const pageLevels = levels.slice(safePage * perPage, (safePage + 1) * perPage)
  const summary = entry.progressFor?.(progress.completed)
  // 没有存档时不能拿 undefined 去调游戏方法（游戏会按有效状态读字段）
  const currentLevelId = envelope
    ? (entry.game.contentId?.(envelope.state) ?? levelIdOf(envelope))
    : ''

  const start = (): void => {
    void updateGameSettings(entry.game.id, { difficulty })
    onStartNew(difficulty)
  }

  /*
   * 玩法说明：**固定长度**（约 6 行），超出时给一个「阅读全部」按钮展开。
   *
   * 只管折叠态的溢出：展开后 scrollHeight 会等于 clientHeight，
   * 若那时重算就会把「收起」按钮弄没，用户就收不回去了。
   */
  const [rulesExpanded, setRulesExpanded] = useState(false)
  const [rulesOverflow, setRulesOverflow] = useState(false)
  const rulesRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (rulesExpanded) return
    const element = rulesRef.current
    if (element) setRulesOverflow(element.scrollHeight > element.clientHeight + 1)
  }, [entry, rulesExpanded])

  return (
    <div className="eink-screen eink-screen--sticky-footer">
      <TopBar title={i18n.t(`${entry.game.i18nNamespace}.title`)} onBack={onBack} />

      {/* 主操作固定在页脚（永远在首屏内），说明与关卡选择放在这个可滚动区里 */}
      <div className="eink-screen__content" ref={contentRef}>
        {corrupt ? (
        <section className="eink-section eink-section--warning" role="alert">
          <h2>{i18n.t('shell.storage.reason.corrupt')}</h2>
          <p className="eink-text">{i18n.t('shell.storage.corruptHint')}</p>
        </section>
      ) : null}

        <section className="eink-section">
          <h2>{i18n.t('shell.detail.rules')}</h2>
        <div
          className={rulesExpanded ? 'eink-rules' : 'eink-rules eink-rules--clamped'}
          ref={rulesRef}
          /* 限高、字号、右下角按钮的定位都在 styles.css 的 .eink-rules* 里（不再用内联样式） */
          data-expanded={rulesExpanded ? 'yes' : 'no'}
        >
          {entry.rulesKeys.map((key) => (
            <p key={key} className="eink-text">
              {i18n.t(key)}
            </p>
          ))}
          {/*
            收起时：右下角放「…」与「阅读全部」，两者都是**覆盖**在说明右下角（绝对定位）。
            墨水屏没有渐变可用，硬截断 + 显式省略号是唯一诚实的表达。
          */}
          {rulesExpanded || rulesOverflow ? (
            <div className="eink-rules__foot">
              {rulesExpanded ? null : (
                <span className="eink-rules__ellipsis" aria-hidden="true">
                  …
                </span>
              )}
              <button
                type="button"
                className="eink-rules__more"
                onClick={() => setRulesExpanded((prev) => !prev)}
              >
                {i18n.t(rulesExpanded ? 'shell.detail.collapse' : 'shell.detail.readAll')}
              </button>
            </div>
          ) : null}
        </div>
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
        {summary ? (
          <StatBar
            stats={[
              {
                labelKey: 'shell.library.progressLabel',
                value: `${summary.done}/${summary.total}`,
              },
            ]}
          />
        ) : null}
        {levels.length === 0 ? (
          <p className="eink-muted">{i18n.t('shell.detail.none')}</p>
        ) : (
          <>
            <ul className="eink-levels" ref={listRef}>
              {pageLevels.map((level, offset) => {
                const index = safePage * perPage + offset
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
                          : i18n.t(`${entry.game.i18nNamespace}.progress.notSolved`)}
                      {best !== undefined ? ` · ${i18n.t('shell.common.moves')} ${best}` : ''}
                    </span>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </section>

      </div>

      <footer
        className="eink-footer eink-footer--split"
        style={{ minHeight: layout.buttonHeight + 16 }}
      >
        {/* 翻页按钮固定在页脚，不需要滚动就能看见（窄屏会自动换行到第二行） */}
        {pageCount > 1 ? (
          <Pager
            page={safePage}
            pageCount={pageCount}
            onPrev={() => setPage((value) => Math.max(0, value - 1))}
            onNext={() => setPage((value) => Math.min(pageCount - 1, value + 1))}
          />
        ) : null}
        <div className="eink-footer__actions">
        {hasSave ? (
          <ActionButton labelKey="shell.detail.resume" emphasis="primary" size="large" onSelect={onResume} />
        ) : null}
        <ActionButton
          labelKey="shell.detail.start"
          emphasis={hasSave ? 'normal' : 'primary'}
          size="large"
          onSelect={() => (hasSave ? setConfirmReplace(true) : start())}
        />
        </div>
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
