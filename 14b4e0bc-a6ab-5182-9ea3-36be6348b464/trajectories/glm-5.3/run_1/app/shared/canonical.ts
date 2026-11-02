/**
 * RFC 8785 canonical JSON for audit-chain payloads: keys sorted by UTF-16 code
 * units, no whitespace, and JSON-string/number serialisation as ECMAScript
 * writes them (the payloads hold only strings, whole numbers, booleans, null,
 * arrays and objects, so number formatting is IEEE-exact for our values).
 */
export function canonicalJson(value: unknown): string {
  const slices: string[] = [];
  writeValue(value, slices);
  return slices.join('');
}

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

function writeValue(value: unknown, out: string[]): void {
  if (value === null) {
    out.push('null');
    return;
  }
  switch (typeof value) {
    case 'string':
      out.push(jsonString(value));
      return;
    case 'number':
      out.push(jsonNumber(value));
      return;
    case 'boolean':
      out.push(value ? 'true' : 'false');
      return;
    case 'object': {
      const v = value as Json;
      if (Array.isArray(v)) {
        out.push('[');
        for (let i = 0; i < v.length; i++) {
          if (i > 0) out.push(',');
          writeValue(v[i], out);
        }
        out.push(']');
        return;
      }
      const keys = Object.keys(v as Record<string, unknown>).sort(compareUtf16);
      out.push('{');
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i]!;
        if (i > 0) out.push(',');
        out.push(jsonString(k), ':');
        writeValue((v as Record<string, Json>)[k], out);
      }
      out.push('}');
      return;
    }
    default:
      out.push('null');
  }
}

function compareUtf16(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

const ESCAPE: Record<string, string> = {
  '"': '\\"',
  '\\': '\\\\',
  '\b': '\\b',
  '\f': '\\f',
  '\n': '\\n',
  '\r': '\\r',
  '\t': '\\t',
};

export function jsonString(s: string): string {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    const esc = ESCAPE[ch];
    if (esc !== undefined) {
      out += esc;
      continue;
    }
    const code = ch.charCodeAt(0);
    if (code < 0x20) {
      out += `\\u${code.toString(16).padStart(4, '0')}`;
      continue;
    }
    // lone surrogates are not written by JSON.stringify; escape them for safety
    if (code >= 0xd800 && code <= 0xdfff) {
      out += `\\u${code.toString(16).padStart(4, '0')}`;
      continue;
    }
    out += ch;
  }
  return out + '"';
}

export function jsonNumber(n: number): string {
  if (!Number.isFinite(n)) throw new Error('non-finite number in canonical JSON');
  if (Number.isInteger(n)) return String(n);
  // Payload numbers are whole; fall back to ECMAScript formatting otherwise.
  return JSON.stringify(n);
}
