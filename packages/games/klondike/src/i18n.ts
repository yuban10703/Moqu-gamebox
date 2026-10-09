import type { Dict } from '@eink/core'

/**
 * 空当接龙文案。
 *
 * 牌面上的 A / J / Q / K 与花色符号不进字典（各语言里都一样，与斗地主同一口径）；
 * 这里只有界面文字：牌堆名、提示、按钮、统计、结果。
 */
export const klondikeZh: Dict = {
  'klondike.title': '空当接龙',
  'klondike.rules.body':
    '把 52 张牌按花色收进 4 个基础堆：同一花色从 A 一路升到 K 就收满了。牌列里只能红黑交替、点数递减地叠（♠9 上只能放 ♡8 或 ♢8），空列只接 K 打头的序列。抽牌堆一次翻 1 张（入门）或 3 张（熟练），翻出来的牌进弃牌堆，只有弃牌堆最上面那张能动；抽牌堆空了再点它，整叠弃牌堆会倒扣回去重翻，次数不限。',
  'klondike.rules.body2':
    '点一张明牌把它提起来（从那张到列顶的整段合法序列会一起提起），再点目标牌堆放下；点同一张牌取消。点抽牌堆就是翻牌。牌列里露出来的牌背会自动翻开。',
  'klondike.rules.body3':
    '上排是抽牌堆、弃牌堆与 4 个基础堆，下排是 7 个牌列（每一列从列顶往下排）；每一堆都能点，带斜纹方块的是没翻开的牌背。空列与空基础堆的虚线空位也可以点：先点一张明牌把它提起来，再点那个空位，就是把这一段放到那儿（空列只接 K 打头的序列，空基础堆只接 A）。',
  'klondike.rules.restart': '重新开始会换一副新牌（重新洗牌、局号归零）；想重玩手里这一副，用对局页的「重开本局」。',
  'klondike.difficulty.starter': '入门',
  'klondike.difficulty.skilled': '熟练',
  'klondike.illegal.notice': '这里不能这样动牌',
  'klondike.pile.stock': '抽牌堆',
  'klondike.pile.waste': '弃牌堆',
  'klondike.pile.foundation': '基础堆',
  'klondike.pile.tableau': '牌列',
  'klondike.banner.pick': '点一张明牌，或点抽牌堆翻牌',
  'klondike.banner.drop': '再点目标牌堆放下；点同一张牌取消',
  'klondike.action.collect': '自动收牌',
  'klondike.action.restartDeal': '重开本局',
  'klondike.action.nextDeal': '换一局',
  'klondike.stat.moves': '步数',
  'klondike.stat.collected': '已收牌',
  'klondike.stat.deal': '局号',
  'klondike.won.title': '四堆全部收满',
  'klondike.result.deal__other': '第 {count} 局',
  'klondike.result.moves__other': '共 {count} 步',
  'klondike.solved.best': '最佳 {count} 步',
}

export const klondikeEn: Dict = {
  'klondike.title': 'Klondike',
  'klondike.rules.body':
    'Collect all 52 cards onto the four foundations: one suit each, from ace up to king. Columns build down in alternating colours (a black 9 takes a red 8) and an empty column only takes a run led by a king. The stock turns over 1 card at a time (Starter) or 3 (Skilled) onto the waste, and only the top waste card can be moved; tap an empty stock to turn the whole waste back over, as often as you like.',
  'klondike.rules.body2':
    'Tap a face-up card to pick it up (the whole valid run from that card to the top of the column comes with it), then tap the pile you want to drop it on; tap the same card again to cancel. Tapping the stock turns a card over. Face-down cards at the top of a column flip over by themselves.',
  'klondike.rules.body3':
    'The top row is the stock, the waste and the four foundations; the seven columns sit below (each from its top card downwards). Every pile is tappable, and a hatched square is a face-down card. The dashed empty slot of an empty column or foundation is tappable too: pick a face-up card up, then tap that slot to drop the run there (only a run led by a king fits an empty column, only an ace fits an empty foundation).',
  'klondike.rules.restart': 'Restart shuffles a brand new deal (the deal number starts over). To replay the deal you are holding, use "Restart deal" in the game screen.',
  'klondike.difficulty.starter': 'Starter',
  'klondike.difficulty.skilled': 'Skilled',
  'klondike.illegal.notice': 'That move is not allowed',
  'klondike.pile.stock': 'Stock',
  'klondike.pile.waste': 'Waste',
  'klondike.pile.foundation': 'Foundations',
  'klondike.pile.tableau': 'Columns',
  'klondike.banner.pick': 'Tap a face-up card, or tap the stock to turn one over',
  'klondike.banner.drop': 'Tap the pile to drop it on; tap the same card to cancel',
  'klondike.action.collect': 'Auto-collect',
  'klondike.action.restartDeal': 'Restart deal',
  'klondike.action.nextDeal': 'New deal',
  'klondike.stat.moves': 'Moves',
  'klondike.stat.collected': 'Collected',
  'klondike.stat.deal': 'Deal',
  'klondike.won.title': 'All four foundations are full',
  'klondike.result.deal__one': 'Deal {count}',
  'klondike.result.deal__other': 'Deal {count}',
  'klondike.result.moves__one': '{count} move',
  'klondike.result.moves__other': '{count} moves',
  'klondike.solved.best': 'Best {count} moves',
}
