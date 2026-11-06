// Cars: visibility, the start-up rule, bay billing, and the register / list / detail endpoints.
import type { BayBilling, Car, CarDetail, Entry, Startup } from "../shared/api.js";
import { carName, type BayClass, type FlagCode, type Role } from "../shared/domain.js";
import { formatScaled } from "../shared/decimal.js";
import { centibarText, distanceToKilometres, pressureToCentibar, type DistanceUnit, type PressureUnit } from "../shared/units.js";
import { zurichDay, zurichParts } from "../shared/zurich.js";
import { requireRole } from "./auth.js";
import { config } from "./config.js";
import { isoOrNull, many, newId, one, type Db } from "./db.js";
import { FieldErrors, notFound } from "./errors.js";
import type { Ctx, Reply } from "./http.js";
import { chf } from "./money.js";
import { presentActor, type Viewer } from "./projection.js";
import { presentRelease, releaseRows } from "./releases.js";
import { belongingsOf } from "./belongings.js";
import { photosOf, reportOf } from "./uploads.js";
import { effectiveJobStatus } from "./jobs.js";

export interface CarRow {
  [key: string]: unknown;
  id: string;
  owner_id: string;
  owner_name: string;
  year: number;
  make: string;
  model: string;
  registration: string;
  colour: string;
  length_mm: number;
  width_mm: number;
  odometer_km: number;
  tyre_spec_centibar: number;
  startup_schedule: boolean;
  status: "awaiting_intake" | "stored" | "released";
  bay_id: string | null;
  bay_code: string | null;
  bay_class: BayClass | null;
  intake_at: Date | null;
  last_startup_at: Date | null;
  billing_status: BayBilling["status"];
  billing_plan: string | null;
  billing_monthly_centimes: string | null;
  kb_subscription_id: string | null;
  charged_through_date: string | null;
  billing_end_date: string | null;
  cancel_requested: boolean;
  open_release: boolean;
}

export const CAR_SELECT = `
  SELECT c.*, o.name AS owner_name, b.code AS bay_code, b.class AS bay_class,
         (SELECT max(e.at) FROM care_entries e WHERE e.car_id = c.id AND e.started) AS last_startup_at,
         EXISTS (SELECT 1 FROM releases r WHERE r.car_id = c.id AND r.status IN ('requested', 'booked', 'staged')) AS open_release
    FROM cars c
    JOIN users o ON o.id = c.owner_id
    LEFT JOIN bays b ON b.id = c.bay_id`;

/** Order of My cars and the Cars table: by bay code, then cars without a bay by name. */
const CAR_ORDER = "ORDER BY b.code NULLS LAST, (c.year::text || ' ' || c.make || ' ' || c.model), c.id";

/** The car if the viewer may see it, otherwise 404. Owners see only their own cars. */
export async function visibleCar(db: Db, user: Viewer, id: string, lock = false): Promise<CarRow> {
  if (lock) await db.query("SELECT 1 FROM cars WHERE id = $1 FOR UPDATE", [id]);
  const row = await one<CarRow>(db, `${CAR_SELECT} WHERE c.id = $1`, [id]);
  if (!row || (user.role === "owner" && row.owner_id !== user.id)) throw notFound();
  return row;
}

/** The start-up rule (brief: Business rules › Start-up status), decided here only. */
export function startupStatus(car: Pick<CarRow, "startup_schedule" | "last_startup_at" | "intake_at">, now = new Date()): Startup {
  const lastAt = isoOrNull(car.last_startup_at);
  if (!car.startup_schedule) return { scheduled: false, last_at: lastAt, next_due: null, status: "not_scheduled" };
  const anchor = car.last_startup_at ?? car.intake_at;
  if (!anchor) return { scheduled: true, last_at: null, next_due: null, status: "ok" };
  const due = new Date(anchor.getTime() + config.timers.startupOverdueSeconds * 1000);
  return { scheduled: true, last_at: lastAt, next_due: zurichDay(due), status: now >= due ? "overdue" : "ok" };
}

function presentBayBilling(row: CarRow): BayBilling {
  return {
    status: row.billing_status,
    plan: row.billing_plan,
    monthly_price: row.billing_monthly_centimes === null ? null : chf(BigInt(row.billing_monthly_centimes)),
    charged_through_date: row.charged_through_date,
    billing_end_date: row.billing_end_date,
    cancel_requested: row.cancel_requested,
  };
}

