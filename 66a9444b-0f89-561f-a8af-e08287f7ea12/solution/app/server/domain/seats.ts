// Seat holds and the waitlist. Every change to a session's seats runs under that session's row lock, so
// competing requests for the last seats are judged one at a time; seats remaining is computed, never stored.
import { deadlineText } from "../../shared/brussels.ts";
import { config } from "../config.ts";
import { db, transaction, type Db } from "../db/index.ts";
import { ApiError, FieldErrors, appOrigin, notFound, ok, route, type SignedInCtx } from "../http.ts";
import { audit } from "./audit.ts";
import { newId } from "./ids.ts";
import { queueMail } from "./outbox.ts";
import { isoOrNull, isoUtc } from "./time.ts";
import { asObject, intOrNull } from "./validate.ts";

const HOLD_LIMIT = { visitor: 4, group_booker: 30 } as const;
const BUYERS = ["visitor", "group_booker"] as const;

type HoldRow = { id: string; session_id: string; quantity: number; expires_at: Date; status: string };

function holdView(h: HoldRow) {
  return { id: h.id, session_id: h.session_id, quantity: h.quantity, expires_at: isoUtc(h.expires_at), status: h.status };
}

async function seatsRemaining(q: Db, sessionId: string, now: Date): Promise<number | null> {
  return (await q.one<{ n: number | null }>("SELECT seats_remaining($1, $2) AS n", [sessionId, now]))!.n;
}

/**
 * Settles one session under its lock: lapsed holds expire, lapsed offers pass on, and every freed seat goes to
 * the earliest waiting entry as a mailed offer with its claim window.
 */
export async function settleSession(q: Db, sessionId: string, now: Date): Promise<void> {
  const session = await q.one<{ status: string; title: string }>("SELECT status, title FROM sessions WHERE id = $1 FOR UPDATE", [sessionId]);
  if (!session) return;
  const expired = await q.all<{ id: string }>(
    "UPDATE holds SET status = 'expired' WHERE session_id = $1 AND status = 'active' AND NOT is_live(expires_at, $2) RETURNING id", [sessionId, now]);
  for (const hold of expired) await audit(q, "system", "hold.expired", { type: "hold", id: hold.id });
  const lapsed = await q.all<{ id: string }>(
    "UPDATE waitlist_entries SET status = 'lapsed' WHERE session_id = $1 AND status = 'offered' AND NOT is_live(offer_expires_at, $2) RETURNING id",
    [sessionId, now]);
  for (const entry of lapsed) await audit(q, "system", "waitlist.offer_lapsed", { type: "waitlist_entry", id: entry.id });
  if (session.status === "cancelled") return;
  let free = (await seatsRemaining(q, sessionId, now)) ?? 0;
  while (free > 0) {
    const next = await q.one<{ id: string; email: string }>(
      `SELECT w.id, u.email FROM waitlist_entries w JOIN users u ON u.id = w.user_id
       WHERE w.session_id = $1 AND w.status = 'waiting' ORDER BY w.seq LIMIT 1`, [sessionId]);
    if (!next) return;
    const deadline = new Date(now.getTime() + config.time.waitlistClaimSeconds * 1000);
    await q.query("UPDATE waitlist_entries SET status = 'offered', offer_expires_at = $2 WHERE id = $1", [next.id, deadline]);
    await queueMail(q, {
      to: next.email,
      subject: `A seat is free: ${session.title}`,
      body: `A seat for ${session.title} is free and held for you.\n\nClaim it by ${deadlineText(deadline.getTime())} (Brussels time) on My tickets:\n${appOrigin()}/tickets\n\nIf you don't claim it by then, it goes to the next person on the waitlist.\n\nKerf Frequencies`,
    });
    free--;
  }
}

