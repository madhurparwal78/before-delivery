// Password hashing with scrypt; unknown accounts are checked against a dummy hash so timing does not differ.
import { randomBytes, scrypt as scryptCb, timingSafeEqual, randomUUID } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, length: number) => Promise<Buffer>;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 32);
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}

const DUMMY = hashPassword(randomUUID());

/** Verifies against `stored`, or against a throwaway hash when there is no account. */
export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  const [, saltText, keyText] = (stored ?? (await DUMMY)).split("$");
  const expected = Buffer.from(keyText, "base64");
  const actual = await scrypt(password, Buffer.from(saltText, "base64"), expected.length);
  return stored !== null && timingSafeEqual(actual, expected);
}

export function newId(prefix: string): string {
  return `${prefix}-${randomBytes(6).toString("hex")}`;
}
