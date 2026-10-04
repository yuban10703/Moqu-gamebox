/**
 * 设置模型：全局默认 + 单游戏覆盖（对应 C06）。
 * 模型只描述取值，可用性由壳层决定；未知/非法字段一律回落默认值（旧存档必须仍能读入）。
 */
import type { FontScale } from './layout.js'
import type { LocaleId } from './i18n.js'

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
  perGame: Record<string, GameSettings>
}

export const DEFAULT_SETTINGS: SettingsSnapshot = {
  locale: 'auto',
  fontScale: 1,
  timer: true,
  dpad: true,
  boldLines: true,
  perGame: {},
}

export function parseSettings(raw: unknown): SettingsSnapshot {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS }
  const value = raw as Partial<SettingsSnapshot>
  const fontScale: FontScale =
    value.fontScale === 1.25 || value.fontScale === 1.5 ? value.fontScale : 1
  const locale =
    value.locale === 'zh-CN' || value.locale === 'en-US' ? value.locale : ('auto' as const)
  return {
    locale,
    fontScale,
    timer: value.timer !== false,
    dpad: value.dpad !== false,
    boldLines: value.boldLines !== false,
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
