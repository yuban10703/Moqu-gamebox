/**
 * 展示模型：把局面翻译成「与呈现技术无关」的棋盘与控制项描述。
 *
 * 只画**一张棋盘 = 敌方海域**（任务书口径）：
 * - 没打过的格 `kind:'floor'`（留白）；
 * - 打过但没中 `kind:'floor'` + `glyph:'○'` + `textScale 0.55`；
 * - 命中 `kind:'tile'` + `glyph:'✖'` + `textScale 0.6`（实心格 + 叉号，黑白屏一眼可辨）；
 * - **玩家最后一手**的格子 `selected: true`（棋盘画的是敌方海域，所以白方打我方的那一手不在这里高亮）。
 *
 * 自己舰队的受损情况只能从 stats 看：因此统计三项恒定输出
 * 「我方剩余舰格 / 敌方剩余舰格 / 我方已射击数」，数字必须准确。
 */
import type { BoardView, CellKind, CellView, ControlSpec, GameView, StatView } from '@eink/core'
import {
  BOARD_SIZE,
  CELLS,
  ENEMY,
  PLAYER,
  remainingShipCells,
  type BattleshipState,
} from './board.js'
import { gameStatus } from './rules.js'

/** 未中：空心圈；命中：叉号（棋盘符号，不是界面文案） */
export const MISS_GLYPH = '○' // i18n-exempt
export const HIT_GLYPH = '✖' // i18n-exempt
export const MISS_TEXT_SCALE = 0.55
export const HIT_TEXT_SCALE = 0.6

/** 壳层无障碍标签用的 key（apps/web 的约定为 `<namespace>.cell.<kind>`） */
export const CELL_LABEL_KEYS: Partial<Record<CellKind, string>> = {
  floor: 'battleship.cell.floor',
  tile: 'battleship.cell.tile',
}

/** 注册表用：把 kind 映射到文案 key（壳层不硬编码玩法文案） */
export function cellLabelKey(kind: CellKind): string | undefined {
  return CELL_LABEL_KEYS[kind]
}

export function cellKindAt(state: BattleshipState, index: number): CellKind {
  if (!state.playerShots[index]) return 'floor'
  return state.enemyFleet.mask[index] === true ? 'tile' : 'floor'
}

export function cellGlyphAt(state: BattleshipState, index: number): string {
  if (!state.playerShots[index]) return ''
  return state.enemyFleet.mask[index] === true ? HIT_GLYPH : MISS_GLYPH
}

export function buildBoard(state: BattleshipState): BoardView {
  const cells: CellView[] = []
  for (let index = 0; index < CELLS; index++) {
    const hit = state.enemyFleet.mask[index] === true
    const shot = state.playerShots[index] === true
    const kind: CellKind = shot && hit ? 'tile' : 'floor'
    const glyph = shot ? (hit ? HIT_GLYPH : MISS_GLYPH) : ''
    const cell: CellView = { index, kind, glyph }
    if (glyph !== '') cell.textScale = hit ? HIT_TEXT_SCALE : MISS_TEXT_SCALE
    if (index === state.lastPlayerShot) cell.selected = true
    cells.push(cell)
  }
  // 刻意不设 groups：8×8 海域没有分组结构
  return { kind: 'grid', cols: BOARD_SIZE, rows: BOARD_SIZE, cells }
}

/**
 * 控制项：只有撤销。
 * 棋盘点击是唯一的主要输入（selectAction 把「点格子」映射成射击），
 * 重开/菜单由壳层自己渲染（壳层认识这些固定 id），游戏不重复声明。
 */
export function buildControls(state: BattleshipState): ControlSpec[] {
  return [
    {
      id: 'undo',
      labelKey: 'shell.game.undo',
      role: 'action',
      enabled: state.log.length > 0,
      emphasis: 'normal',
    },
  ]
}

export function buildStats(state: BattleshipState): StatView[] {
  // 三项恒定输出：内容出现/消失不会让统计栏高度跳动
  return [
    { labelKey: 'battleship.stat.mine', value: String(remainingShipCells(state, PLAYER)) },
    { labelKey: 'battleship.stat.foe', value: String(remainingShipCells(state, ENEMY)) },
    { labelKey: 'battleship.stat.shots', value: String(state.moves) },
  ]
}

export function buildView(state: BattleshipState): GameView {
  const status = gameStatus(state)
  const details: Array<{ key: string; params?: Record<string, string | number> }> = []
  if (status !== 'playing') {
    const sunk = state.enemyFleet.ships.filter((ship) =>
      ship.cells.every((cell) => state.playerShots[cell]),
    ).length
    // 带 params 的明细由壳层走 plural()，因此这些 key 必须提供复数形式
    details.push({ key: 'battleship.result.sunk', params: { count: sunk } })
    details.push({ key: 'battleship.result.moves', params: { count: state.moves } })
  }
  return {
    board: buildBoard(state),
    stats: buildStats(state),
    result:
      status === 'playing'
        ? null
        : { titleKey: `battleship.${status === 'won' ? 'won' : 'lost'}.title`, details },
    // 没有需要壳层以稳定文字提示的状态：非法点击由壳层按 illegalNoticeKey 显示
    notice: null,
  }
}
