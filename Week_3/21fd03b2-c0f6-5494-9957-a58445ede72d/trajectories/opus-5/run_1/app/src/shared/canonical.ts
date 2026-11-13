export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/**
 * Canonical JSON: keys sorted by code point at every level, no whitespace,
 * minimal string escapes, shortest round-tripping numbers, negative zero as `0`.
 */
export function canonicalJson(value: Json): string {
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') return canonicalNumber(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value).sort(compareCodePoints);
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

export function canonicalNumber(value: number): string {
  if (value === 0) return '0';
  return String(value);
}

export function compareCodePoints(a: string, b: string): number {
  if (a === b) return 0;
  const aPoints = [...a];
  const bPoints = [...b];
  for (let i = 0; i < aPoints.length && i < bPoints.length; i += 1) {
    const diff = (aPoints[i].codePointAt(0) as number) - (bPoints[i].codePointAt(0) as number);
    if (diff !== 0) return diff;
  }
  return aPoints.length - bPoints.length;
}
