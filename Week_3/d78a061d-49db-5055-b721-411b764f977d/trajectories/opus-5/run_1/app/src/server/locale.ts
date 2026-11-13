import { isLocale, type Locale } from '../shared/i18n/index.js';

interface AcceptEntry {
  tag: string;
  quality: number;
  order: number;
}

function parseAcceptLanguage(header: string): AcceptEntry[] {
  const entries: AcceptEntry[] = [];
  header.split(',').forEach((part, index) => {
    const [tagPart, ...paramParts] = part.trim().split(';');
    if (tagPart === undefined || tagPart === '') return;
    let quality = 1;
    for (const param of paramParts) {
      const match = /^\s*q\s*=\s*([0-9.]+)\s*$/i.exec(param);
      if (match) quality = Number.parseFloat(match[1]);
    }
    if (!Number.isFinite(quality) || quality <= 0) return;
    entries.push({ tag: tagPart.trim(), quality, order: index });
  });
  return entries.sort((a, b) => b.quality - a.quality || a.order - b.order);
}

export function localeFromAcceptLanguage(header: string | undefined): Locale | null {
  if (header === undefined) return null;
  for (const entry of parseAcceptLanguage(header)) {
    const primary = entry.tag.split('-')[0]?.toLowerCase();
    if (isLocale(primary)) return primary;
  }
  return null;
}

/** The single place locale resolution happens: account, cookie, Accept-Language, then en. */
export function resolveLocale(input: {
  accountLocale?: Locale | null;
  cookieLocale?: string | null;
  acceptLanguage?: string | undefined;
}): Locale {
  if (input.accountLocale && isLocale(input.accountLocale)) return input.accountLocale;
  if (isLocale(input.cookieLocale)) return input.cookieLocale;
  return localeFromAcceptLanguage(input.acceptLanguage) ?? 'en';
}
