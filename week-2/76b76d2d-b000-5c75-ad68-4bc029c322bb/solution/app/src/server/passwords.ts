import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password, salt, 32, (error, key) => (error ? reject(error) : resolve(key))));
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("base64url")}$${(await derive(password, salt)).toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [, salt, key] = stored.split("$");
  if (!salt || !key) return false;
  const expected = Buffer.from(key, "base64url");
  const actual = await derive(password, Buffer.from(salt, "base64url"));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
