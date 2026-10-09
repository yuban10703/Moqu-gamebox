/**
 * 数织文案。壳层会把本字典合并进 i18n 运行时；
 * 中英两种语言的**基础 key 集合必须完全一致**（compareDicts / check-i18n 会校验）。
 *
 * 复数约定（与其它玩法一致）：带 `{count}` 的句子在英文里写 `__one` / `__other`，
 * 中文只写 `__other`（中文不需要复数变化）。
 */
import type { Dict } from '@eink/core'

export const nonogramZh: Dict = {
  'nonogram.title': '数织',
  'nonogram.rules.body':
    '每行、每列外面的数字是这一行（列）连续黑格的段长，按顺序排列；相邻两段之间至少空一格。点格子循环切换三态：空 → 黑 → 叉。',
  'nonogram.rules.body2':
    '叉和空在过关判定里一样算"非黑"，叉只是给自己做的记号。点「检查」只会告诉你共有几行（列）与线索不符，不会标出是哪些行，更不会揭示答案。',
  'nonogram.rules.restart': '重开会换一道题，当前的标记会全部清空。',

  'nonogram.difficulty.starter': '入门',
  'nonogram.difficulty.skilled': '熟练',
  'nonogram.difficulty.challenging': '挑战',

  // 统计栏文案不带插值：壳层对 stats.labelKey 只做 t(labelKey)
  'nonogram.stat.puzzle': '题号',
  'nonogram.stat.black': '已涂',
  'nonogram.stat.wrong': '不符行数',

  'nonogram.action.clear': '清屏',
  'nonogram.action.check': '检查',

  // 检查结果：**数量**在统计栏的「不符行数」里（notice 只有文案 key、没有插值参数，
  // 所以这里只说"去看那个数"，不假装自己能报数字）
  'nonogram.notice.check': '已检查：不符的行列数见「不符行数」',

  'nonogram.illegal': '这里不能这样操作',
  'nonogram.illegal.difficulty': '未知难度',
  'nonogram.illegal.index': '点不到这个格子',
  'nonogram.illegal.finished': '这一题已经完成',
  'nonogram.illegal.action': '不认识这个操作',
  'nonogram.illegal.state': '存档数据不可用',

  // 格子无障碍标签（apps/web 的 cellLabelKey 按 `<namespace>.cell.<kind>` 取）
  'nonogram.cell.mine': '黑格',
  'nonogram.cell.flag': '叉，已排除',
  'nonogram.cell.empty': '空格',

  'nonogram.result.title': '涂好了',
  'nonogram.result.moves__other': '本局 {count} 步',
  'nonogram.result.puzzle__other': '第 {count} 题',
  // 壳层在结果面板的最后接一句「最佳 N 步」（i18n.t，参数名 count）。
  // 缺了它面板会直接印出 ⟦nonogram.solved.best⟧ —— 走查实测就是这个。
  'nonogram.solved.best': '最佳 {count} 步',
}

export const nonogramEn: Dict = {
  'nonogram.title': 'Nonogram',
  'nonogram.rules.body':
    'The numbers outside each row and column are the lengths of its runs of black cells, in order; two runs are separated by at least one blank cell. Tap a cell to cycle through blank → black → cross.',
  'nonogram.rules.body2':
    'Crosses count as blank when the puzzle is judged — they are only your own notes. Check counts how many lines disagree with their clues; it never shows which ones and never reveals the answer.',
  'nonogram.rules.restart': 'Restarting deals another puzzle and clears every mark.',

  'nonogram.difficulty.starter': 'Starter',
  'nonogram.difficulty.skilled': 'Skilled',
  'nonogram.difficulty.challenging': 'Challenging',

  'nonogram.stat.puzzle': 'Puzzle',
  'nonogram.stat.black': 'Filled',
  'nonogram.stat.wrong': 'Wrong lines',

  'nonogram.action.clear': 'Clear',
  'nonogram.action.check': 'Check',

  'nonogram.notice.check': 'Checked — see the “Wrong lines” stat for how many disagree',

  'nonogram.illegal': 'That action is not allowed here',
  'nonogram.illegal.difficulty': 'Unknown difficulty',
  'nonogram.illegal.index': 'Cannot tap that cell',
  'nonogram.illegal.finished': 'This puzzle is already solved',
  'nonogram.illegal.action': 'Unknown action',
  'nonogram.illegal.state': 'Save data is not usable',

  'nonogram.cell.mine': 'Black cell',
  'nonogram.cell.flag': 'Crossed out',
  'nonogram.cell.empty': 'Empty cell',

  'nonogram.result.title': 'Solved',
  'nonogram.result.moves__one': '{count} move',
  'nonogram.result.moves__other': '{count} moves',
  'nonogram.result.puzzle__one': 'Puzzle {count}',
  'nonogram.result.puzzle__other': 'Puzzle {count}',
  'nonogram.solved.best': 'Best {count} moves',
}
