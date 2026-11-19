import { randomBytes, randomUUID } from "node:crypto";

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

/** Secret key of at least 32 characters, URL-safe. */
export function newPersonKey(): string {
  return `dgk_${randomBytes(24).toString("base64url")}`;
}

/** Fix code: random secret of at least 32 URL-safe characters. */
export function newFixCode(): string {
  return randomBytes(32).toString("base64url");
}
