import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export function id(prefix: string): string {
  return `${prefix}-${randomBytes(10).toString("hex")}`;
}

export function shareToken(): string {
  return randomBytes(18).toString("base64url");
}

export function code6(): string {
  return String(Math.floor(Math.random() * 1000000)).padStart(6, "0");
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(":");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const hash = scryptSync(password, parts[1], 64);
  const expected = Buffer.from(parts[2], "hex");
  return hash.length === expected.length && timingSafeEqual(hash, expected);
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

const NETWORKS: Array<{ test: (n: string) => boolean; name: string }> = [
  { test: (n) => /^4/.test(n), name: "Visa" },
  { test: (n) => /^(5[1-5]|2(2[2-9]|[3-6]\d|7[0-2]|20[1-9]))/.test(n), name: "Mastercard" },
  { test: (n) => /^(60|65|81|82|508)/.test(n), name: "RuPay" },
];

export function luhn(number: string): boolean {
  if (!/^\d{12,19}$/.test(number)) return false;
  let sum = 0;
  let alt = false;
  for (let i = number.length - 1; i >= 0; i--) {
    let d = Number(number[i]);
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

export function cardNetwork(number: string): string | null {
  for (const n of NETWORKS) {
    if (n.test(number)) return n.name;
  }
  return null;
}
