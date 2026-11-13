import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hashSync(password, 10);
}

export async function checkPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compareSync(password, hash);
}

export function newSessionToken(): string {
  return randomBytes(32).toString("hex");
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function sha256Buffer(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** A new upload API key: spk_ + 32 lower-case hex characters. */
export function newKey(): string {
  return "spk_" + randomBytes(16).toString("hex");
}
