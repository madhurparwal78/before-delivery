import crypto from "node:crypto";
import type { Db } from "./db.js";
import { clock } from "./clock.js";

export type Ctx = {
  visitorId: string;
  sessionId: string | null;
  username: string | null;
  role: "guest" | "manager" | "operator" | null;
  manages: string[];
  lang: "en" | "de" | "ar";
  cur: "EUR" | "USD" | "JPY" | "KWD";
  setVisitor: boolean;
  setSession: boolean;
  clearSession: boolean;
};

export function randomToken(bytes = 24): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function bookingCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  const buf = crypto.randomBytes(6);
  for (let i = 0; i < 6; i++) s += alphabet[buf[i] % alphabet.length];
  return "KW-" + s;
}

const ISO_LANGS = ["en", "de", "ar"] as const;
const ISO_CURS = ["EUR", "USD", "JPY", "KWD"] as const;

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export async function loadContext(db: Db, cookieHeader: string | undefined): Promise<Ctx> {
  const cookies = parseCookies(cookieHeader);
  const ctx: Ctx = {
    visitorId: cookies.kip_visitor ?? "",
    sessionId: cookies.kip_session ?? null,
    username: null,
    role: null,
    manages: [],
    lang: "en",
    cur: "EUR",
    setVisitor: false,
    setSession: false,
    clearSession: false
  };
  if (!ctx.visitorId) {
    ctx.visitorId = randomToken(18);
    ctx.setVisitor = true;
    await db.query("INSERT INTO visitors (id, lang, cur) VALUES ($1,'en','EUR') ON CONFLICT DO NOTHING", [ctx.visitorId]);
  } else {
    const r = await db.query("SELECT lang, cur FROM visitors WHERE id = $1", [ctx.visitorId]);
    if (r.rows[0]) {
      ctx.lang = r.rows[0].lang;
      ctx.cur = r.rows[0].cur;
    } else {
      await db.query("INSERT INTO visitors (id, lang, cur) VALUES ($1,'en','EUR') ON CONFLICT DO NOTHING", [ctx.visitorId]);
    }
  }
  if (ctx.sessionId) {
    const s = await db.query("SELECT username FROM sessions WHERE id = $1", [ctx.sessionId]);
    if (s.rows[0]) {
      ctx.username = s.rows[0].username;
      const u = await db.query("SELECT role, lang, cur FROM users u JOIN sessions s ON s.username = u.username WHERE s.id = $1", [ctx.sessionId]);
      if (u.rows[0]) {
        ctx.role = u.rows[0].role;
        ctx.lang = u.rows[0].lang;
        ctx.cur = u.rows[0].cur;
      }
      if (ctx.role === "manager") {
        const m = await db.query(
          "SELECT p.code FROM manager_properties mp JOIN properties p ON p.id = mp.property_id WHERE mp.username = $1 ORDER BY p.code",
          [ctx.username]
        );
        ctx.manages = m.rows.map((r: { code: string }) => r.code);
      }
    } else {
      ctx.sessionId = null;
      ctx.clearSession = true;
    }
  }
  if (ctx.lang !== "en" && !ISO_LANGS.includes(ctx.lang as "en")) ctx.lang = "en";
  if (!ISO_CURS.includes(ctx.cur as "EUR")) ctx.cur = "EUR";
  return ctx;
}

export function cookieHeader(ctx: Ctx): string[] {
  const out: string[] = [];
  const base = "HttpOnly; SameSite=Lax; Path=/";
  if (ctx.setVisitor) out.push(`kip_visitor=${encodeURIComponent(ctx.visitorId)}; ${base}`);
  if (ctx.setSession) out.push(`kip_session=${encodeURIComponent(ctx.sessionId!)}; ${base}`);
  if (ctx.clearSession) out.push(`kip_session=; ${base}; Max-Age=0`);
  return out;
}

/** Sessions of one user, for sign-out-everywhere and account events. */
export async function sessionVisitorPairs(db: Db, username: string): Promise<{ sessionId: string }[]> {
  return (await db.query("SELECT id AS \"sessionId\" FROM sessions WHERE username = $1", [username])).rows;
}

export async function storePreferences(db: Db, ctx: Ctx, lang: "en" | "de" | "ar", cur: "EUR" | "USD" | "JPY" | "KWD"): Promise<void> {
  if (ctx.username) {
    await db.query("UPDATE sessions SET lang = $1, cur = $2 WHERE id = $3", [lang, cur, ctx.sessionId]);
  } else {
    await db.query("UPDATE visitors SET lang = $1, cur = $2 WHERE id = $3", [lang, cur, ctx.visitorId]);
  }
}

export async function completedStaysCount(db: Db, ctx: Ctx): Promise<number> {
  // Completed bookings made by this user or visitor in the 730 days up to now.
  const now = clock.now();
  const cutoff = new Date(now.getTime() - 730 * 86400000);
  const r = await db.query(
    `SELECT count(DISTINCT b.id)::int AS n FROM bookings b
     WHERE b.state = 'completed' AND b.completion_at >= $1
       AND (($2::text IS NOT NULL AND b.username = $2) OR ($3::text IS NOT NULL AND b.visitor_id = $3))`,
    [cutoff, ctx.username, ctx.username ? null : ctx.visitorId]
  );
  return r.rows[0].n;
}
