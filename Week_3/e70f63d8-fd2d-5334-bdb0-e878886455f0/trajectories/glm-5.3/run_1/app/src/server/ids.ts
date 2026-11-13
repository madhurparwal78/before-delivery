import { randomBytes, scryptSync, timingSafeEqual, randomUUID } from "node:crypto";

// Sessions are opaque random tokens in Postgres; passwords are scrypt hashes.

export const newId = (): string => randomUUID();

export const newPasswordHash = (password: string): string => {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, Buffer.from(salt, "hex"), 32).toString("hex");
  return `${salt}:${hash}`;
};

export const passwordMatches = (password: string, stored: string): boolean => {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, Buffer.from(salt, "hex"), 32);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
};

export const newSessionToken = (): string => randomBytes(32).toString("base64url");

const ALPHANUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
export const newViewerCode = (): string => {
  const bytes = randomBytes(22);
  let out = "";
  for (let i = 0; i < 22; i++) out += ALPHANUM[bytes[i] % ALPHANUM.length];
  return out;
};

export const newInviteToken = (): string => randomBytes(24).toString("base64url");

export const newPenId = (): string => randomBytes(16).toString("hex");
