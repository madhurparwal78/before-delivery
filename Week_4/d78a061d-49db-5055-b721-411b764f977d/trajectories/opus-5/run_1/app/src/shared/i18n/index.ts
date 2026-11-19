import { en, type MessageKey } from './en.js';
import { ja } from './ja.js';
import { es } from './es.js';

export type Locale = 'en' | 'ja' | 'es';
export const LOCALES: readonly Locale[] = ['en', 'ja', 'es'] as const;
export type { MessageKey };

const DICTS: Record<Locale, Record<MessageKey, string>> = { en, ja, es };

export const LOCALE_TAGS: Record<Locale, string> = {
  en: 'en-US',
  ja: 'ja-JP',
  es: 'es-ES',
};

export const LOCALE_OPTION_NAMES: Record<Locale, string> = {
  en: 'English',
  ja: '日本語',
  es: 'Español',
};

export function isLocale(value: unknown): value is Locale {
  return value === 'en' || value === 'ja' || value === 'es';
}

/** Locale-aware integer formatting, as browsers format it. */
export function fmtCount(locale: Locale, value: number): string {
  return new Intl.NumberFormat(LOCALE_TAGS[locale], { maximumFractionDigits: 0 }).format(value);
}

/** Locale-aware fixed-decimal formatting. */
export function fmtFixed(locale: Locale, value: number, decimals: number): string {
  return new Intl.NumberFormat(LOCALE_TAGS[locale], {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

export type MessageParams = Record<string, string | number>;

export function t(locale: Locale, key: MessageKey, params: MessageParams = {}): string {
  const template = DICTS[locale][key];
  return template.replace(/\{(\w+)\}/g, (_match, name: string) => {
    const value = params[name];
    if (value === undefined) return '';
    return typeof value === 'number' ? fmtCount(locale, value) : value;
  });
}

export function documentTitle(locale: Locale, screen: MessageKey | null): string {
  if (screen === null) return t(locale, 'title.home');
  return t(locale, 'title.pattern', { screen: t(locale, screen) });
}
