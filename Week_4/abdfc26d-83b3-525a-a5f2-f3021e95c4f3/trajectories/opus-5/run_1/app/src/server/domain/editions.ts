import { createHash } from 'node:crypto';

const SEED_DIVISOR = 4294967295;

/** The first 16 lowercase hex characters of SHA-256 of `<slug>:<N>`. */
export function editionSeedHash(slug: string, editionNumber: number): string {
  return createHash('sha256').update(`${slug}:${editionNumber}`, 'utf8').digest('hex').slice(0, 16);
}

/** The `uSeed` the shader receives for an edition: the hash's first 8 hex digits over 2^32-1. */
export function editionSeedValue(slug: string, editionNumber: number): number {
  return Number.parseInt(editionSeedHash(slug, editionNumber).slice(0, 8), 16) / SEED_DIVISOR;
}
