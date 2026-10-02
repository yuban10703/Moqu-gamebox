/**
 * 扫雷文案。壳层会把本字典合并进 i18n 运行时；
 * 中英两种语言的**基础 key 集合必须完全一致**（compareDicts / check-i18n 会校验）。
 */
import type { Dict } from '@eink/core'

export const minesweeperZh: Dict = {
  'minesweeper.title': '扫雷',
  'minesweeper.rules.body':
    '直接点格子把它翻开。数字表示这一格周围 8 格里有几颗雷；翻开全部非雷格即获胜。',
  'minesweeper.rules.body2':
    '第一次点开的格子一定安全：地雷是在首次翻开之后才放置的，且不会落在首点及其周围 8 格。用「标记模式」把怀疑有雷的格子插上旗。',
  'minesweeper.rules.restart': '重开会清空当前盘面，重新放置地雷。',
  'minesweeper.illegal': '这里不能这样操作',
  'minesweeper.stat.mines': '剩余雷数',
  'minesweeper.stat.progress': '已翻开',
  'minesweeper.control.flagMode.on': '标记模式：开',
  'minesweeper.control.flagMode.off': '标记模式：关',
  'minesweeper.difficulty.starter': '入门',
  'minesweeper.difficulty.skilled': '熟练',
  'minesweeper.difficulty.challenging': '挑战',
  'minesweeper.cell.hidden': '未翻开',
  'minesweeper.cell.flag': '已插旗',
  'minesweeper.cell.mine': '地雷',
  'minesweeper.cell.number': '数字格',
  'minesweeper.cell.empty': '空白格',
  'minesweeper.won.title': '扫雷完成',
  'minesweeper.lost.title': '踩到雷了',
  'minesweeper.result.mines__other': '盘面共 {count} 颗雷',
  'minesweeper.result.revealed__other': '翻开 {count} 格',
  'minesweeper.result.flags__other': '插旗 {count} 个',
}

export const minesweeperEn: Dict = {
  'minesweeper.title': 'Minesweeper',
  'minesweeper.rules.body':
    'Tap a cell to open it. A number tells how many of the 8 neighbouring cells hold a mine; open every safe cell to win.',
  'minesweeper.rules.body2':
    'Your first tap is always safe: mines are placed only after it and never on that cell or its 8 neighbours. Use flag mode to mark cells you suspect.',
  'minesweeper.rules.restart': 'Restarting clears this board and places the mines again.',
  'minesweeper.illegal': 'That action is not allowed here',
  'minesweeper.stat.mines': 'Mines left',
  'minesweeper.stat.progress': 'Opened',
  'minesweeper.control.flagMode.on': 'Flag mode: on',
  'minesweeper.control.flagMode.off': 'Flag mode: off',
  'minesweeper.difficulty.starter': 'Starter',
  'minesweeper.difficulty.skilled': 'Skilled',
  'minesweeper.difficulty.challenging': 'Challenging',
  'minesweeper.cell.hidden': 'Not opened',
  'minesweeper.cell.flag': 'Flagged',
  'minesweeper.cell.mine': 'Mine',
  'minesweeper.cell.number': 'Numbered cell',
  'minesweeper.cell.empty': 'Blank cell',
  'minesweeper.won.title': 'Board cleared',
  'minesweeper.lost.title': 'You hit a mine',
  'minesweeper.result.mines__one': '{count} mine on the board',
  'minesweeper.result.mines__other': '{count} mines on the board',
  'minesweeper.result.revealed__one': '{count} cell opened',
  'minesweeper.result.revealed__other': '{count} cells opened',
  'minesweeper.result.flags__one': '{count} flag placed',
  'minesweeper.result.flags__other': '{count} flags placed',
}
