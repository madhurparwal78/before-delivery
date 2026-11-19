import crypto from 'node:crypto';

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(12).toString('hex')}`;
}

export function newToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256Hex(data: Buffer | Uint8Array | string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(candidate, 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
