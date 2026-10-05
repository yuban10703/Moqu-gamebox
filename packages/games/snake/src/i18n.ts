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
  /*
   * 玩法说明的**长度预算**（用户要求：再精简、尽量不折叠）：
   * 详情页规则区是 `max-height: 9em`（自身字号 0.9em）≈ **6 行**，超出才出现「阅读全部」。
   * 18px 档每行约 25.6 个汉字，两段合计 ≤ 5 行（≈128 字）就一定能整段显示，
   * 不用点开折叠。改文案时按这个预算加，别把「阅读全部」又惹回来。
   */
  'snake.rules.body':
    '蛇自己往前爬：三档都是 0.7 秒一格。方向键 / 滑动 = 立刻走一格，连点就连走；每次操作后重新计时。',
  'snake.rules.body2':
    '不能原地掉头。入门可穿墙、熟练实心墙、挑战有障碍且吃一个长两节；撞到即结束；填满即胜，「暂停」时不动。',
  // 重开走的是「换一个种子重新摆盘」：食物与障碍都会重新随机
  'snake.rules.restart':
    '重新开始会重新摆一次食物与障碍、并清空撤销记录，无法撤销回重开之前。',
  'snake.stat.score': '分数',
  'snake.stat.length': '蛇长',
  'snake.stat.moves': '步数',
  'snake.dir.up': '上',
  'snake.dir.down': '下',
  'snake.dir.left': '左',
  'snake.dir.right': '右',
  'snake.dpad.label': '方向控制',
  'snake.blocked': '这一步走不通：不能掉头',
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
  // 这里的 goal / flag 分别被本作用作 食物 / 撞上的蛇头（head / segment / tail 与字面同义）
  'snake.cell.wall': '障碍',
  'snake.cell.empty': '空格',
  'snake.cell.head': '蛇头',
  'snake.cell.segment': '蛇身',
  'snake.cell.goal': '食物',
  'snake.cell.flag': '撞上的蛇头',
  'snake.cell.tail': '蛇尾',
}

export const snakeEn: Dict = {
  'snake.title': 'Snake',
  'snake.rules.body':
    'Crawls on its own: 0.7s per cell. Keys or swipes step a cell; each input restarts the clock.',
  'snake.rules.body2':
    'No turning back (that button dims). Starter wraps, Skilled has walls, Challenging adds obstacles; a crash ends the run. Pause freezes it.',
  'snake.rules.restart':
    'Restarting lays out new food and obstacles and clears the undo history; you cannot undo back past a restart.',
  'snake.stat.score': 'Score',
  'snake.stat.length': 'Length',
  'snake.stat.moves': 'Steps',
  'snake.dir.up': 'Up',
  'snake.dir.down': 'Down',
  'snake.dir.left': 'Left',
  'snake.dir.right': 'Right',
  'snake.dpad.label': 'Direction pad',
  'snake.blocked': 'Cannot turn back',
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
  // sokoban and minesweeper); goal / flag are drawn here as food / crashed head
  // (head / segment / tail mean what they say).
  'snake.cell.wall': 'Obstacle',
  'snake.cell.empty': 'Empty cell',
  'snake.cell.head': 'Snake head',
  'snake.cell.segment': 'Snake body',
  'snake.cell.goal': 'Food',
  'snake.cell.flag': 'Crashed snake head',
  'snake.cell.tail': 'Snake tail',
}
