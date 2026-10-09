/**
 * 展示模型：把局面翻译成壳层的牌桌（CardTableView）与按钮。
 *
 * 空当接龙是一人一桌的「排牌」玩法：全桌 13 个牌堆（抽牌堆、弃牌堆、4 个基础堆、7 个牌列）
 * 都各自可点。展示层因此给壳层的是 **piles**（壳层的牌堆布局，见 CardTable.tsx 的 Piles）：
 *   上排 = 抽牌堆 / 弃牌堆 / 4 个基础堆（layout:'row'）
 *   下排 = 7 个牌列（layout:'stack'，每列从列顶往下排，牌背排在列尾）
 *
 * 每个可点的元素都带一个编号，编号**只由「哪个牌堆的第几张」决定**（cards.clickIdOf），
 * 点哪张、点完派发什么动作，全在规则层（engine.tap）里判定，壳层依旧什么都不知道。
 * 空牌列与空基础堆也给编号（CardPileView.id，见 emptyPileClickId）：没有它，
 * 「把 K 放到空列」「把 A 放进空基础堆」这两步在界面上没有可点的东西（引擎一直支持）。
 *
 * 给了 piles 时壳层**不再渲染 seats / center / hand**（CardTable 的既有约定），这里也就不产出它们。
 * 总览信息没有丢：每个堆自带名字与真实张数（`cards` + `hidden`），已收牌 / 步数 / 局号在统计条里。
 */
import type {
  CardFace,
  CardPileView,
  CardTableView,
  ControlSpec,
  GameStatus,
  GameView,
  StatView,
} from '@eink/core'
import {
  CARD_COUNT,
  FOUNDATION_COUNT,
  STOCK,
  TABLEAU_COUNT,
  WASTE,
  clickIdOf,
  decodeClickId,
  foundation,
  rankLabel,
  rankOf,
  samePile,
  suitOf,
  tableau,
  type PileRef,
} from './cards.js'
import {
  collectStep,
  pileCards,
  statusOf,
  tableOf,
  topOf,
  type KlondikeState,
  type Selection,
  type TableState,
} from './engine.js'

/** 牌背的字形：1-bit 上不能靠颜色，用斜纹方块表示「这张没翻开」 */
export const CARD_BACK_GLYPH = '▨'
/** 抽牌堆空了但还能回收时的字形（点它就是「整叠倒扣回来」） */
export const RECYCLE_GLYPH = '↻'

/**
 * 牌堆里的一张可点牌（clickTargets 的一项）。
 * `callers`（测试与无障碍）靠它判断「这一点下去会发生什么」，buildPiles 只用到 face。
 */
export interface ClickTarget {
  /** 交给 selectAction 的编号（= CardFace.id） */
  id: number
  pile: PileRef
  cardIndex: number
  face: CardFace
  /** 没翻开（牌背）：不能当源；只在已经提起一段时能当目标 */
  faceDown: boolean
  /** 属于当前提起的那一段（壳层会把它们一起抬高） */
  picked: boolean
}

/** 这张牌属不属于当前提起的那一段 */
function isPicked(selection: Selection | null, table: TableState, pile: PileRef, cardIndex: number): boolean {
  if (selection === null || !samePile(selection.pile, pile)) return false
  // 弃牌堆的编号只有堆顶那一个，选中它就是选中这一张
  if (pile.zone === 'waste') return true
  return cardIndex >= selection.cardIndex && cardIndex < table.tableau[pile.index]!.cards.length
}

/**
 * 全桌**有牌可画**的可点牌（固定顺序：抽牌堆 → 弃牌堆顶 → 4 个基础堆顶 → 7 个牌列，每列从列顶往下）。
 * 抽牌堆永远给一个入口（还有牌可翻，或者弃牌堆还能回收），否则玩家会找不到「翻牌」这个动作。
 *
 * buildPiles() 按牌堆把它分组，isClickable() 拿它判断「这一张点得动吗」——
 * 展示层与规则层（selectAction）用的是同一批编号，不会出现「画出来了却点不动」。
 *
 * 没翻开的牌（抽牌堆入口、牌列的牌背）在 `face` 上带 `faceDown: true`：壳层据此画 1-bit 斜纹牌背，
 * 而不是把 `CARD_BACK_GLYPH`（▨）当牌面画出来 —— 那个字形只留给"拿字符冒充牌背"的旧画法。
 */
