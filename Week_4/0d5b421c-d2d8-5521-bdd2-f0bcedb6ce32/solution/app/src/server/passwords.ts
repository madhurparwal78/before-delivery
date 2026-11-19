import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const KEY_LENGTH = 32;

/** Salted scrypt hash, stored as `salt:hash` in hex. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  return `${salt.toString("hex")}:${scryptSync(password, salt, KEY_LENGTH).toString("hex")}`;
}

export function passwordMatches(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  const expected = Buffer.from(hash ?? "", "hex");
  const actual = scryptSync(password, Buffer.from(salt ?? "", "hex"), KEY_LENGTH);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
