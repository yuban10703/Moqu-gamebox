/**
 * 黑白棋文案。壳层会把本字典合并进 i18n 运行时；
 * 键前缀与 GameDef.i18nNamespace（'reversi'）一致。
 *
 * 约定（与核心层一致）：
 * - 代码里不得出现硬编码界面文案，一律通过 key 取；
 * - 复数写成 `__one` / `__other`，中文只提供 `__other`；
 * - 中英「基础 key 集合」必须完全一致（dicts 测试保证）。
 */
import type { Dict } from '@eink/core'

export const reversiZh: Dict = {
  'reversi.title': '黑白棋',
  'reversi.rules.body':
    '点击带小点的空格落子：被你夹住的对方棋子会全部翻成你的颜色。八个方向都能夹子，夹不住任何棋子的空格不能落子。',
  'reversi.rules.body2':
    '你是黑方，先手；白方由规则层自动应手，它无处可下时会自动跳过。棋盘下满或双方都无处可下时对局结束，棋子多者获胜，相同为平局。撤销会退回一整回合（你的落子与白方的应手一起退回）。',
  'reversi.rules.restart': '重新开始会清空当前对局，回到同一种子下的初始局面，且无法撤销回重开之前。',
  'reversi.illegal.notice': '这里落子夹不住对方的棋子',
  'reversi.difficulty.starter': '入门',
  'reversi.difficulty.skilled': '熟练',
  'reversi.difficulty.challenging': '挑战',
  'reversi.stat.black': '黑子',
  'reversi.stat.white': '白子',
  'reversi.stat.moves': '步数',
  'reversi.cell.tile': '棋子',
  'reversi.cell.number': '可落子',
  'reversi.cell.empty': '空格',
  'reversi.notice.opponentPass': '对方无处可下，已跳过',
  'reversi.notice.playerPass': '你无处可下，已自动跳过',
  'reversi.won.title': '你赢了',
  'reversi.lost.title': '你输了',
  'reversi.draw.title': '平局',
  'reversi.result.black__other': '黑子 {count}',
  'reversi.result.white__other': '白子 {count}',
  // 壳层用 i18n.t(key, { count }) 取「该难度最佳」，因此基础键必须带 {count}
  'reversi.solved.best': '该难度最佳 {count} 步',
  'reversi.solved.best__other': '该难度最佳 {count} 步',
}

export const reversiEn: Dict = {
  'reversi.title': 'Reversi',
  'reversi.rules.body':
    'Tap an empty cell marked with a dot to place a disc: every opposing disc you trap in a line flips to your colour. All eight directions count, and a cell that traps nothing is not a legal move.',
  'reversi.rules.body2':
    'You play black and move first. The white side answers automatically, and it is skipped when it has no legal move. The game ends when the board is full or neither side can move: most discs wins, equal discs is a draw. Undo takes back a whole turn (your move and the white reply).',
  'reversi.rules.restart':
    'Restarting clears the current game and returns to the opening position for the same seed; you cannot undo back past a restart.',
  'reversi.illegal.notice': 'That move traps no opposing disc',
  'reversi.difficulty.starter': 'Starter',
  'reversi.difficulty.skilled': 'Skilled',
  'reversi.difficulty.challenging': 'Challenging',
  'reversi.stat.black': 'Black',
  'reversi.stat.white': 'White',
  'reversi.stat.moves': 'Moves',
  'reversi.cell.tile': 'Disc',
  'reversi.cell.number': 'Legal move',
  'reversi.cell.empty': 'Empty cell',
  'reversi.notice.opponentPass': 'White has no move and was skipped',
  'reversi.notice.playerPass': 'You have no move and were skipped',
  'reversi.won.title': 'You win',
  'reversi.lost.title': 'You lose',
  'reversi.draw.title': 'Draw',
  'reversi.result.black__one': '{count} black disc',
  'reversi.result.black__other': '{count} black discs',
  'reversi.result.white__one': '{count} white disc',
  'reversi.result.white__other': '{count} white discs',
  'reversi.solved.best': 'Best for this difficulty: {count} moves',
  'reversi.solved.best__one': 'Best for this difficulty: {count} move',
  'reversi.solved.best__other': 'Best for this difficulty: {count} moves',
}
