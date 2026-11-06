// Password hashing (scrypt) and the random tokens behind sessions, approval, invite and preview links.
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const KEY_LENGTH = 32;

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, { N: 16384, r: 8, p: 1 }, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("base64")}$${(await derive(password, salt)).toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [, salt, key] = stored.split("$");
  const expected = Buffer.from(key, "base64");
  const actual = await derive(password, Buffer.from(salt, "base64"));
  return timingSafeEqual(expected, actual);
}

/** 32 random bytes in URL-safe base64. */
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Only token hashes are stored. */
export function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
