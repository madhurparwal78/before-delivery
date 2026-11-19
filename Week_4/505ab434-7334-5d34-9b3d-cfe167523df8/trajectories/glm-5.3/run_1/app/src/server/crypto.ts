import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 32).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const candidate = scryptSync(password, salt, 32);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function hmacHex(secret: string, value: string): string {
  return createHash('sha256').update(`${secret}:${value}`, 'utf8').digest('hex');
}

export function stableStringify(value: unknown): string {
  const seen = new Set<unknown>();
  return JSON.stringify(value, (_k, v) => {
    if (typeof v === 'object' && v !== null) {
      if (seen.has(v)) return undefined as unknown as string;
      seen.add(v);
    }
    if (typeof v === 'bigint') return v.toString();
    return v;
  });
}
