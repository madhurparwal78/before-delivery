import { randomBytes } from "node:crypto";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** A short upper-case identifier such as `CH-7K2M9XQA`. */
export function publicId(prefix: string, length = 8): string {
  const bytes = randomBytes(length);
  let body = "";
  for (let i = 0; i < length; i += 1) body += ALPHABET[(bytes[i] ?? 0) % ALPHABET.length];
  return `${prefix}-${body}`;
}

export function secretToken(bytes = 24): string {
  return randomBytes(bytes).toString("base64url");
}
