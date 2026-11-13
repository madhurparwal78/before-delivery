import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { compareAsc } from "./util.js";

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString("base64url")}`;
}

export function newToken(): string {
  return randomBytes(24).toString("base64url");
}

/** Password hashing with scrypt; format: salt:hash. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 32).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const idx = stored.indexOf(":");
  if (idx === -1) return false;
  const salt = stored.slice(0, idx);
  const hash = stored.slice(idx + 1);
  const candidate = scryptSync(password, salt, 32);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

/** Emails compare as email.toUpperCase().toLowerCase(). */
export function foldEmail(email: string): string {
  return email.toUpperCase().toLowerCase();
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Time comparisons used across the app. */
export { compareAsc };
