/**
 * A small typed HTML builder. Every value is escaped here, so no page can leak markup.
 *
 * Translatable text is rendered with both languages beside it in `data-en` and `data-pl`,
 * which lets the browser swap every owner string in place without a reload and keeps the
 * server the only author of published copy.
 */

import type { Language } from './format';

export type Attributes = Readonly<Record<string, string | number | boolean | null | undefined>>;
export type Child = string | number | null | undefined | false;

const VOID_TAGS = new Set(['input', 'br', 'img', 'meta', 'link']);

export function escapeText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttribute(value: string): string {
  return escapeText(value).replace(/"/g, '&quot;');
}

function renderAttributes(attributes: Attributes): string {
  const parts: string[] = [];
  for (const [name, value] of Object.entries(attributes)) {
    if (value === null || value === undefined || value === false) continue;
    if (value === true) {
      parts.push(` ${name}`);
      continue;
    }
    parts.push(` ${name}="${escapeAttribute(String(value))}"`);
  }
  return parts.join('');
}

export function h(tag: string, attributes: Attributes = {}, ...children: Child[]): string {
  const open = `<${tag}${renderAttributes(attributes)}>`;
  if (VOID_TAGS.has(tag)) return open;
  const inside = children.filter((child): child is string | number => child !== null && child !== undefined && child !== false);
  return `${open}${inside.map((child) => (typeof child === 'number' ? String(child) : child)).join('')}</${tag}>`;
}

/** Raw markup already built by this module. */
export function fragment(...children: Child[]): string {
  return children.filter((child): child is string | number => child !== null && child !== undefined && child !== false).join('');
}

export function text(value: string | number): string {
  return escapeText(String(value));
}

export interface Pair {
  'en-GB': string;
  'pl-PL': string;
}

/** The attributes that let the browser swap a string in place. */
export function bilingual(pair: Pair): Attributes {
  return { 'data-en': pair['en-GB'], 'data-pl': pair['pl-PL'] };
}

/** Both languages of a label, for an accessible name that must also swap. */
export function bilingualLabel(pair: Pair): Attributes {
  return { 'data-en-label': pair['en-GB'], 'data-pl-label': pair['pl-PL'] };
}

export function pick(pair: Pair, language: Language): string {
  return pair[language];
}
