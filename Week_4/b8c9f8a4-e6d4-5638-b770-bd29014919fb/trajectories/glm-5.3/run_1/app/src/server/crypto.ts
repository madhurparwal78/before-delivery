import crypto from 'node:crypto';

/** Random tokens for sessions and links. */
export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256Hex(data: Buffer | string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/** Hash for storing tokens at rest: session cookie values and link tokens. */
export function tokenHash(token: string): string {
  return sha256Hex(`ob:${token}`);
}

export function uuid(): string {
  return crypto.randomUUID();
}

/** Deterministic UUID for seed records so seeding is repeatable. */
export function seedUuid(seedKey: string): string {
  const hex = crypto.createHash('sha256').update(`open-bonnet-seed:${seedKey}`).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function timingSafeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}
