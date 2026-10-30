// Random identifiers and secrets. Every id carries at least 80 bits of randomness.
import { createHash, randomBytes, randomInt } from "node:crypto";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** prefix + 20 lowercase letters or digits (about 103 bits). */
export function randomId(prefix: string, length = 20): string {
  let out = prefix;
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

/** 32 random bytes, URL-safe: share tokens, session cookies and postbox keys. */
export function secretToken(): string {
  return randomBytes(32).toString("base64url");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function courierName(): string {
  return `Courier ${String(randomInt(10000)).padStart(4, "0")}`;
}

export const iso = (at: Date | number): string => new Date(at).toISOString();
