import { randomBytes } from 'node:crypto';

export function newId(prefix: 'ws' | 'au' | 'run' | 'tb' | 'im' | 'iv' | 'usr'): string {
  return `${prefix}-${randomBytes(4).toString('hex')}`;
}

export function newToken(): string {
  return randomBytes(24).toString('base64url');
}
