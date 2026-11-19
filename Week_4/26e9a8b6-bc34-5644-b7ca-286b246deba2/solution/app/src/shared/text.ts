export function codePointLength(text: string): number {
  let count = 0;
  for (const _ of text) count++;
  return count;
}

/** True when JSON text nests deeper than `max` levels; a linear scan that never recurses. */
export function jsonNestsDeeperThan(text: string, max: number): boolean {
  let depth = 0;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (inString) {
      if (c === 0x5c) i++;
      else if (c === 0x22) inString = false;
    } else if (c === 0x22) inString = true;
    else if (c === 0x7b || c === 0x5b) {
      if (++depth > max) return true;
    } else if (c === 0x7d || c === 0x5d) depth--;
  }
  return false;
}

/** True when a string, or any key or string inside a parsed JSON value, holds a NUL character (a database text column cannot). */
export function holdsNul(value: unknown): boolean {
  if (typeof value === 'string') return value.includes('\u0000');
  if (Array.isArray(value)) return value.some(holdsNul);
  if (value !== null && typeof value === 'object') return Object.entries(value).some(([key, inner]) => key.includes('\u0000') || holdsNul(inner));
  return false;
}
