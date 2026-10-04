/**
 * 华容道文案。壳层会把本字典合并进 i18n 运行时；
 * 键前缀与 GameDef.i18nNamespace（'klotski'）一致。
 *
 * 约定（与核心层一致）：
 * - 代码里不得出现硬编码界面文案，一律通过 key 取；
 * - 复数写成 `__one` / `__other`，中文只提供 `__other`；
 * - 中英「基础 key 集合」必须完全一致（dicts 测试保证）。
 */
import type { Dict } from '@eink/core'

export const klotskiZh: Dict = {
  'klotski.title': '华容道',
  'klotski.rules.body':
    '先点棋子选中，再点旁边的空格滑一格。把曹操（2×2）挪到最下方出口。',
  'klotski.rules.body2':
    '棋子不能重叠或滑出棋盘。撤销退回上一步，重开回到初始摆法。',
  'klotski.rules.restart': '重新开始会回到本关的初始摆法，且无法撤销回重开之前。',
  'klotski.illegal.notice': '这一步滑不过去',
  'klotski.difficulty.starter': '入门',
  'klotski.difficulty.skilled': '熟练',
  'klotski.difficulty.challenging': '挑战',
  'klotski.progress.notSolved': '未过关',
  'klotski.level.label': '第 {index} 关',
  'klotski.level.position': '第 {index}/{total} 关',
  'klotski.level.last': '最后一关',
  'klotski.stat.moves': '步数',
  'klotski.stat.level': '关卡',
  'klotski.stat.target': '最少步数',
  'klotski.cell.empty': '空格',
  'klotski.cell.goal': '出口',
  'klotski.cell.tile': '棋子',
  'klotski.won.title': '曹操出关',
  'klotski.result.moves__other': '本局 {count} 步',
  'klotski.result.target__other': '本关最少 {count} 步',
  // 壳层用 i18n.t(key, { count }) 取「该难度最佳」，因此基础键必须带 {count}
  'klotski.solved.best': '该难度最佳 {count} 步',
  'klotski.solved.best__other': '该难度最佳 {count} 步',
}

export const klotskiEn: Dict = {
  'klotski.title': 'Klotski',
  'klotski.rules.body':
    'Tap a piece, then an adjacent empty cell to slide it. Move the 2×2 block to the exit.',
  'klotski.rules.body2':
    'One slide per move. Undo takes back one slide.',
  'klotski.rules.restart':
    'Restarting returns to this level’s opening layout; you cannot undo back past a restart.',
  'klotski.illegal.notice': 'That block cannot slide',
  'klotski.difficulty.starter': 'Starter',
  'klotski.difficulty.skilled': 'Skilled',
  'klotski.difficulty.challenging': 'Challenging',
  'klotski.progress.notSolved': 'Not solved',
  'klotski.level.label': 'Level {index}',
  'klotski.level.position': 'Level {index}/{total}',
  'klotski.level.last': 'Last level',
  'klotski.stat.moves': 'Moves',
  'klotski.stat.level': 'Level',
  'klotski.stat.target': 'Best known',
  'klotski.cell.empty': 'Empty square',
  'klotski.cell.goal': 'Exit',
  'klotski.cell.tile': 'Block',
  'klotski.won.title': 'Cao Cao is out',
  'klotski.result.moves__one': '{count} move in this game',
  'klotski.result.moves__other': '{count} moves in this game',
  'klotski.result.target__one': 'Best known for this level: {count} move',
  'klotski.result.target__other': 'Best known for this level: {count} moves',
  'klotski.solved.best': 'Best for this difficulty: {count} moves',
  'klotski.solved.best__one': 'Best for this difficulty: {count} move',
  'klotski.solved.best__other': 'Best for this difficulty: {count} moves',
}
