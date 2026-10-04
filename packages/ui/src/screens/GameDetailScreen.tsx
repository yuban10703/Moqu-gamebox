/**
 * 游戏详情：玩法说明、难度、当前进度、关卡列表、开始/继续。
 * 「已有存档时开新局」必须明确询问，绝不静默丢局。
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { readHistory, type HistoryEntry, type SaveEnvelope } from '@eink/core'
import { computeRootLayout } from '@eink/core'
import { ActionButton, Dialog, Pager, StatBar, TopBar } from '../components.js'
import { useUi } from '../contexts.js'
import { supportsSwipe, type GameRegistryEntry } from '../registry.js'
import { levelIdOf, progressOf } from './LibraryScreen.js'

/** 测量失败时的兜底每页数量 */
const LEVELS_PER_PAGE_FALLBACK = 12

/** 用时格式：m:ss（超过 1 小时给 h:mm:ss）—— 纯数字，不需要走 i18n */
function formatDuration(seconds: number): string {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0
  const minutes = Math.floor(total / 60)
  const secs = total % 60
  const pad = (value: number): string => String(value).padStart(2, '0')
  if (minutes >= 60) return `${Math.floor(minutes / 60)}:${pad(minutes % 60)}:${pad(secs)}`
  return `${minutes}:${pad(secs)}`
}

