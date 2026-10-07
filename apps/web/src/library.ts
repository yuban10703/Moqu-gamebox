/**
 * 游戏库登记表：Web 与 Android 共用同一份。
 * 新增游戏只需在这里加一条（壳层不感知具体游戏）。
 */
import { coreDictEn, coreDictZh } from '@eink/core'
import {
  PACK,
  progressSummary,
  sokobanEn,
  sokobanGame,
  sokobanZh,
} from '@eink/sokoban'
import { game2048, game2048En, game2048Zh } from '@eink/2048'
import { fifteenEn, fifteenGame, fifteenZh } from '@eink/fifteen'
import { gomokuEn, gomokuGame, gomokuZh } from '@eink/gomoku'
import { lightsoutEn, lightsoutGame, lightsoutZh } from '@eink/lightsout'
import {
  PACK as KLOTSKI_PACK,
  klotskiEn,
  klotskiGame,
  klotskiZh,
  packProgress as klotskiProgress,
} from '@eink/klotski'
import { memoryEn, memoryGame, memoryZh } from '@eink/memory'
import { minesweeperEn, minesweeperGame, minesweeperZh } from '@eink/minesweeper'
import { sudokuEn, sudokuGame, sudokuZh } from '@eink/sudoku'
import { snakeEn, snakeGame, snakeZh } from '@eink/snake'
import { tetrisEn, tetrisGame, tetrisZh } from '@eink/tetris'
import { match3En, match3Game, match3Zh } from '@eink/match3'
import { doudizhuEn, doudizhuGame, doudizhuZh } from '@eink/doudizhu'
import { buckshotEn, buckshotGame, buckshotZh } from '@eink/buckshot'
import {
  cellLabelKey as xiangqiCellLabelKey,
  progressFor as xiangqiProgressFor,
  xiangqiEn,
  xiangqiGame,
  xiangqiZh,
} from '@eink/xiangqi'
import { chessEn, chessGame, chessZh, cellLabelKey as chessCellLabelKey, progressFor as chessProgressFor } from '@eink/chess'
import { cellLabelKey as reversiCellLabelKey, progressFor as reversiProgressFor, reversiEn, reversiGame, reversiZh } from '@eink/reversi'
import { defineGame, type GameLibrary } from '@eink/ui'

