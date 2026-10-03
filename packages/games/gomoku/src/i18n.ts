/**
 * 五子棋文案。壳层会把本字典合并进 i18n 运行时；
 * 键前缀与 GameDef.i18nNamespace（'gomoku'）一致。
 *
 * 约定（与核心层一致）：
 * - 代码里不得出现硬编码界面文案，一律通过 key 取；
 * - 复数写成 `__one` / `__other`，中文只提供 `__other`；
 * - 中英「基础 key 集合」必须完全一致（dicts 测试保证）。
 */
import type { Dict } from '@eink/core'

export const gomokuZh: Dict = {
  'gomoku.title': '五子棋',
  'gomoku.rules.body':
    '点空格落子，你执黑先手。横竖斜任意方向先连成五子即获胜。',
  'gomoku.rules.body2':
    '白方自动应手，无需等待；撤销退回一整回合（你的落子与白方应手一起）。',
  'gomoku.rules.restart': '重新开始会清空当前对局，回到同一种子下的空棋盘，且无法撤销回重开之前。',
  'gomoku.illegal.notice': '这里不能落子',
  'gomoku.difficulty.starter': '入门',
  'gomoku.difficulty.skilled': '熟练',
  'gomoku.difficulty.challenging': '挑战',
  'gomoku.stat.black': '黑子',
  'gomoku.stat.white': '白子',
  'gomoku.stat.moves': '步数',
  'gomoku.cell.tile': '棋子',
  'gomoku.cell.empty': '空格',
  'gomoku.won.title': '你赢了',
  'gomoku.lost.title': '你输了',
  'gomoku.draw.title': '平局',
  'gomoku.result.moves__other': '你共下了 {count} 手',
  'gomoku.result.draw': '棋盘已下满，双方都没有连成五子',
  // 壳层用 i18n.t(key, { count }) 取「该难度最佳」，因此基础键必须带 {count}
  'gomoku.solved.best': '该难度最佳 {count} 步',
  'gomoku.solved.best__other': '该难度最佳 {count} 步',
}

export const gomokuEn: Dict = {
  'gomoku.title': 'Gomoku',
  'gomoku.rules.body':
    'Tap an empty point to place a stone; you are Black and move first. Five in a row wins.',
  'gomoku.rules.body2':
    'White replies automatically in the same move. Undo takes back a whole round.',
  'gomoku.rules.restart':
    'Restarting clears the current game and returns to an empty board for the same seed; you cannot undo back past a restart.',
  'gomoku.illegal.notice': 'That cell cannot be played',
  'gomoku.difficulty.starter': 'Starter',
  'gomoku.difficulty.skilled': 'Skilled',
  'gomoku.difficulty.challenging': 'Challenging',
  'gomoku.stat.black': 'Black',
  'gomoku.stat.white': 'White',
  'gomoku.stat.moves': 'Moves',
  'gomoku.cell.tile': 'Stone',
  'gomoku.cell.empty': 'Empty cell',
  'gomoku.won.title': 'You win',
  'gomoku.lost.title': 'You lose',
  'gomoku.draw.title': 'Draw',
  'gomoku.result.moves__one': 'You played {count} move',
  'gomoku.result.moves__other': 'You played {count} moves',
  'gomoku.result.draw': 'The board is full and neither side connected five',
  'gomoku.solved.best': 'Best for this difficulty: {count} moves',
  'gomoku.solved.best__one': 'Best for this difficulty: {count} move',
  'gomoku.solved.best__other': 'Best for this difficulty: {count} moves',
}
