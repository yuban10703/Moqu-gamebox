/**
 * 2048 文案。壳层会把本字典合并进 i18n 运行时；
 * 键前缀与 GameDef.i18nNamespace（'2048'）保持一致 ——
 * 壳层用 `${i18nNamespace}.title` 取标题，也用该名字取游戏库封面字形。
 *
 * 约定（与核心层一致）：
 * - 代码里不得出现硬编码界面文案，一律通过 key 取；
 * - 复数写成 `__one` / `__other`，中文只提供 `__other`；
 * - 中英「基础 key 集合」必须完全一致（dicts 测试保证）。
 */
import type { Dict } from '@eink/core'

export const game2048Zh: Dict = {
  '2048.title': '2048',
  '2048.rules.body':
    '用方向按钮让所有方块朝该方向滑动，两个相同的数字撞在一起会合成两倍大的方块。一次移动里同一个方块只会合并一次。',
  '2048.rules.body2':
    '每次有效移动后会自动出现一个新方块（九成是 2）。合成出目标数字即算完成；棋盘填满且四个方向都滑不动就失败。撤销只能一步一步往回退，重新开始会清空全部进度。也可以滑动棋盘。',
  '2048.rules.restart': '重新开始会清空当前进度并回到该难度的初始局面，且无法撤销回重开之前。',
  '2048.stat.score': '分数',
  '2048.stat.moves': '步数',
  '2048.stat.target': '目标',
  '2048.dir.up': '上',
  '2048.dir.down': '下',
  '2048.dir.left': '左',
  '2048.dir.right': '右',
  '2048.dpad.label': '方向控制',
  '2048.blocked': '这个方向走不通',
  '2048.won.title': '达成目标',
  '2048.lost.title': '无路可走',
  '2048.result.score__other': '得分 {count}',
  '2048.result.moves__other': '用了 {count} 步',
  '2048.solved.best': '该难度最佳 {count} 步',
  '2048.solved.best__other': '该难度最佳 {count} 步',
  // 2048 没有关卡概念；这两个键只是为了让壳层按命名空间取键时不出现缺失占位符
  '2048.level.label': '第 {index} 局',
  '2048.level.position': '第 {index}/{total} 局',
  '2048.difficulty.starter': '入门',
  '2048.difficulty.skilled': '熟练',
  '2048.difficulty.challenging': '挑战',
  '2048.cell.empty': '空格',
  '2048.cell.tile': '数字方块',
}

export const game2048En: Dict = {
  '2048.title': '2048',
  '2048.rules.body':
    'Use the direction buttons to slide every tile that way. Two tiles with the same number merge into one tile of double the value, and a tile can only merge once per move.',
  '2048.rules.body2':
    'After every valid move a new tile appears (nine times out of ten it is a 2). Reach the target number to win; you lose when the board is full and no direction moves anything. Undo steps back one move at a time, and restart clears all progress. You can also swipe the board.',
  '2048.rules.restart':
    'Restarting clears the current progress and returns to a fresh board for this difficulty; you cannot undo back past a restart.',
  '2048.stat.score': 'Score',
  '2048.stat.moves': 'Moves',
  '2048.stat.target': 'Target',
  '2048.dir.up': 'Up',
  '2048.dir.down': 'Down',
  '2048.dir.left': 'Left',
  '2048.dir.right': 'Right',
  '2048.dpad.label': 'Direction pad',
  '2048.blocked': 'That direction is blocked',
  '2048.won.title': 'Target reached',
  '2048.lost.title': 'No moves left',
  '2048.result.score__other': 'Score {count}',
  '2048.result.moves__one': '{count} move',
  '2048.result.moves__other': '{count} moves',
  '2048.solved.best': 'Best for this difficulty: {count}',
  '2048.solved.best__one': 'Best for this difficulty: {count} move',
  '2048.solved.best__other': 'Best for this difficulty: {count} moves',
  // 2048 has no level concept; these two keys only keep the shell's
  // namespace-based key lookup free of missing-key placeholders.
  '2048.level.label': 'Game {index}',
  '2048.level.position': 'Game {index}/{total}',
  '2048.difficulty.starter': 'Starter',
  '2048.difficulty.skilled': 'Skilled',
  '2048.difficulty.challenging': 'Challenging',
  '2048.cell.empty': 'Empty cell',
  '2048.cell.tile': 'Number tile',
}
