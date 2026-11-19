import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/** Opaque ids: url-safe base64 of random bytes. */
export function newId(): string {
  return randomBytes(12).toString("base64url");
}

/** Unguessable page tokens: 32 bytes. */
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 32).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(":");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const hash = scryptSync(password, parts[1], 32);
  const expected = Buffer.from(parts[2], "hex");
  return hash.length === expected.length && timingSafeEqual(hash, expected);
}

/** A stable inputs hash: keys sorted, so the same body always hashes alike. */
export function stableHash(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}
