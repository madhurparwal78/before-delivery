// Sealing of access-key, webhook and two-step secrets, keyed by FARSHORE_SECRET_KEY (or the generated
// sealing-key file), random identifiers and password hashing.
import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { config } from "./config.js";

const sealKey = createHash("sha256").update(`seal\u0000${config.secretKey}`).digest();

export function seal(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", sealKey, iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
}

export function unseal(sealed: string): string {
  const raw = Buffer.from(sealed, "base64");
  const decipher = createDecipheriv("aes-256-gcm", sealKey, raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}

export function sha256Hex(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

// Recovery codes are accepted in any letter case, with or without the hyphen; only this hash is stored.
export const normalizeRecoveryCode = (code: string): string => code.toLowerCase().replace(/-/g, "");
export const recoveryCodeHash = (code: string): string => sha256Hex(normalizeRecoveryCode(code));

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

const ALNUM_UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

function randomFrom(alphabet: string, length: number): string {
  let out = "";
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      // Reject bytes past the largest multiple of the alphabet size so every character is equally likely.
      if (byte < 256 - (256 % alphabet.length) && out.length < length) out += alphabet[byte % alphabet.length];
    }
  }
  return out;
}

export const newKeyId = (): string => `FSK${randomFrom(ALNUM_UPPER, 17)}`;
export const newKeySecret = (): string => randomFrom(ALNUM, 40);
export const newId = (): string => randomBytes(12).toString("hex");
export const newRecoveryCode = (): string => randomFrom("abcdefghijklmnopqrstuvwxyz0123456789", 10);

function scryptAsync(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, 32, { N: 16384, r: 8, p: 1 }, (error, key) => (error ? reject(error) : resolve(key))));
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("base64")}$${(await scryptAsync(password, salt)).toString("base64")}`;
}

export async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [, salt, hash] = stored.split("$");
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const actual = await scryptAsync(password, Buffer.from(salt, "base64"));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
