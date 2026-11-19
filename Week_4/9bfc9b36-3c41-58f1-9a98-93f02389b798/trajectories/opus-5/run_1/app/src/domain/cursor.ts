import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config';
import { FIELD_COPY, wholeNumberCopy } from '../shared/copy';
import { invalid } from '../http/errors';

/**
 * The one place that mints and reads list cursors. A cursor belongs to the filter
 * that produced it, and a value the server never issued is refused.
 */

const CURSOR_KEY = createHmac('sha256', config.authClientSecret).update('boltrope-cursor-v1').digest();

function sign(payload: string): string {
  return createHmac('sha256', CURSOR_KEY).update(payload).digest('base64url').slice(0, 22);
}

export interface CursorPosition {
  /** The list's ordering instant, or another leading sort value. */
  readonly at: string;
  /** The tie-break id. */
  readonly id: string;
}

/** The fingerprint of every query member other than `limit` and `cursor`. */
export function filterFingerprint(filter: Readonly<Record<string, string | null | undefined>>): string {
  const parts = Object.keys(filter)
    .sort()
    .map((key) => `${key}=${filter[key] ?? ''}`);
  return parts.join('&');
}

export function mintCursor(filter: string, position: CursorPosition): string {
  const payload = Buffer.from(JSON.stringify({ f: filter, a: position.at, i: position.id }), 'utf8').toString(
    'base64url',
  );
  return `${payload}.${sign(payload)}`;
}

export function readCursor(cursor: string, filter: string): CursorPosition {
  const dot = cursor.lastIndexOf('.');
  if (dot <= 0) throw invalid({ cursor: FIELD_COPY.cursorInvalid });
  const payload = cursor.slice(0, dot);
  const given = cursor.slice(dot + 1);
  const expected = sign(payload);
  if (given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
    throw invalid({ cursor: FIELD_COPY.cursorInvalid });
  }
  let decoded: { f?: unknown; a?: unknown; i?: unknown };
  try {
    decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as typeof decoded;
  } catch {
    throw invalid({ cursor: FIELD_COPY.cursorInvalid });
  }
  if (typeof decoded.f !== 'string' || typeof decoded.a !== 'string' || typeof decoded.i !== 'string') {
    throw invalid({ cursor: FIELD_COPY.cursorInvalid });
  }
  if (decoded.f !== filter) throw invalid({ cursor: FIELD_COPY.cursorOtherFilter });
  return { at: decoded.a, id: decoded.i };
}

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 50;

export function readLimit(raw: string | null): number {
  if (raw === null || raw === '') return DEFAULT_LIMIT;
  const refusal = invalid({ limit: wholeNumberCopy(1, MAX_LIMIT) });
  if (!/^-?\d+$/.test(raw)) throw refusal;
  const value = Number(raw);
  if (value < 1) throw refusal;
  return Math.min(value, MAX_LIMIT);
}
