/**
 * 壳层上下文：平台、设置、i18n、视口。
 * 只做装配，不含业务规则；所有值都可以在测试里注入。
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  DEFAULT_LAYOUT,
  LOCALE_LABELS,
  LOCALES,
  createI18n,
  detectLocale,
  mergeSettings,
  setGameSettings,
  type Dict,
  type DictSet,
  type FontScale,
  type I18n,
  type LayoutConfig,
  type LocaleId,
  type SettingsSnapshot,
  type Viewport,
  type GameSettings,
} from '@eink/core'
import type { AppStorage, Platform } from '@eink/platform'

export interface UiContextValue {
  platform: Platform
  storage: AppStorage
  settings: SettingsSnapshot
  /** 实际生效的语言（已把 auto 解析成具体语言） */
  locale: LocaleId
  i18n: I18n
  viewport: Viewport
  layoutConfig: LayoutConfig
  updateSettings(patch: Partial<SettingsSnapshot>): Promise<void>
  updateGameSettings(gameId: string, patch: GameSettings): Promise<void>
}

const UiContext = createContext<UiContextValue | null>(null)

export function useUi(): UiContextValue {
  const value = useContext(UiContext)
  if (!value) throw new Error('useUi must be used inside <UiProvider>')
  return value
}

export interface UiProviderProps {
  platform: Platform
  dicts: DictSet
  children: ReactNode
  /** 测试注入初始设置 */
  initialSettings?: SettingsSnapshot
}

export function UiProvider({ platform, dicts, children, initialSettings }: UiProviderProps): ReactNode {
  const [settings, setSettings] = useState<SettingsSnapshot | null>(initialSettings ?? null)
  const viewport = useViewport()

  useEffect(() => {
    if (settings) return
    let cancelled = false
    void (async () => {
      const loaded = await platform.storage.loadSettings()
      if (!cancelled) setSettings(loaded)
    })()
    return () => {
      cancelled = true
    }
  }, [platform, settings])

  const effective = settings ?? { ...(initialSettings ?? defaultSettings()) }
  const locale: LocaleId =
    effective.locale === 'auto'
      ? detectLocale(typeof navigator === 'undefined' ? [] : navigator.languages ?? [navigator.language])
      : effective.locale
  const i18n = useMemo(() => createI18n(locale, dicts), [locale, dicts])

  const updateSettings = useCallback(
    async (patch: Partial<SettingsSnapshot>) => {
      const next = mergeSettings(effective, patch)
      setSettings(next)
      await platform.storage.saveSettings(next)
    },
    [effective, platform],
  )

  const updateGameSettings = useCallback(
    async (gameId: string, patch: GameSettings) => {
      const next = setGameSettings(effective, gameId, patch)
      setSettings(next)
      await platform.storage.saveSettings(next)
    },
    [effective, platform],
  )

  const layoutConfig = useMemo<LayoutConfig>(
    () => ({ ...DEFAULT_LAYOUT, fontScale: effective.fontScale }),
    [effective.fontScale],
  )

  const value: UiContextValue = {
    platform,
    storage: platform.storage,
    settings: effective,
    locale,
    i18n,
    viewport,
    layoutConfig,
    updateSettings,
    updateGameSettings,
  }

  return <UiContext.Provider value={value}>{children}</UiContext.Provider>
}

function defaultSettings(): SettingsSnapshot {
  return {
    locale: 'auto',
    fontScale: 1,
    timer: true,
    dpad: true,
    boldLines: true,
    perGame: {},
  }
}

/** 视口实测（不要假设 1 CSS px = 1 物理 px） */
export function useViewport(): Viewport {
  const read = (): Viewport => {
    if (typeof window === 'undefined') return { width: 1024, height: 768, dpr: 1 }
    const visual = window.visualViewport
    return {
      width: Math.round(visual?.width ?? window.innerWidth),
      height: Math.round(visual?.height ?? window.innerHeight),
      dpr: Number(window.devicePixelRatio?.toFixed(3) ?? 1),
    }
  }
  const [viewport, setViewport] = useState<Viewport>(read)

  useEffect(() => {
    const update = (): void => setViewport(read())
    window.addEventListener('resize', update)
    window.addEventListener('orientationchange', update)
    window.visualViewport?.addEventListener('resize', update)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('orientationchange', update)
      window.visualViewport?.removeEventListener('resize', update)
    }
  }, [])

  return viewport
}

/** 根节点上挂语言、字号与线条偏好，供 CSS 使用 */
export function useRootAttributes(locale: LocaleId, settings: SettingsSnapshot): void {
  useEffect(() => {
    const root = document.documentElement
    root.lang = locale
    root.dataset.fontScale = String(settings.fontScale)
    root.dataset.boldLines = settings.boldLines ? 'on' : 'off'
  }, [locale, settings])
}

export const FONT_SCALE_OPTIONS: ReadonlyArray<{ value: FontScale; labelKey: string }> = [
  { value: 1, labelKey: 'shell.settings.fontScale.standard' },
  { value: 1.25, labelKey: 'shell.settings.fontScale.large' },
  { value: 1.5, labelKey: 'shell.settings.fontScale.huge' },
]

export const LOCALE_OPTIONS: ReadonlyArray<{ value: LocaleId | 'auto'; labelKey: string; label?: string }> = [
  { value: 'auto', labelKey: 'shell.settings.language.auto' },
  ...LOCALES.map((locale) => ({ value: locale, labelKey: `locale.${locale}`, label: LOCALE_LABELS[locale] })),
]

export type { Dict }
