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
 *       number（已翻开且带数字）、tile（承载数字/文字的方块）、given（题目给定，描边更重）、
 *       head / tail（有朝向的头部 / 尾端，配合 CellView.facing 画成朝向一侧的图形；贪吃蛇用）
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
  | 'head'
  | 'tail'

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
  /**
   * 该格内容"填错"（合法但不对）。壳层据此在格子上画一个 1px 的叉**覆盖**住数字 ——
   * 墨水屏不能靠颜色，用形状标记比在文字前加前缀更干净（数字本身保持整齐）。
   */
  wrong?: boolean
  /**
   * 有朝向的图形朝哪边（目前只对 head / tail 有意义）：
   * head = 前进方向（圆头与眼睛朝这边）；tail = 远离身体的方向（尾尖指向这边）。
   * 图形按 up 画好，壳层按朝向整体旋转 —— 不靠灰度，单靠形状就能看出往哪走。
   */
  facing?: MoveDir
  /** 右/下邻格属于同一块棋子：该边不画格线（华容道用） */
  mergeRight?: boolean
  mergeBottom?: boolean
  selected?: boolean
  /**
   * 格内文字的字号系数（相对格子边长，缺省 0.66）。
   * 用于区分「题目给定」与「玩家填入」这类同格内容 —— 黑白屏上字号比颜色可靠。
   * 由游戏声明而不是壳层写死，避免同一 kind 在不同玩法里被误改字号。
   */
  textScale?: number
}

export interface BoardView {
  kind: 'grid'
  cols: number
  rows: number
  cells: CellView[]
  /**
   * 格子分组（每 groupCols × groupRows 为一组），壳层会在组边界画**更粗的分隔线**。
   * 数独的 3×3 宫就是典型用法：没有它，9×9 里所有线一样细，宫结构看不出来。
   */
  groups?: { cols: number; rows: number }
  /*
   * 曾经有过 `labels`（整块文字的绝对定位覆盖层）：覆盖层与格子网格是两套坐标系，
   * 真机上整体错位（棋盘元素在 (30,211)、格子在 (172,259)），用户看到的名字与可点区域对不上。
   * 现在改成"名字写进锚格内部 + 同块合并格线"，视觉元素一律按格，因此这个字段已删除。
   */
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

/**
 * 自动步进的间隔下限（毫秒）—— **所有玩法都必须遵守**。
 *
 * 依据（真机实测，不是估计）：BOOX 面板能完成的整屏刷新约 **2 次/秒**
 * （见 docs/refresh-adaptation.md「高频全刷为什么不是功能」，每次完整刷新 ≈500ms）。
 * 间隔低于 400ms 时，一次重绘还没走完下一次就来了：玩家看到的不是运动，而是跳变与残影。
 * 壳层按这个常量做兜底钳位 —— 游戏即使声明了更小的值也不会真的跑得更快。
 */
export const MIN_TICK_MS = 400

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
  /**
   * 把「点了某个 role:'action' 的控件」映射成动作；返回 null 表示无动作。
   *
   * 为什么需要：`controls()` 里除方向键外的按钮（数独数字键、扫雷标记模式开关）
   * 必须由**游戏自己**说明点下去派发什么，否则壳层只能硬编码少数几个动作 id，
   * 新游戏的按钮就点不到（这正是接入扫雷时发现的缺口）。
   */
  controlAction?(state: S, controlId: string): A | null
  /**
   * 内容 id：用于「继续」定位与通关进度。关卡制游戏返回关卡 id；
   * 无关卡制游戏可返回难度 id。缺省时壳层回退读 state.levelId。
   * 约定：**只会收到来自有效存档的 state**（壳层不得传 undefined）。
   */
  contentId?(state: S): string
  /**
   * 计步数：用于记录「最佳成绩」。缺口时不记录最佳（例如数独、扫雷这类不计步的玩法）。
   * 缺省时壳层回退读 state.moves。
   */
  movesOf?(state: S): number
  status(state: S): GameStatus
  view(state: S): GameView
  controls(state: S): ControlSpec[]
  /** 序列化为存档可承载的 JSON；必须与 decode 往返一致 */
  encode(state: S): unknown
  decode(raw: unknown): S
  /**
   * 自动步进间隔（毫秒）；返回 `null` = 当前不该自动步进（已结束 / 已暂停 / 其它）。
   *
   * 契约（对应 docs/eink-guidelines.md「允许慢速自动步进」一条）：
   * 1. **这是声明，不是定时器**：规则层仍然纯函数、零时间引用（不得出现
   *    setInterval / setTimeout / requestAnimationFrame / Date.now / performance.now），
   *    定时器只存在于壳层会话（packages/ui/src/session.ts）；
   * 2. 到点时壳层派发 `{ type: 'tick' }`，由 `reduce` 解释为「自动走一步 / 自动下落一格」；
   * 3. 返回值必须只由 `state`（与 `difficulty`）决定，不得读时钟；低于 `MIN_TICK_MS`
   *    的声明会被壳层钳到 `MIN_TICK_MS`；
   * 4. 只有需要自动步进的玩法才声明它 —— 没声明的玩法行为完全不变（壳层不会起表）。
   */
  tickMs?(state: S, difficulty: string): number | null
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
