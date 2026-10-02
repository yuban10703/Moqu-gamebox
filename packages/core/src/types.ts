/**
 * 游戏接入契约。
 *
 * 设计要点（与验收要求 F01「同输入序列双端得到同状态」直接相关）：
 * 1. 规则层的全部随机性必须来自 `create(seed, difficulty)`，且只用 core/rng 里的确定性随机源；
 *    规则层**禁止**使用 Math.random / Date.now。
 * 2. 状态是「不可变 + 可通过动作日志重放」的：`reduce` 纯函数，不做副作用。
 * 3. 撤销/重开也建模为动作，因此存档只需要保存动作日志即可完整还原局面。
 * 4. `view()` 只产出黑白可读的展示模型；具体用 DOM/SVG 还是别的呈现由壳层决定。
 */

export type MoveDir = 'up' | 'down' | 'left' | 'right'

/** 棋盘格语义：状态之间的区别必须能靠形状/符号分辨，不能只靠灰阶 */
/**
 * 格子语义。壳层只按 kind 决定「用什么图形/纹理画」与无障碍标签，
 * 不假设任何具体玩法 —— 新增游戏只需使用既有 kind 或在此追加通用 kind。
 *
 * 推箱子：floor / wall / goal / box / boxOnGoal / player / playerOnGoal
 * 通用：empty（空格）、hidden（未翻开）、flag（标记）、mine（雷）、
 *       number（已翻开且带数字）、tile（承载数字/文字的方块）、given（题目给定，描边更重）
 */
export type CellKind =
  | 'floor'
  | 'wall'
  | 'goal'
  | 'box'
  | 'boxOnGoal'
  | 'player'
  | 'playerOnGoal'
  | 'empty'
  | 'hidden'
  | 'flag'
  | 'mine'
  | 'number'
  | 'tile'
  | 'given'

export interface CellView {
  /** 行优先索引 */
  index: number
  kind: CellKind
  /**
   * 格子文字：数字类玩法（数独、2048、扫雷计数）直接放数字 ——
   * 墨水屏上数字比图标更易读；其余玩法放符号。
   * 壳层按 kind 决定是「画图形」还是「显示文字」。
   */
  glyph: string
  /** 当前选中/光标所在格：壳层加重描边（黑白屏上靠线宽区分，不用灰度） */
  selected?: boolean
}

export interface BoardView {
  kind: 'grid'
  cols: number
  rows: number
  cells: CellView[]
}

export interface StatView {
  labelKey: string
  value: string
}

export interface GameView {
  board: BoardView | null
  stats: StatView[]
  /** 结果页文案（仅在 status 非 playing 时有意义） */
  result: { titleKey: string; details: Array<{ key: string; params?: Record<string, string | number> }> } | null
  /** 需要壳层以稳定文字提示的状态（例如「这个方向走不通」），不使用动画 */
  notice: { textKey: string } | null
}

/** 壳层据此渲染可见按钮；棋盘格点击不是唯一输入方式 */
export interface ControlSpec {
  id: string
  labelKey: string
  /** dpad 会渲染成方向盘形状；action 是普通按钮 */
  role: 'action' | 'dpad'
  dir?: MoveDir
  /**
   * 仅对 action 有意义：不适用时禁用（例如没有可撤销的动作）。
   * 方向盘按钮**始终可点**：走不通时由会话给出明确的文字反馈，而不是静默无响应。
   */
  enabled: boolean
  emphasis: 'primary' | 'normal'
  /** 视觉强弱：方向盘上走不通的方向用 muted 呈现，但仍可点 */
  tone?: 'normal' | 'muted'
  /** 需要二次确认的危险操作（如覆盖已有进度） */
  confirm?: boolean
}

export type GameStatus = 'playing' | 'won' | 'lost'

export interface DifficultySpec {
  id: string
  labelKey: string
}

export interface GameDef<S, A> {
  readonly id: string
  /** 规则版本：规则语义变化时 +1，旧存档据此判定兼容性 */
  readonly rulesVersion: number
  /** 内容版本：题库/关卡包变化时 +1 */
  readonly contentVersion: number
  readonly i18nNamespace: string
  readonly difficulties: readonly DifficultySpec[]
  /** 被拒绝的输入要给出的明确文字提示（走不通 / 不能这样走） */
  readonly illegalNoticeKey?: string
  /** 确定性初始状态 */
  create(seed: number, difficultyId: string): S
  /** 纯函数；非法动作必须抛出 IllegalActionError */
  reduce(state: S, action: A): S
  /** 当前局面下被规则允许的动作（用于禁用按钮与服务端/回放校验） */
  legal(state: S): readonly A[]
  /**
   * 把「点了第 index 个格子」映射成一个动作；返回 null 表示该格不可点。
   * 数独、扫雷这类格子交互靠它接入，壳层因此不必知道任何具体玩法。
   */
  selectAction?(state: S, index: number): A | null
  status(state: S): GameStatus
  view(state: S): GameView
  controls(state: S): ControlSpec[]
  /** 序列化为存档可承载的 JSON；必须与 decode 往返一致 */
  encode(state: S): unknown
  decode(raw: unknown): S
}

export class IllegalActionError extends Error {
  constructor(
    readonly gameId: string,
    readonly reason: string,
  ) {
    super(`illegal action for ${gameId}: ${reason}`)
    this.name = 'IllegalActionError'
  }
}

export interface CompletionRecord {
  gameId: string
  difficulty: string
  finishedAt: number
  outcome: 'won' | 'lost'
  moves: number
  elapsedMs: number
  hintsUsed: number
  /** 游戏自定义的最佳记录（如最少步数） */
  best?: Record<string, number>
}
