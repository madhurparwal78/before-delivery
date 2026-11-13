// Canonical JSON: keys sorted by code point, no whitespace, minimal escapes,
// numbers in the shortest form that reads back to the same double, no trailing newline.
export function canonicalJson(value: unknown): string {
  const out: string[] = [];
  writeValue(value, out);
  return out.join('');
}

function writeValue(value: unknown, out: string[]): void {
  if (value === null || typeof value === 'boolean') {
    out.push(String(value));
    return;
  }
  if (typeof value === 'number') {
    out.push(numberToJson(value));
    return;
  }
  if (typeof value === 'string') {
    writeString(value, out);
    return;
  }
  if (Array.isArray(value)) {
    out.push('[');
    for (let i = 0; i < value.length; i++) {
      if (i > 0) out.push(',');
      writeValue(value[i], out);
    }
    out.push(']');
    return;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort(compareCodePoints);
  out.push('{');
  let first = true;
  for (const key of keys) {
    const v = record[key];
    if (v === undefined) continue;
    if (!first) out.push(',');
    first = false;
    writeString(key, out);
    out.push(':');
    writeValue(v, out);
  }
  out.push('}');
}

function compareCodePoints(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function writeString(value: string, out: string[]): void {
  out.push('"');
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    const ch = value.charAt(i);
    if (ch === '"') out.push('\\"');
    else if (ch === '\\') out.push('\\\\');
    else if (ch === '\n') out.push('\\n');
    else if (ch === '\r') out.push('\\r');
    else if (ch === '\t') out.push('\\t');
    else if (ch === '\b') out.push('\\b');
    else if (ch === '\f') out.push('\\f');
    else if (code < 0x20) out.push('\\u' + code.toString(16).padStart(4, '0'));
    else out.push(ch);
  }
  out.push('"');
}

// Shortest number form that reads back to the same double, with -0 written as 0.
// JavaScript's String(number) is already the shortest round-trip form; canonical JSON
// additionally writes negative zero as 0 and rejects non-finite values.
export function numberToJson(value: number): string {
  if (!Number.isFinite(value)) throw new Error('non-finite number in canonical JSON');
  if (value === 0) return '0'; // covers -0
  let s = String(value);
  if (s.includes('.')) {
    s = s.replace(/0+$/, '');
    if (s.endsWith('.')) s = s.slice(0, -1);
  }
  return s;
}
