// Passwords are stored only as a salted hash (scrypt), sessions are opaque
// random cookies.

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export function hashPassword(pw: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(pw, salt, 32).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  const i = stored.indexOf(":");
  if (i < 0) return false;
  const salt = stored.slice(0, i);
  const hash = stored.slice(i + 1);
  const test = scryptSync(pw, salt, 32);
  const orig = Buffer.from(hash, "hex");
  return orig.length === test.length && timingSafeEqual(test, orig);
}
