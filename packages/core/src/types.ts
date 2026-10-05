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
 *       head / tail（有朝向的头部 / 尾端，配合 CellView.facing 画成朝向一侧的图形；贪吃蛇用）、
 *       segment（连向相邻格的一节，配合 CellView.links 画成连续的管；贪吃蛇的身体）
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
  | 'segment'

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
  /**
   * 格子文字的**文案 key**（需要翻译时用它，不要往 glyph 里写中文）。
   *
   * 由来：俄罗斯方块消行定格那一拍要在整条黑带上写「消行」（见 docs/juice/README.md），
   * 而 `glyph` 是字面量 —— 字面量里的中文会绕过 i18n，英文界面就漏翻译（`check-i18n.mjs` 会直接拦下）。
   * 给了 `glyphKey` 就以它为准：**壳层翻译后**再渲染（游戏包继续只给 key，与其它展示字段同一套约定）。
   * 文字是数字/符号（+800、42、○）时用 `glyph` 就够了，不需要 key。
   */
  glyphKey?: string
  /**
   * 这一格**反色呈现**（黑格翻成白格、字翻成黑字）。
   *
   * 俄罗斯方块的消行定格用它做三拍：① 要被消掉的那几行变白 → ② 白底上出黑字
   * （「消行 +100」，见 glyphKey/banner）→ ③ 行消失、上面的方块落下来。
   * 一格只有黑与白两种状态，所以"变白"本身就是最醒目的标记：整行连成一条白带，
   * 压在黑压压的堆里一眼就能看到（不加描边 —— 加了内框反而会把第二拍的黑字切碎）。
   * 与 `banner` 的区别：这个是"这一格内容反色"，那个是"这一格的文字可以比格子宽"。
   */
  flash?: boolean
  /**
   * 这一格的文字是**横幅**：允许比格子宽，壳层必须保证它不被相邻格盖住。
   *
   * 由来：俄罗斯方块消行定格那一拍要在整条黑带上写「消行 +800」——
   * 黑带是一整行黑格，而相邻格子的背景会把溢出的文字**盖掉**
   * （真机实测：`Line clear` 只剩 `Line cl`、`+100` 只剩 `+10`）。
   * 壳层的做法是把文字绝对定位锚在**这一格**上（仍然按格，不是独立覆盖层 ——
   * "覆盖层自成一坐标系"那套做法历史上在真机上整体错过位，见下面 BoardView 的注释）。
   *
   * 只在文字可能比格子宽时才需要它；数字类玩法（数独 / 2048 / 扫雷）一格一个数，不用标。
   */
  banner?: boolean
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
  /**
   * 这一格连向哪些相邻格（目前只对 segment 有意义）：壳层从格子中心朝这些方向各伸出一段，
   * 相邻格互相连上，整条就成了一根连续的管；拐弯处外角是圆的。
   */
  links?: readonly MoveDir[]
  /** 右/下邻格属于同一块棋子：该边不画格线（华容道用） */
  mergeRight?: boolean
  mergeBottom?: boolean
  /**
   * 棋子**圆片**的画法（象棋用）：`light` = 白底黑字 + 双边框，`dark` = 黑底白字 + 粗边框。
   * 为什么需要它：1-bit 屏上没有颜色，两方棋子若只是同一个字（象棋的马/车/炮就是），
   * 玩家分不清谁是谁（用户实测反馈过）；给棋子一个实心底色，双方就一眼可辨。
   * 名字用 light/dark 而不是 red/black：契约不认识具体玩法。
   */
  disc?: 'light' | 'dark'
  /** 当前选中/光标所在格：壳层加重描边（黑白屏上靠线宽区分，不用灰度） */
  selected?: boolean
  /**
   * 上一手的**起点**：棋子已经离开这一格，壳层在格子中心点一个小圆点当"痕迹"。
   * 与 `lastTo` 配对使用 —— 让玩家一眼看出这一步从哪走到哪，而不必回头记。
   * 用位置痕迹而不是放大/加粗字形：1-bit 屏上字号一放大，笔画密的字（如象棋的「马」）
   * 就会糊成一团，位置信息反而更可靠。
   *
   * 值是**方号**（0/1），不是布尔 —— 双方各自的最后一手都要能标出来，且 1-bit 屏上
   * 不能靠颜色区分，所以壳层按方号换形状：0（红/白棋）= 空心圆点 ○，1（黑棋）= 实心圆点 ●，
   * 与棋子底色同调（白子挖空、黑子填实）。
   * 写成 `0 | 1` 而不是 `boolean` 是有意的：`0` 是合法值，任何地方都必须按
   * `!== undefined` 判断，不能写 `if (cell.lastFrom)`（那样 0 会被当成"没有"）。
   */
  lastFrom?: 0 | 1
  /**
   * 上一手的**终点**：壳层给这一格加一圈内描边（反白格上自动改用白描边，仍是 1-bit）。
   * 只描边、不改字号：棋子本身保持与其它棋子相同的字号，方便一眼比较。
   * 方号含义同 `lastFrom`：0 = 单线粗框，1 = 双线框（靠线数而不是颜色区分红黑）。
   */
  lastTo?: 0 | 1
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