export function clickTargets(state: KlondikeState): ClickTarget[] {
  const table = tableOf(state)
  const selection = state.selected
  const out: ClickTarget[] = []

  if (table.stock.length > 0) {
    out.push({
      id: clickIdOf(STOCK),
      pile: STOCK,
      cardIndex: 0,
      face: { id: clickIdOf(STOCK), rank: CARD_BACK_GLYPH, suit: null, faceDown: true },
      faceDown: true,
      picked: false,
    })
  } else if (table.waste.length > 0) {
    out.push({
      id: clickIdOf(STOCK),
      pile: STOCK,
      cardIndex: 0,
      face: { id: clickIdOf(STOCK), rank: RECYCLE_GLYPH, suit: null, faceDown: true },
      faceDown: true,
      picked: false,
    })
  }

  const wasteTop = topOf(table, WASTE)
  if (wasteTop !== null) {
    out.push({
      id: clickIdOf(WASTE),
      pile: WASTE,
      cardIndex: 0,
      face: {
        id: clickIdOf(WASTE),
        rank: rankLabel(rankOf(wasteTop)),
        suit: suitOf(wasteTop),
        ...(isPicked(selection, table, WASTE, 0) ? { selected: true } : {}),
      },
      faceDown: false,
      picked: isPicked(selection, table, WASTE, 0),
    })
  }

  for (let index = 0; index < FOUNDATION_COUNT; index++) {
    const pile = foundation(index)
    const top = topOf(table, pile)
    if (top === null) continue
    out.push({
      id: clickIdOf(pile),
      pile,
      cardIndex: 0,
      face: { id: clickIdOf(pile), rank: rankLabel(rankOf(top)), suit: suitOf(top) },
      faceDown: false,
      picked: false,
    })
  }

  // 牌列：从列顶往下排（与眼睛看一叠牌的顺序一致），牌背排在列尾
  for (let column = 0; column < TABLEAU_COUNT; column++) {
    const pile = tableau(column)
    const cards = table.tableau[column]!.cards
    for (let cardIndex = cards.length - 1; cardIndex >= 0; cardIndex--) {
      const card = cards[cardIndex]!
      const faceDown = cardIndex < table.tableau[column]!.faceDown
      const picked = isPicked(selection, table, pile, cardIndex)
      out.push({
        id: clickIdOf(pile, cardIndex),
        pile,
        cardIndex,
        face: faceDown
          ? {
              id: clickIdOf(pile, cardIndex),
              rank: CARD_BACK_GLYPH,
              suit: null,
              faceDown: true,
              ...(picked ? { selected: true } : {}),
            }
          : {
              id: clickIdOf(pile, cardIndex),
              rank: rankLabel(rankOf(card)),
              suit: suitOf(card),
              ...(picked ? { selected: true } : {}),
            },
        faceDown,
        picked,
      })
    }
  }
  return out
}

/**
 * 空堆的点击编号（`CardPileView.id`）：空牌列 / 空基础堆在界面上也要有一个**可点的入口**，
 * 否则「把 K 放到空列」「把 A 放进空基础堆」这两步做不出来 —— 而它们是这个玩法的核心操作。
 *
 * 编号与牌上的编号**同源**（cards.clickIdOf）：空牌列 = 6 + 列号 × 32（第 0 张）、空基础堆 = 2 + 序号，
 * 因此 decodeClickId 能原样解回「哪一堆（空列 / 空基础堆）」，规则层的 reduce（tap → move）
 * 不用为它加任何特例 —— 视图与解码两处永远自洽。
 *
 * 抽牌堆 / 弃牌堆不给编号：抽牌堆空了还能回收时已经由 clickTargets 给了入口，空弃牌堆两个方向都没有动作。
 */
export function emptyPileClickId(table: TableState, pile: PileRef): number | undefined {
  if (pile.zone !== 'tableau' && pile.zone !== 'foundation') return undefined
  if (pileCards(table, pile).length > 0) return undefined
  return clickIdOf(pile)
}

/**
 * 这一张（或这个空位）现在点得动吗？壳层的 selectAction 与测试共用它，
 * 保证「画出来的 / 点得动的」是同一批：
 *   - 抽牌堆入口：永远可点（翻牌；抽牌堆空了就是回收）；
 *   - 明牌：可点（没选中时当源，选中后当目标或改选）；
 *   - 牌背：只有在已经提起一段时能当目标（点整列 = 把牌放到这一列）；
 *   - 空堆的空位（空列 / 空基础堆，见 emptyPileClickId）：同样只有已经提起一段时才是目标。
 */
