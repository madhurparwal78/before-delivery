import { randomBytes } from 'node:crypto';

export function newId(prefix: string): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = randomBytes(8);
  let out = '';
  for (let i = 0; i < 8; i++) out += alphabet[bytes[i] % alphabet.length];
  return `${prefix}_${out}`;
}

export function newToken(bytes = 24): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256Hex(data: Buffer | string): string {
  const { createHash } = require('node:crypto') as typeof import('node:crypto');
  return createHash('sha256').update(data).digest('hex');
}
