/**
 * 首页 / 游戏库：继续游戏 + 全部游戏 + 设置入口。
 * 首批游戏少，保持短列表；不使用滚动跟随的复杂导航。
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { readHistory, type HistoryEntry, type SaveEnvelope } from '@eink/core'
import { ActionButton } from '../components.js'
import { GameIcon } from '../GameIcon.js'
import { useUi } from '../contexts.js'
import { useOfflineState } from '../useOfflineState.js'
import type { GameRegistryEntry } from '../registry.js'

/**
 * 每页游戏数的兜底值。
 *
 * 真实每页数量是**按实际可用空间算出来的**（见下面的 measure）：
 * 卡片没铺满就分页会让人困惑（用户反馈过），所以先在渲染后量一次
 * 「内容区还能放下几行 × 网格有几列」，只有条目真的超过这个数才分页。
 * 这个常量只在测量前作为首帧值使用。
 */
// 离开首页（例如进对局）后仍然记住用户所在的页码，返回时不会被重置为 1
let lastLibraryPage = 0

const PAGE_SIZE_FALLBACK = 24

/**
 * 分页器占用的一行高度（含它与网格之间的间距）。只用于**测量阶段的高度预留**，
 * 不参与任何样式计算。
 *
 * 两个来源取**较大值**：
 * - 真实元素（分页器已经渲染出来时直接量）；
 * - 按 CSS 反推的兜底估算（首帧只有一页、分页器还没渲染时走这条，是必经路径）。
 *
 * 为什么兜底按「最坏情况」算：measure() 只在内容区尺寸/条目数变化时重跑，
 * **分页器出现本身不会触发重测**（内容区尺寸没变，ResizeObserver 不会回调），
 * 所以这一枪打低了就会一直低，网格富余小于误差时就把分页器顶出内容区。
 *
 * 用户要求「翻页按钮要大一些」后，`.eink-pager__btn` 与 `.eink-button` 同档：
 * min-height 48px（内容 1em 行高 + 上下 2px 边框都小于它），
 * `.eink-pager--footer` 又把行高收到 1，所以**一行分页 = 按钮 48px + 区块间距**。
 * 兜底按 48px 算（字号档再大也不超过它：1em + 4px 边框要 44px 字号才追平）。
 * 实测：预留从旧的 46px 涨到 56px 之后，439×847@26px 坏档仍是 4 块/页、
 * 439×560@26px 是 6 块/页（比改前还多 2 块，因为页脚同时变矮了），两处内容区都不滚动。
 */
