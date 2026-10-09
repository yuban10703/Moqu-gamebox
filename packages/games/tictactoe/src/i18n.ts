/**
 * 井字棋文案。壳层会把本字典合并进 i18n 运行时；
 * 键前缀与 GameDef.i18nNamespace（'tictactoe'）一致。
 *
 * 约定（与核心层一致）：
 * - 代码里不得出现硬编码界面文案，一律通过 key 取；
 * - 复数写成 `__one` / `__other`，中文只提供 `__other`；
 * - 中英「基础 key 集合」必须完全一致（dicts 测试保证）。
 */
import type { Dict } from '@eink/core'

export const tictactoeZh: Dict = {
  'tictactoe.title': '井字棋',
  'tictactoe.rules.body':
    '九格里轮流落子，你执 ✕ 先下。横、竖、斜任意一条线先连成三个就赢；九格下满还没人连成线就是和局。',
  'tictactoe.rules.body2':
    '三档难度只改对手强度：入门是随机落子、常常看漏送到眼前的连线；熟练能赢就赢、你要赢就堵，然后占中心与角；挑战把整盘算尽、绝不失误，最好的结果只有和局。「提示」会标出当前这一步的正解。',
  'tictactoe.rules.body3':
    '双人同屏：两个人在同一台设备上轮流点格子，✕ 是玩家一、○ 是玩家二；撤销只退最后一手（对电脑时撤销退回一整回合）。',
  // 重开走的是「换一个种子重新开局」：不声称同一种子（对手的应手会重新随机）
  'tictactoe.rules.restart': '重新开始会换一局棋，当前这一局连同进度都会被替换。',
  'tictactoe.illegal.notice': '这里不能落子',
  'tictactoe.difficulty.starter': '入门',
  'tictactoe.difficulty.skilled': '熟练',
  'tictactoe.difficulty.challenging': '挑战',
  'tictactoe.difficulty.hotseat': '双人同屏',
  'tictactoe.action.hint': '提示',
  'tictactoe.stat.you': '你 ✕',
  'tictactoe.stat.computer': '电脑 ○',
  'tictactoe.stat.p1': '玩家一 ✕',
  'tictactoe.stat.p2': '玩家二 ○',
  'tictactoe.stat.moves': '步数',
  'tictactoe.turn.you': '轮到你落子',
  'tictactoe.turn.computer': '电脑在想…',
  'tictactoe.turn.p1': '轮到玩家一（✕）',
  'tictactoe.turn.p2': '轮到玩家二（○）',
  'tictactoe.cell.tile': '棋子',
  'tictactoe.cell.empty': '空格',
  'tictactoe.cell.hint': '提示落点',
  'tictactoe.won.title': '你赢了',
  'tictactoe.lost.title': '你输了',
  'tictactoe.draw.title': '和局',
  'tictactoe.won.p1': '玩家一获胜',
  'tictactoe.won.p2': '玩家二获胜',
  'tictactoe.result.moves__other': '本局共下了 {count} 手',
  'tictactoe.result.draw': '九格下满，谁都没连成一条线',
  // 壳层用 i18n.t(key, { count }) 取「该难度最佳」，因此基础键必须带 {count}
  'tictactoe.solved.best': '该难度最少 {count} 手',
  'tictactoe.solved.best__other': '该难度最少 {count} 手',
}

export const tictactoeEn: Dict = {
  'tictactoe.title': 'Tic-tac-toe',
  'tictactoe.rules.body':
    'Take turns filling the nine cells; you are ✕ and move first. Three in a row — across, down or diagonally — wins; a full grid with no line is a draw.',
  'tictactoe.rules.body2':
    'The three levels only change the opponent: Starter plays at random and often misses a line you hand it; Skilled takes a win and blocks yours, then takes the centre and corners; Challenging solves the whole board and never loses, so a draw is the best you can get. Hint marks the best move for the position.',
  'tictactoe.rules.body3':
    'Two players on one screen: ✕ is Player 1 and ○ is Player 2 taking turns on the same device. Undo takes back only the last move (against the computer it takes back a whole round).',
  'tictactoe.rules.restart': 'Restarting deals a fresh game; the current one and its progress are replaced.',
  'tictactoe.illegal.notice': 'Cannot play that cell',
  'tictactoe.difficulty.starter': 'Starter',
  'tictactoe.difficulty.skilled': 'Skilled',
  'tictactoe.difficulty.challenging': 'Challenging',
  'tictactoe.difficulty.hotseat': 'Two players',
  'tictactoe.action.hint': 'Hint',
  'tictactoe.stat.you': 'You ✕',
  'tictactoe.stat.computer': 'Computer ○',
  'tictactoe.stat.p1': 'Player 1 ✕',
  'tictactoe.stat.p2': 'Player 2 ○',
  'tictactoe.stat.moves': 'Moves',
  'tictactoe.turn.you': 'Your move',
  'tictactoe.turn.computer': 'The computer is thinking…',
  'tictactoe.turn.p1': "Player 1's turn (✕)",
  'tictactoe.turn.p2': "Player 2's turn (○)",
  'tictactoe.cell.tile': 'Mark',
  'tictactoe.cell.empty': 'Empty cell',
  'tictactoe.cell.hint': 'Suggested cell',
  'tictactoe.won.title': 'You win',
  'tictactoe.lost.title': 'You lose',
  'tictactoe.draw.title': 'Draw',
  'tictactoe.won.p1': 'Player 1 wins',
  'tictactoe.won.p2': 'Player 2 wins',
  'tictactoe.result.moves__one': 'The game took {count} move',
  'tictactoe.result.moves__other': 'The game took {count} moves',
  'tictactoe.result.draw': 'The nine cells are full and nobody connected three',
  'tictactoe.solved.best': 'Fewest moves for this difficulty: {count}',
  'tictactoe.solved.best__one': 'Fewest moves for this difficulty: {count}',
  'tictactoe.solved.best__other': 'Fewest moves for this difficulty: {count}',
}
