// Order tracking, support cases and the per-email lookup limit (brief: Tracking, cases and the lookup limit).
import { nextCounter, pool, transaction } from "../db.ts";
import { ApiError, assertValid, type Fields } from "../errors.ts";
import { addSeconds, iso, now, SECONDS } from "../clock.ts";
import { messageText, normaliseEmail, safeText, validEmail } from "../patterns.ts";
import { caseOpened } from "./notices.ts";
import { orderForTracking, trackingView } from "./orders.ts";

const MISSES_ALLOWED = 5;
const ORDER_NOT_FOUND = "We could not find an order with those details.";
const CASE_NOT_FOUND = "We could not find a case with those details.";

/** 429 while five misses for this email still count; Retry-After until the oldest counted miss stops counting. */
async function checkLimit(email: string): Promise<void> {
  const { rows } = await pool.query<{ at: Date }>(
    "SELECT at FROM lookup_misses WHERE email_norm = $1 AND at > $2 ORDER BY at",
    [email, addSeconds(now(), -SECONDS.lookupWindow)],
  );
  if (rows.length < MISSES_ALLOWED) return;
  const oldest = rows[0]!.at;
  const wait = Math.ceil((addSeconds(oldest, SECONDS.lookupWindow).getTime() - now().getTime()) / 1000);
  throw new ApiError("too_many_attempts", { headers: { "Retry-After": String(wait) } });
}

async function lookup<T>(body: Record<string, unknown>, notFound: string, find: (email: string) => Promise<T | null>): Promise<T> {
  const missing = new ApiError("not_found", { message: notFound });
  if (typeof body.email !== "string") throw missing;
  const email = body.email.trim().toLowerCase();
  await checkLimit(email);
  const found = await find(email);
  if (found !== null) return found;
  await pool.query("INSERT INTO lookup_misses (email_norm, at) VALUES ($1, $2)", [email, now()]);
  throw missing;
}

export function trackOrder(body: Record<string, unknown>): Promise<object> {
  return lookup(body, ORDER_NOT_FOUND, async (email) => {
    const number = typeof body.order_number === "string" ? body.order_number.trim().toUpperCase() : "";
    const found = number ? await orderForTracking(pool, number) : null;
    return found && found.email === email ? trackingView(pool, found.row) : null;
  });
}

export function lookupCase(body: Record<string, unknown>): Promise<object> {
  return lookup(body, CASE_NOT_FOUND, async (email) => {
    const reference = typeof body.reference === "string" ? body.reference.trim().toUpperCase() : "";
    const { rows } = await pool.query<{ reference: string; status: string; subject: string; opened_at: Date; email_norm: string }>(
      "SELECT reference, status, subject, opened_at, email_norm FROM cases WHERE reference = $1",
      [reference],
    );
    const found = rows[0];
    return found && found.email_norm === email
      ? { reference: found.reference, status: found.status, subject: found.subject, opened_at: iso(found.opened_at) }
      : null;
  });
}

export async function openCase(body: Record<string, unknown>): Promise<{ reference: string }> {
  const fields: Fields = {};
  const email = normaliseEmail(body.email);
  if (!email) fields.email = "Enter a valid email.";
  const order = body.order_number ?? "";
  if (typeof order !== "string" || order.trim().length > 20) fields.order_number = "Enter an order number like TF-100001.";
  const subject = safeText(body.subject) ?? "";
  if (subject.length < 5 || subject.length > 120) fields.subject = "Enter a subject of 5 to 120 characters.";
  const message = typeof body.message === "string" ? messageText(body.message).trim() : "";
  if (message.length < 20 || message.length > 2000) fields.message = "Enter a message of 20 to 2000 characters.";
  assertValid(fields);
  return transaction(async (tx) => {
    const reference = `SC-${await nextCounter(tx, "case")}`;
    await tx.query(
      `INSERT INTO cases (reference, email, email_norm, order_number, subject, message, status, opened_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'open', $7)`,
      [reference, validEmail(body.email), email, (order as string).trim() || null, subject, message, now()],
    );
    await caseOpened(tx, validEmail(body.email) as string, reference, subject);
    return { reference };
  });
}
