/**
 * 极小的 i18n 运行时（不引入 i18next 之类的依赖）。
 *
 * 规则：
 * - 文案一律通过 key 取，代码里不得出现硬编码界面文案（由 tools/scripts/check-i18n.mjs 校验）。
 * - 复数用 `key__one` / `key__other` 两个键表达；中文只要求 `__other`，英文一般两个都要。
 * - 缺 key 时返回 `⟦key⟧`，让缺词在界面和测试里立刻暴露，而不是静默显示英文。
 * - 中英两种语言的**基础 key 集合必须完全一致**（校验脚本保证）。
 */
export type LocaleId = 'zh-CN' | 'en-US'

export const LOCALES: readonly LocaleId[] = ['zh-CN', 'en-US']

export const LOCALE_LABELS: Record<LocaleId, string> = {
  'zh-CN': '简体中文',
  'en-US': 'English',
}

export type Dict = Record<string, string>
export type DictSet = Partial<Record<LocaleId, Dict>>

export interface I18n {
  readonly locale: LocaleId
  t(key: string, params?: Record<string, string | number>): string
  plural(key: string, count: number, params?: Record<string, string | number>): string
  has(key: string): boolean
  /** 本次会话中缺失过的 key（诊断页展示） */
  missingKeys(): string[]
}

const FALLBACK: LocaleId = 'en-US'

export function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name]
    return value === undefined ? match : String(value)
  })
}

export function createI18n(locale: LocaleId, dicts: DictSet): I18n {
  const missing = new Set<string>()
  const lookup = (key: string): string | undefined => dicts[locale]?.[key] ?? dicts[FALLBACK]?.[key]

  const t = (key: string, params?: Record<string, string | number>): string => {
    const raw = lookup(key)
    if (raw === undefined) {
      missing.add(key)
      return `⟦${key}⟧`
    }
    return interpolate(raw, params)
  }

  const plural = (key: string, count: number, params?: Record<string, string | number>): string => {
    const suffix = count === 1 ? 'one' : 'other'
    // 先在本语言里找：中文没有 __one，必须落到本语言的 __other，
    // 而不是掉进 fallback 语言的 __one（否则中文界面会冒出英文单数形式）
    const local = dicts[locale]
    const raw =
      local?.[`${key}__${suffix}`] ??
      local?.[`${key}__other`] ??
      dicts[FALLBACK]?.[`${key}__${suffix}`] ??
      dicts[FALLBACK]?.[`${key}__other`]
    if (raw === undefined) {
      missing.add(`${key}__${suffix}`)
      return `⟦${key}__${suffix}⟧`
    }
    return interpolate(raw, { count, ...params })
  }

  return {
    locale,
    t,
    plural,
    has: (key) => lookup(key) !== undefined,
    missingKeys: () => [...missing].sort(),
  }
}

/** 由 navigator.languages 推断语言；zh 系列一律落到 zh-CN */
export function detectLocale(languages: readonly string[]): LocaleId {
  for (const lang of languages) {
    const lower = lang.toLowerCase()
    if (lower.startsWith('zh')) return 'zh-CN'
    if (lower.startsWith('en')) return 'en-US'
  }
  return 'zh-CN'
}

/**
 * 取出一个字典集合里全部「基础 key」（去掉 __one/__other 后缀），用于语言对齐校验。
 */
export function baseKeys(dict: Dict): Set<string> {
  const out = new Set<string>()
  for (const key of Object.keys(dict)) {
    out.add(key.replace(/__(one|other)$/, ''))
  }
  return out
}

export interface DictIssue {
  locale: LocaleId
  key: string
  kind: 'missing' | 'extra' | 'missing-other'
}

/**
 * 语言对齐校验（测试与 `npm run check:i18n` 共用同一份规则）：
 * 1. 各语言的基础 key 集合必须完全一致；
 * 2. 只要某语言为某个 key 定义了复数形式，所有语言都必须有 `__other`；
 * 3. `__one` 是可选的（中文只用 `__other`）。
 */
export function compareDicts(dicts: DictSet): DictIssue[] {
  const issues: DictIssue[] = []
  const present = LOCALES.filter((locale) => dicts[locale] !== undefined)
  if (present.length === 0) return issues

  const baseByLocale = new Map<LocaleId, Set<string>>()
  for (const locale of present) baseByLocale.set(locale, baseKeys(dicts[locale]!))

  const union = new Set<string>()
  for (const keys of baseByLocale.values()) for (const key of keys) union.add(key)

  for (const key of [...union].sort()) {
    for (const locale of present) {
      if (!baseByLocale.get(locale)!.has(key)) issues.push({ locale, key, kind: 'missing' })
    }
    const pluralLocales = present.filter(
      (locale) =>
        dicts[locale]![`${key}__one`] !== undefined || dicts[locale]![`${key}__other`] !== undefined,
    )
    if (pluralLocales.length === 0) continue
    for (const locale of present) {
      if (dicts[locale]![`${key}__other`] === undefined) {
        issues.push({ locale, key, kind: 'missing-other' })
      }
    }
  }
  return issues
}
