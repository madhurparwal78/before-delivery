import { randomUUID, createHash, timingSafeEqual } from "node:crypto";

export function uuid(): string {
  return randomUUID();
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function newSessionToken(): string {
  return randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
}

export function verifySecret(storedHex: string, given: string): boolean {
  const a = Buffer.from(storedHex, "hex");
  const b = createHash("sha256").update(given).digest();
  return a.length === b.length && timingSafeEqual(a, b);
}
