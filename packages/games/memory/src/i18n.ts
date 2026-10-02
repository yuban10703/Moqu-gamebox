/**
 * 记忆配对文案。壳层会把本字典合并进 i18n 运行时；
 * 键前缀与 GameDef.i18nNamespace（'memory'）一致。
 *
 * 约定（与核心层一致）：
 * - 代码里不得出现硬编码界面文案，一律通过 key 取；
 * - 复数写成 `__one` / `__other`，中文只提供 `__other`；
 * - 中英「基础 key 集合」必须完全一致（dicts 测试保证）。
 */
import type { Dict } from '@eink/core'

export const memoryZh: Dict = {
  'memory.title': '记忆配对',
  'memory.rules.body':
    '点开两张牌：符号相同就永久配对；符号不同则两张先保持可见，等你下一次点击时会先把它们盖回去。把所有对子都配对完成即获胜。',
  'memory.rules.body2':
    '墨水屏没有动画也没有计时：不匹配的牌不会自动翻回，盖回发生在你下一次点击时，而这一次点击同时算作新一次翻牌。撤销可以退回一次翻牌尝试。',
  'memory.rules.restart': '重开会清空当前进度并重新洗牌；同一难度与同一开局种子依然完全可复现。',
  'memory.illegal.notice': '这里不能这样点',
  'memory.notice.cover': '再点一张扣着的牌，会先把这两张盖回',
  'memory.difficulty.starter': '入门',
  'memory.difficulty.skilled': '熟练',
  'memory.difficulty.challenging': '挑战',
  'memory.stat.pairs': '已配对',
  'memory.stat.attempts': '尝试次数',
  'memory.cell.tile': '已翻开的牌',
  'memory.cell.hidden': '扣着的牌',
  'memory.won.title': '全部配对完成',
  'memory.result.attempts__other': '你共尝试了 {count} 次',
  'memory.solved.best': '该难度最佳 {count} 次',
  'memory.solved.best__other': '该难度最佳 {count} 次',
}

export const memoryEn: Dict = {
  'memory.title': 'Memory Match',
  'memory.rules.body':
    'Turn over two tiles: matching symbols pair up for good; different symbols stay visible until your next tap, which covers them back first. Pair every tile to win.',
  'memory.rules.body2':
    'E-ink has no animation and no timer: mismatched tiles never flip back on their own. They are covered at your next tap, and that tap also counts as the new flip. Undo takes back one flip attempt.',
  'memory.rules.restart':
    'Restarting clears the current progress and deals a new layout; the same difficulty and starting seed stay fully reproducible.',
  'memory.illegal.notice': 'That tile cannot be tapped',
  'memory.notice.cover': 'Tap another face-down tile to cover these two back first',
  'memory.difficulty.starter': 'Starter',
  'memory.difficulty.skilled': 'Skilled',
  'memory.difficulty.challenging': 'Challenging',
  'memory.stat.pairs': 'Pairs',
  'memory.stat.attempts': 'Attempts',
  'memory.cell.tile': 'Face-up tile',
  'memory.cell.hidden': 'Face-down tile',
  'memory.won.title': 'All pairs matched',
  'memory.result.attempts__one': 'You made {count} attempt',
  'memory.result.attempts__other': 'You made {count} attempts',
  'memory.solved.best': 'Best for this difficulty: {count} attempts',
  'memory.solved.best__one': 'Best for this difficulty: {count} attempt',
  'memory.solved.best__other': 'Best for this difficulty: {count} attempts',
}
