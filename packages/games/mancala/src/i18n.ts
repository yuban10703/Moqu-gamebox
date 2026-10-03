/**
 * 播棋文案。壳层会把本字典合并进 i18n 运行时；
 * 键前缀与 GameDef.i18nNamespace（'mancala'）一致。
 *
 * 约定（与核心层一致）：
 * - 代码里不得出现硬编码界面文案，一律通过 key 取；
 * - 复数写成 `__one` / `__other`，中文只提供 `__other`；
 * - 中英「基础 key 集合」必须完全一致（dicts 测试保证）。
 *
 * 方向口径写进 rules.body：2 行 7 列；白方在上（仓在左、坑从右往左播），
 * 黑方在下（仓在右、坑从左往右播）；逆时针前进，**跳过对手的仓**。
 */
import type { Dict } from '@eink/core'

export const mancalaZh: Dict = {
  'mancala.title': '播棋',
  'mancala.rules.body':
    '点自己（下方一行）的坑，就能把里面的石子全部取出，逆时针一格放一颗。最后一颗落在自己的仓里可以立刻再播一次；落在自己原本空着的坑、而且对面坑里有石子，就把两边一起收进自己的仓。',
  'mancala.rules.body2':
    '棋盘 2 行 7 列：上方一行是对手（仓在左上角，6 个坑从右往左数），下方一行是你（仓在右下角，6 个坑从左往右数）。播种沿逆时针前进，自己的仓不跳过、对手的仓要跳过。任一方的 6 个坑全空时本局结束：双方把坑里剩下的石子收回自己的仓，再比谁仓里多。初始每个坑 4 颗（三档难度相同，区别只在对手强弱）。',
  'mancala.rules.restart': '重新开始会清空当前对局，回到初始摆法，且无法撤销回重开之前。',
  'mancala.illegal.notice': '只能点自己这行里有石子的坑',
  'mancala.difficulty.starter': '入门（对手随机）',
  'mancala.difficulty.skilled': '熟练（对手会连走与吃子）',
  'mancala.difficulty.challenging': '挑战（对手会算几步）',
  'mancala.stat.black': '我方仓',
  'mancala.stat.white': '对方仓',
  'mancala.stat.moves': '步数',
  'mancala.cell.floor': '空坑',
  'mancala.cell.tile': '有石子的坑',
  'mancala.cell.number': '仓',
  'mancala.won.title': '你赢了',
  'mancala.lost.title': '你输了',
  'mancala.draw.title': '平局',
  'mancala.result.black__other': '我方仓 {count} 颗',
  'mancala.result.white__other': '对方仓 {count} 颗',
  // 壳层用 i18n.t(key, { count }) 取「该难度最佳」，因此基础键必须带 {count}
  'mancala.solved.best': '该难度最少 {count} 步',
  'mancala.solved.best__other': '该难度最少 {count} 步',
}

export const mancalaEn: Dict = {
  'mancala.title': 'Mancala',
  'mancala.rules.body':
    'Tap one of your pits (bottom row) to lift all its stones and drop one per cell anticlockwise. If the last stone lands in your own store you move again; if it lands in one of your own empty pits and the opposite pit holds stones, you capture both into your store.',
  'mancala.rules.body2':
    'The board is 2 rows by 7 columns: the top row is your opponent (store at the top left, pits counted right to left), the bottom row is you (store at the bottom right, pits counted left to right). Sowing runs anticlockwise, never skipping your own store but always skipping your opponent’s store. The game ends when either side has all six pits empty: both sides sweep the remaining stones into their stores and the larger store wins. Each pit starts with 4 stones (same for all difficulties; only the opponent gets stronger).',
  'mancala.rules.restart':
    'Restarting clears the current game and returns to the starting layout; you cannot undo back past a restart.',
  'mancala.illegal.notice': 'You can only pick a non-empty pit on your own side',
  'mancala.difficulty.starter': 'Starter (random opponent)',
  'mancala.difficulty.skilled': 'Skilled (opponent plays extra turns and captures)',
  'mancala.difficulty.challenging': 'Challenging (opponent looks ahead)',
  'mancala.stat.black': 'My store',
  'mancala.stat.white': 'Their store',
  'mancala.stat.moves': 'Moves',
  'mancala.cell.floor': 'Empty pit',
  'mancala.cell.tile': 'Pit with stones',
  'mancala.cell.number': 'Store',
  'mancala.won.title': 'You win',
  'mancala.lost.title': 'You lose',
  'mancala.draw.title': 'Draw',
  'mancala.result.black__one': 'My store: {count} stone',
  'mancala.result.black__other': 'My store: {count} stones',
  'mancala.result.white__one': 'Their store: {count} stone',
  'mancala.result.white__other': 'Their store: {count} stones',
  'mancala.solved.best': 'Best for this difficulty: {count} moves',
  'mancala.solved.best__one': 'Best for this difficulty: {count} move',
  'mancala.solved.best__other': 'Best for this difficulty: {count} moves',
}
