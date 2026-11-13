import { createHash, randomBytes, randomUUID } from 'node:crypto';

export function uuid(): string {
  return randomUUID();
}

/** A stable uuid for a seeded record, so re-seeding inserts nothing twice. */
export function seedUuid(name: string): string {
  const hex = createHash('sha256').update(`candour-bench:${name}`).digest('hex').slice(0, 32);
  const variant = ((parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(18, 20)}-${hex.slice(20, 32)}`;
}

export function token(): string {
  return randomBytes(32).toString('base64url');
}

export function sixDigitCode(): string {
  return String(randomBytes(4).readUInt32BE(0) % 1000000).padStart(6, '0');
}
