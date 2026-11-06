import { randomBytes, scrypt, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt) as (p: string, s: string, k: number) => Promise<Buffer>;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = await scryptAsync(password, salt, 32);
  return `scrypt:${salt}:${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(":");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const derived = await scryptAsync(password, parts[1], 32);
  const expected = Buffer.from(parts[2], "hex");
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

export function sha256Hex(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

export function shortId(prefix: string): string {
  return `${prefix}_${randomBytes(9).toString("base64url")}`;
}
