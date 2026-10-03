/**
 * 跳棋文案。壳层会把本字典合并进 i18n 运行时；
 * 键前缀与 GameDef.i18nNamespace（'checkers'）一致。
 *
 * 规则文案必须如实写出本作采用的**国际跳棋简化版**口径（强制吃子、兵可前后吃、连跳强制继续）。
 *
 * 约定（与核心层一致）：
 * - 代码里不得出现硬编码界面文案，一律通过 key 取；
 * - 复数写成 `__one` / `__other`，中文只提供 `__other`；
 * - 中英「基础 key 集合」必须完全一致（dicts 测试保证）。
 */
import type { Dict } from '@eink/core'

export const checkersZh: Dict = {
  'checkers.title': '跳棋',
  'checkers.rules.body':
    '你执黑棋在下方先走。兵只能向前斜走一格；吃子时跳过相邻的一枚敌子、落到它后面的空格，方向可前可后，还能连续吃。只要存在吃子着法，就必须吃子，而且一次吃子后若还能继续吃，必须接着吃。',
  'checkers.rules.body2':
    '兵走到对方底线升王，王可以前后斜走一格、也能前后吃子。对方棋子被吃光，或轮到对方走却无子可动，你就赢了。连续 40 个半回合双方都没有吃子或升王则判和。撤销会退回一整回合（你的一步与对方的应手一起退回，连跳也算一步）。',
  'checkers.rules.restart': '重新开始会清空当前对局，回到同一种子下的起始局面，且无法撤销回重开之前。',
  'checkers.illegal.notice': '这一步不合规则（有子可吃时必须吃子）',
  'checkers.difficulty.starter': '入门（对手随机应手）',
  'checkers.difficulty.skilled': '熟练（对手贪心应手）',
  'checkers.difficulty.challenging': '挑战（对手会算 4 层）',
  'checkers.stat.black': '黑子',
  'checkers.stat.white': '白子',
  'checkers.stat.moves': '步数',
  'checkers.cell.wall': '棋盘外',
  'checkers.cell.empty': '空格',
  'checkers.cell.tile': '棋子',
  'checkers.won.title': '你赢了',
  'checkers.lost.title': '你输了',
  'checkers.draw.title': '和棋',
  'checkers.result.black__other': '黑子 {count}',
  'checkers.result.white__other': '白子 {count}',
  'checkers.result.moves__other': '本局 {count} 步',
  // 壳层用 i18n.t(key, { count }) 取「该难度最佳」，因此基础键必须带 {count}
  'checkers.solved.best': '该难度最佳 {count} 步',
  'checkers.solved.best__other': '该难度最佳 {count} 步',
}

export const checkersEn: Dict = {
  'checkers.title': 'Checkers',
  'checkers.rules.body':
    'You play black at the bottom and move first. A man steps one square diagonally forward; to capture, it jumps an adjacent enemy piece and lands on the empty square beyond — forwards or backwards — and may keep jumping. Capturing is compulsory: if any capture exists you must take it, and once you start a capture chain you must continue while more jumps remain.',
  'checkers.rules.body2':
    'A man reaching the far row is crowned a king; kings step one square diagonally in any direction and capture in any direction. You win by capturing every enemy piece, or when the opponent has no legal move. Forty half-moves without a capture or promotion is a draw. Undo takes back a whole turn (your move and the reply, chains included).',
  'checkers.rules.restart':
    'Restarting clears the current game and returns to the opening position for the same seed; you cannot undo back past a restart.',
  'checkers.illegal.notice': 'That move is not allowed (you must capture when you can)',
  'checkers.difficulty.starter': 'Starter (opponent plays at random)',
  'checkers.difficulty.skilled': 'Skilled (opponent plays greedily)',
  'checkers.difficulty.challenging': 'Challenging (opponent looks 4 plies ahead)',
  'checkers.stat.black': 'Black',
  'checkers.stat.white': 'White',
  'checkers.stat.moves': 'Moves',
  'checkers.cell.wall': 'Off board',
  'checkers.cell.empty': 'Empty square',
  'checkers.cell.tile': 'Piece',
  'checkers.won.title': 'You win',
  'checkers.lost.title': 'You lose',
  'checkers.draw.title': 'Draw',
  'checkers.result.black__one': '{count} black piece',
  'checkers.result.black__other': '{count} black pieces',
  'checkers.result.white__one': '{count} white piece',
  'checkers.result.white__other': '{count} white pieces',
  'checkers.result.moves__one': '{count} move in this game',
  'checkers.result.moves__other': '{count} moves in this game',
  'checkers.solved.best': 'Best for this difficulty: {count} moves',
  'checkers.solved.best__one': 'Best for this difficulty: {count} move',
  'checkers.solved.best__other': 'Best for this difficulty: {count} moves',
}
