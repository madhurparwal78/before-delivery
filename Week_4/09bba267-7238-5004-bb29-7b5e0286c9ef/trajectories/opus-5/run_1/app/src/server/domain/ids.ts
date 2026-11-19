import { randomBytes, randomUUID } from 'node:crypto';

const ORDER_ID_ALPHABET = 'ACDEFGHJKLMNPQRSTUVWXY3456789';

export function newOrderId(): string {
  const letters = Array.from(randomBytes(8), (byte) => ORDER_ID_ALPHABET[byte % ORDER_ID_ALPHABET.length]);
  return `HH-${letters.join('')}`;
}

export function newToken(): string {
  return randomBytes(16).toString('hex');
}

export function newUuid(): string {
  return randomUUID();
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function newPerformanceId(title: string): string {
  const base = slugify(title).slice(0, 60);
  const suffix = randomBytes(3).toString('hex');
  return base === '' ? `performance-${suffix}` : `${base}-${suffix}`;
}
