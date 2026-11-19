import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export function hashPassword(password: string, salt?: string): { hash: string; salt: string } {
  const useSalt = salt ?? randomBytes(16).toString('hex');
  const hash = scryptSync(password, useSalt, 32).toString('hex');
  return { hash, salt: useSalt };
}

export function passwordMatches(password: string, hash: string, salt: string): boolean {
  const candidate = hashPassword(password, salt).hash;
  const left = Buffer.from(candidate, 'hex');
  const right = Buffer.from(hash, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

export function token(bytes = 24): string {
  return randomBytes(bytes).toString('base64url');
}

/** Six digits, as mailed for sign-up. */
export function signupCode(): string {
  return String(100000 + Math.floor(Math.random() * 900000));
}