/** The worker's pass: settles every session with a hold or offer whose instant has passed. */
export async function settleDueSessions(): Promise<void> {
  const now = new Date();
  const due = await db.all<{ session_id: string }>(
    `SELECT DISTINCT session_id FROM holds WHERE status = 'active' AND NOT is_live(expires_at, $1)
     UNION SELECT DISTINCT session_id FROM waitlist_entries WHERE status = 'offered' AND NOT is_live(offer_expires_at, $1)`, [now]);
  for (const { session_id } of due) await transaction((tx) => settleSession(tx, session_id, now));
}

type LockedSession = { id: string; title: string; admission: string; status: string };

async function lockForSale(q: Db, sessionId: unknown, now: Date): Promise<LockedSession> {
  if (typeof sessionId !== "string") throw notFound();
  const session = await q.one<LockedSession>(
    "SELECT id, title, admission, effective_status(status, publish_at, $2) AS status FROM sessions WHERE id = $1", [sessionId, now]);
  if (!session) throw notFound();
  await settleSession(q, session.id, now);
  if (session.status === "cancelled") throw new ApiError(409, "session_cancelled");
  if (session.status !== "published") throw new ApiError(409, "not_on_sale");
  return session;
}

async function createHold(q: Db, userId: string, sessionId: string, quantity: number, now: Date): Promise<HoldRow> {
  const id = newId();
  const expires = new Date(now.getTime() + config.time.holdSeconds * 1000);
  await q.query("INSERT INTO holds (id, user_id, session_id, quantity, status, created_at, expires_at) VALUES ($1,$2,$3,$4,'active',$5,$6)",
    [id, userId, sessionId, quantity, now, expires]);
  return { id, session_id: sessionId, quantity, expires_at: expires, status: "active" };
}

route("POST", "/api/holds", BUYERS, async (ctx) => {
  const body = asObject(ctx.body);
  const result = await transaction(async (tx) => {
    const now = new Date();
    const session = await lockForSale(tx, body.session_id, now);
    const quantity = intOrNull(body.quantity);
    const limit = HOLD_LIMIT[ctx.user.role as keyof typeof HOLD_LIMIT];
    if (session.admission !== "seat") throw new FieldErrors({ session_id: "no_seats" });
    const remaining = (await seatsRemaining(tx, session.id, now))!;
    const inRange = quantity !== null && quantity >= 1 && quantity <= limit;
    if (remaining === 0 || (inRange && remaining < quantity)) return { soldOut: remaining };
    if (!inRange) throw new FieldErrors({ quantity: "out_of_range" });
    const hold = await createHold(tx, ctx.user.id, session.id, quantity, now);
    return { hold, remaining: remaining - quantity };
  });
  if ("soldOut" in result) throw new ApiError(409, "sold_out", { seats_remaining: result.soldOut, waitlist: true });
  return ok({ ...holdView(result.hold), seats_remaining: result.remaining }, 201);
});

route("GET", "/api/holds", BUYERS, async (ctx) => {
  const rows = await db.all<HoldRow>(
    "SELECT id, session_id, quantity, expires_at, status FROM holds WHERE user_id = $1 AND status = 'active' AND is_live(expires_at, $2) ORDER BY created_at",
    [ctx.user.id, new Date()]);
  return ok({ holds: rows.map(holdView) });
});

route("DELETE", "/api/holds/:id", BUYERS, async (ctx) => {
  await transaction(async (tx) => {
    const now = new Date();
    const hold = await tx.one<{ session_id: string }>("SELECT session_id FROM holds WHERE id = $1 AND user_id = $2", [ctx.params.id!, ctx.user.id]);
    if (!hold) throw notFound();
    await settleSession(tx, hold.session_id, now);
    const released = await tx.query("UPDATE holds SET status = 'released' WHERE id = $1 AND status = 'active' RETURNING id", [ctx.params.id!]);
    if (!released.rowCount) throw new ApiError(409, "hold_not_active");
    await settleSession(tx, hold.session_id, now);
  });
  return { status: 204 };
});

type WaitRow = { id: string; session_id: string; title: string; status: string; offer_expires_at: Date | null; position: number };

