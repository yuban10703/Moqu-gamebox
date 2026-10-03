/**
 * 直棋文案。壳层会把本字典合并进 i18n 运行时；
 * 键前缀与 GameDef.i18nNamespace（'ninemens'）一致。
 *
 * 约定（与核心层一致）：
 * - 代码里不得出现硬编码界面文案，一律通过 key 取；
 * - 复数写成 `__one` / `__other`，中文只提供 `__other`；
 * - 中英「基础 key 集合」必须完全一致（dicts 测试保证）。
 */
import type { Dict } from '@eink/core'

export const ninemensZh: Dict = {
  'ninemens.title': '直棋',
  'ninemens.rules.body':
    '棋盘是三个同心方框，共 24 个点位。先把 9 颗子轮流放到空点位上（落子期）；双方都放完后轮流把子沿连线移到相邻空点（移动期）；当某方只剩 3 颗子时，该方可以飞到任意空点（飞子期）。',
  'ninemens.rules.body2':
    '把自己的 3 颗子连成一条直线（成三），就可以立刻吃掉对方一颗子，并且这一步要打满：一次成两条线就吃两颗。成三里的子不能吃，除非对方所有子都在成三里。一方只剩 2 颗子、或者轮到他走却一步都走不了，该方就输了（本作没有和棋）。',
  'ninemens.rules.restart': '重新开始会清空当前对局，回到空盘与双方各 9 颗子，且无法撤销回重开之前。',
  'ninemens.illegal.notice': '这一步不合法（可以点自己的子选中，再点能到的空点）',
  'ninemens.difficulty.starter': '入门（对手随机）',
  'ninemens.difficulty.skilled': '熟练（对手会成三与堵截）',
  'ninemens.difficulty.challenging': '挑战（对手会算几步）',
  'ninemens.stat.black': '黑方在场',
  'ninemens.stat.white': '白方在场',
  'ninemens.stat.hand': '我方待落',
  'ninemens.cell.wall': '盘外的格',
  'ninemens.cell.empty': '空点位',
  'ninemens.cell.tile': '棋子',
  'ninemens.cell.number': '可走的位置',
  'ninemens.won.title': '你赢了',
  'ninemens.lost.title': '你输了',
  'ninemens.result.moves__other': '本局共 {count} 步',
  'ninemens.result.captured__other': '吃掉对方 {count} 颗',
  // 壳层用 i18n.t(key, { count }) 取「该难度最佳」，因此基础键必须带 {count}
  'ninemens.solved.best': '该难度最少 {count} 步',
  'ninemens.solved.best__other': '该难度最少 {count} 步',
}

export const ninemensEn: Dict = {
  'ninemens.title': "Nine Men's Morris",
  'ninemens.rules.body':
    'The board is three concentric squares with 24 points. First both sides take turns placing their 9 stones on empty points (placing phase); then they slide a stone along a line to an adjacent empty point (moving phase); once a side is down to 3 stones it may fly to any empty point (flying phase).',
  'ninemens.rules.body2':
    'Line up 3 of your stones to form a mill: you then remove one of your opponent’s stones, and a double mill removes two. Stones inside a mill are protected unless every enemy stone is in a mill. You lose when you are reduced to 2 stones or cannot move at all on your turn (there are no draws in this version).',
  'ninemens.rules.restart':
    'Restarting clears the current game and returns to an empty board with 9 stones each; you cannot undo back past a restart.',
  'ninemens.illegal.notice': 'That move is not legal (tap your own stone, then an empty point it can reach)',
  'ninemens.difficulty.starter': 'Starter (random opponent)',
  'ninemens.difficulty.skilled': 'Skilled (opponent mills and blocks)',
  'ninemens.difficulty.challenging': 'Challenging (opponent looks ahead)',
  'ninemens.stat.black': 'Black on board',
  'ninemens.stat.white': 'White on board',
  'ninemens.stat.hand': 'In my hand',
  'ninemens.cell.wall': 'Off-board cell',
  'ninemens.cell.empty': 'Empty point',
  'ninemens.cell.tile': 'Stone',
  'ninemens.cell.number': 'Available point',
  'ninemens.won.title': 'You win',
  'ninemens.lost.title': 'You lose',
  'ninemens.result.moves__one': '{count} move in this game',
  'ninemens.result.moves__other': '{count} moves in this game',
  'ninemens.result.captured__one': '{count} enemy stone captured',
  'ninemens.result.captured__other': '{count} enemy stones captured',
  'ninemens.solved.best': 'Best for this difficulty: {count} moves',
  'ninemens.solved.best__one': 'Best for this difficulty: {count} move',
  'ninemens.solved.best__other': 'Best for this difficulty: {count} moves',
}
