import { timingSafeEqual } from 'node:crypto';

/**
 * Byte helpers. The server boundary counts a request body's bytes exactly and
 * refuses bodies above their published limit.
 */

export const JSON_BODY_LIMIT = 100_000;
export const PHOTO_LIMIT = 5_000_000;
export const CSV_LIMIT = 1_000_000;

export function bodyWithinLimit(bytes: Uint8Array, limit: number): boolean {
  return bytes.length <= limit;
}

/** Constant-time comparison for short secrets where equality is all that matters. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
