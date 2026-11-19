import crypto from 'node:crypto';

export function uuid(): string {
  return crypto.randomUUID();
}

export function randomToken(bytes: number): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256Hex(bytes: Buffer): string {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

export function timingSafeEqualString(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

/** A reference is PL- followed by six uppercase letters or digits. */
export function newReference(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let tail = '';
  const bytes = crypto.randomBytes(6);
  for (let i = 0; i < 6; i += 1) tail += alphabet[bytes[i] % alphabet.length];
  return `PL-${tail}`;
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
}

export function isIdempotencyKey(value: string): boolean {
  return value.length >= 1 && value.length <= 100 && /^[A-Za-z0-9_-]*$/.test(value);
}

/** Ids and other path values are treated as plain data, never as query text. */
export function plainText(value: string): string {
  return value;
}
