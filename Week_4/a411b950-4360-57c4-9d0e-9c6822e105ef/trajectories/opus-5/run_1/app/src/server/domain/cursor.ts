import { createHmac, timingSafeEqual } from 'node:crypto';

export type EnquiryCursor = {
  /** The reference of the last row of the page that issued the cursor. */
  lastReference: string;
  /** The status filter the page was read under; an absent filter is its own value. */
  status: string | null;
};

function sign(payload: string, key: string): string {
  return createHmac('sha256', key).update(payload).digest('base64url');
}

export function encodeCursor(cursor: EnquiryCursor, key: string): string {
  const payload = Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
  return `${payload}.${sign(payload, key)}`;
}

export function decodeCursor(value: string, key: string): EnquiryCursor | null {
  const dot = value.indexOf('.');
  if (dot <= 0) return null;
  const payload = value.slice(0, dot);
  const signature = value.slice(dot + 1);
  const expected = sign(payload, key);
  if (signature.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as EnquiryCursor;
    if (typeof parsed.lastReference !== 'string') return null;
    if (parsed.status !== null && typeof parsed.status !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}
