import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const KEY_LENGTH = 32;

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `${salt.toString("hex")}:${key.toString("hex")}`;
}

const DECOY = hashPassword("decoy-password-for-unknown-emails");

/** Always does one derivation, so an unknown email costs the same as a wrong password. */
export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  const [saltHex, keyHex] = (stored ?? (await DECOY)).split(":");
  const expected = Buffer.from(keyHex ?? "", "hex");
  const actual = await derive(password, Buffer.from(saltHex ?? "", "hex"));
  return stored !== null && expected.length === actual.length && timingSafeEqual(expected, actual);
}
