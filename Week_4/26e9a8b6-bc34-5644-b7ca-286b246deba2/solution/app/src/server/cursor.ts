/** Opaque cursors: base64url JSON of the sort key of the last row served. */
export function encodeCursor(key: Record<string, string | number>): string {
  return Buffer.from(JSON.stringify(key)).toString('base64url');
}

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function decoded(cursor: string | null): Record<string, unknown> | null {
  if (!cursor) return null;
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString());
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** A (time, id) cursor, or null (the first page) when the text is not one this server issued. */
export function decodeTimeCursor(cursor: string | null): { t: string; id: string } | null {
  const value = decoded(cursor);
  return value && typeof value.t === 'string' && TIMESTAMP.test(value.t) && typeof value.id === 'string' && UUID.test(value.id) ? { t: value.t, id: value.id } : null;
}

/** A version-number cursor, or null (the first page) when the text is not one this server issued. */
export function decodeNumberCursor(cursor: string | null): number | null {
  const value = decoded(cursor);
  return value && Number.isInteger(value.n) && (value.n as number) >= 0 && (value.n as number) <= 2_147_483_647 ? (value.n as number) : null;
}
