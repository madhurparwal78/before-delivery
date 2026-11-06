import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ICON_DIR = join(fileURLToPath(new URL('.', import.meta.url)), 'public', 'icons');

const cache = new Map<string, string>();

/** Inlines a Lucide icon so it inherits the current text colour. */
export function icon(name: string): string {
  const cached = cache.get(name);
  if (cached !== undefined) return cached;
  const markup = readFileSync(join(ICON_DIR, `${name}.svg`), 'utf8')
    .replace(/\s*<\?xml[^>]*\?>\s*/g, '')
    .replace('<svg', '<svg aria-hidden="true" focusable="false" class="icon"')
    .trim();
  cache.set(name, markup);
  return markup;
}