export function isClickable(state: KlondikeState, id: number): boolean {
  const target = clickTargets(state).find((candidate) => candidate.id === id)
  if (!target) {
    /*
     * 空堆的空位：壳层画得出来（CardPileView.id），但没提起牌时点它没有任何动作，
     * 因此这里返回 null（壳层据此给「这里不能这样动牌」的提示）；提起一段之后它才是目标，
     * 放不放得下由 moveError 判（不是 K / 不是 A 时规则层照样拒绝，见 engine.tap）。
     */
    const decoded = decodeClickId(id)
    if (!decoded || decoded.cardIndex !== 0) return false
    return state.selected !== null && emptyPileClickId(tableOf(state), decoded.pile) !== undefined
  }
  if (target.pile.zone === 'stock') return true
  if (target.faceDown) return state.selected !== null
  return true
}

/**
 * 13 个牌堆（壳层的牌堆布局用）：上排 = 抽牌堆 / 弃牌堆 / 4 个基础堆，下排 = 7 个牌列。
 *
 * 每一堆的牌直接来自 clickTargets() 的分组：与规则层用的是同一批编号，
 * 因此壳层点回来的 id 一定能被 decodeClickId 解回「这一堆的第几张」。
 * 张数由 `cards` + `hidden` 凑出**真实数目**（只画堆顶的堆把余下的写进 hidden）。
 */
export function buildPiles(state: KlondikeState): CardPileView[] {
  const table = tableOf(state)
  const targets = clickTargets(state)
  const facesOf = (pile: PileRef): CardFace[] =>
    targets.filter((target) => samePile(target.pile, pile)).map((target) => target.face)
  const picked = (pile: PileRef): boolean => state.selected !== null && samePile(state.selected.pile, pile)

  const piles: CardPileView[] = []

  /*
   * 抽牌堆：整堆只有**一个**入口（翻牌 / 回收），其余张数写进 hidden。
   *
   * 抽空了但弃牌堆还有牌可回收时，入口改用**堆级 id**（`CardPileView.id`），
   * 而不是往 `cards` 里塞一张「回收」假牌（RECYCLE_GLYPH + faceDown）：
   * 壳层按 `cards.length + hidden` 算这一堆的张数（CardTable.tsx 的 slots），
   * 塞假牌会让抽空的抽牌堆显示「1 张」、`data-empty` 也还是 `no`，13 堆合计变成 53（多算一张），
   * 而且那张假牌画出来是牌背 —— 玩家看不出已经抽空、以为还剩一张可翻。
   * 入口是**入口**不是牌：`cards: []` + `id` 让壳层把空位本身渲染成可点按钮，
   * 张数 = 0、`data-empty` 正确，编号与规则层仍然同源（decodeClickId 照旧解回抽牌堆，
   * selectAction → tap 走既有的回收路径）。两边都空时不给 id，空位保持原来的虚线占位、点不动。
   */
  const stockEntry = targets.find((target) => target.pile.zone === 'stock')
  const stockFaces = table.stock.length > 0 ? facesOf(STOCK) : []
  piles.push({
    labelKey: 'klondike.pile.stock',
    cards: stockFaces,
    hidden: Math.max(0, table.stock.length - stockFaces.length),
    layout: 'row',
    ...(stockFaces.length === 0 && stockEntry ? { id: stockEntry.id } : {}),
  })

  // 弃牌堆：只有堆顶那张能动（编号也只有那一个），底下压着的照样算进这一堆的张数
  const wasteFaces = facesOf(WASTE)
  piles.push({
    labelKey: 'klondike.pile.waste',
    cards: wasteFaces,
    hidden: Math.max(0, table.waste.length - wasteFaces.length),
    layout: 'row',
    ...(picked(WASTE) ? { selected: true } : {}),
  })

  for (let index = 0; index < FOUNDATION_COUNT; index++) {
    const pile = foundation(index)
    const cards = facesOf(pile)
    const emptyId = emptyPileClickId(table, pile)
    piles.push({
      labelKey: 'klondike.pile.foundation',
      cards,
      // 基础堆只画堆顶（也只有它能动）：收进去的其他牌写进 hidden，张数照样是真的
      hidden: Math.max(0, table.foundations[index]!.length - cards.length),
      layout: 'row',
      // 空基础堆：没有牌可画，但留一个可点的空位（放 A 进去）
      ...(emptyId === undefined ? {} : { id: emptyId }),
    })
  }

  for (let column = 0; column < TABLEAU_COUNT; column++) {
    const pile = tableau(column)
    const cards = facesOf(pile)
    const emptyId = emptyPileClickId(table, pile)
    piles.push({
      labelKey: 'klondike.pile.tableau',
      cards,
      /*
       * 牌列把**整列**都画出来（含牌背）：牌背在这一堆里是有编号的 —— 提起一段之后点它就是
       * 「放到这一列」，与长条年代的行为一致。所以这里 hidden 恒为 0（没有"点不动的牌背"）。
       */
      hidden: 0,
      layout: 'stack',
      // 空牌列：没有牌可画，但留一个可点的空位（放 K 打头的整段进去）
      ...(emptyId === undefined ? {} : { id: emptyId }),
      ...(picked(pile) ? { selected: true } : {}),
    })
  }

  return piles
}

