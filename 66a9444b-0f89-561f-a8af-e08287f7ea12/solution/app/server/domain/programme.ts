// The programme: edition and festival days, venues, disciplines and sessions in festival time.
import { TIME_ZONE, datesBetween, dayLabel, festivalDayBounds, festivalDayOf, localIso, parseWall } from "../../shared/brussels.ts";
import type { User } from "../auth.ts";
import { db, transaction, type Db } from "../db/index.ts";
import { ApiError, FieldErrors, notFound, ok, route } from "../http.ts";
import { audit } from "./audit.ts";
import { newId } from "./ids.ts";
import { isoOrNull, isoUtc } from "./time.ts";
import { asObject, intOrNull, text } from "./validate.ts";

type Edition = { name: string; first_day: string; last_day: string };

export type SessionRow = {
  id: string; title: string; description: string; discipline: string; venue_id: string; admission: "pass" | "seat";
  capacity: number | null; seats_remaining: number | null; price_full_cents: number | null; price_reduced_cents: number | null;
  starts_at: Date; ends_at: Date; status: string; publish_at: Date | null; version: number;
};

/** Every session read goes through this select: effective status and live seats remaining at `$1`. */
export const SESSION_SELECT = `SELECT s.id, s.title, s.description, s.discipline, s.venue_id, s.admission, s.capacity,
  seats_remaining(s.id, $1) AS seats_remaining, s.price_full_cents, s.price_reduced_cents, s.starts_at, s.ends_at,
  effective_status(s.status, s.publish_at, $1) AS status, s.publish_at, s.version FROM sessions s`;

export async function edition(q: Db = db): Promise<Edition> {
  const row = await q.one<{ name: string; first_day: string; last_day: string }>("SELECT name, first_day::text, last_day::text FROM edition WHERE id = 1");
  return row!;
}

export function festivalDays(e: Edition) {
  return datesBetween(e.first_day, e.last_day).map((date) => {
    const bounds = festivalDayBounds(date);
    return { date, label: dayLabel(date), starts_at: isoUtc(bounds.startsAt), ends_at: isoUtc(bounds.endsAt) };
  });
}

export function sessionView(row: SessionRow, full: boolean) {
  const view = {
    id: row.id, title: row.title, description: row.description, discipline: row.discipline, venue_id: row.venue_id,
    admission: row.admission, capacity: row.capacity, seats_remaining: row.seats_remaining,
    price_full_cents: row.price_full_cents, price_reduced_cents: row.price_reduced_cents,
    starts_at: isoUtc(row.starts_at), ends_at: isoUtc(row.ends_at),
    starts_local: localIso(row.starts_at.getTime()), ends_local: localIso(row.ends_at.getTime()),
    festival_day: festivalDayOf(row.starts_at.getTime()), status: row.status,
  };
  return full ? { ...view, publish_at: isoOrNull(row.publish_at), version: row.version } : view;
}

const PUBLIC = ["published", "cancelled"];

