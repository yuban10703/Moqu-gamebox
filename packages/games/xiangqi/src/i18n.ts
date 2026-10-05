/**
 * 中国象棋文案。壳层会把本字典合并进 i18n 运行时；
 * 键前缀与 GameDef.i18nNamespace（'xiangqi'）一致。
 *
 * 约定（与核心层一致）：
 * - 代码里不得出现硬编码界面文案，一律通过 key 取；
 *   棋子字形（帅仕相马车炮兵 / 将士象马车炮卒）是**棋盘上的字形**而非界面文案，
 *   在 view.ts 里标 `i18n-exempt`，中英界面同样显示汉字（用户已拍板）；
 * - 复数写成 `__one` / `__other`，中文只提供 `__other`；
 * - 中英「基础 key 集合」必须完全一致（dicts 测试保证）。
 */
import type { Dict } from '@eink/core'

export const xiangqiZh: Dict = {
  'xiangqi.title': '中国象棋',
  'xiangqi.rules.body':
    '你执红先行（红方在下）。点自己的棋子选中，再点高亮的落点走子；黑方自动应手，无需等待。',
  'xiangqi.rules.body2':
    '马走日、别马腿，相走田、塞象眼，仕帅不出九宫，炮吃子必须隔一个炮架，兵过河后才能横走。将帅不可照面，也不得送将。',
  'xiangqi.rules.body3':
    '将死或困毙对方即获胜（象棋里无子可动同样判负）；同一局面出现第三次判和。棋盘中间那条粗线就是楚河汉界。',
  'xiangqi.rules.restart':
    '重新开始会清空当前对局，回到同一种子下的标准开局，且无法撤销回重开之前。',
  'xiangqi.illegal.notice': '这一步走不通',
  'xiangqi.difficulty.starter': '入门',
  'xiangqi.difficulty.skilled': '熟练',
  'xiangqi.difficulty.challenging': '挑战',
  'xiangqi.stat.red': '红子',
  'xiangqi.stat.black': '黑子',
  'xiangqi.stat.moves': '步数',
  'xiangqi.cell.piece': '棋子',
  'xiangqi.cell.target': '可落点',
  'xiangqi.cell.empty': '空格',
  'xiangqi.won.title': '你赢了',
  'xiangqi.lost.title': '你输了',
  'xiangqi.draw.title': '和棋',
  'xiangqi.notice.check': '将军！必须应将',
  'xiangqi.result.moves__other': '你共走了 {count} 步',
  'xiangqi.result.checkmate': '将死：无子可动且正被将军',
  'xiangqi.result.stalemate': '困毙：没有被将军但无子可动（象棋同样判负）',
  'xiangqi.result.repetition': '同一局面出现三次，判和',
  // 壳层用 i18n.t(key, { count }) 取「该难度最佳」，因此基础键必须带 {count}
  'xiangqi.solved.best': '该难度最佳 {count} 步',
  'xiangqi.solved.best__other': '该难度最佳 {count} 步',
}

export const xiangqiEn: Dict = {
  'xiangqi.title': 'Chinese Chess',
  'xiangqi.rules.body':
    'You play Red (bottom) and move first. Tap one of your pieces to select it, then tap a highlighted target. Black replies automatically in the same move.',
  'xiangqi.rules.body2':
    'Horse moves in an L and can be blocked at its leg; elephant moves two diagonally and can be blocked at its eye; advisor and general stay inside the palace; a cannon captures only over exactly one screen; a pawn may move sideways only after crossing the river. The two generals may never face each other on an open file, and you may not leave your own general in check.',
  'xiangqi.rules.body3':
    'Checkmate or stalemate wins (in xiangqi a side with no legal move loses); a position repeated three times is a draw. The thick line across the middle of the board is the river.',
  'xiangqi.rules.restart':
    'Restarting clears the current game and returns to the standard opening for the same seed; you cannot undo back past a restart.',
  'xiangqi.illegal.notice': 'That move is not allowed',
  'xiangqi.difficulty.starter': 'Starter',
  'xiangqi.difficulty.skilled': 'Skilled',
  'xiangqi.difficulty.challenging': 'Challenging',
  'xiangqi.stat.red': 'Red',
  'xiangqi.stat.black': 'Black',
  'xiangqi.stat.moves': 'Moves',
  'xiangqi.cell.piece': 'Piece',
  'xiangqi.cell.target': 'Legal target',
  'xiangqi.cell.empty': 'Empty cell',
  'xiangqi.won.title': 'You win',
  'xiangqi.lost.title': 'You lose',
  'xiangqi.draw.title': 'Draw',
  'xiangqi.notice.check': 'Check! You must answer it',
  'xiangqi.result.moves__one': 'You played {count} move',
  'xiangqi.result.moves__other': 'You played {count} moves',
  'xiangqi.result.checkmate': 'Checkmate: no legal move while in check',
  'xiangqi.result.stalemate': 'Stalemate: no legal move without being in check (also a loss)',
  'xiangqi.result.repetition': 'The same position occurred three times, so the game is drawn',
  'xiangqi.solved.best': 'Best for this difficulty: {count} moves',
  'xiangqi.solved.best__one': 'Best for this difficulty: {count} move',
  'xiangqi.solved.best__other': 'Best for this difficulty: {count} moves',
}
