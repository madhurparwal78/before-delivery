import { createHash, randomUUID } from 'node:crypto';

/** A fresh server-issued id. */
export function newId(): string {
  return randomUUID();
}

const SEED_NAMESPACE = 'plumbline.marrowhall.seed';

/**
 * A stable id for a seeded record, so applying the seed again touches the same
 * rows rather than making new ones.
 */
export function seedId(name: string): string {
  const digest = createHash('sha1').update(`${SEED_NAMESPACE}:${name}`).digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(
    16,
    20,
  )}-${hex.slice(20)}`;
}
