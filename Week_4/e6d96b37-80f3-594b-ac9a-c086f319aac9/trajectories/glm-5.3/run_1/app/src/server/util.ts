import { createHash, randomBytes } from "node:crypto";

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function randomHex(bytes = 16): string {
  return randomBytes(bytes).toString("hex");
}

export function randomId(prefix: string, bytes = 12): string {
  return `${prefix}_${randomBytes(bytes).toString("hex")}`;
}

const TOKEN_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export function randomToken(length = 40): string {
  const buf = randomBytes(length);
  let s = "";
  for (let i = 0; i < length; i++) {
    s += TOKEN_ALPHABET[buf[i] % TOKEN_ALPHABET.length];
  }
  return s;
}

export function urlSafeToken(length = 32): string {
  const buf = randomBytes(length);
  let s = "";
  for (let i = 0; i < length; i++) {
    s += TOKEN_ALPHABET[buf[i] % TOKEN_ALPHABET.length];
  }
  return s;
}

export function etagFor(bytes: Uint8Array): string {
  return `"${sha256Hex(bytes).slice(0, 24)}"`;
}
