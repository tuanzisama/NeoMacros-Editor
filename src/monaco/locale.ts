/**
 * Monaco UI 语言目录与解析。monaco ESM 的界面文案（查找框/右键菜单等）
 * 来自 globalThis._VSCODE_NLS_MESSAGES，由 esm/vs/nls/lang/<locale>.js
 * 副作用模块装载（见 nls-boot.ts），须在 editor.main 求值前完成。
 */

export const MONACO_LOCALES = [
  'en',
  'zh-cn',
  'zh-tw',
  'ja',
  'ko',
  'de',
  'es',
  'fr',
  'it',
  'pl',
  'pt-br',
  'ru',
  'tr',
  'cs',
] as const

export type MonacoLocale = (typeof MONACO_LOCALES)[number]

export type LanguageSetting = 'auto' | MonacoLocale

/** 语言选择器显示名：各语言用本语言书写 */
export const LOCALE_LABELS: Record<MonacoLocale, string> = {
  en: 'English',
  'zh-cn': '简体中文',
  'zh-tw': '繁體中文',
  ja: '日本語',
  ko: '한국어',
  de: 'Deutsch',
  es: 'Español',
  fr: 'Français',
  it: 'Italiano',
  pl: 'Polski',
  'pt-br': 'Português (Brasil)',
  ru: 'Русский',
  tr: 'Türkçe',
  cs: 'Čeština',
}

/** ISO 基础语种 → monaco 可用项；zh 的繁体变体在下方特判 */
const BASE_LOCALE: Partial<Record<string, MonacoLocale>> = {
  en: 'en',
  zh: 'zh-cn',
  ja: 'ja',
  ko: 'ko',
  de: 'de',
  es: 'es',
  fr: 'fr',
  it: 'it',
  pl: 'pl',
  pt: 'pt-br',
  ru: 'ru',
  tr: 'tr',
  cs: 'cs',
}

/** auto：按浏览器语言列表映射，未命中回退 en */
export function resolveMonacoLocale(pref: LanguageSetting): MonacoLocale {
  if (pref !== 'auto') return pref
  for (const tag of navigator.languages) {
    const lower = tag.toLowerCase()
    const [lang, region] = lower.split('-')
    if (lang === 'zh' && (lower.includes('hant') || region === 'tw' || region === 'hk' || region === 'mo')) {
      return 'zh-tw'
    }
    const hit = BASE_LOCALE[lang]
    if (hit) return hit
  }
  return 'en'
}
