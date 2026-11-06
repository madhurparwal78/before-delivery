import { createHash, randomBytes } from 'node:crypto';

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing environment variable ${name}`);
  }
  return value;
}

export function readEnv(name: string): string | undefined {
  const value = process.env[name];
  return value === '' ? undefined : value;
}

export function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

export function randomId(prefix: string): string {
  return `${prefix}-${randomBytes(9).toString('base64url')}`;
}

/** Unguessable link token: 128 bits of randomness in URL-safe characters. */
export function linkToken(): string {
  return randomBytes(16).toString('base64url');
}

export function isIdempotencyKey(key: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/.test(key);
}

/** Rounds half up towards positive infinity, matching the brief's conversion rule. */
export function roundHalfUp(value: number): number {
  return Math.floor(value + 0.5);
}
