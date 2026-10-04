/**
 * 消消乐文案。壳层会把本字典合并进 i18n 运行时；
 * 键前缀与 GameDef.i18nNamespace（'match3'）一致。
 *
 * 约定（与核心层一致）：
 * - 代码里不得出现硬编码界面文案，一律通过 key 取（本文件是字典本体，是唯一例外）；
 * - 复数写成 `__one` / `__other`，中文只提供 `__other`；
 * - 中英「基础 key 集合」必须完全一致（dicts 测试保证）。
 */
import type { Dict } from '@eink/core'

export const match3Zh: Dict = {
  'match3.title': '消消乐',
  'match3.rules.body': '点一格选中，再点相邻格交换；横竖连成三格以上即消除计分。',
  'match3.rules.body2': '换不出三连的交换会被拒绝，不扣步数。',
  'match3.rules.body3': '达到目标分数过关，步数用尽失败；无可交换组合时自动重排。',
  'match3.rules.restart':
    '重开会清空分数与撤销记录，回到同一局的初始棋盘；同一难度与同一开局种子完全可复现。',
  'match3.illegal.notice': '换不出三连：不扣步数',
  'match3.notice.pick': '再点相邻一格交换',
  'match3.notice.shuffled': '没有可换的组合，已重排',
  'match3.difficulty.starter': '入门',
  'match3.difficulty.skilled': '熟练',
  'match3.difficulty.challenging': '挑战',
  'match3.stat.score': '分数',
  'match3.stat.moves': '剩余步数',
  'match3.cell.tile': '棋子',
  'match3.won.title': '达成目标分数',
  'match3.lost.title': '步数用尽',
  'match3.result.score__other': '本局得分 {count}',
  'match3.result.moves__other': '共用了 {count} 步',
  // 基础 key 不能省：壳层结果面板用 i18n.t('<ns>.solved.best') 取它（不走 plural）
  'match3.solved.best': '该难度最少步数 {count}',
  'match3.solved.best__other': '该难度最少步数 {count}',
}

export const match3En: Dict = {
  'match3.title': 'Match Three',
  'match3.rules.body':
    'Tap a piece, then an adjacent one to swap; three or more in a row or column clear and score.',
  'match3.rules.body2': 'A swap that makes no match is refused and costs no move.',
  'match3.rules.body3':
    'Reach the target score to win; run out of moves and the round is lost. With no match available the board reshuffles.',
  'match3.rules.restart':
    'Restart clears the score and the undo records and returns to the same opening board; the same difficulty and starting seed stay fully reproducible.',
  'match3.illegal.notice': 'Swap must make a match',
  'match3.notice.pick': 'Tap a neighbour to swap',
  'match3.notice.shuffled': 'No swaps left, shuffled',
  'match3.difficulty.starter': 'Starter',
  'match3.difficulty.skilled': 'Skilled',
  'match3.difficulty.challenging': 'Challenging',
  'match3.stat.score': 'Score',
  'match3.stat.moves': 'Moves left',
  'match3.cell.tile': 'Piece',
  'match3.won.title': 'Target score reached',
  'match3.lost.title': 'Out of moves',
  'match3.result.score__one': 'You scored {count} point',
  'match3.result.score__other': 'You scored {count} points',
  'match3.result.moves__one': 'You used {count} move',
  'match3.result.moves__other': 'You used {count} moves',
  'match3.solved.best': 'Best for this difficulty: {count} moves',
  'match3.solved.best__one': 'Best for this difficulty: {count} move',
  'match3.solved.best__other': 'Best for this difficulty: {count} moves',
}