export function presentCar(viewer: Viewer, row: CarRow): Car {
  return {
    id: row.id,
    name: carName(row),
    year: row.year,
    make: row.make,
    model: row.model,
    registration: row.registration,
    colour: row.colour,
    owner: presentActor(viewer, { id: row.owner_id, name: row.owner_name, role: "owner" }),
    length_mm: row.length_mm,
    width_mm: row.width_mm,
    odometer_km: row.odometer_km,
    tyre_spec_bar: centibarText(row.tyre_spec_centibar),
    status: row.status,
    bay: row.bay_id && row.bay_code && row.bay_class ? { id: row.bay_id, code: row.bay_code, class: row.bay_class } : null,
    startup: startupStatus(row),
    bay_billing: presentBayBilling(row),
    open_release: row.open_release,
  };
}

export interface EntryRow {
  [key: string]: unknown;
  id: string;
  car_id: string;
  at: Date;
  by_id: string;
  by_name: string;
  by_role: Role;
  started: boolean;
  battery_centivolts: number | null;
  tyre_fl: number | null;
  tyre_fr: number | null;
  tyre_rl: number | null;
  tyre_rr: number | null;
  note: string;
  flags: FlagCode[];
}

export const ENTRY_SELECT = `
  SELECT e.*, u.name AS by_name, u.role AS by_role FROM care_entries e JOIN users u ON u.id = e.by_id`;

export function presentEntry(viewer: Viewer, row: EntryRow): Entry {
  const tyres =
    row.tyre_fl !== null && row.tyre_fr !== null && row.tyre_rl !== null && row.tyre_rr !== null
      ? { fl: centibarText(row.tyre_fl), fr: centibarText(row.tyre_fr), rl: centibarText(row.tyre_rl), rr: centibarText(row.tyre_rr) }
      : null;
  return {
    id: row.id,
    at: row.at.toISOString(),
    by: presentActor(viewer, { id: row.by_id, name: row.by_name, role: row.by_role }),
    started: row.started,
    battery_v: row.battery_centivolts === null ? null : formatScaled(BigInt(row.battery_centivolts), 2),
    tyres_bar: tyres,
    note: row.note,
    flags: row.flags,
  };
}

async function carDetail(db: Db, viewer: Viewer, row: CarRow): Promise<CarDetail> {
  const ownerView = viewer.role === "owner";
  const [belongings, report, photos, entries, jobs, releases] = await Promise.all([
    belongingsOf(db, row.id),
    reportOf(db, viewer, row.id),
    photosOf(db, row.id),
    many<EntryRow>(db, `${ENTRY_SELECT} WHERE e.car_id = $1 ORDER BY e.at DESC, e.id DESC LIMIT 20`, [row.id]),
    many<{ id: string; number: string; title: string; status: string; expires_at: Date | null }>(
      db,
      `SELECT id, number, title, status, expires_at FROM jobs WHERE car_id = $1 ${ownerView ? "AND status <> 'draft'" : ""} ORDER BY number`,
      [row.id],
    ),
    releaseRows(db, "WHERE r.car_id = $1", [row.id]),
  ]);
  return {
    ...presentCar(viewer, row),
    belongings,
    condition_report: report,
    photos,
    care_entries: entries.map((e) => presentEntry(viewer, e)),
    jobs: jobs.map((j) => ({ id: j.id, number: j.number, title: j.title, status: effectiveJobStatus(j) })),
    releases: await Promise.all(releases.map((r) => presentRelease(db, viewer, r))),
  };
}

// ---- Endpoints ---------------------------------------------------------------------------------

