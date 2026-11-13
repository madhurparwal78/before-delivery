import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const COST = 16384;
const KEY_BYTES = 32;

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_BYTES, { N: COST }, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}

/** Checks a password against a stored hash; an unknown account is checked against a hash nobody can match, so the work is the same. */
export async function checkPassword(password: string, stored: string | undefined): Promise<boolean> {
  const [, saltText, keyText] = (stored ?? (await unmatchable())).split("$");
  const expected = Buffer.from(keyText ?? "", "base64");
  const actual = await derive(password, Buffer.from(saltText ?? "", "base64"));
  return stored !== undefined && expected.length === actual.length && timingSafeEqual(expected, actual);
}

let decoy: Promise<string> | undefined;
function unmatchable(): Promise<string> {
  decoy ??= hashPassword(randomBytes(24).toString("base64"));
  return decoy;
}

export const digest = (token: string): string => createHash("sha256").update(token).digest("hex");
export const newToken = (): string => randomBytes(32).toString("base64url");
