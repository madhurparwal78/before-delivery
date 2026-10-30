// Password hashing with scrypt from node:crypto.
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const derive = promisify(scrypt) as (password: string, salt: Buffer, length: number) => Promise<Buffer>;
const LENGTH = 32;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, LENGTH);
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [, salt, key] = stored.split("$");
  if (!salt || !key) return false;
  const expected = Buffer.from(key, "base64");
  const actual = await derive(password, Buffer.from(salt, "base64"), expected.length);
  return timingSafeEqual(actual, expected);
}

/** Signup rule: 10 to 72 characters with at least one letter and one digit. */
export function passwordProblem(value: unknown): string | null {
  const ok = typeof value === "string" && value.length >= 10 && value.length <= 72 && /\p{L}/u.test(value) && /\d/.test(value);
  return ok ? null : "Use 10 or more characters with a letter and a digit.";
}
