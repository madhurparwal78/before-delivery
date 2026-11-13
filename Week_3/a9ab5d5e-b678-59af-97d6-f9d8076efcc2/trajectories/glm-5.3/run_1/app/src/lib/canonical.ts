import { createHash } from 'node:crypto';

/** RFC 8785 canonical JSON serialisation. Inputs are JSON-safe trees of
 *  strings, numbers (integers), booleans, null, arrays and plain objects. */
export function canonicalJson(value: unknown): string {
  return canonicalize(value);
}

function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      return canonicalNumber(value);
    case 'string':
      return canonicalString(value);
    case 'object': {
      if (Array.isArray(value)) {
        return `[${value.map(canonicalize).join(',')}]`;
      }
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj)
        .filter((k) => obj[k] !== undefined)
        .sort(compareUtf16);
      const body = keys
        .map((k) => `${canonicalString(k)}:${canonicalize(obj[k])}`)
        .join(',');
      return `{${body}}`;
    }
    default:
      throw new Error(`not canonicalizable: ${typeof value}`);
  }
}

/** RFC 8785 sorts by UTF-16 code units of the key string. */
function compareUtf16(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function canonicalString(s: string): string {
  const out: string[] = ['"'];
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp === 0x22) out.push('\\"');
    else if (cp === 0x5c) out.push('\\\\');
    else if (cp === 0x08) out.push('\\b');
    else if (cp === 0x09) out.push('\\t');
    else if (cp === 0x0a) out.push('\\n');
    else if (cp === 0x0c) out.push('\\f');
    else if (cp === 0x0d) out.push('\\r');
    else if (cp < 0x20 || (cp >= 0x7f && cp <= 0x9f)) out.push(`\\u${cp.toString(16).padStart(4, '0')}`);
    else out.push(ch);
  }
  out.push('"');
  return out.join('');
}

/** RFC 8785 §3.2.2.3 number serialisation. Only integers and values that
 *  JSON.stringify round-trips are expected here; canonical JSON of the
 *  numeric kinds used in this app is exact for IEEE-754 doubles. */
export function canonicalNumber(n: number): string {
  if (!Number.isFinite(n)) throw new Error('not canonicalizable');
  if (Object.is(n, -0)) n = 0;
  if (Number.isInteger(n) && Math.abs(n) < 1e21) return String(n);
  const json = JSON.stringify(n);
  const back = JSON.parse(json);
  if (back !== n) throw new Error('not canonicalizable');
  return json;
}

export function digestOf(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}
