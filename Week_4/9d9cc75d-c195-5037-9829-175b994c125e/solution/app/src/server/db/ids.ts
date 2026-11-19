import { randomBytes } from 'node:crypto';

/** Opaque, URL-safe, 16 characters. */
export function newId(): string {
  return randomBytes(12).toString('base64url');
}
