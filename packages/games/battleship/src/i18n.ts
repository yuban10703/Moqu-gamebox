/**
 * 海战棋文案。壳层会把本字典合并进 i18n 运行时；
 * 键前缀与 GameDef.i18nNamespace（'battleship'）一致。
 *
 * 约定（与核心层一致）：
 * - 代码里不得出现硬编码界面文案，一律通过 key 取；
 * - 复数写成 `__one` / `__other`，中文只提供 `__other`；
 * - 中英「基础 key 集合」必须完全一致（dicts 测试保证）。
 *
 * 摆舰口径写进 rules.body2：不重叠、不越界、**互不接触（含对角）**，由 seed 决定。
 */
import type { Dict } from '@eink/core'

export const battleshipZh: Dict = {
  'battleship.title': '海战棋',
  'battleship.rules.body':
    '点敌方海域里的格子开炮（棋盘上就是敌方的海）。打中敌舰会留一个叉号，并且可以继续打；打空会留一个圆圈，然后轮到对手开炮。谁先把对方的舰全部打沉谁就赢。',
  'battleship.rules.body2':
    '三档难度都是 8×8 海域，只是舰数不同：入门 3 艘（舰长 2、3、3）、熟练 4 艘（2、3、3、4）、挑战 5 艘（2、3、3、4、5）。双方舰队都由种子自动摆放：不重叠、不越界，而且互不接触（斜着挨着也不行）。我方剩余舰格只显示在统计条里，所以要看紧那几个数字。',
  'battleship.rules.restart': '重新开始会按同一种子重新摆出同一布局，且无法撤销回重开之前。',
  'battleship.illegal.notice': '这一格已经打过了',
  'battleship.difficulty.starter': '入门 3 艘',
  'battleship.difficulty.skilled': '熟练 4 艘',
  'battleship.difficulty.challenging': '挑战 5 艘',
  'battleship.stat.mine': '我方舰格',
  'battleship.stat.foe': '敌方舰格',
  'battleship.stat.shots': '已射击',
  'battleship.cell.floor': '未打过的海面/空弹',
  'battleship.cell.tile': '命中',
  'battleship.won.title': '全歼敌舰',
  'battleship.lost.title': '我方舰队被击沉',
  'battleship.result.sunk__other': '击沉敌舰 {count} 艘',
  'battleship.result.moves__other': '共射击 {count} 次',
  // 壳层用 i18n.t(key, { count }) 取「该难度最佳」，因此基础键必须带 {count}
  'battleship.solved.best': '该难度最少 {count} 次射击',
  'battleship.solved.best__other': '该难度最少 {count} 次射击',
}

export const battleshipEn: Dict = {
  'battleship.title': 'Battleship',
  'battleship.rules.body':
    'Tap a square in the enemy waters (this board is the enemy sea). A hit leaves a cross and lets you fire again; a miss leaves a circle and the opponent fires. Sink the whole enemy fleet before yours goes down.',
  'battleship.rules.body2':
    'All difficulties use an 8×8 sea, only the fleet size differs: starter 3 ships (lengths 2, 3, 3), skilled 4 ships (2, 3, 3, 4), challenging 5 ships (2, 3, 3, 4, 5). Both fleets are placed from the seed: no overlap, inside the board, and never touching — not even diagonally. Your own damage is shown only in the stats row, so keep an eye on those numbers.',
  'battleship.rules.restart':
    'Restarting lays out the same fleets for the same seed; you cannot undo back past a restart.',
  'battleship.illegal.notice': 'You already fired at that square',
  'battleship.difficulty.starter': 'Starter, 3 ships',
  'battleship.difficulty.skilled': 'Skilled, 4 ships',
  'battleship.difficulty.challenging': 'Challenging, 5 ships',
  'battleship.stat.mine': 'My ship cells',
  'battleship.stat.foe': 'Enemy ship cells',
  'battleship.stat.shots': 'Shots fired',
  'battleship.cell.floor': 'Untried water or miss',
  'battleship.cell.tile': 'Hit',
  'battleship.won.title': 'Enemy fleet destroyed',
  'battleship.lost.title': 'Your fleet was sunk',
  'battleship.result.sunk__one': '{count} enemy ship sunk',
  'battleship.result.sunk__other': '{count} enemy ships sunk',
  'battleship.result.moves__one': '{count} shot fired',
  'battleship.result.moves__other': '{count} shots fired',
  'battleship.solved.best': 'Best for this difficulty: {count} shots',
  'battleship.solved.best__one': 'Best for this difficulty: {count} shot',
  'battleship.solved.best__other': 'Best for this difficulty: {count} shots',
}
