import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const KEY_LENGTH = 32;

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, KEY_LENGTH, { N: 16384, r: 8, p: 1 }, (error, key) => (error ? reject(error) : resolve(key))),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("base64url")}$${(await derive(password, salt)).toString("base64url")}`;
}

const DECOY = `scrypt$${randomBytes(16).toString("base64url")}$${randomBytes(KEY_LENGTH).toString("base64url")}`;

/** Verifies in constant time; an unknown account is checked against a decoy so timing reveals nothing. */
export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  const [, salt, key] = (stored ?? DECOY).split("$");
  const expected = Buffer.from(key ?? "", "base64url");
  const actual = await derive(password, Buffer.from(salt ?? "", "base64url"));
  return stored !== null && expected.length === actual.length && timingSafeEqual(expected, actual);
}
