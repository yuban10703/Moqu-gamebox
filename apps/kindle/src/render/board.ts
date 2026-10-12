/**
 * 棋盘渲染器（BoardView → DOM，ES5 目标）。
 *
 * 与 React 版的对应关系：语义完全对齐 packages/ui/src/components.tsx 的 `Board` + `BoardGlyph`
 * （同样按 kind 决定画什么、同样的合并/分组/末手标记规则），但**布局手段不同**：
 * React 版把尺寸交给 CSS 容器查询；这里没有容器查询可用，于是由 JS 算出格子边长，
 * 用 `<table>` 排布 —— table 是这张最老的引擎上唯一能保证「等宽等高、无缝隙、不错行」的布局原语。
 *
 * 明确不做的事：不使用 `position:absolute` 覆盖层来放整盘文字。
 * 覆盖层与网格是两套坐标系（历史上真机整体错位过），元素一律按格渲染。
 */
import type { BoardView, CellKind, CellView, MoveDir } from '@eink/core'
import { el, clear } from '../dom.js'
import type { RenderCtx } from './types.js'
import { svg, shape, svgSupported } from './svg.js'

/** 以「文字」呈现的格子：数字/符号在墨水屏上比图形更清楚，且天然是 1-bit */
const TEXT_KINDS: Record<string, boolean> = {
  tile: true,
  given: true,
  number: true,
  flag: true,
  mine: true,
  floor: true,
}

/** 身体一节朝各方向伸出的那一段（管宽 18/24，从格子中心伸到格边） */
const SEGMENT_ARMS: Record<string, { x: number; y: number; width: number; height: number }> = {
  up: { x: 3, y: 0, width: 18, height: 12 },
  down: { x: 3, y: 12, width: 18, height: 12 },
  left: { x: 0, y: 3, width: 12, height: 18 },
  right: { x: 12, y: 3, width: 12, height: 18 },
}

/** 有朝向的图形都按「朝上」画好，再整体旋转（SVG 坐标系 y 向下，顺时针为正） */
const FACING_DEGREES: Record<string, number> = { up: 0, right: 90, down: 180, left: 270 }

/** SVG 不可用时的文字兜底：形状语义靠符号近似表达 */
const FALLBACK_TEXT: Record<string, string> = {
  goal: '○',
  box: '▢',
  boxOnGoal: '▣',
  player: '●',
  playerOnGoal: '◉',
  head: '▲',
  tail: '▼',
  segment: '■',
  wall: '█',
}

/** 格子边长下限：低于它数字与符号就读不清了（真机实测 24px 是底线） */
const MIN_CELL = 24
/**
 * 格子边长上限。
 *
 * 原先取 96px，实测（760×1024 视口截图）发现 4 列的华容道只画到 384px 宽，
 * 右边一半屏幕空着 —— 墨水屏上"大格子=可点、可读"，面积是最值钱的东西。
 * 现在放宽到 160px：真正的约束是可用宽高（见 computeCellSize 的两种约束取小），
 * 这里只作为最后一道保险，防止某一款玩法给出异常的行列数时把棋盘撑爆。
 */
const MAX_CELL = 160

/**
 * 画一个棋子图形（对应 BoardGlyph）。
 * 返回 null 表示「这个 kind 不画图形」（文字类与 empty/wall 等）。
 */
