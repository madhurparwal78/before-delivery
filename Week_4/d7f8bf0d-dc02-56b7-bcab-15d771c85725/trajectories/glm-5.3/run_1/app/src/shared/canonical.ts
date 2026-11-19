import { createHash } from 'node:crypto';

/**
 * Canonical JSON: object keys sorted, no whitespace, non-ASCII left unescaped.
 * The canonical hash is the lowercase SHA-256 hex of this form.
 */
export function canonicalJson(value: unknown): string {
  return serialize(value);
}

function serialize(value: unknown): string {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'string') {
    return jsonString(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(serialize).join(',') + ']';
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return '{' + entries.map(([k, v]) => jsonString(k) + ':' + serialize(v)).join(',') + '}';
  }
  throw new Error('unserializable value');
}

function jsonString(s: string): string {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x22) out += '\\"';
    else if (c === 0x5c) out += '\\\\';
    else if (c === 0x08) out += '\\b';
    else if (c === 0x0c) out += '\\f';
    else if (c === 0x0a) out += '\\n';
    else if (c === 0x0d) out += '\\r';
    else if (c === 0x09) out += '\\t';
    else if (c < 0x20) out += '\\u' + c.toString(16).padStart(4, '0');
    else out += s[i];
  }
  return out + '"';
}

export function canonicalHash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex').toLowerCase();
}

/** Round halves up to the nearest integer (for measured rule values). */
export function roundHalfUp(n: number): number {
  const f = Math.floor(n);
  const diff = n - f;
  if (diff > 0.5) return f + 1;
  if (diff < 0.5) return f;
  return f + 1;
}
