/**
 * 四子棋文案。壳层会把本字典合并进 i18n 运行时；
 * 键前缀与 GameDef.i18nNamespace（'connect4'）一致。
 *
 * 约定（与核心层一致）：
 * - 代码里不得出现硬编码界面文案，一律通过 key 取；
 * - 复数写成 `__one` / `__other`，中文只提供 `__other`；
 * - 中英「基础 key 集合」必须完全一致（dicts 测试保证）。
 */
import type { Dict } from '@eink/core'

export const connect4Zh: Dict = {
  'connect4.title': '四子棋',
  'connect4.rules.body':
    '点击任意一列落子：你是黑方，先手，棋子会落到该列最低的空格。横、竖、两条斜线任意一个方向先连成四子即获胜；棋盘下满仍无人成四则为平局。',
  'connect4.rules.body2':
    '白方由规则层自动应手：你每落一手，白方立刻回应，因此不需要等待对手。每个还能落子的列会在最低空格上显示一个小点；撤销会退回一整回合（你的落子与白方的应手一起退回）。',
  'connect4.rules.restart':
    '重新开始会清空当前对局，回到同一种子下的空棋盘，且无法撤销回重开之前。',
  'connect4.illegal.notice': '这一列已经满了',
  'connect4.difficulty.starter': '入门',
  'connect4.difficulty.skilled': '熟练',
  'connect4.difficulty.challenging': '挑战',
  'connect4.stat.black': '黑子',
  'connect4.stat.white': '白子',
  'connect4.stat.moves': '步数',
  'connect4.cell.tile': '棋子',
  'connect4.cell.empty': '空格',
  'connect4.cell.number': '可落子位置',
  'connect4.won.title': '你赢了',
  'connect4.lost.title': '你输了',
  'connect4.draw.title': '平局',
  'connect4.result.moves__other': '你共下了 {count} 手',
  'connect4.result.draw': '棋盘已下满，双方都没有连成四子',
  // 壳层用 i18n.t(key, { count }) 取「该难度最佳」，因此基础键必须带 {count}
  'connect4.solved.best': '该难度最佳 {count} 步',
  'connect4.solved.best__other': '该难度最佳 {count} 步',
}

export const connect4En: Dict = {
  'connect4.title': 'Connect Four',
  'connect4.rules.body':
    'Tap any column to drop a stone: you play black and move first, and the stone falls to the lowest empty cell of that column. Connect four stones in a row horizontally, vertically or diagonally to win; a full board with no four in a row is a draw.',
  'connect4.rules.body2':
    'White answers automatically: after every move of yours the reply is played at once, so there is nothing to wait for. Every playable column shows a small dot on its lowest empty cell. Undo takes back a whole turn (your drop and the white reply).',
  'connect4.rules.restart':
    'Restarting clears the current game and returns to an empty board for the same seed; you cannot undo back past a restart.',
  'connect4.illegal.notice': 'That column is full',
  'connect4.difficulty.starter': 'Starter',
  'connect4.difficulty.skilled': 'Skilled',
  'connect4.difficulty.challenging': 'Challenging',
  'connect4.stat.black': 'Black',
  'connect4.stat.white': 'White',
  'connect4.stat.moves': 'Moves',
  'connect4.cell.tile': 'Stone',
  'connect4.cell.empty': 'Empty cell',
  'connect4.cell.number': 'Playable cell',
  'connect4.won.title': 'You win',
  'connect4.lost.title': 'You lose',
  'connect4.draw.title': 'Draw',
  'connect4.result.moves__one': 'You played {count} move',
  'connect4.result.moves__other': 'You played {count} moves',
  'connect4.result.draw': 'The board is full and neither side connected four',
  'connect4.solved.best': 'Best for this difficulty: {count} moves',
  'connect4.solved.best__one': 'Best for this difficulty: {count} move',
  'connect4.solved.best__other': 'Best for this difficulty: {count} moves',
}
