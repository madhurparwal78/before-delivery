import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const KEY_BYTES = 32;

function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_BYTES, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${(await derive(password, salt)).toString("hex")}`;
}

export async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [salt, key] = stored.split(":");
  return timingSafeEqual(await derive(password, salt), Buffer.from(key, "hex"));
}

/** A hash no password matches, so an unknown email takes as long as a wrong password. */
export const DECOY_HASH = `${"0".repeat(32)}:${"0".repeat(KEY_BYTES * 2)}`;
