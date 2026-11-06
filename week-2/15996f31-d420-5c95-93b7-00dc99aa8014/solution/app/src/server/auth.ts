// Sessions (brief: API → Sessions) and the opaque ids and tokens the server makes.

import { createHash, randomBytes } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { User } from "../shared/api.js";
import { one, pool } from "./db.js";
import { parseCookies } from "./http.js";

export const SESSION_COOKIE = "bloom_session";

const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

export function newId(prefix: string): string {
  const bytes = randomBytes(14);
  return `${prefix}_${[...bytes].map((byte) => ALPHABET[byte % ALPHABET.length]).join("")}`;
}

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function authenticate(req: IncomingMessage): Promise<User | null> {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!token) return null;
  return one<User>(
    pool,
    "SELECT u.id, u.name, u.role FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1",
    [hashToken(token)],
  );
}

export function sessionCookie(token: string, clear = false): string {
  return `${SESSION_COOKIE}=${clear ? "" : token}; Path=/; HttpOnly; SameSite=Lax${clear ? "; Max-Age=0" : ""}`;
}
