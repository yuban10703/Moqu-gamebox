/**
 * 俄罗斯方块文案。壳层会把本字典合并进 i18n 运行时；
 * 键前缀与 GameDef.i18nNamespace（'tetris'）保持一致 ——
 * 壳层用 `${i18nNamespace}.title` 取标题，也用该名字取游戏库封面图标。
 *
 * 约定（与核心层一致）：
 * - 代码里不得出现硬编码界面文案，一律通过 key 取（本文件是唯一放中文的地方）；
 * - 复数写成 `__one` / `__other`，中文只提供 `__other`；
 * - 中英「基础 key 集合」必须完全一致（dicts 测试保证）。
 *
 * 方向盘按钮只有 48px 一格，文字必须极短：中文一个字、英文一个短词，
 * 否则会挤出按钮外（`上`=旋转、`下`=下落，语义写在 dpad.label 与玩法说明里）。
 */
import type { Dict } from '@eink/core'

export const tetrisZh: Dict = {
  'tetris.title': '俄罗斯方块',
  'tetris.rules.body':
    '方块自动往下掉（入门 1.05 秒、熟练 0.8 秒、挑战 0.6 秒一格）。操作：「左/右」平移，「转」顺时针旋转，「落」下落一格 —— 已经到底时再按「落」就固定并出下一块。棋盘上也能滑动（左右平移、上旋转、下落）；每次操作后重新计时。',
  'tetris.rules.body2':
    '整行填满即消除：一次消 1/2/3/4 行得 100/300/500/800 分 × 等级，每消 10 行升一级。堆到顶、新方块放不下即失败（结果页仍可撤销）；「撤销」退回上一次操作（自动落下的也一起退回），「暂停」时完全不动。',
  'tetris.rules.difficulty':
    '入门：10×18 空场、1.05 秒一格；熟练：10×16、0.8 秒；挑战：同为 10×16，但底部已预堆 4 行（每行一个洞），0.6 秒一格。',
  'tetris.rules.restart': '重新开始会清空当前局面与撤销历史，回到该难度的初始棋盘。',
  'tetris.stat.score': '分数',
  'tetris.stat.lines': '消行',
  'tetris.stat.level': '等级',
  'tetris.dir.up': '转',
  'tetris.dir.down': '落',
  'tetris.dir.left': '左',
  'tetris.dir.right': '右',
  'tetris.dpad.label': '方向控制：左右平移，上旋转，下落一格',
  'tetris.blocked': '这一步走不通',
  'tetris.lost.title': '堆到顶了',
  'tetris.result.score__other': '得分 {count}',
  'tetris.result.lines__other': '消行 {count}',
  'tetris.result.pieces__other': '共固定 {count} 块',
  'tetris.difficulty.starter': '入门',
  'tetris.difficulty.skilled': '熟练',
  'tetris.difficulty.challenging': '挑战',
  'tetris.cell.empty': '空格',
  // kind 名沿用壳层的 CellKind（mine 是壳层唯一的纯黑实心格），文案说「方块」而不是「雷」
  'tetris.cell.mine': '已固定的方块',
  'tetris.cell.boxOnGoal': '当前方块',
}

export const tetrisEn: Dict = {
  'tetris.title': 'Tetris',
  'tetris.rules.body':
    'The piece falls on its own (Starter 1.05s per row, Skilled 0.8s, Challenging 0.6s per row). Left/Right shifts, Turn rotates clockwise, Drop moves down one row - press Drop again once it has landed to lock it and get the next piece. You can swipe on the board too; every input restarts the clock.',
  'tetris.rules.body2':
    'A full row clears: 1/2/3/4 rows score 100/300/500/800 times your level, and every 10 cleared lines raises the level. Top out and the run ends (the result panel can still undo); Undo rolls back your last input (automatic drops included), and Pause freezes everything.',
  'tetris.rules.difficulty':
    'Starter: an empty 10 x 18 well, 1.05s per row. Skilled: 10 x 16, 0.8s. Challenging: also 10 x 16, but with 4 rows already stacked at the bottom (one hole each), 0.6s per row.',
  'tetris.rules.restart':
    'Restarting clears the current board and the undo history, and returns to a fresh board for this difficulty.',
  'tetris.stat.score': 'Score',
  'tetris.stat.lines': 'Lines',
  'tetris.stat.level': 'Level',
  'tetris.dir.up': 'Turn',
  'tetris.dir.down': 'Drop',
  'tetris.dir.left': 'Left',
  'tetris.dir.right': 'Right',
  'tetris.dpad.label': 'Direction pad: sideways to shift, up to rotate, down to drop one row',
  'tetris.blocked': 'That move is blocked',
  'tetris.lost.title': 'Top out',
  'tetris.result.score__other': 'Score {count}',
  'tetris.result.lines__one': '{count} line cleared',
  'tetris.result.lines__other': '{count} lines cleared',
  'tetris.result.pieces__one': '{count} piece locked',
  'tetris.result.pieces__other': '{count} pieces locked',
  'tetris.difficulty.starter': 'Starter',
  'tetris.difficulty.skilled': 'Skilled',
  'tetris.difficulty.challenging': 'Challenging',
  'tetris.cell.empty': 'Empty cell',
  // The kind name follows the shell's CellKind ('mine' is the only solid black cell kind);
  // the wording says "block" rather than "mine" on purpose.
  'tetris.cell.mine': 'Locked block',
  'tetris.cell.boxOnGoal': 'Current piece',
}
