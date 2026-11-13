// Path helpers for dotted property paths.
import type { Breakpoint, Layer } from './types';

export function getPath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

export function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]!;
    if (typeof cur[key] !== 'object' || cur[key] === null) cur[key] = {};
    cur = cur[key] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]!] = value;
}

export function deletePath(obj: Record<string, unknown>, path: string): void {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const nxt = (cur as Record<string, unknown>)[parts[i]!];
    if (typeof nxt !== 'object' || nxt === null) return;
    cur = nxt as Record<string, unknown>;
  }
  delete cur[parts[parts.length - 1]!];
}

// Which breakpoint level supplies a path.
export function sourceLevel(
  path: string,
  bp: Breakpoint,
  overrides: Layer['overrides'],
): Breakpoint {
  if (bp === 'mobile') {
    if (overrideHas(overrides.mobile, path)) return 'mobile';
    if (overrideHas(overrides.tablet, path)) return 'tablet';
    return 'desktop';
  }
  if (bp === 'tablet') {
    if (overrideHas(overrides.tablet, path)) return 'tablet';
    return 'desktop';
  }
  return 'desktop';
}

function overrideHas(map: Record<string, unknown>, path: string): boolean {
  if (Object.prototype.hasOwnProperty.call(map, path)) return true;
  return getPath(map, path) !== undefined;
}

export function getOverrideValue(
  overrides: Layer['overrides'],
  level: 'tablet' | 'mobile',
  path: string,
): unknown {
  const map = overrides[level];
  if (Object.prototype.hasOwnProperty.call(map, path)) return map[path];
  return getPath(map, path);
}

export function collectPaths(obj: Record<string, unknown>, prefix = ''): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    out.push(path);
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out.push(...collectPaths(v as Record<string, unknown>, path));
    }
  }
  return out;
}
