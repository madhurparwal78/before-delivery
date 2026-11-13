import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";

export interface PasswordHash {
  salt: string;
  hash: string;
}

export function hashPassword(password: string): PasswordHash {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 32).toString("hex");
  return { salt, hash };
}

export function verifyPassword(password: string, stored: PasswordHash): boolean {
  const candidate = scryptSync(password, stored.salt, 32);
  const expected = Buffer.from(stored.hash, "hex");
  if (candidate.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(candidate, expected);
}

export function parseStoredHash(value: string): PasswordHash {
  const [salt, hash] = value.split(":");
  return { salt, hash };
}

export function formatStoredHash(hash: PasswordHash): string {
  return `${hash.salt}:${hash.hash}`;
}

export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}
