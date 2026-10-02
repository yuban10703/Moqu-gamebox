/**
 * 数字华容道文案。壳层会把本字典合并进 i18n 运行时；
 * 键前缀与 GameDef.i18nNamespace（'fifteen'）一致。
 *
 * 约定（与核心层一致）：
 * - 代码里不得出现硬编码界面文案，一律通过 key 取；
 * - 复数写成 `__one` / `__other`，中文只提供 `__other`；
 * - 中英「基础 key 集合」必须完全一致（dicts 测试保证）。
 */
import type { Dict } from '@eink/core'

export const fifteenZh: Dict = {
  'fifteen.title': '数字华容道',
  'fifteen.rules.body':
    '把数字块按 1、2、3……的顺序排好，右下角留给空白格。点与空白格相邻的数字块，它就会滑进空白；也可以按方向键，让空白格朝那个方向移动。',
  'fifteen.rules.body2':
    '步数越少越好，撤销可以退回上一次滑动。没有失败状态：排好后还可以继续滑动练习，再排好一次仍会记录更好的成绩。',
  'fifteen.rules.restart': '重新开始会回到同一种子下的初始局面，且无法撤销回重开之前。',
  'fifteen.illegal.notice': '空白格在那个方向已经贴边，走不动',
  'fifteen.difficulty.starter': '入门 3×3',
  'fifteen.difficulty.skilled': '熟练 4×4',
  'fifteen.difficulty.challenging': '挑战 5×5',
  'fifteen.stat.moves': '步数',
  'fifteen.stat.placed': '已归位',
  'fifteen.cell.tile': '数字块',
  'fifteen.cell.empty': '空格',
  'fifteen.dpad.label': '方向控制',
  'fifteen.dir.up': '上',
  'fifteen.dir.down': '下',
  'fifteen.dir.left': '左',
  'fifteen.dir.right': '右',
  'fifteen.won.title': '拼好了',
  'fifteen.result.moves__other': '本局 {count} 步',
  'fifteen.result.tiles__other': '已归位 {count} 块',
  // 壳层用 i18n.t(key, { count }) 取「该难度最佳」，因此基础键必须带 {count}
  'fifteen.solved.best': '该难度最少 {count} 步',
  'fifteen.solved.best__other': '该难度最少 {count} 步',
}

export const fifteenEn: Dict = {
  'fifteen.title': 'Fifteen Puzzle',
  'fifteen.rules.body':
    'Put the tiles back in order 1, 2, 3…, leaving the blank cell in the bottom-right corner. Tap a tile next to the blank and it slides in; you can also press an arrow key to move the blank in that direction.',
  'fifteen.rules.body2':
    'Fewer moves is better, and undo takes back your last slide. There is no losing state: after solving you may keep sliding, and solving again still records a better score.',
  'fifteen.rules.restart':
    'Restarting returns to the opening position for the same seed; you cannot undo back past a restart.',
  'fifteen.illegal.notice': 'The blank cell is against that edge and cannot move',
  'fifteen.difficulty.starter': 'Starter 3×3',
  'fifteen.difficulty.skilled': 'Skilled 4×4',
  'fifteen.difficulty.challenging': 'Challenging 5×5',
  'fifteen.stat.moves': 'Moves',
  'fifteen.stat.placed': 'Placed',
  'fifteen.cell.tile': 'Number tile',
  'fifteen.cell.empty': 'Blank cell',
  'fifteen.dpad.label': 'Direction control',
  'fifteen.dir.up': 'Up',
  'fifteen.dir.down': 'Down',
  'fifteen.dir.left': 'Left',
  'fifteen.dir.right': 'Right',
  'fifteen.won.title': 'Solved',
  'fifteen.result.moves__one': '{count} move in this game',
  'fifteen.result.moves__other': '{count} moves in this game',
  'fifteen.result.tiles__one': '{count} tile placed',
  'fifteen.result.tiles__other': '{count} tiles placed',
  'fifteen.solved.best': 'Best for this difficulty: {count} moves',
  'fifteen.solved.best__one': 'Best for this difficulty: {count} move',
  'fifteen.solved.best__other': 'Best for this difficulty: {count} moves',
}
