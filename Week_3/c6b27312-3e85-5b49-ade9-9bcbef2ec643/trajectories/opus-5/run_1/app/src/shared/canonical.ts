/**
 * Tinework canonical JSON. One serialisation for the geometry digest, the stored
 * solids and the idempotency fingerprints.
 */

import { cmpText } from './order';
import { machineNumber } from './numbers';

export type CanonicalValue =
  | string
  | number
  | boolean
  | null
  | CanonicalValue[]
  | { [key: string]: CanonicalValue };

const ESCAPES: Record<string, string> = {
  '\b': '\\b',
  '\f': '\\f',
  '\n': '\\n',
  '\r': '\\r',
  '\t': '\\t',
  '"': '\\"',
  '\\': '\\\\',
};

function canonicalString(value: string): string {
  let out = '"';
  for (const character of value) {
    const escape = ESCAPES[character];
    if (escape) {
      out += escape;
    } else {
      const code = character.codePointAt(0)!;
      if (code <= 0x1f) {
        out += `\\u${code.toString(16).padStart(4, '0')}`;
      } else {
        out += character;
      }
    }
  }
  return out + '"';
}

export function canonicalJson(value: CanonicalValue): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return machineNumber(value);
  if (typeof value === 'string') return canonicalString(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value).sort(cmpText);
  return `{${keys.map((key) => `${canonicalString(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}
