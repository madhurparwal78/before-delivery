import { randomBytes } from 'node:crypto';

/** Every issued id is a random string of at least 16 characters after its prefix. */
export function newId(prefix: 'acc' | 'res' | 'grp' | 'off' | 'wl' | 'pay' | 'ref' | 'doc' | 'mail'): string {
  return `${prefix}_${randomBytes(12).toString('hex')}`;
}

export function randomToken(): string {
  return randomBytes(32).toString('hex');
}

export function randomObjectId(): string {
  return randomBytes(16).toString('hex');
}
