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
  ],
  dicts: {
    'zh-CN': { ...coreDictZh, ...sokobanZh, ...sudokuZh, ...minesweeperZh, ...game2048Zh, ...fifteenZh, ...gomokuZh, ...memoryZh, ...lightsoutZh, ...klotskiZh },
    'en-US': { ...coreDictEn, ...sokobanEn, ...sudokuEn, ...minesweeperEn, ...game2048En, ...fifteenEn, ...gomokuEn, ...memoryEn, ...lightsoutEn, ...klotskiEn },
  },
}
