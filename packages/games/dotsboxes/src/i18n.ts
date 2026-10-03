/**
 * 点格棋文案。壳层会把本字典合并进 i18n 运行时；
 * 键前缀与 GameDef.i18nNamespace（'dotsboxes'）一致。
 *
 * 约定（与核心层一致）：
 * - 代码里不得出现硬编码界面文案，一律通过 key 取；
 * - 复数写成 `__one` / `__other`，中文只提供 `__other`；
 * - 中英「基础 key 集合」必须完全一致（dicts 测试保证）。
 */
import type { Dict } from '@eink/core'

export const dotsboxesZh: Dict = {
  'dotsboxes.title': '点格棋',
  'dotsboxes.rules.body':
    '点两个点之间的空格就能画一条线（横线或竖线）。谁把某个小方格的第四条边补上，这个方格就归谁，而且可以立刻再画一条。',
  'dotsboxes.rules.body2':
    '棋盘上的线画满后对局结束，占方格多的一方获胜，一样多就是平局。注意别把方格画成「只差一条边」送给对方。撤销会退回一整回合（你的连走与对方的应手一起退回）。',
  'dotsboxes.rules.restart': '重新开始会清空当前对局，回到同一种子下的空棋盘，且无法撤销回重开之前。',
  'dotsboxes.illegal.notice': '这里不能画线（只能画没画过的边）',
  'dotsboxes.difficulty.starter': '入门 3×3',
  'dotsboxes.difficulty.skilled': '熟练 4×4',
  'dotsboxes.difficulty.challenging': '挑战 5×5',
  'dotsboxes.stat.black': '黑方格',
  'dotsboxes.stat.white': '白方格',
  'dotsboxes.stat.remaining': '剩余边',
  'dotsboxes.cell.wall': '交叉点',
  'dotsboxes.cell.empty': '空格',
  'dotsboxes.cell.floor': '未画的线',
  'dotsboxes.cell.tile': '已画线/已占领格',
  'dotsboxes.won.title': '你赢了',
  'dotsboxes.lost.title': '你输了',
  'dotsboxes.draw.title': '平局',
  'dotsboxes.result.black__other': '黑方格 {count}',
  'dotsboxes.result.white__other': '白方格 {count}',
  // 壳层用 i18n.t(key, { count }) 取「该难度最佳」，因此基础键必须带 {count}
  'dotsboxes.solved.best': '该难度最佳 {count} 步',
  'dotsboxes.solved.best__other': '该难度最佳 {count} 步',
}

export const dotsboxesEn: Dict = {
  'dotsboxes.title': 'Dots and Boxes',
  'dotsboxes.rules.body':
    'Tap an empty space between two dots to draw that line (horizontal or vertical). Whoever draws the fourth side of a small box wins that box, and may immediately draw again.',
  'dotsboxes.rules.body2':
    'The game ends when every line is drawn: most boxes wins, an equal number is a draw. Be careful not to leave a box one line short for your opponent to take. Undo takes back a whole turn (your chain of moves and the reply).',
  'dotsboxes.rules.restart':
    'Restarting clears the current game and returns to the empty board for the same seed; you cannot undo back past a restart.',
  'dotsboxes.illegal.notice': 'You can only draw a line that is still empty',
  'dotsboxes.difficulty.starter': 'Starter 3×3',
  'dotsboxes.difficulty.skilled': 'Skilled 4×4',
  'dotsboxes.difficulty.challenging': 'Challenging 5×5',
  'dotsboxes.stat.black': 'Black boxes',
  'dotsboxes.stat.white': 'White boxes',
  'dotsboxes.stat.remaining': 'Lines left',
  'dotsboxes.cell.wall': 'Dot',
  'dotsboxes.cell.empty': 'Empty box',
  'dotsboxes.cell.floor': 'Undrawn line',
  'dotsboxes.cell.tile': 'Drawn line / claimed box',
  'dotsboxes.won.title': 'You win',
  'dotsboxes.lost.title': 'You lose',
  'dotsboxes.draw.title': 'Draw',
  'dotsboxes.result.black__one': '{count} black box',
  'dotsboxes.result.black__other': '{count} black boxes',
  'dotsboxes.result.white__one': '{count} white box',
  'dotsboxes.result.white__other': '{count} white boxes',
  'dotsboxes.solved.best': 'Best for this difficulty: {count} moves',
  'dotsboxes.solved.best__one': 'Best for this difficulty: {count} move',
  'dotsboxes.solved.best__other': 'Best for this difficulty: {count} moves',
}