route("GET", "/api/programme", "public", async (ctx) => {
  const now = new Date();
  const e = await edition();
  const days = festivalDays(e);
  const venues = await db.all<{ id: string; name: string }>("SELECT id, name FROM venues ORDER BY position, id");
  const disciplines = await db.all<{ id: string; name: string }>("SELECT id, name FROM disciplines ORDER BY position");
  const filters = { day: ctx.query.get("day"), venue: ctx.query.get("venue"), discipline: ctx.query.get("discipline") };
  const errors: Record<string, string> = {};
  if (filters.day && !days.some((d) => d.date === filters.day)) errors.day = "unknown";
  if (filters.venue && !venues.some((v) => v.id === filters.venue)) errors.venue = "unknown";
  if (filters.discipline && !disciplines.some((d) => d.id === filters.discipline)) errors.discipline = "unknown";
  if (Object.keys(errors).length) throw new FieldErrors(errors);
  const rows = await db.all<SessionRow>(`${SESSION_SELECT} WHERE effective_status(s.status, s.publish_at, $1) = ANY($2)
    AND ($3::text IS NULL OR s.venue_id = $3) AND ($4::text IS NULL OR s.discipline = $4) ORDER BY s.starts_at, s.id`,
    [now, PUBLIC, filters.venue, filters.discipline]);
  const policy = await db.one<{ full_festival_full_cents: number; full_festival_reduced_cents: number; day_full_cents: number; day_reduced_cents: number; group_discount_percent: number }>(
    "SELECT full_festival_full_cents, full_festival_reduced_cents, day_full_cents, day_reduced_cents, group_discount_percent FROM price_policy WHERE id = 1");
  return ok({
    edition: { ...e, time_zone: TIME_ZONE },
    festival_days: days,
    venues,
    disciplines,
    sessions: rows.map((r) => sessionView(r, false)).filter((s) => !filters.day || s.festival_day === filters.day),
    price_policy: policy,
  });
});

const isCurator = (user: User | null) => user?.role === "curator";

route("GET", "/api/sessions/:id", "public", async (ctx) => {
  const row = await db.one<SessionRow>(`${SESSION_SELECT} WHERE s.id = $2`, [new Date(), ctx.params.id!]);
  if (!row || (!isCurator(ctx.user) && !PUBLIC.includes(row.status))) throw notFound();
  return ok(sessionView(row, isCurator(ctx.user)));
});

route("GET", "/api/curate/sessions", ["curator"], async (ctx) => {
  const status = ctx.query.get("status");
  const rows = await db.all<SessionRow>(`${SESSION_SELECT} WHERE ($2::text IS NULL OR effective_status(s.status, s.publish_at, $1) = $2)
    ORDER BY s.starts_at, s.id`, [new Date(), status]);
  return ok({ sessions: rows.map((r) => sessionView(r, true)) });
});

type SessionFields = {
  title: string; description: string; discipline: string; venue_id: string; starts_at: Date; ends_at: Date;
  admission: "pass" | "seat"; capacity: number | null; price_full_cents: number | null; price_reduced_cents: number | null;
};

/** Validates a full set of session fields (create, or an edit merged over the stored session). */
async function checkSessionFields(q: Db, input: Record<string, unknown>): Promise<SessionFields> {
  const errors: Record<string, string> = {};
  const venue = typeof input.venue_id === "string" ? await q.one("SELECT id FROM venues WHERE id = $1", [input.venue_id]) : null;
  if (!venue) throw notFound();
  const title = text(input.title, 1, 200);
  if (title === null) errors.title = "required";
  const description = typeof input.description === "string" ? input.description.trim().slice(0, 4000) : "";
  const discipline = typeof input.discipline === "string" ? await q.one("SELECT id FROM disciplines WHERE id = $1", [input.discipline]) : null;
  if (!discipline) errors.discipline = "unknown";
  const admission = input.admission === "seat" || input.admission === "pass" ? input.admission : null;
  if (!admission) errors.admission = "unknown";
  const starts = parseWall(input.starts_local);
  const ends = parseWall(input.ends_local);
  const e = await edition(q);
  if (!starts.ok) errors.starts_local = starts.error;
  else if (!withinEdition(e, new Date(starts.instant))) errors.starts_local = "outside_edition";
  if (starts.ok && !ends.ok) errors.ends_local = ends.error;
  else if (starts.ok && ends.ok && ends.instant <= starts.instant) errors.ends_local = "ends_before_start";
  let capacity: number | null = null;
  let full: number | null = null;
  let reduced: number | null = null;
  if (admission === "seat") {
    capacity = intOrNull(input.capacity);
    if (input.capacity === null || input.capacity === undefined) errors.capacity = "required";
    else if (capacity === null || capacity < 1 || capacity > 500) errors.capacity = "out_of_range";
    full = intOrNull(input.price_full_cents);
    reduced = intOrNull(input.price_reduced_cents);
    if (full === null || full < 0 || full > 100000) errors.price_full_cents = "required";
    if (reduced === null || reduced < 0 || reduced > 100000) errors.price_reduced_cents = "required";
  }
  if (Object.keys(errors).length) throw new FieldErrors(errors);
  return {
    title: title!, description, discipline: input.discipline as string, venue_id: input.venue_id as string,
    starts_at: new Date((starts as { instant: number }).instant), ends_at: new Date((ends as { instant: number }).instant),
    admission: admission!, capacity, price_full_cents: full, price_reduced_cents: reduced,
  };
}