function glyph(kind: CellKind, bold: boolean, facing?: MoveDir, links?: readonly MoveDir[]): Node | null {
  if (kind === 'floor' || kind === 'wall' || TEXT_KINDS[kind] === true) return null
  const stroke = bold ? 2.6 : 1.6
  const thin = bold ? 2 : 1.1

  if (!svgSupported()) {
    const text = FALLBACK_TEXT[kind]
    if (!text) return null
    return document.createTextNode(text)
  }

  if (kind === 'segment') {
    const node = svg({})
    node.appendChild(shape('circle', { cx: 12, cy: 12, r: 9, fill: '#000' }))
    const list = links ?? []
    for (let i = 0; i < list.length; i++) {
      const arm = SEGMENT_ARMS[list[i]]
      if (!arm) continue
      node.appendChild(shape('rect', arm))
    }
    return node
  }

  if (kind === 'head' || kind === 'tail') {
    const node = svg({})
    const group = shape('g', { transform: 'rotate(' + FACING_DEGREES[facing ?? 'up'] + ' 12 12)' })
    if (kind === 'head') {
      group.appendChild(shape('path', { d: 'M3 24V12a9 9 0 0 1 18 0v12z', fill: '#000' }))
      group.appendChild(shape('circle', { cx: 8.3, cy: 10.8, r: 2.3, fill: '#fff' }))
      group.appendChild(shape('circle', { cx: 15.7, cy: 10.8, r: 2.3, fill: '#fff' }))
    } else {
      group.appendChild(shape('path', { d: 'M3 24C4.5 15.5 8.5 8 12 2.5 15.5 8 19.5 15.5 21 24z', fill: '#000' }))
    }
    node.appendChild(group)
    return node
  }

  if (kind === 'goal') {
    const node = svg({})
    node.appendChild(shape('circle', { cx: 12, cy: 12, r: 6.5, fill: 'none', stroke: '#000', 'stroke-width': stroke }))
    return node
  }

  if (kind === 'box') {
    // 板条箱：外框 + 对角线，外框贴着格子边（占满）
    const node = svg({})
    node.appendChild(shape('rect', { x: 1, y: 1, width: 22, height: 22, fill: 'none', stroke: '#000', 'stroke-width': stroke }))
    node.appendChild(shape('path', { d: 'M1 1 L23 23 M23 1 L1 23', stroke: '#000', 'stroke-width': thin }))
    return node
  }

  if (kind === 'boxOnGoal') {
    // 已就位：实心箱体 + 白斜线，与空心箱子一眼可分
    const node = svg({})
    node.appendChild(shape('rect', { x: 1, y: 1, width: 22, height: 22, fill: '#000' }))
    node.appendChild(shape('path', { d: 'M1 1 L23 23 M23 1 L1 23', stroke: '#fff', 'stroke-width': thin }))
    return node
  }

  if (kind === 'player') {
    // 人形剪影：头 + 肩
    const node = svg({})
    node.appendChild(shape('circle', { cx: 12, cy: 7.4, r: 4, fill: '#000' }))
    node.appendChild(shape('path', { d: 'M4.6 21c0-4.1 3.3-7 7.4-7s7.4 2.9 7.4 7z', fill: '#000' }))
    return node
  }

  if (kind === 'playerOnGoal') {
    // 目标圆环 + 缩小的人形：语义就是「站在目标点上」
    const node = svg({})
    node.appendChild(shape('circle', { cx: 12, cy: 12, r: 10, fill: 'none', stroke: '#000', 'stroke-width': stroke }))
    node.appendChild(shape('circle', { cx: 12, cy: 8.6, r: 3.2, fill: '#000' }))
    node.appendChild(shape('path', { d: 'M6.6 19.4c0-3.2 2.4-5.4 5.4-5.4s5.4 2.2 5.4 5.4z', fill: '#000' }))
    return node
  }

  if (kind === 'flag') {
    // 有 SVG 时旗子也画图形：字体旗子在部分固件上是缺字方块
    const node = svg({})
    node.appendChild(shape('path', { d: 'M7 21V4', stroke: '#000', 'stroke-width': thin + 0.6 }))
    node.appendChild(shape('path', { d: 'M7 4h10l-3 3.5L17 11H7z', fill: '#000' }))
    return node
  }

  if (kind === 'mine') {
    // 地雷：实心圆 + 八根刺（灰度不可用时靠刺区分，不靠颜色）
    const node = svg({})
    node.appendChild(shape('circle', { cx: 12, cy: 12, r: 5, fill: '#000' }))
    const dirs = [
      [12, 2, 12, 6], [12, 18, 12, 22], [2, 12, 6, 12], [18, 12, 22, 12],
      [5, 5, 8, 8], [19, 19, 16, 16], [19, 5, 16, 8], [5, 19, 8, 16],
    ]
    for (let i = 0; i < dirs.length; i++) {
      const d = dirs[i]
      node.appendChild(shape('line', { x1: d[0], y1: d[1], x2: d[2], y2: d[3], stroke: '#000', 'stroke-width': thin }))
    }
    return node
  }

  if (kind === 'hidden') {
    // 未翻开：浅浅的斜纹由格子自身给（见下），这里不画图形
    return null
  }

  // 其余 kind（empty 等）显式返回 null。
  return null
}

