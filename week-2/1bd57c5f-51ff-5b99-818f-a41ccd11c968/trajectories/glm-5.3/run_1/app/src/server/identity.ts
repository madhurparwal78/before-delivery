import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (p: string, s: Buffer, len: number) => Promise<Buffer>;

const SCRYPT_KEYLEN = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, SCRYPT_KEYLEN);
  return `scrypt:${salt.toString("hex")}:${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(":");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const saltPart = parts[1];
  const hashPart = parts[2];
  if (saltPart === undefined || hashPart === undefined) return false;
  const salt = Buffer.from(saltPart, "hex");
  const expected = Buffer.from(hashPart, "hex");
  const derived = await scrypt(password, salt, expected.length);
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString("hex")}`;
}

export function newToken(): string {
  return randomBytes(32).toString("hex");
}

export function newUuid(): string {
  return randomBytes(16).toString("hex") + randomBytes(16).toString("hex");
}