route("POST", "/api/sessions", ["curator"], async (ctx) => {
  const input = asObject(ctx.body);
  const id = `s-${newId()}`;
  const session = await transaction(async (tx) => {
    const f = await checkSessionFields(tx, input);
    await tx.query(`INSERT INTO sessions (id, title, description, discipline, venue_id, admission, capacity, price_full_cents,
      price_reduced_cents, starts_at, ends_at, status, version) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'draft',1)`,
      [id, f.title, f.description, f.discipline, f.venue_id, f.admission, f.capacity, f.price_full_cents, f.price_reduced_cents, f.starts_at, f.ends_at]);
    await audit(tx, ctx.user, "session.created", { type: "session", id }, { title: f.title });
    return (await tx.one<SessionRow>(`${SESSION_SELECT} WHERE s.id = $2`, [new Date(), id]))!;
  });
  return ok(sessionView(session, true), 201);
});

const EDITABLE = ["draft", "review", "scheduled"];

route("PATCH", "/api/sessions/:id", ["curator"], async (ctx) => {
  const updated = await transaction(async (tx) => {
    const now = new Date();
    const current = await tx.one<SessionRow>(`${SESSION_SELECT} WHERE s.id = $2 FOR UPDATE`, [now, ctx.params.id!]);
    if (!current) throw notFound();
    const ifMatch = ctx.headers["if-match"];
    if (typeof ifMatch !== "string" || ifMatch.trim() === "") throw new ApiError(428, "version_required");
    if (Number(ifMatch.replace(/"/g, "")) !== current.version) throw new ApiError(412, "stale_version", { current_version: current.version });
    if (!EDITABLE.includes(current.status)) throw new ApiError(409, "not_editable");
    const input = asObject(ctx.body);
    const merged = {
      title: current.title, description: current.description, discipline: current.discipline, venue_id: current.venue_id,
      starts_local: localIso(current.starts_at.getTime()), ends_local: localIso(current.ends_at.getTime()),
      admission: current.admission, capacity: current.capacity,
      price_full_cents: current.price_full_cents, price_reduced_cents: current.price_reduced_cents, ...input,
    };
    const f = await checkSessionFields(tx, merged);
    await tx.query(`UPDATE sessions SET title=$2, description=$3, discipline=$4, venue_id=$5, admission=$6, capacity=$7,
      price_full_cents=$8, price_reduced_cents=$9, starts_at=$10, ends_at=$11, version = version + 1 WHERE id = $1`,
      [current.id, f.title, f.description, f.discipline, f.venue_id, f.admission, f.capacity, f.price_full_cents, f.price_reduced_cents, f.starts_at, f.ends_at]);
    await audit(tx, ctx.user, "session.edited", { type: "session", id: current.id }, { fields: Object.keys(input) });
    return (await tx.one<SessionRow>(`${SESSION_SELECT} WHERE s.id = $2`, [now, current.id]))!;
  });
  return ok(sessionView(updated, true));
});

/** Edition dates can't exclude existing sessions. */
export function withinEdition(e: Edition, startsAt: Date): boolean {
  const day = festivalDayOf(startsAt.getTime());
  return day >= e.first_day && day <= e.last_day;
}