/** 按可用宽高算出格子边长（正方形；两种约束取小） */
export function computeCellSize(cols: number, rows: number, width: number, height: number): number {
  let byWidth = Math.floor((width - 8) / cols)
  if (height > 0) {
    const byHeight = Math.floor((height - 8) / rows)
    if (byHeight < byWidth) byWidth = byHeight
  }
  if (byWidth < MIN_CELL) return MIN_CELL
  if (byWidth > MAX_CELL) return MAX_CELL
  return byWidth
}

/** 一行/一列最多有几段线索 —— 线索带的厚度与宽度都按它算 */
function clueMax(clues: string[][] | undefined): number {
  if (!clues || clues.length === 0) return 0
  let max = 0
  for (let i = 0; i < clues.length; i++) {
    if (clues[i].length > max) max = clues[i].length
  }
  return max
}

export function renderBoard(container: HTMLElement, board: BoardView, ctx: RenderCtx): void {
  clear(container)
  const cols = board.cols
  const rows = board.rows
  const groups = board.groups
  const rowClues = board.rowClues
  const colClues = board.colClues

  /*
   * 线索带（数织）的尺寸必须**按线索条数**算，不能按"占一格"估。
   *
   * 踩过的坑：原先给线索带只留了一个格子的大小，而线索字号又是按格子等比放大的
   * （cell × 0.34）—— 5 个数字的列线索需要 5 行文字，最后把那一行撑到 748px，
   * 整块棋盘 1383px 高，在一屏 1024px 上被裁掉一半（全量审计量出来的）。
   *
   * 现在：线索字号**固定**（它是配角，不该跟着格子一起放大），
   * 带子厚度 = 最多几条线索 × 行高，宽度 = 最多几位数字 × 字宽，再从可用区里扣掉。
   */
  const rowClueCount = clueMax(rowClues)
  const colClueCount = clueMax(colClues)
  const clueFont = Math.max(9, Math.min(15, Math.round(Math.min(ctx.width, ctx.height) / 60)))
  const clueLine = Math.ceil(clueFont * 1.2)
  const topBand = colClueCount > 0 ? colClueCount * clueLine + 2 : 0
  const leftBand = rowClueCount > 0 ? Math.ceil(rowClueCount * clueFont * 0.85) + 4 : 0
  // 每格还有 1px×2 的边框要占地方：9 列的棋盘光边框就吃掉 18px，
  // 不扣掉的话高度会稳稳超出几个像素（审计量到的 3~9px 就是它）
  const cell = computeCellSize(
    cols,
    rows,
    ctx.width - leftBand - cols * 2,
    ctx.height - topBand - rows * 2,
  )

  const table = el('table', { class: 'k-board', cellspacing: '0', cellpadding: '0' })
  table.setAttribute('role', 'grid')
  table.setAttribute('aria-rowcount', String(rows))
  table.setAttribute('aria-colcount', String(cols))

  let hasCovered = false
  let hasWall = false
  for (let i = 0; i < board.cells.length; i++) {
    const kind = board.cells[i].kind
    if (kind === 'hidden') hasCovered = true
    else if (kind === 'wall') hasWall = true
  }
  /*
   * 斜纹底纹，铺在**整盘**上（逐格铺会让 45° 线在格边错位，真机反馈过）。
   *
   * 两种用途共用这一层：
   *   · 未翻格（hidden，扫雷的未翻开格、记忆的背面卡片）→ 细纹
   *   · 墙 / 障碍（wall，推箱子的墙、贪吃蛇的障碍）→ 粗纹
   * 贪吃蛇的视图注释里写的就是「障碍 = 斜纹底（kind 'wall'，壳层用纹理而不是灰度）」，
   * 这是玩法与壳层之间的约定。
   *
   * **墙原先根本没画**（`wall` 在图形分支里直接 return null，格子又是白底）——
   * 于是推箱子有一圈看不见的墙，玩家"还没走到边框就被拦住"（用户报的）。
   *
   * 两个必须成对的条件，缺一个纹就看不见：
   *   1. 这里给表格铺 background-image；
   *   2. 未翻格与墙格必须是**透明**背景 —— 否则每一格都用不透明的白把自己盖住。
   *      （这正是"未翻格没区分"的原因：那条规则我一度写在样式表里，而行内背景压过它。）
   *
   * 线用**纯黑**而不是浅灰：1-bit 墨水屏上灰色靠抖动模拟、容易糊成噪点，
   * 而斜纹本来就是靠"形状"区分（仓库的 1-bit 规则：别只靠灰阶）。
   */
  if (hasCovered || hasWall) {
    // 有未翻格时用细纹（未翻格是"待办"，视觉上要轻）；只有墙时用粗纹（墙是实体障碍）
    const stroke = hasCovered ? 1 : 2.6
    table.setAttribute(
      'style',
      'border-collapse:collapse;table-layout:fixed;margin:0 auto;' +
        'background-image:url("data:image/svg+xml;utf8,' +
        encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><path d="M-2.5 2.5 L2.5 -2.5 M0 10 L10 0 M7.5 12.5 L12.5 7.5" stroke="#000" stroke-width="' +
            stroke +
            '"/></svg>',
        ) +
        '");',
    )
  } else {
    table.setAttribute('style', 'border-collapse:collapse;table-layout:fixed;margin:0 auto;')
  }

  // 列线索带（数织：顶部）
  if (colClues) {
    const clueRow = el('tr', { class: 'k-board__clue-row' })
    if (rowClues) {
      // 左上角空格：与左侧行线索带同宽
      clueRow.appendChild(
        el('th', {
          class: 'k-board__clue-corner',
          style: 'width:' + leftBand + 'px;height:' + topBand + 'px;border:none;padding:0;',
        }),
      )
    }
    for (let c = 0; c < cols; c++) {
      const th = el('th', {
        class: 'k-board__clue-col',
        style:
          'width:' + cell + 'px;height:' + topBand + 'px;border:none;padding:0;' +
          'vertical-align:bottom;text-align:center;font-weight:400;font-size:' + clueFont + 'px;' +
          'line-height:' + clueLine + 'px;overflow:hidden;',
      })
      const list = colClues[c] ?? []
      for (let k = 0; k < list.length; k++) {
        th.appendChild(el('div', { style: 'height:' + clueLine + 'px;overflow:hidden;' }, list[k]))
      }
      clueRow.appendChild(th)
    }
    table.appendChild(clueRow)
  }

  for (let r = 0; r < rows; r++) {
    const tr = el('tr', {})
    if (rowClues) {
      const th = el('th', {
        class: 'k-board__clue-row',
        style:
          'width:' + leftBand + 'px;height:' + cell + 'px;border:none;padding:0 3px 0 0;' +
          'vertical-align:middle;text-align:right;white-space:nowrap;font-weight:400;' +
          'font-size:' + clueFont + 'px;line-height:' + clueLine + 'px;overflow:hidden;',
      })
      const list = rowClues[r] ?? []
      th.appendChild(document.createTextNode(list.join(' ')))
      tr.appendChild(th)
    }
    for (let c = 0; c < cols; c++) {
      const index = r * cols + c
      tr.appendChild(renderCell(board, board.cells[index], index, r, c, cell, groups, ctx))
    }
    table.appendChild(tr)
  }

  container.appendChild(table)
}

