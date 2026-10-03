/**
 * 骑士巡游文案。壳层会把本字典合并进 i18n 运行时；
 * 键前缀与 GameDef.i18nNamespace（'knightstour'）一致。
 *
 * 约定（与核心层一致）：
 * - 代码里不得出现硬编码界面文案，一律通过 key 取；
 * - 复数写成 `__one` / `__other`，中文只提供 `__other`；
 * - 中英「基础 key 集合」必须完全一致（dicts 测试保证）。
 */
import type { Dict } from '@eink/core'

export const knightstourZh: Dict = {
  'knightstour.title': '骑士巡游',
  'knightstour.rules.body':
    '马走日字：从起点开始，每一步都要跳到「日」字对角、且还没有走过的格子。把棋盘上 64 格全部走一遍就完成巡游。',
  'knightstour.rules.body2':
    '带小点的格子是已经走过的路，当前可以跳的格子会用更小的点标出（直接点它就能跳过去）。走进死路不用怕：撤销上一步，或者重新开始。入门难度可以打开提示，★ 是推荐的下一跳。',
  'knightstour.rules.restart': '重新开始会回到同一种子决定的起点，且无法撤销回重开之前。',
  'knightstour.illegal.notice': '那里不是合法的马步',
  'knightstour.difficulty.starter': '入门（从角落出发，可开提示）',
  'knightstour.difficulty.skilled': '熟练（从边线出发）',
  'knightstour.difficulty.challenging': '挑战（从中央出发）',
  'knightstour.stat.moves': '步数',
  'knightstour.stat.visited': '已访问',
  'knightstour.stat.start': '起点',
  'knightstour.cell.floor': '未访问格',
  'knightstour.cell.player': '马',
  'knightstour.cell.goal': '起点',
  'knightstour.cell.number': '可跳落点',
  'knightstour.control.hint.on': '提示 开',
  'knightstour.control.hint.off': '提示 关',
  'knightstour.notice.hint': '提示已开启：★ 是推荐的下一跳',
  'knightstour.won.title': '巡游完成',
  'knightstour.result.moves__other': '本局 {count} 步',
  'knightstour.result.visited__other': '走遍 {count} 格',
  // 壳层用 i18n.t(key, { count }) 取「该难度最佳」，因此基础键必须带 {count}
  'knightstour.solved.best': '该难度最少 {count} 步',
  'knightstour.solved.best__other': '该难度最少 {count} 步',
}

export const knightstourEn: Dict = {
  'knightstour.title': 'Knight’s Tour',
  'knightstour.rules.body':
    'A knight moves in an L: from the starting square, every move must land two squares one way and one square the other, on a square you have not visited yet. Visit all 64 squares to complete the tour.',
  'knightstour.rules.body2':
    'Squares with a small dot are the path already travelled; the squares you may jump to now are marked with a smaller dot (tap one to jump). If you run into a dead end, undo the last move or restart. The starter difficulty offers a hint toggle: ★ marks the recommended next jump.',
  'knightstour.rules.restart':
    'Restarting returns to the starting square chosen by the same seed; you cannot undo back past a restart.',
  'knightstour.illegal.notice': 'That is not a legal knight move',
  'knightstour.difficulty.starter': 'Starter (corner start, hint available)',
  'knightstour.difficulty.skilled': 'Skilled (edge start)',
  'knightstour.difficulty.challenging': 'Challenging (centre start)',
  'knightstour.stat.moves': 'Moves',
  'knightstour.stat.visited': 'Visited',
  'knightstour.stat.start': 'Start',
  'knightstour.cell.floor': 'Unvisited square',
  'knightstour.cell.player': 'Knight',
  'knightstour.cell.goal': 'Start square',
  'knightstour.cell.number': 'Possible jump',
  'knightstour.control.hint.on': 'Hint on',
  'knightstour.control.hint.off': 'Hint off',
  'knightstour.notice.hint': 'Hint is on: ★ is the recommended next jump',
  'knightstour.won.title': 'Tour complete',
  'knightstour.result.moves__one': '{count} move in this game',
  'knightstour.result.moves__other': '{count} moves in this game',
  'knightstour.result.visited__one': '{count} square visited',
  'knightstour.result.visited__other': '{count} squares visited',
  'knightstour.solved.best': 'Best for this difficulty: {count} moves',
  'knightstour.solved.best__one': 'Best for this difficulty: {count} move',
  'knightstour.solved.best__other': 'Best for this difficulty: {count} moves',
}
