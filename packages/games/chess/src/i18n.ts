/** 中文文案。玩法说明三段合计 ≤ 130 字（P6Plus 18px 六行预算，超了会折成「阅读全部」）。 */
import type { Dict } from '@eink/core'

/** 中文文案。玩法说明三段合计 ≤ 130 字（P6Plus 18px 六行预算，超了会折成「阅读全部」）。
 *  复数用扁平后缀键（`key__one` / `key__other`），与核心层约定一致。 */
export const chessZh: Dict = {
  'chess.title': '国际象棋',
  'chess.rules.body': '你执白先行：点自己的子，再点高亮的落点走子；黑方会自己应手。',
  'chess.rules.body2': '兵直走斜吃、到底线升变为后；王车易位、吃过路兵按标准规则。被将军必须应将，无路可走即输。',
  'chess.rules.body3': '将死对方即获胜；无子可动的逼和、三次重复、50 回合无吃子无动兵都判和。',
  'chess.rules.restart': '重开会清空当前对局',
  'chess.illegal.notice': '这一步不能走',
  'chess.won.title': '你赢了',
  'chess.lost.title': '你输了',
  'chess.draw.title': '和棋',
  'chess.result.moves__other': '你共走了 {count} 步',
  'chess.result.draw': '未分胜负',
  'chess.stat.white': '白子',
  'chess.stat.black': '黑子',
  'chess.stat.moves': '步数',
  'chess.cell.tile': '棋子',
  'chess.cell.goal': '可落点',
  'chess.cell.empty': '空格',
  'chess.difficulty.starter': '入门',
  'chess.difficulty.skilled': '熟练',
  'chess.difficulty.challenging': '挑战',
}

/** 英文文案（key 与中文一一对应） */
export const chessEn: Dict = {
  'chess.title': 'Chess',
  'chess.rules.body': 'You play White first. Tap a piece, then a marked square.',
  'chess.rules.body2': 'Escape check or lose. Castling and en passant are standard.',
  'chess.rules.body3': 'Pawns become queens. Checkmate wins; stalemate or repetition draws.',
  'chess.rules.restart': 'Restarting clears the current game',
  'chess.illegal.notice': 'That move is not allowed',
  'chess.won.title': 'You won',
  'chess.lost.title': 'You lost',
  'chess.draw.title': 'Draw',
  'chess.result.moves__one': 'You finished in {count} move',
  'chess.result.moves__other': 'You finished in {count} moves',
  'chess.result.draw': 'No decisive result',
  'chess.stat.white': 'White',
  'chess.stat.black': 'Black',
  'chess.stat.moves': 'Moves',
  'chess.cell.tile': 'Piece',
  'chess.cell.goal': 'Target',
  'chess.cell.empty': 'Empty',
  'chess.difficulty.starter': 'Starter',
  'chess.difficulty.skilled': 'Skilled',
  'chess.difficulty.challenging': 'Challenging',
}
