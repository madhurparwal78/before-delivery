import * as crypto from 'node:crypto';
import { config } from '../config';

const sealingKey = crypto.hkdfSync('sha256', config.secretKey, Buffer.from('farshore-seal'), Buffer.from('sealed-secret'), 32);

/** Seals a server-held secret (access key, webhook or two-step secret) for storage in Postgres. */
export function seal(plaintext: string): string {
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(sealingKey), nonce);
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), body]).toString('base64');
}

export function unseal(sealed: string): string {
  const raw = Buffer.from(sealed, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(sealingKey), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
}

/** HKDF-SHA256 over the server secret key. Workspace keys are never stored. */
export function workspaceKey(slug: string, generation: number): Buffer {
  return Buffer.from(
    crypto.hkdfSync('sha256', config.secretKey, Buffer.from('farshore-workspace-key'), Buffer.from(`${slug}:${generation}`), 32),
  );
}

export function wrapDataKey(slug: string, generation: number, dataKey: Buffer): string {
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', workspaceKey(slug, generation), nonce);
  const body = Buffer.concat([cipher.update(dataKey), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), body]).toString('base64');
}

export function unwrapDataKey(slug: string, generation: number, wrapped: string): Buffer {
  const raw = Buffer.from(wrapped, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', workspaceKey(slug, generation), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]);
}

export function sha256Hex(value: string | Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function hashToken(token: string): string {
  return sha256Hex(token);
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 3) return false;
  const salt = Buffer.from(parts[1], 'hex');
  const expected = Buffer.from(parts[2], 'hex');
  const derived = crypto.scryptSync(password, salt, expected.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(derived, expected);
}

const tokenAlphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export function randomToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function randomId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(12).toString('base64url')}`;
}

export function randomAlphanumeric(length: number): string {
  const out: string[] = [];
  const bytes = crypto.randomBytes(length * 2);
  for (let i = 0; out.length < length; i += 1) {
    const byte = bytes[i % bytes.length];
    if (byte < 248) out.push(tokenAlphabet[byte % 62]);
  }
  return out.join('');
}

export function randomUpperAlphanumeric(length: number): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const bytes = crypto.randomBytes(length);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}
