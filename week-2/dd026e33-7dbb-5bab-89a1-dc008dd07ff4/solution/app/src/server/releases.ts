// Releases (brief: Business rules › Release states, Release hold, Release slots, Release
// completion). Completion takes hold of the car and the release, checks in the published order, and
// records the release, frees the bay and sends the owner's email as one unit.
import type { Release, ReleaseStatus } from "../shared/api.js";
import { carName, type Role } from "../shared/domain.js";
import { OPEN_RELEASE, releaseActionAllowed } from "../shared/transitions.js";
import { formatSlot, HOUSE_TIME_ZONE, localWeekday, slotString, zurichLocalToInstant, zurichParts } from "../shared/zurich.js";
import { requireRole } from "./auth.js";
import { iso, isUniqueViolation, many, newId, one, type Db } from "./db.js";
import { belongingsCheckedIn, conflict, FieldErrors, invoiceUnpaid, mailUnavailable, notFound, ProviderDown } from "./errors.js";
import type { Ctx, Reply } from "./http.js";
import { releaseBookedEmail, releasedEmail, sendNow } from "./mail.js";
import { presentActor, type Viewer } from "./projection.js";
import { checkedInItems } from "./belongings.js";
import { presentCar, visibleCar } from "./cars.js";
import { holdsFor } from "./invoices.js";
import { enqueueEmail, enqueueSubscriptionCancel } from "./queue.js";

const NOTICE_MS = 48 * 3_600_000;
const FIRST_SLOT_MINUTES = 8 * 60;
const LAST_SLOT_MINUTES = 17 * 60 + 30;

interface ReleaseRow {
  [key: string]: unknown;
  id: string;
  car_id: string;
  owner_id: string;
  slot: string;
  status: ReleaseStatus;
  bay_code: string | null;
  car_year: number;
  car_make: string;
  car_model: string;
  car_bay_code: string | null;
  owner_name: string;
  owner_email: string;
}

const RELEASE_SELECT = `
  SELECT r.*, c.year AS car_year, c.make AS car_make, c.model AS car_model, b.code AS car_bay_code,
         o.name AS owner_name, o.email AS owner_email
    FROM releases r JOIN cars c ON c.id = r.car_id JOIN users o ON o.id = r.owner_id LEFT JOIN bays b ON b.id = c.bay_id`;

export async function releaseRows(db: Db, where: string, params: unknown[]): Promise<ReleaseRow[]> {
  return many<ReleaseRow>(db, `${RELEASE_SELECT} ${where} ORDER BY r.created_at, r.id`, params);
}

export async function presentRelease(db: Db, viewer: Viewer, row: ReleaseRow): Promise<Release> {
  const events = await many<{ status: ReleaseStatus; at: Date; by_id: string; by_name: string; by_role: Role }>(
    db,
    `SELECT e.status, e.at, e.by_id, u.name AS by_name, u.role AS by_role
       FROM release_events e JOIN users u ON u.id = e.by_id WHERE e.release_id = $1 ORDER BY e.id`,
    [row.id],
  );
  const open = OPEN_RELEASE.includes(row.status);
  return {
    id: row.id,
    car: { id: row.car_id, name: carName({ year: row.car_year, make: row.car_make, model: row.car_model }) },
    owner: presentActor(viewer, { id: row.owner_id, name: row.owner_name, role: "owner" }),
    slot: row.slot,
    slot_label: formatSlot(row.slot),
    status: row.status,
    bay_code: open ? row.car_bay_code : row.bay_code,
    held_by: open ? await holdsFor(db, row.car_id) : [],
    events: events.map((e) => ({ status: e.status, at: iso(e.at), by: presentActor(viewer, { id: e.by_id, name: e.by_name, role: e.by_role }) })),
  };
}

async function visibleRelease(db: Db, viewer: Viewer, id: string): Promise<ReleaseRow> {
  const row = await one<ReleaseRow>(db, `${RELEASE_SELECT} WHERE r.id = $1`, [id]);
  if (!row || (viewer.role === "owner" && row.owner_id !== viewer.id)) throw notFound();
  return row;
}

async function releaseReply(db: Db, viewer: Viewer, id: string, status = 200, extra: Record<string, unknown> = {}): Promise<Reply> {
  return { status, body: { release: await presentRelease(db, viewer, await visibleRelease(db, viewer, id)), ...extra } };
}

async function addEvent(db: Db, releaseId: string, status: ReleaseStatus, byId: string): Promise<void> {
  await db.query("INSERT INTO release_events (release_id, status, at, by_id) VALUES ($1, $2, clock_timestamp(), $3)", [releaseId, status, byId]);
}

