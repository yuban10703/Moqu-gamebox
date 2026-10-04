/**
 * 设置模型：全局默认 + 单游戏覆盖（对应 C06）。
 * 模型只描述取值，可用性由壳层决定；未知/非法字段一律回落默认值（旧存档必须仍能读入）。
 */
import type { FontScale } from './layout.js'
import type { LocaleId } from './i18n.js'

/**
 * 未翻格（扫雷未翻格 / 记忆配对扣着的牌）的呈现风格。
 *
 * 四种都试过、都在真机上量过（见 docs/eink-guidelines.md「覆盖格的标记」）：
 *   stripes   单斜纹（**当前默认**，用户选定）—— 1px 线 / 7px 周期（初版是 5px，用户要"间隔大一点"）
 *   mark      居中实心方块 —— 纯黑白、逐格居中、任何刷新档都稳定
 *   markLarge 大方块 —— 同上的放大版，格子大时更醒目
 *   hollow    空心方块 —— 墨量更少，观感更轻
 *   dots      网点（1-bit 抖动，4px 点阵）—— 看起来是浅灰，纯黑白
 *   gray      真灰色块 —— 只有支持灰阶的刷新档才是真灰，快刷档会被系统抖成噪点
 *
 * 做成设置项是因为口味因人因机而异（有人常开灰阶档、有人只用快刷）；
 * 默认按用户要求回到**单斜纹**，其余五种留在暂停菜单里可选。
 */
export type CoverStyle = 'mark' | 'markLarge' | 'hollow' | 'dots' | 'gray' | 'stripes'

/** 选项顺序即暂停菜单里循环切换的顺序 */
export const COVER_STYLES: readonly CoverStyle[] = [
  'mark',
  'markLarge',
  'hollow',
  'dots',
  'gray',
  'stripes',
]

export const DEFAULT_COVER_STYLE: CoverStyle = 'stripes'

/** 循环到下一个风格（暂停菜单里那一个按钮用它切换） */
export function nextCoverStyle(current: CoverStyle): CoverStyle {
  const index = COVER_STYLES.indexOf(current)
  return COVER_STYLES[(index + 1) % COVER_STYLES.length] ?? DEFAULT_COVER_STYLE
}

export interface GameSettings {
  difficulty?: string
  timer?: boolean
  dpad?: boolean
  boldLines?: boolean
}

export interface SettingsSnapshot {
  /** auto 表示跟随系统语言 */
  locale: LocaleId | 'auto'
  fontScale: FontScale
  timer: boolean
  dpad: boolean
  boldLines: boolean
  /** 未翻格的呈现风格（全局；扫雷与记忆配对共用） */
  coverStyle: CoverStyle
  perGame: Record<string, GameSettings>
}

export const DEFAULT_SETTINGS: SettingsSnapshot = {
  locale: 'auto',
  fontScale: 1,
  timer: true,
  dpad: true,
  boldLines: true,
  coverStyle: DEFAULT_COVER_STYLE,
  perGame: {},
}

export function parseSettings(raw: unknown): SettingsSnapshot {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS }
  const value = raw as Partial<SettingsSnapshot>
  const fontScale: FontScale =
    value.fontScale === 1.25 || value.fontScale === 1.5 ? value.fontScale : 1
  const locale =
    value.locale === 'zh-CN' || value.locale === 'en-US' ? value.locale : ('auto' as const)
  // 未知/非法风格一律回落默认值（旧存档必须仍能读入）
  const coverStyle = COVER_STYLES.includes(value.coverStyle as CoverStyle)
    ? (value.coverStyle as CoverStyle)
    : DEFAULT_COVER_STYLE
  return {
    locale,
    fontScale,
    timer: value.timer !== false,
    dpad: value.dpad !== false,
    boldLines: value.boldLines !== false,
    coverStyle,
    perGame: typeof value.perGame === 'object' && value.perGame !== null ? value.perGame : {},
  }
}

export function mergeSettings(
  base: SettingsSnapshot,
  patch: Partial<SettingsSnapshot>,
): SettingsSnapshot {
  return parseSettings({ ...base, ...patch, perGame: patch.perGame ?? base.perGame })
}

export function setGameSettings(
  base: SettingsSnapshot,
  gameId: string,
  patch: GameSettings,
): SettingsSnapshot {
  const current = base.perGame[gameId] ?? {}
  const merged: GameSettings = { ...current, ...patch }
  for (const key of Object.keys(merged) as Array<keyof GameSettings>) {
    if (merged[key] === undefined) delete merged[key]
  }
  return { ...base, perGame: { ...base.perGame, [gameId]: merged } }
}

export interface EffectiveSettings {
  difficulty: string | undefined
  timer: boolean
  dpad: boolean
  boldLines: boolean
  fontScale: FontScale
  locale: LocaleId | 'auto'
}

/** 全局默认 + 单游戏覆盖后的最终取值 */
export function effectiveSettings(
  snapshot: SettingsSnapshot,
  gameId: string,
): EffectiveSettings {
  const override = snapshot.perGame[gameId] ?? {}
  return {
    difficulty: override.difficulty,
    timer: override.timer ?? snapshot.timer,
    dpad: override.dpad ?? snapshot.dpad,
    boldLines: override.boldLines ?? snapshot.boldLines,
    fontScale: snapshot.fontScale,
    locale: snapshot.locale,
  }
}
