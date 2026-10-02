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
  ],
  dicts: {
    'zh-CN': { ...coreDictZh, ...sokobanZh },
    'en-US': { ...coreDictEn, ...sokobanEn },
  },
}
