import type { RouteContext } from './http.ts';
import type { Value } from '../db/pg.ts';

export type { Value };

/** Typed JSON body parsing and query parameters for handlers. */

export async function readJson(ctx: RouteContext): Promise<Record<string, unknown>> {
  const raw = await ctx.rawBody();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    return {};
  } catch {
    return {};
  }
}

export function asString(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

export function asNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function asInteger(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) ? v : null;
}

export function asBoolean(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null;
}

export function asStringArray(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== 'string') return null;
    out.push(item);
  }
  return out;
}

export function toValue(v: unknown): Value {
  if (v === undefined) return null;
  if (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || Array.isArray(v)) return v as Value;
  return JSON.stringify(v);
}
