import { createHash, randomBytes } from "node:crypto";

export function id(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString("base64url")}`;
}

/** Game codes: 12 characters from lowercase letters and digits, secure random. */
export function gameCode(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = randomBytes(12);
  let code = "";
  for (let i = 0; i < 12; i++) code += alphabet[bytes[i]! % alphabet.length];
  return code;
}

export function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** Timestamps are ISO 8601 UTC with milliseconds. */
export function pgToIso(value: Date | string): string {
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toISOString();
}

export function cookiesOf(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (name) out[name] = decodeURIComponent(value);
  }
  return out;
}

export function playerCookie(value: string): string {
  return `overlap_player=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Path=/`;
}
