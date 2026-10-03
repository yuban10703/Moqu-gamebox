/**
 * 迷宫文案。壳层会把本字典合并进 i18n 运行时；
 * 键前缀与 GameDef.i18nNamespace（'maze'）一致。
 *
 * 约定（与核心层一致）：
 * - 代码里不得出现硬编码界面文案，一律通过 key 取；
 * - 复数写成 `__one` / `__other`，中文只提供 `__other`；
 * - 中英「基础 key 集合」必须完全一致（dicts 测试保证）。
 */
import type { Dict } from '@eink/core'

export const mazeZh: Dict = {
  'maze.title': '迷宫',
  'maze.rules.body':
    '从左上角走到右下角的出口。按方向键让角色朝那个方向走一格；那一边是墙就走不过去，会有文字提示。也可以直接点相邻的通路格。',
  'maze.rules.body2':
    '走过的格子会留下小点，方便回头看走过的路。每座迷宫都是按种子随机生成的完美迷宫：任意两格之间恰有一条通路，不会绕圈子。撤销可以退回上一步。',
  'maze.rules.restart': '重新开始会回到同一种子下的同一座迷宫，且无法撤销回重开之前。',
  'maze.illegal.notice': '那边是墙，走不过去',
  'maze.difficulty.starter': '入门 11×11',
  'maze.difficulty.skilled': '熟练 15×15',
  'maze.difficulty.challenging': '挑战 21×21',
  'maze.stat.moves': '步数',
  'maze.stat.explored': '已探索',
  'maze.cell.wall': '墙',
  'maze.cell.floor': '通路',
  'maze.cell.player': '你',
  'maze.cell.goal': '出口',
  'maze.dpad.label': '方向控制',
  'maze.dir.up': '上',
  'maze.dir.down': '下',
  'maze.dir.left': '左',
  'maze.dir.right': '右',
  'maze.won.title': '走出迷宫',
  'maze.result.moves__other': '本局 {count} 步',
  'maze.result.explored__other': '走过 {count} 格',
  // 壳层用 i18n.t(key, { count }) 取「该难度最佳」，因此基础键必须带 {count}
  'maze.solved.best': '该难度最少 {count} 步',
  'maze.solved.best__other': '该难度最少 {count} 步',
}

export const mazeEn: Dict = {
  'maze.title': 'Maze',
  'maze.rules.body':
    'Walk from the top-left corner to the exit in the bottom-right. Press an arrow key to step that way; if that side is a wall you cannot pass and a short message appears. You can also tap an adjacent open cell.',
  'maze.rules.body2':
    'Cells you have walked leave a small dot so you can retrace your route. Every maze is a perfect maze generated from the seed: exactly one path connects any two cells, so you can never loop. Undo takes back your last step.',
  'maze.rules.restart':
    'Restarting returns to the same maze for the same seed; you cannot undo back past a restart.',
  'maze.illegal.notice': 'That side is a wall — you cannot walk through',
  'maze.difficulty.starter': 'Starter 11×11',
  'maze.difficulty.skilled': 'Skilled 15×15',
  'maze.difficulty.challenging': 'Challenging 21×21',
  'maze.stat.moves': 'Moves',
  'maze.stat.explored': 'Explored',
  'maze.cell.wall': 'Wall',
  'maze.cell.floor': 'Open cell',
  'maze.cell.player': 'You',
  'maze.cell.goal': 'Exit',
  'maze.dpad.label': 'Direction control',
  'maze.dir.up': 'Up',
  'maze.dir.down': 'Down',
  'maze.dir.left': 'Left',
  'maze.dir.right': 'Right',
  'maze.won.title': 'Maze solved',
  'maze.result.moves__one': '{count} move in this game',
  'maze.result.moves__other': '{count} moves in this game',
  'maze.result.explored__one': '{count} cell explored',
  'maze.result.explored__other': '{count} cells explored',
  'maze.solved.best': 'Best for this difficulty: {count} moves',
  'maze.solved.best__one': 'Best for this difficulty: {count} move',
  'maze.solved.best__other': 'Best for this difficulty: {count} moves',
}
