import { randomBytes, randomUUID } from 'node:crypto';

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '')}`;
}

/** URL-safe token of at least 32 characters. */
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export function slugify(value: string): string {
  const withoutAccents = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return withoutAccents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
