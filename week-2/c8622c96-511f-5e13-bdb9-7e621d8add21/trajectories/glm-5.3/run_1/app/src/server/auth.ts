import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const ITERATIONS = 16384;
const KEYLEN = 32;

export async function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = randomBytes(16);
    scrypt(password, salt, KEYLEN, { N: ITERATIONS, r: 8, p: 1 }, (err, derived) => {
      if (err) reject(err);
      else resolve(`pbkdf2$${ITERATIONS}$${salt.toString("base64")}$${derived.toString("base64")}`);
    });
  });
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = Number(parts[1]);
  const salt = Buffer.from(parts[2], "base64");
  const expected = Buffer.from(parts[3], "base64");
  return new Promise((resolve) => {
    scrypt(password, salt, expected.length, { N: iterations, r: 8, p: 1 }, (err, derived) => {
      if (err) {
        resolve(false);
        return;
      }
      resolve(derived.length === expected.length && timingSafeEqual(derived, expected));
    });
  });
}

export function newToken(): string {
  return randomBytes(32).toString("hex");
}

export function sessionCookieSecret(): string {
  return createHmac("sha256", "saltprint-session").update(randomBytes(8)).digest("hex");
}
