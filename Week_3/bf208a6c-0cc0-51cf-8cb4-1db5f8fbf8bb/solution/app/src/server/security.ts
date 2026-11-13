import { createHash, randomBytes, randomInt, scrypt, timingSafeEqual } from "node:crypto";

const KEY_BYTES = 32;

function derive(secret: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(secret, salt, KEY_BYTES, (error, key) => (error ? reject(error) : resolve(key))));
}

export async function hashSecret(secret: string): Promise<string> {
  const salt = randomBytes(16);
  return `${salt.toString("hex")}:${(await derive(secret, salt)).toString("hex")}`;
}

export async function secretMatches(secret: string, stored: string): Promise<boolean> {
  const [salt, key] = stored.split(":");
  if (!salt || !key) return false;
  return timingSafeEqual(await derive(secret, Buffer.from(salt, "hex")), Buffer.from(key, "hex"));
}

export const newToken = (): string => randomBytes(24).toString("base64url");

export const digest = (value: string): string => createHash("sha256").update(value).digest("hex");

export const newCode = (): string => String(randomInt(0, 1_000_000)).padStart(6, "0");
