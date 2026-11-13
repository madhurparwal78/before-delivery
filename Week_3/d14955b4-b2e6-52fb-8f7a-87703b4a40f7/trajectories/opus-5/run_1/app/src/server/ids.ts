import { randomBytes } from 'node:crypto';

export function newId(prefix: string): string {
  return `${prefix}-${randomBytes(12).toString('base64url')}`;
}

export function randomToken(): string {
  return randomBytes(32).toString('base64url');
}