function renderCell(
  board: BoardView,
  cellView: CellView,
  index: number,
  row: number,
  col: number,
  size: number,
  groups: { cols: number; rows: number } | undefined,
  ctx: RenderCtx,
): HTMLElement {
  const cols = board.cols
  const rows = board.rows
  const cells = board.cells

  const border = '1px solid #000'
  let css =
    'width:' + size + 'px;height:' + size + 'px;padding:0;position:relative;' +
    'vertical-align:middle;text-align:center;overflow:hidden;box-sizing:border-box;'
  css += 'border:' + border + ';'

  // 同块合并：只去掉**共享的那条边**两侧的格线（棋子朝外的那条边必须留着）
  const mergeRight = cellView.mergeRight === true
  const mergeBottom = cellView.mergeBottom === true
  const mergeLeft = col > 0 && cells[index - 1] !== undefined && cells[index - 1].mergeRight === true
  const mergeTop = row > 0 && cells[index - cols] !== undefined && cells[index - cols].mergeBottom === true
  if (mergeRight) css += 'border-right:none;'
  if (mergeBottom) css += 'border-bottom:none;'
  if (mergeLeft) css += 'border-left:none;'
  if (mergeTop) css += 'border-top:none;'

  // 分组（数独 3×3 宫）：只在**组与组之间**加粗，最外圈由 table 边框负责
  if (groups) {
    const isGroupRight = (col + 1) % groups.cols === 0 && col + 1 < cols
    const isGroupBottom = (row + 1) % groups.rows === 0 && row + 1 < rows
    if (isGroupRight) css += 'border-right:2px solid #000;'
    if (isGroupBottom) css += 'border-bottom:2px solid #000;'
  }

  const flash = cellView.flash === true
  const disc = cellView.disc
  if (flash) css += 'background:#000;color:#fff;'
  else if (disc === 'dark') {
    /*
     * 深色圆片：**黑底白字**（相对地，light = 白底黑字）。
     *
     * 这是游戏层给 disc 的语义 —— 象棋 view 注释原话：「圆片底色 = 区分红黑的唯一手段」
     * （两方的马/车/炮是同一个字），国际象棋两侧干脆都是 R/N/B/Q/K。React 的 Board
     * 一直按这个画；Kindle 渲染器原先只把字段**透传**、从没上过色，于是双方棋子在
     * Kindle 上除了位置完全无法区分，井字棋赢的三格（disc:'dark' 反白）也不亮。
     * 现在补上，与「选中反白」「被吃架上下底色相反」是同一套 1-bit 语言。
     * 只影响设置了 disc 的格子（象棋 / 国际象棋 / 井字棋），其余玩法外观一字不变。
     */
    css += 'background:#000;color:#fff;'
  } else if (cellView.kind === 'hidden') {
    /*
     * 未翻开：**故意不涂白**，让整盘那层斜纹透出来。
     *
     * 这里必须写成 transparent，不能指望样式表 —— 每个格子的背景都是**行内**写的，
     * 行内样式压过任何选择器（先前在 CSS 里加了一条 `[data-kind=hidden]{background:transparent}`，
     * 计算值仍然是白的，等于没写）。而"铺不铺斜纹"也是这个渲染器决定的，
     * 两件事放在一起才不会各说各话。
     *
     * 扫雷的未翻格、记忆的背面卡片都走这条；已翻开的格子仍是白底，正好把斜纹遮掉。
     */
    css += 'background:transparent;color:#000;'
  } else if (cellView.kind === 'wall') {
    // 墙 / 障碍：同样透明，让整盘那层**粗**斜纹透出来（见上面的说明）
    css += 'background:transparent;color:#000;'
  } else if (cellView.kind === 'mine') {
    /*
     * 地雷格/固化格：**实心黑块 + 白字**（React 样式表同一条规则：
     * .eink-board__cell[data-kind='mine'] { background: var(--ink-black) }）。
     *
     * 两种用法：扫雷翻出雷 = 白字"●"压在黑块上；俄罗斯方块落定后的方块
     * （kind 'mine' + 空 glyph）= 一块纯黑。**这条样式缺了，固化块就整块消失**
     * —— Kindle 渲染器原先漏了它：俄罗斯方块“落地就消失”（用户反馈），
     * 而同一份视图数据在 web 上一直是黑块。
     */
    css += 'background:#000;color:#fff;'
  } else css += 'background:#fff;color:#000;'

  if (cellView.selected === true) css += 'box-shadow:inset 0 0 0 2px #000;'

  const td = el('td', { class: 'k-board__cell', style: css })
  td.setAttribute('data-kind', String(cellView.kind))
  td.setAttribute('data-index', String(index))

  /*
   * 所有内容放进一个内层 div，而不是直接塞进 <td>。
   *
   * 原因（老 WebKit 的实际行为）：`position:relative` 在 `<td>` 上不可靠 ——
   * 老引擎里表格单元格不是常规的定位包含块，绝对定位的子元素会去找更外层的祖先，
   * 于是「横幅文字」「填错叉」这类要按格锚定的元素会整体错位
   * （这个项目历史上就被"覆盖层与网格两套坐标系"坑过一次，真机上名字与可点区域对不上）。
   * 换成 td > div(position:relative) 之后，定位包含块是一个普通的块级元素，行为稳定。
   */
  const inner = el('div', {
    class: 'k-board__inner',
    style: 'position:relative;width:100%;height:100%;box-sizing:border-box;',
  })

  // 无障碍名：程序化读屏与探索脚本都靠它；缺 glyph 时退化成 kind
  const label = cellView.glyph ? cellView.glyph : String(cellView.kind)
  td.setAttribute('aria-label', label)

  // 末手痕迹：起点画点、终点描内框（方号 0 空心 / 1 实心，靠形状不靠颜色）
  if (cellView.lastFrom !== undefined) {
    const dotSize = Math.max(5, Math.round(size * 0.14))
    const fromCss =
      'position:absolute;top:50%;left:50%;width:' + dotSize + 'px;height:' + dotSize + 'px;' +
      'margin-top:' + -Math.round(dotSize / 2) + 'px;margin-left:' + -Math.round(dotSize / 2) + 'px;' +
      'border-radius:50%;' +
      (cellView.lastFrom === 1 ? 'background:#000;' : 'background:#fff;border:1px solid #000;')
    inner.appendChild(el('span', { class: 'k-board__mark', style: fromCss }))
  }
  if (cellView.lastTo !== undefined) {
    const outline = cellView.lastTo === 1
      ? 'box-shadow:inset 0 0 0 2px #000;'
      : 'box-shadow:inset 0 0 0 1px #fff,inset 0 0 0 3px #000;'
    td.setAttribute('style', (td.getAttribute('style') ?? '') + outline)
  }

  // 内容：文字类走文字，其余走图形
  const kind = cellView.kind
  if (TEXT_KINDS[kind] === true && cellView.glyph) {
    const scale = cellView.textScale !== undefined ? cellView.textScale : 0.66
    const fontSize = Math.max(8, Math.round(size * scale))
    const span = el(
      'span',
      { class: 'k-board__glyph', style: 'font-size:' + fontSize + 'px;line-height:' + size + 'px;' },
      cellView.glyph,
    )
    span.setAttribute('aria-hidden', 'true')
    inner.appendChild(span)
  } else {
    const node = glyph(kind, false, cellView.facing, cellView.links)
    if (node !== null) {
      if (node.nodeType === 3) {
        // 兜底的文字符号：按格子的字号渲染
        const span = el(
          'span',
          { class: 'k-board__glyph', style: 'font-size:' + Math.round(size * 0.7) + 'px;line-height:' + size + 'px;' },
        )
        span.appendChild(node)
        span.setAttribute('aria-hidden', 'true')
        inner.appendChild(span)
      } else {
        const box = node as SVGElement
        box.setAttribute('width', '100%')
        box.setAttribute('height', '100%')
        box.setAttribute('style', 'display:block;')
        inner.appendChild(box)
      }
    }
  }

  // 横幅文字（俄罗斯方块消行定格）：允许比格子宽，因此绝对定位锚在这一格上
  if (cellView.banner === true && cellView.glyph) {
    const bannerCss =
      'position:absolute;left:0;top:50%;margin-top:' + -Math.round(size * 0.3) + 'px;' +
      'width:100%;text-align:center;white-space:nowrap;font-size:' + Math.round(size * 0.62) + 'px;' +
      'font-weight:700;pointer-events:none;'
    const banner = el('span', { class: 'k-board__banner', style: bannerCss }, cellView.glyph)
    banner.setAttribute('aria-hidden', 'true')
    inner.appendChild(banner)
  }

  // 填错标记：1px 的叉**覆盖**住数字（黑白屏上不能靠颜色，用形状）
  if (cellView.wrong === true) {
    const cross = el('span', { class: 'k-board__wrong', style: 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;' })
    if (svgSupported()) {
      const node = svg({})
      node.setAttribute('width', '100%')
      node.setAttribute('height', '100%')
      node.appendChild(shape('line', { x1: 4, y1: 4, x2: 20, y2: 20, stroke: '#000', 'stroke-width': 1.6 }))
      node.appendChild(shape('line', { x1: 20, y1: 4, x2: 4, y2: 20, stroke: '#000', 'stroke-width': 1.6 }))
      cross.appendChild(node)
    } else {
      cross.appendChild(el('span', { style: 'font-size:' + Math.round(size * 0.9) + 'px;line-height:' + size + 'px;' }, '×'))
    }
    inner.appendChild(cross)
  }

  td.appendChild(inner)

  if (ctx.onCell) {
    td.addEventListener(
      'click',
      function onClick(): void {
        ctx.onCell(index)
      },
      false,
    )
  }

  return td
}

/** 把 glyphKey 翻成 glyph（与 React 版 localizeBoard 同义）：渲染前必须先过这一道。 */
export function localizeBoard(board: BoardView, t: (key: string) => string): BoardView {
  let needs = false
  for (let i = 0; i < board.cells.length; i++) {
    if (board.cells[i].glyphKey) {
      needs = true
      break
    }
  }
  if (!needs) return board
  const cells: CellView[] = []
  for (let i = 0; i < board.cells.length; i++) {
    const cell = board.cells[i]
    if (cell.glyphKey) {
      const copy: CellView = {
        index: cell.index,
        kind: cell.kind,
        glyph: t(cell.glyphKey),
      }
      if (cell.glyphKey !== undefined) copy.glyphKey = cell.glyphKey
      if (cell.flash !== undefined) copy.flash = cell.flash
      if (cell.banner !== undefined) copy.banner = cell.banner
      if (cell.wrong !== undefined) copy.wrong = cell.wrong
      if (cell.facing !== undefined) copy.facing = cell.facing
      if (cell.links !== undefined) copy.links = cell.links
      if (cell.mergeRight !== undefined) copy.mergeRight = cell.mergeRight
      if (cell.mergeBottom !== undefined) copy.mergeBottom = cell.mergeBottom
      if (cell.disc !== undefined) copy.disc = cell.disc
      if (cell.selected !== undefined) copy.selected = cell.selected
      if (cell.lastFrom !== undefined) copy.lastFrom = cell.lastFrom
      if (cell.lastTo !== undefined) copy.lastTo = cell.lastTo
      if (cell.textScale !== undefined) copy.textScale = cell.textScale
      cells.push(copy)
    } else {
      cells.push(cell)
    }
  }
  const out: BoardView = { kind: 'grid', cols: board.cols, rows: board.rows, cells: cells }
  if (board.groups) out.groups = board.groups
  if (board.rowClues) out.rowClues = board.rowClues
  if (board.colClues) out.colClues = board.colClues
  return out
}