function pagerRowHeight(content: HTMLElement, gap: number): number {
  const spacing = Math.max(gap, 8)
  const font = Number.parseFloat(getComputedStyle(content).fontSize) || 18
  const estimate = Math.max(48, Math.ceil(font) + 4) + spacing
  const pager = content.querySelector('.eink-pager')
  if (pager) {
    const rect = pager.getBoundingClientRect()
    if (rect.height > 0) return Math.max(estimate, Math.ceil(rect.height) + spacing)
  }
  return estimate
}

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
  /** 关于页入口：放在页脚**右下角**（原版本号的位置，见 LibraryScreen 里的说明） */
  onAbout: () => void
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
  onAbout,
}: LibraryScreenProps): ReactNode {
  const { i18n, platform } = useUi()
  // 分页状态；current 做 clamp，条目数/每页数变化时不会停在空页
  // 页码存在模块级缓存里：进对局会让 LibraryScreen 卸载，返回首页时若只用组件内 state 就会跳回第 1 页
  const [page, setPageState] = useState(() => lastLibraryPage)
  const setPage = (next: number) => {
    lastLibraryPage = Math.max(0, next)
    setPageState(lastLibraryPage)
  }
  const [pageSize, setPageSize] = useState(PAGE_SIZE_FALLBACK)
  /*
   * 真实每页数是否已经量出来。
   *
   * 首帧用的是兜底 PAGE_SIZE_FALLBACK=24：12 款游戏在兜底里只有 1 页，
   * 于是 current 会被钳到 0 —— 如果这时执行下面的「回写」，就会把刚记住的第 2 页
   * 冲成第 1 页（真机实测：26px 档在第 2 页点进游戏、返回首页直接回到第 1 页）。
   * 因此回写必须等到量出真实每页数之后，兜底阶段的钳位一律不算数。
   */
  const [measured, setMeasured] = useState(false)
  const pageCount = Math.max(1, Math.ceil(entries.length / pageSize))
  const current = Math.min(page, pageCount - 1)
  /*
   * 把钳位结果**回写**缓存与组件 state。
   *
   * 只在渲染时 Math.min 是不够的：页数先缩后增时（例如坏档警告出现→每页变少→页数变多，
   * 之后又消失）缓存里还留着旧页码，此时 current 会被钳到最后一页，
   * 但「进详情再返回」会重新挂载组件并从缓存读回那个**已经不存在的页码**——
   * entries.slice 直接给出空页（用户看到「第 3/2 页上一页下一页」却一张卡都没有）。
   * 回写后缓存始终等于屏幕上真正显示的那一页。
   */
  useEffect(() => {
    if (!measured) return
    if (page === current) return
    lastLibraryPage = current
    setPageState(current)
  }, [page, current, measured])
  const pageEntries = entries.slice(current * pageSize, current * pageSize + pageSize)
  const gridRef = useRef<HTMLUListElement | null>(null)
  // 订阅而不是读一次快照：否则 SW 就绪后「离线准备中」这个徽标不会更新
  const offline = useOfflineState(platform.offline)
  /**
   * 「继续上一局」选**最近玩过**的那一款，而不是注册顺序里第一个有存档的。
   * 原先用 entries.find(...)，于是玩了 2048 之后首页卡片还显示推箱子（探索式测试发现）。
   */
  const continued = entries
    .filter((entry) => saves[entry.game.id])
    .sort((a, b) => (saves[b.game.id]?.updatedAt ?? 0) - (saves[a.game.id]?.updatedAt ?? 0))[0]

  /*
   * 量「这屏能放多少张卡」：列数 = 网格宽 / 卡宽，行数 = 内容区可用高 / 卡高。
   *
   * 关键：**只观察内容区与窗口，绝不观察网格自身**。
   * 之前观察网格导致翻页后重算（页数从 2 变 3）、页码自己跳 —— 真机上实测到的 bug。
   * 另外可用高度用「内容区高度 − 网格相对内容区的偏移」算，与网格当页有几张卡无关。
   *
   * 偏移量的依赖必须显式列出：损坏警告与「继续上一局」都在网格上方，
   * 它们出现/消失会改变 gridOffset，从而改变这一屏放得下几行。
   * 只靠 ResizeObserver 不行 —— 内容区自身的尺寸没变，观察回调不保证再来一次
   * （实测：坏档警告出现后内容 894px > 可视 632px，只因碰巧撞上一次初始回调才恢复）。
   * 这些依赖都不会在翻页时变化，所以不会造成「页数自跳」。
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
      /*
       * 分页器已经移到网格**下方**（用户要求）：它自成一行，测量时必须预留，
       * 否则「刚好填满」的那一档会把分页器顶出内容区（首页在最大字号档不允许滚动）。
       * 只在条目真的超过一页（分页器会出现）时预留 —— 只有一页时不留，
       * 免得白白少放一行游戏。预留量不依赖当前 pageSize，因此不会翻页自跳。
       */
      const naturalRows = Math.max(
        1,
        Math.floor((content.clientHeight - gridOffset - 4 + gap) / (tileRect.height + gap)),
      )
      const reserve = entries.length > columns * naturalRows ? pagerRowHeight(content, gap) : 0
      const available = content.clientHeight - gridOffset - 4 - reserve
      const rows = Math.max(1, Math.floor((available + gap) / (tileRect.height + gap)))
      const next = Math.max(1, columns * rows)
      setPageSize((prev) => (prev === next ? prev : next))
      // 真实每页数已经量出来了：从这里开始才允许把越界页码回写（见上面的 measured 说明）
      setMeasured(true)
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
  }, [entries.length, corruptGameIds.length, continued?.game.id, offline, platform.storage.persistent])

  return (
    <div className="eink-screen eink-screen--library eink-screen--sticky-footer">
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
         * 「继续上一局」与下面的「全部游戏」用**同一套区块写法**：eink-section + __head + h2。
         * 用户反馈它原先没有任何标题、直接顶在页面最上面一块，很突兀。
         *
         * 栏本身仍是**一条细栏**（原来是一张全宽大卡：标题 + 统计 + 两个大按钮，小屏上占近三行）。
         * 整栏可点即继续；标题已经写了「继续上一局」，栏内就只留有用的信息
         * （游戏名 + 关卡），不再重复文案。
         */
        <section className="eink-section eink-section--continue">
          <div className="eink-section__head">
            <h2>{i18n.t('shell.library.continue')}</h2>
          </div>
          {(() => {
            const envelope = saves[continued.game.id]!
            const title = i18n.t(`${continued.game.i18nNamespace}.title`)
            /*
             * Level-based games (sokoban / klotski) keep "Level N".
             * Games without levels (2048 / sudoku / ...) have no level index at all:
             * falling back to index 0 used to print a meaningless "Level 1".
             * They show their real progress instead (same key and same progressFor
             * the detail screen uses); if that is unavailable or empty, the bar
             * shows the game name alone rather than inventing a level.
             */
            const hasLevels = (continued.levels?.length ?? 0) > 0
            let meta = ''
            if (hasLevels) {
              const contentId = continued.game.contentId?.(envelope.state) ?? levelIdOf(envelope)
              const index = continued.indexOfLevel?.(contentId, envelope.state) ?? 0
              meta = `${i18n.t('shell.common.level')} ${index + 1}`
            } else {
              const summary = continued.progressFor?.(progressOf(envelope).completed)
              if (summary && summary.total > 0) {
                meta = i18n.t('shell.library.progress', { done: summary.done, total: summary.total })
              }
            }
            return (
              <button
                type="button"
                className="eink-continue"
                onClick={() => onContinue(continued.game.id)}
                // 无障碍名仍要能独立读懂：区块标题在按钮之外，读屏可能只读到按钮
                aria-label={meta ? `${i18n.t('shell.library.continue')} ${title} ${meta}` : `${i18n.t('shell.library.continue')} ${title}`}
              >
                <GameIcon namespace={continued.game.i18nNamespace} size={22} />
                <span className="eink-continue__title">{title}</span>
                {meta ? <span className="eink-continue__meta">{meta}</span> : null}
              </button>
            )
          })()}
        </section>
      ) : null}

      {/*
        「全部游戏」区块：翻页而不是滚动（多游戏时高度/宽度都不变；硬件翻页键也接管，
        见 useHardwarePageKeys）。`eink-section--games` 让这个区块吃掉内容区的剩余高度，
        翻页行因此钉在底部 —— 用户反馈：最后一页卡片少时，翻页按钮会跟着卡片往上跑。
      */}
      <section className="eink-section eink-section--games">
        <div className="eink-section__head">
          <h2>{i18n.t('shell.library.all')}</h2>
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
                    {/* 标题在图标右侧的剩余空间里水平 + 垂直居中：样式见 styles.css 的 .eink-tile__title */}
                    <span className="eink-tile__title">
                      {i18n.t(`${entry.game.i18nNamespace}.title`)}
                    </span>

                  </button>
                </li>
              )
            })}
          </ul>
        )}
        {/*
          分页控件在网格**下方**、右对齐（用户要求：原来挤在标题行右侧）。
          只有一页时不渲染；翻页按钮是原生 <button>，键盘与硬件翻页键都能到。
        */}
        {pageCount > 1 ? (
          <div className="eink-pager eink-pager--footer">
            <button
              type="button"
              className="eink-pager__btn"
              data-page="prev"
              disabled={current === 0}
              onClick={() => setPage(current - 1)}
              /*
               * 可见文字「上一页」太短，读屏单独念它听不出翻到哪一页；
               * aria-label 补上动作 + 目标页（禁用时钳到当前页，不会是「第 0 页」）。
               */
              aria-label={`${i18n.t('shell.library.prevPage')} · ${i18n.t('shell.library.page', { index: Math.max(1, current), total: pageCount })}`}
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
              aria-label={`${i18n.t('shell.library.nextPage')} · ${i18n.t('shell.library.page', { index: Math.min(pageCount, current + 2), total: pageCount })}`}
            >
              {i18n.t('shell.library.nextPage')}
            </button>
          </div>
        ) : null}
      </section>

      </div>

      <footer className="eink-footer">
        {/*
          页脚保持**三个**主按钮（设置/帮助/诊断）——它们 + 右下角的「关于」正是首屏放得下 12 个方块的前提：
          多一个主按钮（.eink-button，48px 高、110~187px 宽）就会折到第二行
          （zh 18px 页脚 61→93px、en 18px 93→124px）。
          「关于」用窄的无边框链接放在原版本号的位置，实测六个配置的页脚：
          zh 18px 61px、zh 26px 73px（原本 114px：版本号折在第二行）、en 18px 93px、en 26px 148px、
          1248px 宽的两档 61px —— 比改前只多出「英文 18px 这一档的 18px」。
        */}
        <ActionButton labelKey="shell.nav.settings" onSelect={onSettings} />
        <ActionButton labelKey="shell.nav.help" onSelect={onHelp} />
        <ActionButton labelKey="shell.nav.diagnostics" onSelect={onDiagnostics} />
        {/*
          用户要求：去掉右下角的构建版本号，把「关于」换到这个位置。
          版本号本身没有消失 —— 它移到了关于页（那里现在是判断设备上是否最新版的唯一入口）。
          margin-left:auto（.eink-footer__about）把它推到行尾；这一行放不下时它会自己折到下一行，
          不会挤压设置/帮助/诊断三个主按钮。
        */}
        <button type="button" className="eink-link eink-footer__about" onClick={onAbout}>
          {i18n.t('shell.nav.about')}
        </button>
      </footer>
    </div>
  )
}

/**
 * 存档进度：关卡完成情况 + 最佳步数 + 历史记录（无关卡玩法用后者）。
 * 三个字段都可能缺失（旧存档 / 从没玩过）—— 这里一律给安全默认值。
 */
export interface SaveProgress {
  completed: string[]
  bestMoves: Record<string, number>
  history?: HistoryEntry[]
}

/** 关卡制玩法：注册表里登记了 levels 的才算（推箱子/华容道） */
export function progressOf(envelope: SaveEnvelope | undefined): SaveProgress {
  const progress = (envelope?.progress ?? {}) as {
    completed?: string[]
    bestMoves?: Record<string, number>
    history?: unknown
  }
  return {
    completed: progress.completed ?? [],
    bestMoves: progress.bestMoves ?? {},
    // 坏数据一律退化成空数组，详情页不能因为旧存档打不开
    history: readHistory(progress.history),
  }
}

export function levelIdOf(envelope: SaveEnvelope | undefined): string {
  const state = envelope?.state as { levelId?: string } | undefined
  return state?.levelId ?? ''
}

