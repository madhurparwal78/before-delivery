import type { Locale } from '../../shared/money.ts';
import { t, type Args } from '../../shared/strings.ts';

export type Attrs = Record<string, string | number | boolean | null | undefined>;

export function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const VOID_TAGS = new Set(['input', 'img', 'br', 'hr', 'meta', 'link', 'source', 'use', 'path', 'circle', 'g']);

export type Child = string | null | false | undefined;

export function h(tag: string, attrs: Attrs = {}, ...children: Child[]): string {
  const parts: string[] = [tag];
  for (const [name, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (value === true) {
      parts.push(name);
      continue;
    }
    parts.push(`${name}="${esc(String(value))}"`);
  }
  const open = `<${parts.join(' ')}>`;
  if (VOID_TAGS.has(tag)) return open;
  return `${open}${children.filter((child): child is string => typeof child === 'string' && child !== '').join('')}</${tag}>`;
}

function argsAttr(args?: Args): Attrs {
  return args === undefined ? {} : { 'data-i18n-args': JSON.stringify(args) };
}

/** An element whose text content is a translated string, re-rendered in place on language switch. */
export function tel(
  tag: string,
  locale: Locale,
  key: string,
  args?: Args,
  attrs: Attrs = {},
  ...children: Child[]
): string {
  return h(tag, { ...attrs, 'data-i18n': key, ...argsAttr(args) }, esc(t(key, locale, args)), ...children);
}

/** Attributes carrying a translated accessible name. */
export function labelled(locale: Locale, key: string, args?: Args): Attrs {
  return { 'aria-label': t(key, locale, args), 'data-i18n-aria': key, ...argsAttr(args) };
}

export function text(locale: Locale, key: string, args?: Args): string {
  return esc(t(key, locale, args));
}



