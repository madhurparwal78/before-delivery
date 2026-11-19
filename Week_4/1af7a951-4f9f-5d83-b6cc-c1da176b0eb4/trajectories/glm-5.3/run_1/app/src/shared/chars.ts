// Character helpers shared by validation and copy.
// Lengths of names, titles and text count Unicode code points; sign offsets
// count UTF-16 code units (handled in the browser and verified here).

export function codePoints(value: string): number {
  let count = 0;
  for (const _ of value) count += 1;
  return count;
}

// General category Cc plus the line and paragraph separators.
export function hasControlChar(value: string): boolean {
  for (const ch of value) {
    const cp = ch.codePointAt(0) ?? 0;
    if ((cp >= 0x00 && cp <= 0x1f) || cp === 0x7f || (cp >= 0x80 && cp <= 0x9f) || cp === 0x2028 || cp === 0x2029) {
      return true;
    }
  }
  return false;
}

export function isBlank(value: string): boolean {
  return value.trim().length === 0;
}

export function utf16Length(value: string): number {
  return value.length;
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmail(value: string): boolean {
  return EMAIL_RE.test(value);
}