export const library: GameLibrary = {
  entries: [
    defineGame({
      game: klotskiGame,
      hideDifficulty: true,
      cellLabelKey: (kind) => `klotski.cell.${kind}`,
      rulesKeys: ['klotski.rules.body', 'klotski.rules.body2'],
      defaultDifficulty: 'starter',
      levels: KLOTSKI_PACK.map((level) => ({ id: level.def.id })),
      progressFor: klotskiProgress,
      indexOfLevel: (levelId) => {
        const index = KLOTSKI_PACK.findIndex((level) => level.def.id === levelId)
        return index >= 0 ? index : 0
      },
    }),
    defineGame({
      game: sokobanGame,
      hideDifficulty: true,
      cellLabelKey: (kind) => `sokoban.cell.${kind}`,
      rulesKeys: ['sokoban.rules.body', 'sokoban.rules.body2'],
      defaultDifficulty: 'starter',
      levels: PACK.map((level) => ({ id: level.def.id })),
      progressFor: (completed) => {
        const summary = progressSummary(completed)
        return { done: summary.done, total: summary.total }
      },
      indexOfLevel: (levelId) => {
        const index = PACK.findIndex((level) => level.def.id === levelId)
        return index >= 0 ? index : 0
      },
    }),
    defineGame({
      game: sudokuGame,
      // 数独不提供撤销 → 不渲染那个按钮（否则是个永远点不动的假按钮）
      hideShellControls: ['undo'],
      // 数独没有 cell.* 字典键 → 不设 cellLabelKey，无障碍标签回退到格子自身符号（数字）
      rulesKeys: ['sudoku.rules.body'],
      defaultDifficulty: 'starter',
      // 无关卡制：进度按「已通关难度 / 总难度」算
      progressFor: (completed) => ({
        done: sudokuGame.difficulties.filter((item) => completed.includes(item.id)).length,
        total: sudokuGame.difficulties.length,
      }),
    }),
    defineGame({
      game: minesweeperGame,
      cellLabelKey: (kind) => `minesweeper.cell.${kind}`,
      rulesKeys: ['minesweeper.rules.body'],
      defaultDifficulty: 'starter',
      progressFor: (completed) => ({
        done: minesweeperGame.difficulties.filter((item) => completed.includes(item.id)).length,
        total: minesweeperGame.difficulties.length,
      }),
    }),
    defineGame({
      game: lightsoutGame,
      cellLabelKey: (kind) => `lightsout.cell.${kind}`,
      rulesKeys: ['lightsout.rules.body', 'lightsout.rules.body2'],
      defaultDifficulty: 'starter',
      progressFor: (completed) => ({
        done: lightsoutGame.difficulties.filter((item) => completed.includes(item.id)).length,
        total: lightsoutGame.difficulties.length,
      }),
    }),
    defineGame({
      game: memoryGame,
      cellLabelKey: (kind) => `memory.cell.${kind}`,
      rulesKeys: ['memory.rules.body', 'memory.rules.body2'],
      defaultDifficulty: 'starter',
      progressFor: (completed) => ({
        done: memoryGame.difficulties.filter((item) => completed.includes(item.id)).length,
        total: memoryGame.difficulties.length,
      }),
    }),
    defineGame({
      game: gomokuGame,
      cellLabelKey: (kind) => `gomoku.cell.${kind}`,
      rulesKeys: ['gomoku.rules.body', 'gomoku.rules.body2'],
      defaultDifficulty: 'starter',
      progressFor: (completed) => ({
        done: gomokuGame.difficulties.filter((item) => completed.includes(item.id)).length,
        total: gomokuGame.difficulties.length,
      }),
    }),
    defineGame({
      game: fifteenGame,
      // 点方块就能滑动，方向键只是重复入口：默认收起，让棋盘直接长到宽度上限（暂停菜单里可重新打开）
      dpadDefault: false,
      cellLabelKey: (kind) => `fifteen.cell.${kind}`,
      rulesKeys: ['fifteen.rules.body'],
      defaultDifficulty: 'starter',
      progressFor: (completed) => ({
        done: fifteenGame.difficulties.filter((item) => completed.includes(item.id)).length,
        total: fifteenGame.difficulties.length,
      }),
    }),
    defineGame({
      game: game2048,
      cellLabelKey: (kind) => `2048.cell.${kind}`,
      rulesKeys: ['2048.rules.body'],
      defaultDifficulty: 'starter',
      // 刻意不传 levels：2048 没有关卡制，传了标题会变成「2048 · 第 1/3 局」这种关卡化措辞。
      // 进度按「已通关难度 / 总难度」算。
      progressFor: (completed) => ({
        done: game2048.difficulties.filter((item) => completed.includes(item.id)).length,
        total: game2048.difficulties.length,
      }),
    }),
    defineGame({
      game: snakeGame,
      cellLabelKey: (kind) => `snake.cell.${kind}`,
      rulesKeys: ['snake.rules.body', 'snake.rules.body2'],
      defaultDifficulty: 'starter',
      progressFor: (completed) => ({
        done: snakeGame.difficulties.filter((item) => completed.includes(item.id)).length,
        total: snakeGame.difficulties.length,
      }),
    }),
    defineGame({
      game: tetrisGame,
      // 上 = 旋转、下 = 下落一格，十字摆法没有空间对应：四键平铺成一行，省下的高度给棋盘
      dpadLayout: 'row',
      cellLabelKey: (kind) => `tetris.cell.${kind}`,
      // 只列两段：详情页规则区约 6 行就折叠（出现「阅读全部」），
      // 第三段「每档井深/预堆」（tetris.rules.difficulty）已不在这里列出 ——
      // 用户要求说明尽量不折叠；难度名与各档间隔都在上面两段正文里。
      rulesKeys: ['tetris.rules.body', 'tetris.rules.body2'],
      defaultDifficulty: 'starter',
      // 无关卡：不传 levels（否则标题变成「· 第 1/3 局」）；本作没有胜利条件，也不传 progressFor
    }),
    defineGame({
      game: match3Game,
      cellLabelKey: (kind) => `match3.cell.${kind}`,
      rulesKeys: ['match3.rules.body', 'match3.rules.body2', 'match3.rules.body3'],
      defaultDifficulty: 'starter',
      // 无关卡：内容 id 就是难度档，进度按「已通关难度 / 3」算（包内 progressFor 的口径）
      progressFor: (completed) => ({
        done: match3Game.difficulties.filter((item) => completed.includes(item.id)).length,
        total: match3Game.difficulties.length,
      }),
    }),
    defineGame({
      game: doudizhuGame,
      // 撤销等于看过牌再重来：本作不提供撤销，壳层的撤销按钮直接不渲染
      hideShellControls: ['undo'],
      rulesKeys: ['doudizhu.rules.body', 'doudizhu.rules.body2'],
      defaultDifficulty: 'starter',
      // 无关卡：每副牌是一「局」，进度按「赢过的难度 / 3」算
      progressFor: (completed) => ({
        done: doudizhuGame.difficulties.filter((item) => completed.includes(item.id)).length,
        total: doudizhuGame.difficulties.length,
      }),
    }),
    defineGame({
      game: buckshotGame,
      // 不提供撤销；「重新开始」也不放在对局底部（屏幕留给道具与弹仓），暂停菜单与结果面板里仍可重开
      hideShellControls: ['undo', 'restart'],
      rulesKeys: ['buckshot.rules.body', 'buckshot.rules.body2', 'buckshot.rules.body3'],
      defaultDifficulty: 'starter',
      // 「难度」区也是模式选择：前三档对恶魔，第四档「双人同屏」
      progressFor: (completed) => ({
        done: ['starter', 'skilled', 'challenging'].filter((id) => completed.includes(id)).length,
        total: 3,
      }),
    }),
    defineGame({
      game: xiangqiGame,
      // 包自己导出的 kind → 字典键映射（与其它游戏内联写 lambda 等价）
      cellLabelKey: xiangqiCellLabelKey,
      rulesKeys: ['xiangqi.rules.body', 'xiangqi.rules.body2', 'xiangqi.rules.body3'],
      defaultDifficulty: 'starter',
      progressFor: xiangqiProgressFor,
    }),
    defineGame({
      game: chessGame,
      cellLabelKey: chessCellLabelKey,
      rulesKeys: ['chess.rules.body', 'chess.rules.body2', 'chess.rules.body3'],
      defaultDifficulty: 'starter',
      progressFor: chessProgressFor,
    }),
    defineGame({
      game: reversiGame,
      cellLabelKey: reversiCellLabelKey,
      rulesKeys: ['reversi.rules.body', 'reversi.rules.body2'],
      defaultDifficulty: 'starter',
      progressFor: reversiProgressFor,
    }),
  ],
  dicts: {
    'zh-CN': { ...coreDictZh, ...sokobanZh, ...sudokuZh, ...minesweeperZh, ...game2048Zh, ...fifteenZh, ...gomokuZh, ...memoryZh, ...lightsoutZh, ...klotskiZh, ...snakeZh, ...tetrisZh, ...match3Zh, ...doudizhuZh, ...buckshotZh, ...xiangqiZh, ...chessZh, ...reversiZh },
    'en-US': { ...coreDictEn, ...sokobanEn, ...sudokuEn, ...minesweeperEn, ...game2048En, ...fifteenEn, ...gomokuEn, ...memoryEn, ...lightsoutEn, ...klotskiEn, ...snakeEn, ...tetrisEn, ...match3En, ...doudizhuEn, ...buckshotEn, ...xiangqiEn, ...chessEn, ...reversiEn },
  },
}
