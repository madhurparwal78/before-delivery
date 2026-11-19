import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = (stored ?? "").split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  try {
    const salt = Buffer.from(parts[1], "base64");
    const expected = Buffer.from(parts[2], "base64");
    const actual = scryptSync(password, salt, expected.length, { N: 16384, r: 8, p: 1 });
    return timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function newSessionToken(): string {
  return randomBytes(24).toString("base64url");
}

export function cookieValue(name: string, value: string): string {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax`;
}

export function cookieClear(name: string): string {
  return `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export type Random = () => number;
export function cryptoRandom(): number {
  const b = randomBytes(4);
  return b.readUInt32BE(0) / 0x100000000;
}

export const SESSION_COOKIE = "wayticket_session";