export function buildTable(state: KlondikeState): CardTableView {
  return {
    kind: 'cards',
    /*
     * 给了 piles 就走牌堆布局：13 个堆各自可点（含空堆的空位），壳层**不再看** seats / center / hand
     * （CardTable.tsx 的既有约定），所以这里也不再产出它们。
     * 总览没有丢：每个堆带自己的名字与真实张数，已收牌 / 步数 / 局号在统计条里（buildStats）。
     */
    seats: [],
    center: null,
    hand: [],
    piles: buildPiles(state),
    bannerKey: state.selected === null ? 'klondike.banner.pick' : 'klondike.banner.drop',
  }
}

export function buildStats(state: KlondikeState): StatView[] {
  const table = tableOf(state)
  const collected = table.foundations.reduce((sum, pile) => sum + pile.length, 0)
  // 竖向只有 3 列（壳层按 min(3, 条数) 排），所以固定三条：步数 / 已收牌 / 局号
  return [
    { labelKey: 'klondike.stat.moves', value: String(state.log.length) },
    { labelKey: 'klondike.stat.collected', value: `${collected}/${CARD_COUNT}` },
    { labelKey: 'klondike.stat.deal', value: String(state.dealNo + 1) },
  ]
}

export function buildControls(state: KlondikeState): ControlSpec[] {
  const table = tableOf(state)
  const canUndo = state.log.length > 0
  return [
    // 撤销按钮的 id 由壳层约定（'undo'），这里只负责报「现在能不能撤」
    { id: 'undo', labelKey: 'shell.game.undo', role: 'action', enabled: canUndo, emphasis: 'normal' },
    {
      id: 'collect',
      labelKey: 'klondike.action.collect',
      role: 'action',
      enabled: collectStep(table) !== null,
      emphasis: 'normal',
    },
    {
      id: 'restart-deal',
      labelKey: 'klondike.action.restartDeal',
      role: 'action',
      enabled: canUndo || state.selected !== null,
      emphasis: 'normal',
    },
    { id: 'next-deal', labelKey: 'klondike.action.nextDeal', role: 'action', enabled: true, emphasis: 'primary' },
    /*
     * 「换一局」还要出现在**结果面板**上（收满 52 张之后玩家最想做的就是再来一局）。
     * 结果面板只认壳层自己的 id 'next-level'，文案仍取本包给的 labelKey
     * —— 声明它只是为了让那个按钮有名字，对局页不会重复渲染（壳层把它当自己的按钮）。
     */
    { id: 'next-level', labelKey: 'klondike.action.nextDeal', role: 'action', enabled: true, emphasis: 'primary' },
  ]
}

/**
 * 结果面板：收满 4 个基础堆时给的一组文案（局号 + 步数；最佳步数由壳层自己接在后面）。
 * 单独把 status 当参数传进来，是为了能直接断言这组 key —— 真走到「赢」要在真发牌里
 * 摆出四个 13 张的基础堆（测试里没法从种子构造），所以判赢与文案分开验：
 * statusOfTable 验「四个 13 张 = won」，这里验「won 的时候给哪些文案」。
 */
export function buildResult(state: KlondikeState, status: GameStatus): GameView['result'] {
  if (status !== 'won') return null
  return {
    titleKey: 'klondike.won.title',
    details: [
      { key: 'klondike.result.deal', params: { count: state.dealNo + 1 } },
      { key: 'klondike.result.moves', params: { count: state.log.length } },
    ],
  }
}

export function buildView(state: KlondikeState): GameView {
  const status = statusOf(state)
  return {
    board: null,
    table: buildTable(state),
    stats: buildStats(state),
    result: buildResult(state, status),
    notice: null,
  }
}