async function waitlistRows(q: Db, userId: string): Promise<WaitRow[]> {
  return q.all<WaitRow>(
    `SELECT w.id, w.session_id, s.title, w.status, w.offer_expires_at,
       (SELECT count(*) FROM waitlist_entries o WHERE o.session_id = w.session_id AND o.status = 'waiting' AND o.seq <= w.seq)::integer AS position
     FROM waitlist_entries w JOIN sessions s ON s.id = w.session_id WHERE w.user_id = $1 ORDER BY w.joined_at DESC`, [userId]);
}

route("POST", "/api/sessions/:id/waitlist", BUYERS, async (ctx: SignedInCtx) => {
  const entry = await transaction(async (tx) => {
    const now = new Date();
    const session = await lockForSale(tx, ctx.params.id, now);
    if (session.admission !== "seat") throw new ApiError(409, "not_on_sale");
    const waiting = await tx.one("SELECT id FROM waitlist_entries WHERE session_id = $1 AND user_id = $2 AND status = 'waiting'", [session.id, ctx.user.id]);
    if (waiting) throw new ApiError(409, "already_waiting");
    if ((await seatsRemaining(tx, session.id, now))! > 0) throw new ApiError(409, "seats_available");
    const id = newId();
    await tx.query("INSERT INTO waitlist_entries (id, user_id, session_id, status, joined_at) VALUES ($1, $2, $3, 'waiting', $4)",
      [id, ctx.user.id, session.id, now]);
    return (await waitlistRows(tx, ctx.user.id)).find((w) => w.id === id)!;
  });
  return ok({ id: entry.id, session_id: entry.session_id, position: entry.position, status: entry.status }, 201);
});

route("GET", "/api/waitlist", BUYERS, async (ctx) => {
  const now = new Date();
  await transaction(async (tx) => {
    for (const s of await tx.all<{ session_id: string }>(
      "SELECT DISTINCT session_id FROM waitlist_entries WHERE user_id = $1 AND status = 'offered'", [ctx.user.id])) {
      await settleSession(tx, s.session_id, now);
    }
  });
  const rows = await waitlistRows(db, ctx.user.id);
  return ok({
    entries: rows.map((w) => ({
      id: w.id, session_id: w.session_id, title: w.title, position: w.status === "waiting" ? w.position : null,
      status: w.status, offer_expires_at: w.status === "offered" ? isoOrNull(w.offer_expires_at) : null,
    })),
  });
});

route("POST", "/api/waitlist/:id/claim", BUYERS, async (ctx) => {
  const hold = await transaction(async (tx) => {
    const now = new Date();
    const entry = await tx.one<{ session_id: string }>("SELECT session_id FROM waitlist_entries WHERE id = $1 AND user_id = $2", [ctx.params.id!, ctx.user.id]);
    if (!entry) throw notFound();
    await settleSession(tx, entry.session_id, now);
    const claimed = await tx.query(
      "UPDATE waitlist_entries SET status = 'claimed' WHERE id = $1 AND status = 'offered' AND is_live(offer_expires_at, $2) RETURNING id", [ctx.params.id!, now]);
    if (claimed.rowCount) return createHold(tx, ctx.user.id, entry.session_id, 1, now);
    const after = (await tx.one<{ status: string }>("SELECT status FROM waitlist_entries WHERE id = $1", [ctx.params.id!]))!;
    if (after.status === "lapsed") return "lapsed" as const;
    throw new ApiError(409, "no_offer");
  });
  if (hold === "lapsed") throw new ApiError(409, "offer_lapsed");
  return ok(holdView(hold), 201);
});

/** Cancelling a session releases its holds and closes its waitlist without mail. */
export async function closeSessionSeats(q: Db, sessionId: string): Promise<void> {
  await q.query("UPDATE holds SET status = 'released' WHERE session_id = $1 AND status = 'active'", [sessionId]);
  await q.query("UPDATE waitlist_entries SET status = 'closed' WHERE session_id = $1 AND status IN ('waiting', 'offered')", [sessionId]);
}
