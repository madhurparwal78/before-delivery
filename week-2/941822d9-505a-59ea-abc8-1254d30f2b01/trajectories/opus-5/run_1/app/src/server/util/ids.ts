import { createHash, randomBytes, randomUUID } from 'node:crypto';

const SEED_NAMESPACE = Buffer.from('6f1d2c3b4a59687706f8e9d0c1b2a394', 'hex');

export function newId(): string {
  return randomUUID();
}

/** Deterministic (RFC 4122 version 5) id, so seeding is idempotent across restarts. */
export function seedId(name: string): string {
  const hash = createHash('sha1').update(SEED_NAMESPACE).update(name, 'utf8').digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  const six = bytes[6];
  const eight = bytes[8];
  if (six === undefined || eight === undefined) throw new Error('sha1 digest too short');
  bytes[6] = (six & 0x0f) | 0x50;
  bytes[8] = (eight & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** URL-safe token carrying `bytes * 8` random bits. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}
