import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";

const N = 32768; // 2^15
const R = 8;
const P = 1;
const KEYLEN = 32;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEYLEN, { N, r: R, p: P, maxmem: 134217728 });
  return `scrypt$${N}$${R}$${P}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = Buffer.from(parts[4], "hex");
  const expected = Buffer.from(parts[5], "hex");
  const hash = scryptSync(password, salt, expected.length, { N: n, r, p, maxmem: 134217728 });
  return hash.length === expected.length && timingSafeEqual(hash, expected);
}

// Session ids and invite tokens: at least 128 bits from a cryptographic source.
export function newSessionToken(): string {
  return randomBytes(24).toString("base64url");
}

export function newInviteToken(): string {
  return randomBytes(24).toString("base64url");
}
