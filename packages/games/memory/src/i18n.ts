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
    '点开两张牌，符号相同即配对。全部配对完成即获胜。',
  'memory.rules.body2':
    '不匹配的牌不会自动翻回：下一次点击先盖回它们，并算作新一次翻牌。',
  'memory.rules.restart': '重开会清空当前进度并重新洗牌；同一难度与同一开局种子依然完全可复现。',
  // 点「待盖回」或「已配对」的牌时，玩家真正需要的是**下一步该点哪**：
  // 用引导语而不是泛化的「这里不能这样点」（后者会把界面上的有效引导顶掉）
  'memory.illegal.notice': '再点一张扣着的牌',
  'memory.notice.cover': '再点一张扣着的牌',
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
    'Flip two cards: equal symbols pair up. Pair every card to win.',
  'memory.rules.body2':
    'Mismatched cards stay until your next tap, which counts as a new flip.',
  'memory.rules.restart':
    'Restarting clears the current progress and deals a new layout; the same difficulty and starting seed stay fully reproducible.',
  'memory.illegal.notice': 'Tap another hidden tile',
  'memory.notice.cover': 'Tap another hidden tile',
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
