/**
 * 孔明棋文案。壳层会把本字典合并进 i18n 运行时；
 * 键前缀与 GameDef.i18nNamespace（'pegsolitaire'）一致。
 *
 * 约定（与核心层一致）：
 * - 代码里不得出现硬编码界面文案，一律通过 key 取；
 * - 复数写成 `__one` / `__other`，中文只提供 `__other`；
 * - 中英「基础 key 集合」必须完全一致（dicts 测试保证）。
 */
import type { Dict } from '@eink/core'

export const pegsolitaireZh: Dict = {
  'pegsolitaire.title': '孔明棋',
  'pegsolitaire.rules.body':
    '棋子只能横竖方向跳吃：先点一枚棋子选中它，再点它后面隔一格的空孔，就会跳过中间那枚棋子并把被跳过的棋子拿走。斜着跳不行，中间没有棋子或落点有棋子都不行。',
  'pegsolitaire.rules.body2':
    '只剩一枚棋子就过关。走不动时不必担心卡死：可以撤销上一步跳吃，或者重新开始。选中/取消棋子不算一步，只有跳吃才计入步数。',
  'pegsolitaire.rules.restart': '重新开始会回到同一难度的起始布局，且无法撤销回重开之前。',
  'pegsolitaire.illegal.notice': '这里不能这样操作',
  'pegsolitaire.difficulty.starter': '入门（中心空）',
  'pegsolitaire.difficulty.skilled': '熟练（中心与其正上方空）',
  'pegsolitaire.difficulty.challenging': '挑战（非对称起始）',
  'pegsolitaire.stat.pegs': '剩余棋子',
  'pegsolitaire.stat.moves': '跳吃次数',
  'pegsolitaire.stat.remaining': '还需跳吃',
  'pegsolitaire.cell.wall': '棋盘外',
  'pegsolitaire.cell.empty': '空孔',
  'pegsolitaire.cell.tile': '棋子',
  'pegsolitaire.won.title': '只剩一枚棋子',
  'pegsolitaire.result.moves__other': '本局 {count} 次跳吃',
  'pegsolitaire.result.pegs__other': '剩余 {count} 枚棋子',
  // 壳层用 i18n.t(key, { count }) 取「该难度最佳」，因此基础键必须带 {count}
  'pegsolitaire.solved.best': '该难度最少 {count} 次跳吃',
  'pegsolitaire.solved.best__other': '该难度最少 {count} 次跳吃',
}

export const pegsolitaireEn: Dict = {
  'pegsolitaire.title': 'Peg Solitaire',
  'pegsolitaire.rules.body':
    'A peg may only jump horizontally or vertically: first tap a peg to select it, then tap the empty hole two cells away — the peg jumps over the one between them and the jumped peg is removed. Diagonal jumps are not allowed, and neither is jumping over an empty hole or landing on a peg.',
  'pegsolitaire.rules.body2':
    'Leave exactly one peg to finish. You can never get stuck for good: undo the last jump or restart. Selecting a peg never counts as a move — only jumps do.',
  'pegsolitaire.rules.restart':
    'Restarting returns to the starting layout for this difficulty; you cannot undo back past a restart.',
  'pegsolitaire.illegal.notice': 'That action is not allowed here',
  'pegsolitaire.difficulty.starter': 'Starter (centre empty)',
  'pegsolitaire.difficulty.skilled': 'Skilled (centre and the hole above it empty)',
  'pegsolitaire.difficulty.challenging': 'Challenging (asymmetric start)',
  'pegsolitaire.stat.pegs': 'Pegs left',
  'pegsolitaire.stat.moves': 'Jumps',
  'pegsolitaire.stat.remaining': 'Jumps to go',
  'pegsolitaire.cell.wall': 'Off board',
  'pegsolitaire.cell.empty': 'Empty hole',
  'pegsolitaire.cell.tile': 'Peg',
  'pegsolitaire.won.title': 'One peg left',
  'pegsolitaire.result.moves__one': '{count} jump in this game',
  'pegsolitaire.result.moves__other': '{count} jumps in this game',
  'pegsolitaire.result.pegs__one': '{count} peg left',
  'pegsolitaire.result.pegs__other': '{count} pegs left',
  'pegsolitaire.solved.best': 'Best for this difficulty: {count} jumps',
  'pegsolitaire.solved.best__one': 'Best for this difficulty: {count} jump',
  'pegsolitaire.solved.best__other': 'Best for this difficulty: {count} jumps',
}