/**
 * 牌桌（扑克类玩法用，与格子棋盘二选一）：壳层画成「上方底牌 / 左右两家 / 中间提示 / 下方手牌」。
 *
 * 只描述**能看到的东西**：别人的手牌只给张数（联机时服务器也只会下发这些）。
 * 牌面字符（点数、花色符号）由壳层画，游戏只给结构化的点数与花色，不给像素与样式。
 */
export interface CardFace {
  /** 牌的 id：点手牌时壳层把它交给 selectAction */
  id: number
  /** 点数文字（A、2、10…）；王为空串，由 joker 决定怎么画 */
  rank: string
  suit: 'spade' | 'heart' | 'club' | 'diamond' | null
  joker?: 'small' | 'big'
  /** 已选中（壳层把它抬高一截） */
  selected?: boolean
}

export interface CardTableSeat {
  position: 'left' | 'right' | 'bottom'
  /** 座位名的文案 key */
  nameKey: string
  /** 头像样式编号（壳层自带几种 1-bit 头像；bottom 座位不画头像） */
  avatar: number
  /** 身份角标（如「地主」）的文案 key */
  badgeKey?: string
  /** 剩余张数（null = 不显示） */
  count: number | null
  /** 正在等这一家出牌 / 叫分 */
  active: boolean
  /** 本轮最近一手出的牌（null = 没出牌） */
  played: CardFace[] | null
  /** 本轮最近一手的文字状态（不出 / 不叫 / 2 分…），与 played 二选一 */
  statusKey?: string
  statusParams?: Record<string, string | number>
}

export interface CardTableView {
  kind: 'cards'
  seats: CardTableSeat[]
  /** 桌面中央的牌（斗地主的底牌）；hidden = 还没公开，画成牌背 */
  center: { cards: CardFace[]; hidden: number } | null
  /** 自己的手牌（理牌顺序） */
  hand: CardFace[]
  /** 桌面中央的一行提示（你的回合 / 请叫分…） */
  bannerKey?: string
  bannerParams?: Record<string, string | number>
}

/**
 * 对决面板（双方轮流行动、各有血量与道具的玩法用，如恶魔轮盘赌）：与格子棋盘 / 牌桌三选一。
 * 壳层画成「上方一家 / 中间枪与弹仓 / 最近记录 / 下方一家」。
 *
 * 文案一律是 key；需要嵌入人名的句子用 subjectKey / objectKey（壳层先翻译再代入 {subject} / {object}）。
 * 道具图标与头像只给名字（icon / portrait），图形由壳层的 1-bit 图标集负责。
 */
export interface DuelLine {
  key: string
  params?: Record<string, string | number>
  subjectKey?: string
  objectKey?: string
  /** 记录里要圈出来的一条（对手回合发生的事）；相邻的几条壳层合进同一个框 */
  highlight?: boolean
}

export interface DuelItem {
  /** 点这件道具时交给 selectAction 的编号 */
  id: number
  icon: string
  labelKey: string
  /** 刚拿到的（壳层标一个「新」） */
  fresh?: boolean
  /** 现在能不能点（轮到这一方、且是真人在操作） */
  selectable: boolean
}

export interface DuelSide {
  position: 'top' | 'bottom'
  nameKey: string
  /** 头像名（壳层自带：devil / player / player1 / player2） */
  portrait: string
  hp: number
  maxHp: number
  items: DuelItem[]
  itemCapacity: number
  /** 正在等这一方行动 */
  active: boolean
  /** 状态角标（如「被铐住」）的文案 key */
  statusKey?: string
  /** 已赢的轮数 */
  wins: number
}

