// Passwords, session tokens and the one rule for whether a session has ended.
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { config } from "../config.js";

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, 32);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

export async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [, saltHex, keyHex] = stored.split("$");
  const key = await scryptAsync(password, Buffer.from(saltHex!, "hex"), 32);
  return timingSafeEqual(key, Buffer.from(keyHex!, "hex"));
}

export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** A session ends once this instance's idle time has passed since its last activity recorded by any instance. */
export function sessionEnded(lastActivityAt: number, now: number): boolean {
  return now - lastActivityAt > config.sessionIdleSeconds * 1000;
}
