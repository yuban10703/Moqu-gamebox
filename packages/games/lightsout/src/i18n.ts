/**
 * 关灯游戏文案。壳层会把本字典合并进 i18n 运行时；
 * 键前缀与 GameDef.i18nNamespace（'lightsout'）一致。
 *
 * 约定（与核心层一致）：
 * - 代码里不得出现硬编码界面文案，一律通过 key 取；
 * - 复数写成 `__one` / `__other`，中文只提供 `__other`；
 * - 中英「基础 key 集合」必须完全一致（dicts 测试保证）。
 */
import type { Dict } from '@eink/core'

export const lightsoutZh: Dict = {
  'lightsout.title': '关灯游戏',
  'lightsout.rules.body':
    '点一盏灯会同时翻转它和上下左右的灯。全部熄灭即过关。',
  'lightsout.rules.body2':
    '谜题由全灭局面随机翻转生成，所以一定有解；步数越少越好。',
  // 重开走的是「换一个种子重新出题」：不再声称同一种子（实测每次都是新谜题）
  'lightsout.rules.restart': '重新开始会换一道新谜题，且无法撤销回重开之前。',
  'lightsout.illegal.notice': '这里不能这样操作',
  'lightsout.difficulty.starter': '入门 5×5',
  'lightsout.difficulty.skilled': '熟练 5×5（更多翻转）',
  'lightsout.difficulty.challenging': '挑战 6×6',
  'lightsout.stat.moves': '步数',
  'lightsout.stat.off': '已熄灭',
  'lightsout.stat.total': '灯总数',
  'lightsout.cell.tile': '亮灯',
  'lightsout.cell.empty': '灭灯',
  'lightsout.won.title': '全部熄灭',
  'lightsout.result.moves__other': '本局 {count} 步',
  'lightsout.result.lights__other': '熄灭全部 {count} 盏灯',
  // 壳层用 i18n.t(key, { count }) 取「该难度最佳」，因此基础键必须带 {count}
  'lightsout.solved.best': '该难度最少 {count} 步',
  'lightsout.solved.best__other': '该难度最少 {count} 步',
}

export const lightsoutEn: Dict = {
  'lightsout.title': 'Lights Out',
  'lightsout.rules.body':
    'Tapping a lamp flips it and its four neighbours. Turn every lamp off to finish.',
  'lightsout.rules.body2':
    'Every puzzle is generated from an all-off board, so a solution always exists.',
  'lightsout.rules.restart':
    'Restarting generates a new puzzle; you cannot undo back past a restart.',
  'lightsout.illegal.notice': 'Action not allowed',
  'lightsout.difficulty.starter': 'Starter 5×5',
  'lightsout.difficulty.skilled': 'Skilled 5×5 (more flips)',
  'lightsout.difficulty.challenging': 'Challenging 6×6',
  'lightsout.stat.moves': 'Moves',
  'lightsout.stat.off': 'Lights off',
  'lightsout.stat.total': 'Lights',
  'lightsout.cell.tile': 'Light on',
  'lightsout.cell.empty': 'Light off',
  'lightsout.won.title': 'All lights out',
  'lightsout.result.moves__one': '{count} move in this game',
  'lightsout.result.moves__other': '{count} moves in this game',
  'lightsout.result.lights__one': 'All {count} light switched off',
  'lightsout.result.lights__other': 'All {count} lights switched off',
  'lightsout.solved.best': 'Best for this difficulty: {count} moves',
  'lightsout.solved.best__one': 'Best for this difficulty: {count} move',
  'lightsout.solved.best__other': 'Best for this difficulty: {count} moves',
}
