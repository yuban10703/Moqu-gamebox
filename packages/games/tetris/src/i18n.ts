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
    '方块会自动往下掉：入门档约 1.05 秒一格，熟练档 0.8 秒，挑战档 0.6 秒（都慢于墨水屏一次整屏刷新，看得清落点）。你自己也能随时操作：左/右平移一格，「转」顺时针旋转，「落」立刻下落一格 —— 方块已经落到底时再按一次「落」就把它固定住，同时出现下一块；自动下落落到底后也会在下一格固定（中间这一格时间留给你微调）。棋盘上也可以直接滑动（左滑/右滑平移、上滑旋转、下滑下落）。每次操作后都会重新计时，刚按完不会立刻又掉一格。',
  'tetris.rules.body2':
    '整行填满即消除：一次消 1/2/3/4 行分别得 100/300/500/800 分，再乘以等级；每消 10 行升一级，等级只提高得分倍率。方块堆到顶部、新方块在井口放不下时本局失败（结果页仍可撤销回上一手）。点「撤销」退回你上一次操作之前（自动落下的那几格会一起退回）；点顶栏的「暂停」随时停表，暂停时方块完全不动。',
  'tetris.rules.difficulty':
    '每档的井深与自动下落速度都不同：入门是 10 列 × 18 行的深井、空场起步、1.05 秒一格；熟练的井更浅（10 × 16）、可周转的余量更小、0.8 秒一格；挑战同样是 10 × 16，但底部已预先堆好 4 行垃圾（每行一个洞，洞的位置由本局种子决定），而且 0.6 秒就掉一格。',
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
    'The piece falls on its own: about 1.05s per row on Starter, 0.8s on Skilled and 0.6s on Challenging (all slower than a full e-ink refresh, so the landing spot stays readable). You can always act first: left/right shift one column, Turn rotates clockwise, Drop moves down one row at once - once a piece has landed, pressing Drop again locks it and the next piece appears, and a piece that fell to the bottom locks on the following automatic step (that one step is your window to nudge it). You can also swipe on the board (sideways to shift, up to rotate, down to drop). Every input restarts the clock, so a piece never drops again the instant you press.',
  'tetris.rules.body2':
    'A completely filled row is cleared: 1/2/3/4 rows at once score 100/300/500/800, multiplied by your level. Every 10 cleared lines raise the level, and the level only raises the score multiplier. You lose when the stack reaches the top and a new piece no longer fits (the result panel still lets you undo the fatal move). Undo returns to just before your last input (the rows the piece fell on its own are rolled back too); pause from the top bar stops the clock - while paused nothing falls at all.',
  'tetris.rules.difficulty':
    'Each difficulty changes both the well and the falling speed: Starter is a deep 10 x 18 well on an empty board at 1.05s per row; Skilled is a shallower 10 x 16 well with less room to recover at 0.8s; Challenging is also 10 x 16 but with 4 rows of garbage already stacked at the bottom (one hole per row, placed from this game seed) and a 0.6s step.',
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