/** 弹仓里的一发：实 / 空（已公开）、未知、自己知道是实 / 空 */
export type DuelToken = 'live' | 'blank' | 'unknown' | 'knownLive' | 'knownBlank'

export interface DuelView {
  kind: 'duel'
  sides: DuelSide[]
  /** 已打出 / 退出的弹（公开） */
  spent: Array<'live' | 'blank'>
  /** 枪里的弹（装填阶段为公开的组成；之后按自己知道的显示） */
  chamber: DuelToken[]
  /** 枪下的一行说明（装填数量 / 还剩几发 / 本轮结果） */
  caption: DuelLine
  /** 枪里剩余的数量（实弹 / 空包弹），直接醒目显示在弹仓下方；装填阶段等不需要时为 null */
  remaining?: DuelLine | null
  /** 枪上的状态标签（手锯：伤害 ×2；用过逆转器…） */
  tags: DuelLine[]
  /** 枪管是否被锯短（画法不同） */
  sawn: boolean
  /** 整场的记录（旧 → 新）；壳层放进可滚动的框里、默认停在最新一条 */
  log: DuelLine[]
}

export interface GameView {
  board: BoardView | null
  /** 对决类玩法用对决面板代替棋盘（有它时 board 为 null） */
  duel?: DuelView | null
  /** 扑克类玩法用牌桌代替棋盘（有它时 board 为 null） */
  table?: CardTableView | null
  stats: StatView[]
  /**
   * 棋盘上/下方的"吃子盘"（象棋用）：已经吃掉的棋子字形，各排一行显示在棋盘外侧的空白处。
   * 传空串表示"这一侧还没有吃到子"，但**字段本身要一直给** —— 壳层为它常驻固定高度，
   * 这样第一次吃子时棋盘不会突然缩一下（布局跳动在这个项目里是要避免的）。
   *
   * 位置约定由游戏决定：象棋红方在下，所以红方吃到的子（黑子）放下方、黑方的战果放上方。
   */
  captured?: { top: string; bottom: string }
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
  /** labelKey 的插值参数（例如「提示 ({count})」里的方案数） */
  labelParams?: Record<string, string | number>
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
  /**
   * 无尽类玩法的成绩（越大越好，如撑过的轮数）；不适用时返回 null。
   * 声明了它，壳层就在一局结束时按内容 id 记「最高纪录」（跨局保留），并在结果面板显示
   * `${i18nNamespace}.result.best`（参数 count）与破纪录时的 `${i18nNamespace}.result.newRecord`。
   */
  scoreOf?(state: S): number | null
  /**
   * **真实结果**（可选）。`status()` 只有 `playing / won / lost` 三态，平局在 `status` 上并入
   * `won` —— 必须并（否则壳层不认为对局结束、不渲染结果面板，而结果面板的标题本来
   * 就取自 `view().result`，不会把平局说成「你输了」）。但**战绩记录**需要知道真相：
   * 声明了本钩子的玩法，平局只写一条「未获胜」的历史记录，**不写**通关进度与最佳成绩。
   *
   * 只有「存在平局」的玩法需要声明（五子棋满盘、象棋三次重复局面）。
   * 壳层只在 `status` 变为非 playing 的那一次跃迁上询问它，平时不调用。
   */
  outcomeOf?(state: S): 'won' | 'lost' | 'draw'
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
  /**
   * 自动步进**由谁执行**（配合 `tickMs` 使用，缺省 `'self'`）：
   *
   * - `'self'`：走的是**玩家自己的局面**（贪吃蛇自动前进、俄罗斯方块自动下落）。
   *   玩家每次有效输入都重置间隔 —— 否则「刚按完转向，下一拍立刻到点」，
   *   在墨水屏上看起来像吞输入（这是当初加输入延迟补偿的原因）。
   * - `'opponent'`：走的是**对手的应手**（五子棋 / 中国象棋 / 斗地主 / 恶魔轮盘赌的电脑回合）。
   *   壳层只在「刚刚轮到对手」的那一次重置计时；等待应手期间玩家再点自己的棋子、手牌、
   *   道具不会把对手的思考一直往后推（实测：连点 3.6 秒，电脑一步不走）。
   *
   * 只有 `tickMs` 会返回非 null 的玩法需要考虑它；两类语义混在一起时（同一款游戏既有
   * 自动前进又有对手应手）按主要语义声明即可，缺省行为与历史版本完全一致。
   */
  tickActor?: 'self' | 'opponent'
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
