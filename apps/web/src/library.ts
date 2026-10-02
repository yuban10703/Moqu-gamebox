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
import { connect4En, connect4Game, connect4Zh } from '@eink/connect4'
import { memoryEn, memoryGame, memoryZh } from '@eink/memory'
import { reversiEn, reversiGame, reversiZh } from '@eink/reversi'
import { minesweeperEn, minesweeperGame, minesweeperZh } from '@eink/minesweeper'
import { sudokuEn, sudokuGame, sudokuZh } from '@eink/sudoku'
import { defineGame, type GameLibrary } from '@eink/ui'

export const library: GameLibrary = {
  entries: [
    defineGame({
      game: sokobanGame,
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
      game: connect4Game,
      cellLabelKey: (kind) => `connect4.cell.${kind}`,
      rulesKeys: ['connect4.rules.body', 'connect4.rules.body2'],
      defaultDifficulty: 'starter',
      progressFor: (completed) => ({
        done: connect4Game.difficulties.filter((item) => completed.includes(item.id)).length,
        total: connect4Game.difficulties.length,
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
      game: reversiGame,
      cellLabelKey: (kind) => `reversi.cell.${kind}`,
      rulesKeys: ['reversi.rules.body', 'reversi.rules.body2'],
      defaultDifficulty: 'starter',
      progressFor: (completed) => ({
        done: reversiGame.difficulties.filter((item) => completed.includes(item.id)).length,
        total: reversiGame.difficulties.length,
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
    'zh-CN': { ...coreDictZh, ...sokobanZh, ...sudokuZh, ...minesweeperZh, ...game2048Zh, ...reversiZh, ...fifteenZh, ...gomokuZh, ...memoryZh, ...connect4Zh },
    'en-US': { ...coreDictEn, ...sokobanEn, ...sudokuEn, ...minesweeperEn, ...game2048En, ...reversiEn, ...fifteenEn, ...gomokuEn, ...memoryEn, ...connect4En },
  },
}
