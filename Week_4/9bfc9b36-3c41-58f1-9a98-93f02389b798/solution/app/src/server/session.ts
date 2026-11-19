/** The session cookie: a signed envelope around the realm's refresh token, readable only by this server. */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config.js";

const key = createHash("sha256").update(`boltrope-session:${config.clientSecret}`).digest();

interface Session {
  sub: string;
  refreshToken: string;
  expiresAt: number;
}

const sign = (payload: string): Buffer => createHmac("sha256", key).update(payload).digest();

export function sealSession(session: Session): string {
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  return `${payload}.${sign(payload).toString("base64url")}`;
}

export function openSession(cookie: string): Session | null {
  const [payload, mac, ...extra] = cookie.split(".");
  if (!payload || !mac || extra.length) return null;
  const given = Buffer.from(mac, "base64url");
  const expected = sign(payload);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Session;
    return typeof session.sub === "string" && typeof session.refreshToken === "string" && session.expiresAt > Date.now() ? session : null;
  } catch {
    return null;
  }
}
