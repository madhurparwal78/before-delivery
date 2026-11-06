import { createHmac, timingSafeEqual } from 'node:crypto';

function sign(secret: Buffer, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

/** Wraps a payload with a tamper-evident signature made from the shared secret. */
export function signPayload(secret: Buffer, payload: string): string {
  return `${Buffer.from(payload, 'utf8').toString('base64url')}.${sign(secret, payload)}`;
}

export function verifyPayload(secret: Buffer, token: string): string | null {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const encoded = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  let payload: string;
  try {
    payload = Buffer.from(encoded, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const expected = Buffer.from(sign(secret, payload), 'utf8');
  const actual = Buffer.from(signature, 'utf8');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  return payload;
}
