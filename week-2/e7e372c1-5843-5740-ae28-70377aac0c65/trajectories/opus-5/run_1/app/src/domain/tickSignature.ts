/** Tick signature and freshness. Both are decided here and nowhere else. */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const TICK_SIGNATURE_WINDOW_SECONDS = 300;

const HEADER_PATTERN = /^t=(\d{1,15}),v1=([0-9a-f]{64})$/;

export type SignatureFailure = 'bad_signature' | 'stale_signature';

export function expectedSignature(key: string, signedSeconds: string, rawBody: Buffer): string {
  const hmac = createHmac('sha256', Buffer.from(key, 'ascii'));
  hmac.update(Buffer.from(`${signedSeconds}.`, 'ascii'));
  hmac.update(rawBody);
  return hmac.digest('hex');
}

/**
 * Verifies `X-Tick-Signature: t=<unix seconds>,v1=<hex>` over the exact bytes
 * `<t>.<raw body>`, then checks freshness against the market clock.
 */
export function verifyTickSignature(
  header: string | undefined,
  rawBody: Buffer,
  key: string,
  marketClockMs: number,
): SignatureFailure | null {
  if (typeof header !== 'string') return 'bad_signature';
  const match = HEADER_PATTERN.exec(header.trim());
  if (!match) return 'bad_signature';
  const signedSeconds = match[1] as string;
  const provided = Buffer.from(match[2] as string, 'hex');
  const expected = Buffer.from(expectedSignature(key, signedSeconds, rawBody), 'hex');
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return 'bad_signature';
  }
  const marketSeconds = Math.floor(marketClockMs / 1000);
  const difference = Math.abs(Number(signedSeconds) - marketSeconds);
  if (difference > TICK_SIGNATURE_WINDOW_SECONDS) return 'stale_signature';
  return null;
}
