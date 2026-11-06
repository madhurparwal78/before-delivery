// Expert callbacks (brief: Expert callbacks): local business hours in the caller's zone, lead time and horizon.
import { nextCounter, pool, transaction, type Db } from "../db.ts";
import { assertValid, ApiError, type Fields } from "../errors.ts";
import { addSeconds, iso, now, SECONDS } from "../clock.ts";
import { callbackLabel, localToUtc } from "../zones.ts";
import { callbackRequested } from "./notices.ts";
import { messageText, PHONE, safeText, validEmail } from "../patterns.ts";
import { savedPicks } from "./builds.ts";

export const CALLBACK_ZONES = [
  "America/New_York", "America/Chicago", "America/Los_Angeles", "America/Puerto_Rico", "America/Toronto", "Europe/Berlin", "Europe/Paris", "Australia/Sydney",
] as const;
export const CALLBACK_TOPICS = ["Choosing a board", "Demo or lesson", "Order or delivery", "Trade-in", "Protection plan"] as const;
const MAX_UPCOMING = 2;
const FIRST_START = 9 * 60;
const LAST_START = 16 * 60 + 30;

function preferredStartProblem(value: unknown, zone: string | null): { problem: string } | { utc: Date } | null {
  const m = typeof value === "string" ? /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value) : null;
  if (!m) return { problem: "Choose a date and time." };
  const [year, month, day, hour, minute] = m.slice(1).map(Number) as [number, number, number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day || hour > 23 || minute > 59) return { problem: "Choose a date and time." };
  if (minute !== 0 && minute !== 30) return { problem: "Choose a time on the hour or half hour." };
  const weekday = date.getUTCDay();
  const start = hour * 60 + minute;
  if (weekday === 0 || weekday === 6 || start < FIRST_START || start > LAST_START) return { problem: "We call on weekdays between 9:00 and 17:00 your time." };
  if (!zone) return null;
  const utc = localToUtc(year, month, day, hour, minute, zone);
  if (utc < addSeconds(now(), SECONDS.callbackLead)) return { problem: "Choose a time at least 2 hours from now." };
  if (utc > addSeconds(now(), SECONDS.callbackHorizon)) return { problem: "Choose a time within the next 30 days." };
  return { utc };
}

export async function requestCallback(body: Record<string, unknown>): Promise<{ reference: string; preferred_start_utc: string }> {
  const fields: Fields = {};
  const name = safeText(body.name);
  if (name === null || name.length < 2 || name.length > 60) fields.name = "Enter your name.";
  const email = validEmail(body.email);
  if (email === null) fields.email = "Enter a valid email.";
  if (typeof body.phone !== "string" || !PHONE.pattern.test(body.phone)) fields.phone = PHONE.message;
  const zone = (CALLBACK_ZONES as readonly unknown[]).includes(body.timezone) ? (body.timezone as string) : null;
  if (!zone) fields.timezone = "Choose a timezone.";
  const start = preferredStartProblem(body.preferred_start, zone);
  if (start && "problem" in start) fields.preferred_start = start.problem;
  if (!(CALLBACK_TOPICS as readonly unknown[]).includes(body.topic)) fields.topic = "Choose a topic.";
  const message = typeof body.message === "string" ? messageText(body.message) : body.message === undefined || body.message === null ? "" : null;
  if (message === null || message.length > 1000) fields.message = "Keep your message under 1000 characters.";
  const buildCode = body.build_code ?? null;
  if (buildCode !== null && (typeof buildCode !== "string" || !(await savedPicks(pool, buildCode)))) fields.build_code = "We could not find that build.";
  assertValid(fields);
  const utc = (start as { utc: Date }).utc;
  const normalised = (email as string).toLowerCase();
  return transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`callback:${normalised}`]);
    const { rows } = await tx.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM callbacks WHERE email_norm = $1 AND preferred_start > $2",
      [normalised, now()],
    );
    if ((rows[0]?.n ?? 0) >= MAX_UPCOMING) throw new ApiError("too_many_requests");
    const reference = `CB-${await nextCounter(tx, "callback")}`;
    await tx.query(
      `INSERT INTO callbacks (reference, name, email, email_norm, phone, timezone, preferred_start, topic, message, build_code, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [reference, name, email, normalised, body.phone, zone, utc, body.topic, message, buildCode, now()],
    );
    await callbackRequested(tx, email as string, { reference, name: name as string, start: utc, zone: zone as string, buildCode: buildCode as string | null });
    return { reference, preferred_start_utc: iso(utc) };
  });
}

interface CallbackView {
  reference: string;
  label: string;
  topic: string;
}

/** The callbacks requested with a customer's email, soonest first, for `/account`. */
export async function callbacksFor(db: Db, email: string): Promise<CallbackView[]> {
  const { rows } = await db.query<{ reference: string; preferred_start: Date; timezone: string; topic: string }>(
    "SELECT reference, preferred_start, timezone, topic FROM callbacks WHERE email_norm = $1 ORDER BY preferred_start, reference",
    [email],
  );
  return rows.map((r) => ({ reference: r.reference, label: callbackLabel(r.preferred_start, r.timezone), topic: r.topic }));
}
