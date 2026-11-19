import { createHash } from 'node:crypto';

/** JSON with object keys sorted at every depth and no whitespace (adapted from kit/modules/idempotency). */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value ?? null, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

export function fingerprint(method: string, path: string, body: unknown): string {
  return createHash('sha256').update(`${method.toUpperCase()}\n${path}\n${canonicalJson(body)}`).digest('hex');
}
