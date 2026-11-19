/** Tiny HTML helpers: escaping, attributes and list joining. */

export const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export type AttributeValue = string | number | boolean | null | undefined;

export const attrs = (map: Record<string, AttributeValue>): string => {
  const parts: string[] = [];
  for (const [name, value] of Object.entries(map)) {
    if (value === null || value === undefined || value === false) continue;
    if (value === true) {
      parts.push(name);
      continue;
    }
    parts.push(`${name}="${escapeHtml(String(value))}"`);
  }
  return parts.length === 0 ? '' : ` ${parts.join(' ')}`;
};

export const listItems = (items: readonly string[]): string =>
  items.map((item) => `<li>${escapeHtml(item)}</li>`).join('');

/** A glyph is decoration: visible, and never part of an accessible name. */
export const glyph = (character: string): string =>
  `<span class="glyph" aria-hidden="true">${escapeHtml(character)}</span>`;

export const visuallyHidden = (text: string): string =>
  `<span class="visually-hidden">${escapeHtml(text)}</span>`;