/** 日期格式：MM-DD（列表要短，年份与时分秒都不值得占位宽） */
function formatDate(at: number): string {
  const date = new Date(at)
  if (!Number.isFinite(date.getTime())) return '--'
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export interface GameDetailScreenProps {
  entry: GameRegistryEntry<unknown, unknown>
  envelope: SaveEnvelope | undefined
  /** 该游戏存在损坏/不兼容存档：开新局前必须明确确认，避免静默删除 */
  corrupt?: boolean
  onBack: () => void
  onResume: () => void
  onStartNew: (difficulty: string) => void
  /** 自由选关：点某一关直接以该关开局（所有关卡都可选，不做解锁限制） */
  onStartLevel?: (levelId: string, difficulty: string) => void
}

export function GameDetailScreen({
  entry,
  envelope,
  corrupt = false,
  onBack,
  onResume,
  onStartNew,
  onStartLevel,
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
  /** 自由选关时待确认的目标关卡（有存档时先确认「替换并开始」，绝不静默丢局） */
  const [pendingLevel, setPendingLevel] = useState<{ id: string; difficulty: string } | null>(null)
  const [page, setPage] = useState(0)
  /**
   * 每页关卡数：**按可用空间实测得出**，而不是写死。
   * 装得下就全部显示、不出现分页；装不下才分页（分页器的位置也一并预留）。
   */
  const [perPage, setPerPage] = useState(LEVELS_PER_PAGE_FALLBACK)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const listRef = useRef<HTMLUListElement | null>(null)

  const levels = entry.levels ?? []
  /**
   * 历史记录：从存档的 progress.history 读，一律走 readHistory（旧存档缺这个字段就是空数组，
   * 坏记录会被丢掉 —— 绝不能让详情页因为旧存档打不开）。
   */
  const history: HistoryEntry[] = readHistory(progress.history)
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

  /**
   * 自由选关：点任意关卡即以该关开局（所有关卡都可选，不做解锁限制）。
   * 已有进行中的局面时先走同一个「替换并开始」确认 —— 与「开始新游戏」保持一致的丢局保护。
   */
  const pickLevel = (levelId: string): void => {
    if (!onStartLevel) return
    void updateGameSettings(entry.game.id, { difficulty })
    if (hasSave) {
      setPendingLevel({ id: levelId, difficulty })
      setConfirmReplace(true)
      return
    }
    onStartLevel(levelId, difficulty)
  }

  /*
   * 玩法说明：**固定长度**（约 6 行），超出时给一个「阅读全部」按钮展开。
   *
   * 只管折叠态的溢出：展开后 scrollHeight 会等于 clientHeight，
   * 若那时重算就会把「收起」按钮弄没，用户就收不回去了。
   */
  const swipeHint = useMemo(() => supportsSwipe(entry), [entry])
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
          /* 是否真的溢出：决定要不要给右下角的「…/阅读全部」留位置（留位会让短说明白占一块） */
          data-overflow={rulesOverflow ? 'yes' : 'no'}
        >
          {entry.rulesKeys.map((key) => (
            <p key={key} className="eink-text">
              {i18n.t(key)}
            </p>
          ))}
          {/*
            能滑动的玩法补一句通用提示（壳层文案，不进各游戏的规则文本）：
            各游戏的说明里已经写了「可以滑动」，但「暂停菜单里关掉方向按钮 → 棋盘更大」藏得深，不说玩家不会知道。
          */}
          {swipeHint ? <p className="eink-text">{i18n.t('shell.detail.swipeHint')}</p> : null}
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

      {/*
        Difficulty is hidden for games that also have levels (sokoban / klotski):
        there it only acts as a "which level to start on" shortcut, and the level list
        already covers that. Games with difficulty only (sudoku, minesweeper, ...) keep it.
      */}
      {entry.hideDifficulty ? null : (
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
      )}

      {/*
       * 关卡区只给有关卡的玩法（推箱子 / 华容道）；只有难度选择的玩法换成历史记录，
       * 免得它永远显示一句「暂无进行中的局面」。
       */}
      {levels.length > 0 ? (
      <section className="eink-section">
        <h2>{i18n.t('shell.detail.levels')}</h2>
        {/* 关卡行整行可点：说明一句，免得用户以为只是展示（只有有关卡的玩法才有这一区） */}
        <p className="eink-muted">{i18n.t('shell.detail.pickLevel')}</p>
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
                    {/*
                      整行是一个真正的 <button>：墨水屏设备要靠硬件键/焦点遍历，
                      所以必须是可聚焦元素，而不是给 <li> 绑 onClick。
                    */}
                    <button
                      type="button"
                      className="eink-levels__pick"
                      disabled={!onStartLevel}
                      onClick={() => pickLevel(level.id)}
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
                    </button>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </section>
      ) : (
      <section className="eink-section">
        <h2>{i18n.t('shell.detail.history')}</h2>
        {history.length === 0 ? (
          <p className="eink-muted">{i18n.t('shell.detail.historyEmpty')}</p>
        ) : (
          /*
           * 紧凑列表：一条一行（最多 5 行，数据层已限长），行高固定 ——
           * 出现/消失时高度可控，不会把固定页脚顶出屏幕。
           */
          <ul className="eink-history">
            {history.map((record, index) => {
              // 难度标签优先用游戏声明的 labelKey；万一记录里的难度已不存在，退回原始 id（不会显示 ⟦key⟧）
              const labelKey = entry.game.difficulties.find(
                (option) => option.id === record.difficulty,
              )?.labelKey
              return (
              <li className="eink-history__item" key={`${record.at}-${index}`}>
                <span className="eink-history__difficulty">
                  {labelKey ? i18n.t(labelKey) : record.difficulty}
                </span>
                <span className="eink-history__detail">
                  {/* 没声明计步的玩法（如扫雷）会记 0 步：与其显示零步，不如省掉这一段 */}
                  {record.moves > 0
                    ? `${i18n.plural('shell.detail.historyMoves', record.moves, { count: record.moves })} · `
                    : ''}
                  {`${formatDuration(record.seconds)} · ${formatDate(record.at)}`}
                  {record.won ? '' : ` · ${i18n.t('shell.detail.historyLost')}`}
                </span>
              </li>
              )
            })}
          </ul>
        )}
      </section>
      )}

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
            const target = pendingLevel
            setPendingLevel(null)
            if (target) onStartLevel?.(target.id, target.difficulty)
            else start()
          }}
          onCancel={() => {
            setConfirmReplace(false)
            setPendingLevel(null)
          }}
        />
      ) : null}
    </div>
  )
}
