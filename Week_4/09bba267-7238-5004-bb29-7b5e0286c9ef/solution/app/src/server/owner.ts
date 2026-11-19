// The venue owner: passcode sign-in, publishing performances and the reconciliation reads.
import { randomBytes, timingSafeEqual } from "node:crypto";
import { hallSeat, SECTIONS } from "../shared/hall.js";
import type { OutboxMessage, Performance } from "../shared/types.js";
import { isoInstant } from "./clock.js";
import { notify, pool, transaction } from "./db.js";
import { fail, validation } from "./http.js";
import { insertPerformance, passcodeDigest, tierSeatIds, type NewTier } from "./schema.js";
import { resolveVenueStart } from "./venueTime.js";
import { performances } from "./views.js";

export async function signIn(body: unknown): Promise<string> {
  const passcode = (body as { passcode?: unknown }).passcode;
  const stored = await pool.query<{ sha256: string }>("SELECT sha256 FROM owner_passcode");
  const given = Buffer.from(passcodeDigest(typeof passcode === "string" ? passcode : ""), "hex");
  if (!timingSafeEqual(given, Buffer.from(stored.rows[0].sha256, "hex"))) throw fail(401, "unauthorized");
  const token = randomBytes(32).toString("hex");
  await pool.query("INSERT INTO owner_sessions (token) VALUES ($1)", [token]);
  return token;
}

export async function signOut(token: string | null): Promise<void> {
  if (token) await pool.query("DELETE FROM owner_sessions WHERE token = $1", [token]);
}

export async function requireOwner(token: string | null): Promise<void> {
  const known = token ? await pool.query("SELECT 1 FROM owner_sessions WHERE token = $1", [token]) : null;
  if (!known?.rowCount) throw fail(401, "unauthorized");
}

const TITLE_MESSAGE = "Enter a title of 1 to 120 characters.";
const START_FORMAT_MESSAGE = "Enter the start as YYYY-MM-DDTHH:MM.";
const NO_SUCH_TIME_MESSAGE = "That time does not occur in Chicago on that date.";
const FUTURE_MESSAGE = "The start must be in the future.";
const TIER_COUNT_MESSAGE = "Add between 1 and 6 tiers.";
const TIER_MESSAGE = "Each tier needs a name, a face value from $1.00 to $1,000.00 and at least one seat that no other tier uses.";

const ROW_IDS = new Set(SECTIONS.flatMap((s) => s.rows.map((r) => `${s.code}-${r}`)));

/** A tier id: the name in lower case, each run of other characters one hyphen, no hyphen at either end. */
const tierIdOf = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

const stringList = (value: unknown): value is string[] => Array.isArray(value) && value.every((v) => typeof v === "string");

function parseTiers(raw: unknown): NewTier[] | string {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 6) return TIER_COUNT_MESSAGE;
  const tiers: NewTier[] = [];
  const used = new Set<string>();
  for (const entry of raw as { name?: unknown; faceCents?: unknown; rows?: unknown; seats?: unknown }[]) {
    const name = typeof entry?.name === "string" ? entry.name.trim() : "";
    const id = tierIdOf(name);
    const face = entry?.faceCents;
    const rows = entry?.rows ?? [];
    const seats = entry?.seats ?? [];
    if (name.length < 1 || name.length > 40 || !id || tiers.some((t) => t.id === id)) return TIER_MESSAGE;
    if (typeof face !== "number" || !Number.isInteger(face) || face < 100 || face > 100000) return TIER_MESSAGE;
    if (!stringList(rows) || !stringList(seats) || !rows.every((r) => ROW_IDS.has(r)) || !seats.every((s) => hallSeat(s))) return TIER_MESSAGE;
    const seatIds = tierSeatIds(rows, seats);
    if (seatIds.size === 0 || [...seatIds].some((s) => used.has(s))) return TIER_MESSAGE;
    seatIds.forEach((s) => used.add(s));
    tiers.push({ id, name, faceCents: face, seatIds });
  }
  return tiers;
}

const slug = (title: string): string => tierIdOf(title).slice(0, 48).replace(/-+$/, "");

export async function publish(body: unknown, now: Date): Promise<Performance> {
  const { title, startsLocal, tiers: rawTiers } = body as { title?: unknown; startsLocal?: unknown; tiers?: unknown };
  const errors: Record<string, string> = {};
  const cleanTitle = typeof title === "string" ? title.trim() : "";
  if (cleanTitle.length < 1 || cleanTitle.length > 120) errors.title = TITLE_MESSAGE;
  const start = resolveVenueStart(typeof startsLocal === "string" ? startsLocal : "");
  if (start === "malformed") errors.startsLocal = START_FORMAT_MESSAGE;
  else if (start === "nonexistent") errors.startsLocal = NO_SUCH_TIME_MESSAGE;
  else if (start.getTime() <= now.getTime()) errors.startsLocal = FUTURE_MESSAGE;
  const tiers = parseTiers(rawTiers);
  if (typeof tiers === "string") errors.tiers = tiers;
  if (Object.keys(errors).length || typeof tiers === "string" || !(start instanceof Date)) throw validation(errors);

  const id = `${slug(cleanTitle) || "performance"}-${randomBytes(3).toString("hex")}`;
  await transaction(async (tx) => {
    await insertPerformance(tx, id, cleanTitle, start, tiers);
    await notify(tx, { k: "performances" });
  });
  const [show] = await performances(pool, now, id);
  return show;
}

export async function outbox(): Promise<OutboxMessage[]> {
  const rows = await pool.query<{ id: string; recipient: string; subject: string; kind: OutboxMessage["kind"]; status: OutboxMessage["status"];
    attempts: number; created_at: Date; sent_at: Date | null }>(
    "SELECT id::text, recipient, subject, kind, status, attempts, created_at, sent_at FROM outbox ORDER BY created_at DESC, id DESC");
  return rows.rows.map((m) => ({
    id: m.id, to: m.recipient, subject: m.subject, kind: m.kind, status: m.status, attempts: m.attempts,
    createdAt: isoInstant(m.created_at), sentAt: m.sent_at ? isoInstant(m.sent_at) : null,
  }));
}
