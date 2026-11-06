import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

const PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;
const KEY_LENGTH = 32;

function derive(password: string, salt: Buffer, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, options, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

/** Memory-hard scrypt hash with its own random salt: `scrypt$N$r$p$salt$hash`. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, PARAMS);
  return ["scrypt", PARAMS.N, PARAMS.r, PARAMS.p, salt.toString("base64"), key.toString("base64")].join("$");
}

/** A hash of a random password, so sign-in for an unknown email does the same hashing work. */
export const decoyHash = hashPassword(randomBytes(24).toString("base64"));

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const key = await derive(password, Buffer.from(salt, "base64"), { N: Number(n), r: Number(r), p: Number(p), maxmem: PARAMS.maxmem });
  return key.length === expected.length && timingSafeEqual(key, expected);
}
