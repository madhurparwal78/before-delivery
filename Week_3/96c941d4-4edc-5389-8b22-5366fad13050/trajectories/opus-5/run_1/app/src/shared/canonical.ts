export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

const SHORT_ESCAPES: Record<number, string> = {
  0x08: '\\b',
  0x09: '\\t',
  0x0a: '\\n',
  0x0c: '\\f',
  0x0d: '\\r',
};

function canonicalString(value: string): string {
  let out = '"';
  for (const unit of value) {
    const code = unit.codePointAt(0) as number;
    if (unit === '"') out += '\\"';
    else if (unit === '\\') out += '\\\\';
    else if (SHORT_ESCAPES[code] !== undefined) out += SHORT_ESCAPES[code];
    else if (code <= 0x1f) out += `\\u${code.toString(16).padStart(4, '0')}`;
    else out += unit;
  }
  return `${out}"`;
}

function canonicalNumber(value: number): string {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`canonical JSON supports only safe integers, received ${value}`);
  }
  return String(value === 0 ? 0 : value);
}

/** Lexicographic comparison by unsigned UTF-16 code units. */
function compareKeys(a: string, b: string): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    const diff = a.charCodeAt(i) - b.charCodeAt(i);
    if (diff !== 0) return diff;
  }
  return a.length - b.length;
}

export function canonicalize(value: JsonValue): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return canonicalNumber(value);
  if (typeof value === 'string') return canonicalString(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const keys = Object.keys(value).sort(compareKeys);
  return `{${keys.map((key) => `${canonicalString(key)}:${canonicalize(value[key])}`).join(',')}}`;
}
