/**
 * 数独文案。壳层会把本字典合并进 i18n 运行时；
 * 中英基础 key 集合必须完全一致（由 core 的 `baseKeys` / `compareDicts` 校验）。
 */
import type { Dict } from '@eink/core'

export const sudokuZh: Dict = {
  'sudoku.title': '数独',
  'sudoku.rules.body':
    '在 9×9 盘面上填入 1-9，让每一行、每一列、每个 3×3 宫内数字都不重复。先点格子，再点数字键填入。',
  'sudoku.rules.body2': '题目给定格（描边更重）不能修改；点「清除」可以撤掉自己填错的数字。',
  'sudoku.rules.restart': '重开会重新出一题，当前的填入进度会丢失。',

  'sudoku.difficulty.starter': '入门',
  'sudoku.difficulty.skilled': '熟练',
  'sudoku.difficulty.challenging': '挑战',

  // 统计栏文案不带插值：壳层对 stats.labelKey 只做 t(labelKey)
  'sudoku.stat.filled': '已填',
  'sudoku.stat.total': '总格数',
  'sudoku.stat.empty': '空格',

  // 数字键各自一个 key：壳层直接 t(labelKey)，不做插值
  'sudoku.digit.1': '1',
  'sudoku.digit.2': '2',
  'sudoku.digit.3': '3',
  'sudoku.digit.4': '4',
  'sudoku.digit.5': '5',
  'sudoku.digit.6': '6',
  'sudoku.digit.7': '7',
  'sudoku.digit.8': '8',
  'sudoku.digit.9': '9',

  'sudoku.action.clear': '清除',
  'sudoku.action.clearHint': '清除选中格',

  'sudoku.illegal.notice': '这一步填不了',
  'sudoku.illegal.difficulty': '未知难度',
  'sudoku.illegal.select': '选不中这个格子',
  'sudoku.illegal.value': '只能填 1-9',
  'sudoku.illegal.noselect': '先选中一个空格',
  'sudoku.illegal.given': '题目给定的数字不能改',
  'sudoku.illegal.occupied': '这格已经有数字了',
  'sudoku.illegal.conflict': '与所在行、列或宫里的数字重复',
  'sudoku.illegal.action': '不认识这个操作',
  'sudoku.illegal.state': '存档数据不可用',

  'sudoku.result.title': '完成',
  'sudoku.result.detail__other': '已填满 {count} 格',
  'sudoku.result.clues__other': '本题提示数 {count}',
}

export const sudokuEn: Dict = {
  'sudoku.title': 'Sudoku',
  'sudoku.rules.body':
    'Fill the 9x9 grid with 1-9 so that no digit repeats in any row, column or 3x3 box. Tap a cell, then tap a digit button.',
  'sudoku.rules.body2':
    'Given digits (heavier outline) cannot be changed; use Clear to remove a digit you filled in yourself.',
  'sudoku.rules.restart': 'Restarting deals a new puzzle and discards your current progress.',

  'sudoku.difficulty.starter': 'Starter',
  'sudoku.difficulty.skilled': 'Skilled',
  'sudoku.difficulty.challenging': 'Challenging',

  // Stats labels carry no interpolation: the shell only calls t(labelKey)
  'sudoku.stat.filled': 'Filled',
  'sudoku.stat.total': 'Cells',
  'sudoku.stat.empty': 'Empty',

  'sudoku.digit.1': '1',
  'sudoku.digit.2': '2',
  'sudoku.digit.3': '3',
  'sudoku.digit.4': '4',
  'sudoku.digit.5': '5',
  'sudoku.digit.6': '6',
  'sudoku.digit.7': '7',
  'sudoku.digit.8': '8',
  'sudoku.digit.9': '9',

  'sudoku.action.clear': 'Clear',
  'sudoku.action.clearHint': 'Clear the selected cell',

  'sudoku.illegal.notice': 'That move is not allowed',
  'sudoku.illegal.difficulty': 'Unknown difficulty',
  'sudoku.illegal.select': 'That cell cannot be selected',
  'sudoku.illegal.value': 'Only 1-9 can be entered',
  'sudoku.illegal.noselect': 'Select an empty cell first',
  'sudoku.illegal.given': 'Given digits cannot be changed',
  'sudoku.illegal.occupied': 'That cell already has a digit',
  'sudoku.illegal.conflict': 'That digit repeats in its row, column or box',
  'sudoku.illegal.action': 'Unknown action',
  'sudoku.illegal.state': 'Save data is not usable',

  'sudoku.result.title': 'Solved',
  'sudoku.result.detail__one': 'All {count} cell filled',
  'sudoku.result.detail__other': 'All {count} cells filled',
  'sudoku.result.clues__one': 'This puzzle had {count} clue',
  'sudoku.result.clues__other': 'This puzzle had {count} clues',
}
