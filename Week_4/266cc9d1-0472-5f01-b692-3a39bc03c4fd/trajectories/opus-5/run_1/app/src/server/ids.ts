import { randomBytes } from "node:crypto";

const ALPHABET = "abcdefghijkmnopqrstuvwxyz0123456789";

export function newId(prefix: string): string {
  const bytes = randomBytes(16);
  let text = "";
  for (const byte of bytes) text += ALPHABET[byte % ALPHABET.length];
  return `${prefix}-${text}`;
}

/** Review tokens are at least 32 random URL-safe characters. */
export function newReviewToken(): string {
  return randomBytes(33).toString("base64url");
}