export async function listCars(ctx: Ctx): Promise<Reply> {
  const q = (ctx.query.get("q") ?? "").trim().toLowerCase();
  const params: unknown[] = [];
  const where: string[] = [];
  if (ctx.user.role === "owner") {
    params.push(ctx.user.id);
    where.push(`c.owner_id = $${params.length}`);
  }
  if (q !== "") {
    params.push(`%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    const n = params.length;
    where.push(
      `(lower(c.year::text || ' ' || c.make || ' ' || c.model) LIKE $${n} OR lower(c.registration) LIKE $${n} OR lower(o.name) LIKE $${n})`,
    );
  }
  const rows = await many<CarRow>(ctx.db, `${CAR_SELECT} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ${CAR_ORDER}`, params);
  return { status: 200, body: { cars: rows.map((r) => presentCar(ctx.user, r)), total: rows.length } };
}

export async function getCar(ctx: Ctx): Promise<Reply> {
  const row = await visibleCar(ctx.db, ctx.user, ctx.params.id ?? "");
  return { status: 200, body: { car: await carDetail(ctx.db, ctx.user, row) } };
}

export async function listOwners(ctx: Ctx): Promise<Reply> {
  requireRole(ctx.user, "concierge", "care_technician", "workshop_lead", "house_manager");
  const owners = await many<{ id: string; name: string; email: string }>(
    ctx.db,
    "SELECT id, name, email FROM users WHERE role = 'owner' ORDER BY position, name",
  );
  return { status: 200, body: { owners } };
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function wholeNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value.trim());
  return null;
}

function decimalText(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && /^\d+(\.\d+)?$/.test(value.trim())) return value.trim();
  return null;
}

export async function registerCar(ctx: Ctx): Promise<Reply> {
  const body = (ctx.body ?? {}) as Record<string, unknown>;
  const ownerId = text(body.owner_id);
  if (ownerId !== null) {
    const owner = await one(ctx.db, "SELECT 1 FROM users WHERE id = $1 AND role = 'owner'", [ownerId]);
    if (!owner) throw notFound();
  }
  requireRole(ctx.user, "concierge", "house_manager");

  const errors = new FieldErrors();
  if (ownerId === null) errors.add("owner_id", "Choose an owner.");
  const year = wholeNumber(body.year);
  const thisYear = zurichParts(new Date()).year;
  if (year === null || year < 1886 || year > thisYear) errors.add("year", `Enter a year from 1886 to ${thisYear}.`);
  const make = text(body.make)?.trim() ?? "";
  const model = text(body.model)?.trim() ?? "";
  const registration = text(body.registration)?.trim() ?? "";
  const colour = text(body.colour)?.trim() ?? "";
  if (make.length < 1 || make.length > 60) errors.add("make", "Enter 1 to 60 characters.");
  if (model.length < 1 || model.length > 60) errors.add("model", "Enter 1 to 60 characters.");
  if (registration.length < 1 || registration.length > 20) errors.add("registration", "Enter 1 to 20 characters.");
  if (colour.length < 1 || colour.length > 60) errors.add("colour", "Enter 1 to 60 characters.");
  const length = wholeNumber(body.length_mm);
  if (length === null || length < 2000 || length > 7000) errors.add("length_mm", "Enter a length from 2000 to 7000 mm.");
  const width = wholeNumber(body.width_mm);
  if (width === null || width < 1200 || width > 2600) errors.add("width_mm", "Enter a width from 1200 to 2600 mm.");

  const odometer = (body.odometer ?? {}) as Record<string, unknown>;
  const distanceUnit = odometer.unit === "mi" ? "mi" : odometer.unit === "km" ? "km" : null;
  const odometerValue = wholeNumber(odometer.value);
  const odometerKm =
    distanceUnit && odometerValue !== null && odometerValue <= 9_999_999 ? distanceToKilometres(String(odometerValue), distanceUnit as DistanceUnit) : null;
  if (odometerKm === null) errors.add("odometer.value", "Enter a whole odometer reading from 0 to 9999999.");

  const tyre = (body.tyre_spec ?? {}) as Record<string, unknown>;
  const pressureUnit = tyre.unit === "psi" ? "psi" : tyre.unit === "bar" ? "bar" : null;
  const tyreText = decimalText(tyre.value);
  const tyreCentibar = pressureUnit && tyreText !== null ? pressureToCentibar(tyreText, pressureUnit as PressureUnit) : null;
  if (tyreCentibar === null || tyreCentibar < 50 || tyreCentibar > 500) errors.add("tyre_spec.value", "Enter a pressure from 0.50 to 5.00 bar.");
  if (typeof body.startup_schedule !== "boolean") errors.add("startup_schedule", "Choose whether the car has a start-up schedule.");
  errors.throwIfAny();

  const id = newId("c");
  await ctx.db.query(
    `INSERT INTO cars (id, owner_id, year, make, model, registration, colour, length_mm, width_mm, odometer_km,
                       tyre_spec_centibar, startup_schedule, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, clock_timestamp())`,
    [id, ownerId, year, make, model, registration, colour, length, width, odometerKm, tyreCentibar, body.startup_schedule],
  );
  const row = await visibleCar(ctx.db, ctx.user, id);
  return { status: 201, body: { car: presentCar(ctx.user, row) } };
}

