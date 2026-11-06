import type { IncomingMessage } from "node:http";

import { copy, normaliseEmail } from "../src/shared/hour";
import { now } from "./clock";
import { transaction, withDb } from "./db";
import { rateLimit } from "./guards";
import { ApiError, cookie, invalid, isObject, unaccepted, type Reply } from "./http";
import { issueLink } from "./links";
import { signInMail } from "./messages";
import { deliverNow, enqueue } from "./outbox";
import { adoptDraft } from "./plans";
import { hashToken, newId, newToken } from "./tokens";

const SESSION_COOKIE = "stillhour_session";
const LINK_LIFETIME_MS = 15 * 60_000;
const SESSION_LIFETIME_S = 2_592_000;

/**
 * Asks for a sign-in link. The reply is the same for every address; a link is mailed only to an
 * address with a draft or a confirmed hour.
 */
export async function requestSignIn(body: unknown): Promise<Reply> {
  const fields = isObject(body) ? unaccepted(body, ["email"]) : {};
  const email = normaliseEmail(isObject(body) ? body.email : undefined);
  if (!email) fields.email = copy.email;
  if (!email || Object.keys(fields).length) throw invalid(fields);
  // The link and its email are committed first; only then is the email handed to SMTP.
  const mailId = await transaction(async (db) => {
    await rateLimit(db, "sign_ins", email);
    const known = await db.query(
      "SELECT 1 FROM drafts WHERE email = $1 UNION ALL SELECT 1 FROM visitors v JOIN plans p ON p.visitor_id = v.id WHERE v.email = $1 LIMIT 1",
      [email],
    );
    if (!known.rowCount) return null;
    const link = await issueLink(db, email, "sign_in");
    return enqueue(db, { to: email, linkHash: link.hash, sendingNow: true, ...signInMail(link.token) });
  });
  if (mailId) await transaction((db) => deliverNow(db, mailId));
  return { status: 202, body: { status: "link_sent" } };
}

const sessionCookie = (token: string, maxAge: number) =>
  `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`;

/** A confirmation link carries the draft it confirms until that draft becomes the hour. */
type LinkRow = { email: string; sent_at: Date | null; used_at: Date | null } & (
  | { purpose: "confirm"; draft_id: string }
  | { purpose: "sign_in"; draft_id: null }
);

/**
 * Spends an emailed link exactly once. It works strictly before 15 minutes after its email reached the
 * mail service; used beats expired. A confirmation link also makes its draft the address's hour.
 */
export async function verifyLink(body: unknown): Promise<Reply> {
  const fields = isObject(body) ? unaccepted(body, ["token"]) : {};
  const token = isObject(body) ? body.token : undefined;
  const isToken = typeof token === "string" && token !== "";
  if (!isToken) fields.token = copy.token;
  if (!isToken || Object.keys(fields).length) throw invalid(fields);
  const tokenHash = hashToken(token);
  return transaction(async (db) => {
    const rows = await db.query<LinkRow>(
      "SELECT email, purpose, draft_id, sent_at, used_at FROM links WHERE token_hash = $1 FOR UPDATE",
      [tokenHash],
    );
    const link = rows.rows[0];
    if (!link) throw new ApiError("link_unknown");
    if (link.used_at) throw new ApiError("link_used");
    const at = now();
    // A link whose email is still queued has not started its 15 minutes (and no one holds it yet).
    if (link.sent_at && at.getTime() >= link.sent_at.getTime() + LINK_LIFETIME_MS) throw new ApiError("link_expired");
    await db.query("UPDATE links SET used_at = $2 WHERE token_hash = $1", [tokenHash, at]);
    const visitor = await db.query<{ id: string }>(
      `INSERT INTO visitors (id, email) VALUES ($1, $2)
       ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING id`,
      [newId(), link.email],
    );
    const visitorId = visitor.rows[0].id;
    if (link.purpose === "confirm") await adoptDraft(db, visitorId, link.draft_id);
    const hasHour = await db.query("SELECT 1 FROM plans WHERE visitor_id = $1", [visitorId]);
    const session = newToken();
    await db.query("INSERT INTO sessions (token_hash, visitor_id, expires_at) VALUES ($1, $2, $3)", [
      hashToken(session),
      visitorId,
      new Date(at.getTime() + SESSION_LIFETIME_S * 1000),
    ]);
    return {
      status: 200,
      body: { signed_in: true, email: link.email, confirmed: Boolean(hasHour.rowCount) },
      headers: { "set-cookie": sessionCookie(session, SESSION_LIFETIME_S) },
    };
  });
}

/** The signed-in visitor's id (their session lasts 30 days on the app clock), or 401. */
export async function visitorOf(request: IncomingMessage): Promise<string> {
  const token = cookie(request, SESSION_COOKIE);
  if (!token) throw new ApiError("signed_out");
  const rows = await withDb((db) =>
    db.query<{ visitor_id: string }>("SELECT visitor_id FROM sessions WHERE token_hash = $1 AND expires_at > $2", [hashToken(token), now()]),
  );
  if (!rows.rows[0]) throw new ApiError("signed_out");
  return rows.rows[0].visitor_id;
}

export async function endSession(request: IncomingMessage): Promise<Reply> {
  const token = cookie(request, SESSION_COOKIE);
  if (token) await withDb((db) => db.query("DELETE FROM sessions WHERE token_hash = $1", [hashToken(token)]));
  return { status: 204, headers: clearedSession() };
}

export const clearedSession = () => ({ "set-cookie": sessionCookie("", 0) });
