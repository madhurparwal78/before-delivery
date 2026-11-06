import { randomBytes, randomUUID } from "node:crypto";

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

export function newId(prefix: string): string {
  const raw = randomBytes(16);
  let out = "";
  for (const byte of raw) out += ALPHABET[byte % ALPHABET.length];
  return `${prefix}_${out}`;
}

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function uuid(): string {
  return randomUUID();
}
