const SEED_DIVISOR = 4294967295;

/** SHA-256 of `<slug>:<N>`, so the lens always renders the same N the same way. */
async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

const cache = new Map<string, number>();

/** The shader's `uSeed` for edition N: the hash's first 8 hex digits over 2^32-1. */
export async function editionSeedValue(slug: string, editionNumber: number): Promise<number> {
  const key = `${slug}:${editionNumber}`;
  const known = cache.get(key);
  if (known !== undefined) return known;
  const hex = await sha256Hex(key);
  const value = Number.parseInt(hex.slice(0, 8), 16) / SEED_DIVISOR;
  cache.set(key, value);
  return value;
}

/** Derives a seed from a stored `seed_hash`, with no hashing round trip. */
export function seedFromHash(seedHash: string): number {
  return Number.parseInt(seedHash.slice(0, 8), 16) / SEED_DIVISOR;
}
