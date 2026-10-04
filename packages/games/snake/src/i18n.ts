/**
 * 贪吃蛇文案。壳层会把本字典合并进 i18n 运行时；
 * 键前缀与 GameDef.i18nNamespace（'snake'）保持一致 ——
 * 壳层用 `${i18nNamespace}.title` 取标题，也用该名字取首页图标。
 *
 * 约定（与核心层一致）：
 * - 代码里不得出现硬编码界面文案，一律通过 key 取；
 * - 复数写成 `__one` / `__other`，中文只提供 `__other`；
 * - 中英「基础 key 集合」必须完全一致（dicts 测试保证）。
 */
import type { Dict } from '@eink/core'

/**
 * 首页方块用的单字字形（供只显示单字的入口使用）。
 * 放在 i18n.ts 是因为这里允许出现中文：check-i18n 会跳过字典文件，
 * 其余源码文件里出现中文字面量会被当成硬编码文案拦下。
 */
export const snakeGlyph = '蛇'

export const snakeZh: Dict = {
  'snake.title': '贪吃蛇',
  'snake.rules.body':
    '蛇自己往前爬：三档都是 0.5 秒一格（难度差异在规则，不在手速）。点方向键 / 方向盘 / 滑动 = 立刻朝那个方向走一格，连点就连走；每次操作后重新计时，刚点完不会又自己走一格。',
  'snake.rules.body2':
    '不能原地掉头（按钮会变暗）。入门可穿墙；熟练是实心墙；挑战还有障碍，且吃一个食物长两节。撞墙 / 障碍 / 自己身体当场结束（这一步算你的操作，可撤销）；填满棋盘即取胜；「暂停」时棋盘完全不动。',
  'snake.rules.restart':
    '重新开始会回到同一种子的初始局面并清空撤销记录，无法撤销回重开之前。',
  'snake.stat.score': '分数',
  'snake.stat.length': '蛇长',
  'snake.stat.moves': '步数',
  'snake.dir.up': '上',
  'snake.dir.down': '下',
  'snake.dir.left': '左',
  'snake.dir.right': '右',
  'snake.dpad.label': '方向控制',
  'snake.blocked': '这一步走不通（不能原地掉头，或本局已经结束）',
  'snake.won.title': '填满棋盘',
  'snake.lost.title': '撞上了',
  'snake.result.score__other': '吃到 {count} 个食物',
  'snake.result.length__other': '蛇长 {count}',
  'snake.result.moves__other': '走了 {count} 步',
  'snake.solved.best': '该难度最佳 {count} 步',
  'snake.solved.best__other': '该难度最佳 {count} 步',
  // 本作没有关卡；这两个键只是为了让壳层按命名空间取键时不出现缺失占位符
  'snake.level.label': '第 {index} 局',
  'snake.level.position': '第 {index}/{total} 局',
  'snake.difficulty.starter': '入门（可穿墙）',
  'snake.difficulty.skilled': '熟练（实心墙）',
  'snake.difficulty.challenging': '挑战（障碍 + 长两节）',
  // 格子标签的 key 一律是 `<命名空间>.cell.<壳层的 CellKind>`（与推箱子、扫雷同约定）：
  // 这里的 mine / box / goal / flag 分别被本作用作 蛇头 / 蛇身 / 食物 / 撞上的蛇头
  'snake.cell.wall': '障碍',
  'snake.cell.empty': '空格',
  'snake.cell.mine': '蛇头',
  'snake.cell.box': '蛇身',
  'snake.cell.goal': '食物',
  'snake.cell.flag': '撞上的蛇头',
}

export const snakeEn: Dict = {
  'snake.title': 'Snake',
  'snake.rules.body':
    'The snake crawls on its own: 0.5s per cell on every difficulty (difficulty changes the rules, not the speed). A direction key, the pad or a swipe moves it one cell that way at once - tap again to keep going, and every input restarts the clock.',
  'snake.rules.body2':
    'It cannot turn back on itself (that button is dimmed). Starter wraps at the edges, Skilled has solid walls, Challenging adds obstacles and two extra segments per meal. Hitting a wall, an obstacle or itself ends the run at once - that step counts as your input, so Undo takes it back. Fill the board to win; Pause freezes everything.',
  'snake.rules.restart':
    'Restarting returns to the opening position for the same seed and clears the undo history; you cannot undo back past a restart.',
  'snake.stat.score': 'Score',
  'snake.stat.length': 'Length',
  'snake.stat.moves': 'Steps',
  'snake.dir.up': 'Up',
  'snake.dir.down': 'Down',
  'snake.dir.left': 'Left',
  'snake.dir.right': 'Right',
  'snake.dpad.label': 'Direction pad',
  'snake.blocked': 'That move is not available (no turning back, or the run is over)',
  'snake.won.title': 'Board filled',
  'snake.lost.title': 'Crashed',
  'snake.result.score__other': 'Ate {count} pieces of food',
  'snake.result.length__other': 'Length {count}',
  'snake.result.moves__one': '{count} step',
  'snake.result.moves__other': '{count} steps',
  'snake.solved.best': 'Best for this difficulty: {count}',
  'snake.solved.best__one': 'Best for this difficulty: {count} step',
  'snake.solved.best__other': 'Best for this difficulty: {count} steps',
  // No levels in this game; these two keys only keep the shell's
  // namespace-based key lookup free of missing-key placeholders.
  'snake.level.label': 'Game {index}',
  'snake.level.position': 'Game {index}/{total}',
  'snake.difficulty.starter': 'Starter (wraps)',
  'snake.difficulty.skilled': 'Skilled (solid walls)',
  'snake.difficulty.challenging': 'Challenging (obstacles + 2 per meal)',
  // Cell label keys are always `<namespace>.cell.<CellKind>` (same convention as
  // sokoban and minesweeper); mine / box / goal / flag are drawn here as
  // snake head / body / food / crashed head.
  'snake.cell.wall': 'Obstacle',
  'snake.cell.empty': 'Empty cell',
  'snake.cell.mine': 'Snake head',
  'snake.cell.box': 'Snake body',
  'snake.cell.goal': 'Food',
  'snake.cell.flag': 'Crashed snake head',
}