// ---- Slots -------------------------------------------------------------------------------------

const SLOT_FORMAT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** The slot's field error, or null when the server accepts it now. */
function slotError(slot: string, now: Date): string | null {
  const match = SLOT_FORMAT.exec(slot);
  if (!match) return "Use a date and time like 2026-11-03T10:30.";
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [number, number, number, number, number];
  const probe = new Date(Date.UTC(year, month - 1, day, hour, minute));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day || hour > 23 || minute > 59) {
    return "Use a date and time like 2026-11-03T10:30.";
  }
  const minutes = hour * 60 + minute;
  if (minute % 30 !== 0 || minutes < FIRST_SLOT_MINUTES || minutes > LAST_SLOT_MINUTES || localWeekday(year, month, day) === 0) {
    return "Choose a half-hour slot between 08:00 and 17:30, Monday to Saturday.";
  }
  if (zurichLocalToInstant(year, month, day, hour, minute).getTime() - now.getTime() < NOTICE_MS) return "Releases need at least 48 hours' notice.";
  return null;
}

/** The first slot on the grid that meets the notice. */
function earliestSlot(now: Date): string {
  const start = zurichParts(new Date(now.getTime() + NOTICE_MS));
  let cursor = Date.UTC(start.year, start.month - 1, start.day);
  for (let day = 0; day < 14; day++, cursor += 86_400_000) {
    const d = new Date(cursor);
    const [year, month, date] = [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
    for (let minutes = FIRST_SLOT_MINUTES; minutes <= LAST_SLOT_MINUTES; minutes += 30) {
      const slot = slotString(year, month, date, Math.floor(minutes / 60), minutes % 60);
      if (slotError(slot, now) === null) return slot;
    }
  }
  throw new Error("no release slot in the next two weeks");
}

export async function getEarliestSlot(): Promise<Reply> {
  const earliest = earliestSlot(new Date());
  return { status: 200, body: { earliest, earliest_label: formatSlot(earliest), time_zone: HOUSE_TIME_ZONE } };
}

// ---- Endpoints ---------------------------------------------------------------------------------

export async function listReleases(ctx: Ctx): Promise<Reply> {
  const owner = ctx.user.role === "owner";
  const rows = await many<ReleaseRow>(
    ctx.db,
    `${RELEASE_SELECT} ${owner ? "WHERE r.owner_id = $1" : ""}
      ORDER BY (r.status IN ('requested', 'booked', 'staged')) DESC, r.slot, r.created_at`,
    owner ? [ctx.user.id] : [],
  );
  return { status: 200, body: { releases: await Promise.all(rows.map((r) => presentRelease(ctx.db, ctx.user, r))) } };
}

export async function getRelease(ctx: Ctx): Promise<Reply> {
  return releaseReply(ctx.db, ctx.user, ctx.params.id ?? "");
}

export async function requestRelease(ctx: Ctx): Promise<Reply> {
  const body = (ctx.body ?? {}) as Record<string, unknown>;
  const carId = typeof body.car_id === "string" ? body.car_id : null;
  if (carId !== null) await visibleCar(ctx.db, ctx.user, carId);
  requireRole(ctx.user, "owner");
  const slot = typeof body.slot === "string" ? body.slot.trim() : "";
  const errors = new FieldErrors();
  if (carId !== null) {
    const car = await visibleCar(ctx.db, ctx.user, carId, true);
    if (car.status !== "stored") throw conflict("car_not_stored");
    if (await one(ctx.db, "SELECT 1 FROM jobs WHERE car_id = $1 AND status = 'in_progress'", [carId])) throw conflict("car_in_workshop");
    if (car.open_release) throw conflict("release_already_open");
    if (await one(ctx.db, "SELECT 1 FROM releases WHERE slot = $1 AND status IN ('requested', 'booked', 'staged')", [slot])) {
      throw conflict("slot_taken");
    }
  } else {
    errors.add("car_id", "Choose a car.");
  }
  const slotProblem = slotError(slot, new Date());
  if (slotProblem) errors.add("slot", slotProblem);
  if (!ctx.idempotencyKey) errors.add("idempotency_key", "Send an Idempotency-Key header.");
  errors.throwIfAny();

  const id = newId("rel");
  try {
    await ctx.db.query("INSERT INTO releases (id, car_id, owner_id, slot, status) VALUES ($1, $2, $3, $4, 'requested')", [
      id,
      carId,
      ctx.user.id,
      slot,
    ]);
  } catch (error) {
    // A simultaneous request for the same slot committed first.
    if (isUniqueViolation(error, "releases_one_open_per_slot")) throw conflict("slot_taken");
    throw error;
  }
  await addEvent(ctx.db, id, "requested", ctx.user.id);
  return releaseReply(ctx.db, ctx.user, id, 201);
}

async function lockRelease(db: Db, id: string): Promise<ReleaseRow> {
  await db.query("SELECT 1 FROM releases WHERE id = $1 FOR UPDATE", [id]);
  const row = await one<ReleaseRow>(db, `${RELEASE_SELECT} WHERE r.id = $1`, [id]);
  if (!row) throw notFound();
  return row;
}

async function step(ctx: Ctx, action: "book" | "stage", to: ReleaseStatus): Promise<ReleaseRow> {
  const id = ctx.params.id ?? "";
  await visibleRelease(ctx.db, ctx.user, id);
  requireRole(ctx.user, "concierge", "house_manager");
  const row = await lockRelease(ctx.db, id);
  if (!releaseActionAllowed(action, row.status)) throw conflict("invalid_transition");
  await ctx.db.query("UPDATE releases SET status = $2 WHERE id = $1", [id, to]);
  await addEvent(ctx.db, id, to, ctx.user.id);
  return row;
}

export async function bookRelease(ctx: Ctx): Promise<Reply> {
  const row = await step(ctx, "book", "booked");
  await enqueueEmail(
    ctx.db,
    releaseBookedEmail({
      owner: { name: row.owner_name, email: row.owner_email },
      carName: carName({ year: row.car_year, make: row.car_make, model: row.car_model }),
      releaseId: row.id,
      slot: row.slot,
      bayCode: row.car_bay_code ?? "",
    }),
  );
  return releaseReply(ctx.db, ctx.user, row.id);
}

export async function stageRelease(ctx: Ctx): Promise<Reply> {
  const row = await step(ctx, "stage", "staged");
  return releaseReply(ctx.db, ctx.user, row.id);
}

export async function cancelRelease(ctx: Ctx): Promise<Reply> {
  const id = ctx.params.id ?? "";
  await visibleRelease(ctx.db, ctx.user, id);
  requireRole(ctx.user, "owner", "concierge", "house_manager");
  const row = await lockRelease(ctx.db, id);
  if (!releaseActionAllowed("cancel", row.status, ctx.user.role === "owner")) throw conflict("invalid_transition");
  await ctx.db.query("UPDATE releases SET status = 'cancelled', bay_code = $2 WHERE id = $1", [id, row.car_bay_code]);
  await addEvent(ctx.db, id, "cancelled", ctx.user.id);
  return releaseReply(ctx.db, ctx.user, id);
}

export async function completeRelease(ctx: Ctx): Promise<Reply> {
  const id = ctx.params.id ?? "";
  const found = await visibleRelease(ctx.db, ctx.user, id);
  requireRole(ctx.user, "concierge", "house_manager");
  // One change at a time per car: the car first, then the release.
  const car = await visibleCar(ctx.db, ctx.user, found.car_id, true);
  const row = await lockRelease(ctx.db, id);
  if (!releaseActionAllowed("complete", row.status)) throw conflict("invalid_transition");
  const holds = await holdsFor(ctx.db, car.id);
  if (holds.length > 0) throw invoiceUnpaid(holds);
  const items = await checkedInItems(ctx.db, car.id);
  if (items.length > 0) throw belongingsCheckedIn(items);

  await ctx.db.query("UPDATE releases SET status = 'released', bay_code = $2 WHERE id = $1", [id, car.bay_code]);
  const event = await one<{ at: Date }>(
    ctx.db,
    "INSERT INTO release_events (release_id, status, at, by_id) VALUES ($1, 'released', clock_timestamp(), $2) RETURNING at",
    [id, ctx.user.id],
  );
  await ctx.db.query(
    "UPDATE cars SET status = 'released', bay_id = NULL, released_at = $2, cancel_requested = true WHERE id = $1",
    [car.id, event?.at],
  );
  await enqueueSubscriptionCancel(ctx.db, car.id);
  try {
    await sendNow(
      releasedEmail({
        owner: { name: row.owner_name, email: row.owner_email },
        carName: carName(car),
        releasedAt: iso(event?.at),
        bayCode: car.bay_code ?? "",
      }),
    );
  } catch (error) {
    if (error instanceof ProviderDown) throw mailUnavailable();
    throw error;
  }
  const updated = await visibleCar(ctx.db, ctx.user, car.id);
  return releaseReply(ctx.db, ctx.user, id, 200, { car: presentCar(ctx.user, updated) });
}
