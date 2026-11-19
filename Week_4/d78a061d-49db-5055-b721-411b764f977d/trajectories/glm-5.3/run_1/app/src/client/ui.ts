import { dicts, tr } from '../shared/i18n.js';
import type { Locale } from '../shared/domain.js';
import { localeNames, locales } from '../shared/domain.js';

export const locale: Locale = (window.__lwLocale as Locale) ?? 'en';
export const pageKind: string = window.__lwKind ?? 'home';
export const signedIn: boolean = window.__lwSignedIn ?? false;

export const t = (section: Parameters<typeof tr>[1], key: string, params: Record<string, string | number> = {}): string =>
  tr(locale, section, key, params);

export const dict = dicts[locale];

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string | boolean | null> = {}, ...children: (Node | string | null | undefined)[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === null || value === false) continue;
    if (name === 'class') node.className = value as string;
    else if (name === 'text') node.textContent = value as string;
    else node.setAttribute(name, value as string);
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export const languageOptions = locales.map((l) => ({ value: l, name: localeNames[l] }));
