// The kitchen, its stations, rate versions, peak windows, document requirements and members.

import { pool, tx, type Db } from "./db.js";
import { variantError, forbidden, invalid, notFound, refuseInvalid, route, type Ctx } from "./http.js";
import { BODIES, bodyObject, keyErrors } from "./bodies.js";
import { businessName } from "./text.js";
import type { Session } from "./auth.js";
import { hourBank } from "./ledger.js";
import { deliverBilling } from "./billing.js";
import { rateStatus, endMinutes, type HourlyRate, type PeakWindow, type ShelfRate } from "../shared/rules.js";
import { DOCUMENT_TYPES, type DocumentType } from "../shared/format.js";
import { WEEKDAY_KEYS, isLocalDate, isLocalTime, isMonth, isoWithOffset, localDateOf, localStamp, minutesOf, monthOf, zonedInstant, type Month } from "../shared/time.js";

interface KitchenRules { peakWindows: PeakWindow[]; requiredDocuments: DocumentType[]; rulesVersion: number }

export async function kitchenRules(db: Db, kitchenId: string): Promise<KitchenRules> {
  const { rows } = await db.query("SELECT peak_windows, required_documents, rules_version FROM kitchens WHERE id = $1", [kitchenId]);
  return { peakWindows: rows[0].peak_windows, requiredDocuments: rows[0].required_documents, rulesVersion: rows[0].rules_version };
}

export const todayOf = (s: Session): string => localDateOf(Date.now(), s.kitchen.timeZone);
const currentMonthOf = (s: Session): Month => monthOf(todayOf(s));

/** A `month` query parameter, defaulting to the kitchen-local current month. */
export function monthParam(ctx: Ctx): Month {
  const raw = ctx.query.get("month");
  if (raw === null) return currentMonthOf(ctx.session!);
  if (!isMonth(raw)) throw invalid({ month: "Use a month in the form YYYY-MM." });
  return raw;
}

export async function kitchenBody(db: Db, s: Session): Promise<Record<string, unknown>> {
  const { peakWindows, requiredDocuments, rulesVersion } = await kitchenRules(db, s.kitchen.id);
  return { ...s.kitchen, today: todayOf(s), currentMonth: currentMonthOf(s), peakWindows, requiredDocuments, rulesVersion };
}

export interface StationRow { id: string; kitchen_id: string; name: string; kind: "hourly" | "shelf"; capacity: number | null; position: number }
type RateVersion = HourlyRate | ShelfRate;

/** A station of this kitchen named by a path or body id; another kitchen's answers 404 as an unknown one does. */
export async function stationById(db: Db, s: Session, id: unknown): Promise<StationRow> {
  const { rows } = await db.query("SELECT * FROM stations WHERE id = $1 AND kitchen_id = $2", [String(id), s.kitchen.id]);
  if (!rows[0]) throw notFound();
  return rows[0];
}

/** Every version of a station's rates, oldest effective instant first. */
export async function rateVersions(db: Db, station: StationRow, zone: string): Promise<RateVersion[]> {
  const { rows } = await db.query("SELECT * FROM rate_versions WHERE station_id = $1 ORDER BY effective_at", [station.id]);
  return rows.map((r) => {
    const effective = { effectiveFrom: r.effective_from as string, effectiveAt: isoWithOffset((r.effective_at as Date).getTime(), zone) };
    return station.kind === "hourly"
      ? { ...effective, offPeakHourlyCents: r.off_peak_cents, peakHourlyCents: r.peak_cents }
      : { ...effective, shelfDayCents: r.shelf_day_cents };
  });
}

/** A station with every rate version's status, and its current rate, decided at this request's instant. */
async function stationBody(station: StationRow, zone: string): Promise<Record<string, unknown>> {
  const now = Date.now();
  const versions = await rateVersions(pool, station, zone);
  const rates = versions.map((rate) => {
    const { effectiveFrom, effectiveAt, ...cents } = rate;
    return { effectiveFrom, effectiveAt, status: rateStatus(rate, versions, now), ...cents };
  });
  return { id: station.id, name: station.name, kind: station.kind, capacity: station.capacity, currentRate: rates.find((r) => r.status === "current") ?? null, rates };
}

route("GET", "/api/kitchen", async (ctx) => ({ status: 200, body: await kitchenBody(pool, ctx.session!) }));

route("GET", "/api/stations", async (ctx) => {
  const s = ctx.session!;
  const { rows } = await pool.query("SELECT * FROM stations WHERE kitchen_id = $1 ORDER BY position", [s.kitchen.id]);
  return { status: 200, body: { stations: await Promise.all(rows.map((r) => stationBody(r, s.kitchen.timeZone))) } };
});

const RATE_MESSAGE = "Enter a rate from $0.01 to $1,000.00.";
const validRate = (v: unknown): boolean => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 100_000;

/**
 * Resolves a kitchen-local `YYYY-MM-DDTHH:MM` to its one effective instant: a repeated time is its
 * first occurrence, a time in a clock-change gap is refused, and the instant must be in the future.
 */
function effectiveInstant(raw: unknown, zone: string, errors: Record<string, string>): number | null {
  const future = "Rate changes must start in the future.";
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw) || !isLocalDate(raw.slice(0, 10)) || !isLocalTime(raw.slice(11))) {
    errors.effectiveFrom = future;
    return null;
  }
  const at = zonedInstant(raw.slice(0, 10), raw.slice(11), zone);
  if (at === null) errors.effectiveFrom = `${raw.slice(11)} does not exist on ${raw.slice(0, 10)} in ${zone} (clocks go forward).`;
  else if (at <= Date.now()) errors.effectiveFrom = future;
  return at;
}

route("POST", "/api/stations/:id/rates", async (ctx) => {
  const s = ctx.session!;
  const station = await stationById(pool, s, ctx.params.id);
  if (s.person.role !== "operator") throw forbidden();
  const body = bodyObject(ctx.body);
  const spec = station.kind === "hourly" ? BODIES.hourlyRate : BODIES.shelfRate;
  const errors = keyErrors(Object.keys(body), spec);
  for (const f of spec.required) if (f !== "effectiveFrom" && !errors[f] && !validRate(body[f])) errors[f] = RATE_MESSAGE;
  const at = errors.effectiveFrom ? null : effectiveInstant(body.effectiveFrom, s.kitchen.timeZone, errors);
  refuseInvalid(errors);
  const { rowCount } = await pool.query(
    `INSERT INTO rate_versions (station_id, effective_from, effective_at, off_peak_cents, peak_cents, shelf_day_cents)
     VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (station_id, effective_at) DO NOTHING`,
    [station.id, body.effectiveFrom, new Date(at!), body.offPeakHourlyCents ?? null, body.peakHourlyCents ?? null, body.shelfDayCents ?? null],
  );
  if (!rowCount) {
    throw variantError(409, "rate_version_exists", [station.name, localStamp(at!, s.kitchen.timeZone)]);
  }
  return { status: 201, body: { station: await stationBody(station, s.kitchen.timeZone) } };
});

const WINDOW_KEYS = ["days", "start", "end"];

function validWindow(w: unknown): w is PeakWindow {
  if (!w || typeof w !== "object" || Array.isArray(w)) return false;
  const { days, start, end } = w as Record<string, unknown>;
  const onQuarter = (t: unknown): t is string => (isLocalTime(t) || t === "24:00") && endMinutes(t) % 15 === 0;
  return Object.keys(w).length === WINDOW_KEYS.length && WINDOW_KEYS.every((k) => k in w)
    && Array.isArray(days) && days.length > 0 && new Set(days).size === days.length
    && days.every((d) => (WEEKDAY_KEYS as readonly unknown[]).includes(d))
    && onQuarter(start) && start !== "24:00" && onQuarter(end) && minutesOf(start) < endMinutes(end);
}

/**
 * Saves one kitchen rule when the request carries the current rules version: exactly one of several
 * saves carrying the same version succeeds, and a stale one answers 412 with the current kitchen.
 */
async function saveRule(s: Session, rulesVersion: number, column: "peak_windows" | "required_documents", value: unknown): Promise<Record<string, unknown>> {
  return tx(async (client) => {
    const { rowCount } = await client.query(
      `UPDATE kitchens SET ${column} = $3, rules_version = rules_version + 1 WHERE id = $1 AND rules_version = $2`,
      [s.kitchen.id, rulesVersion, value],
    );
    if (!rowCount) {
      throw variantError(412, "stale_version_rules", [], { current: await kitchenBody(client, s) });
    }
    return kitchenBody(client, s);
  });
}

function rulesVersionOf(body: Record<string, unknown>, errors: Record<string, string>): number {
  if (!errors.rulesVersion && !Number.isInteger(body.rulesVersion)) errors.rulesVersion = "Reload and try again.";
  return body.rulesVersion as number;
}

route("PUT", "/api/kitchen/peak-windows", async (ctx) => {
  const s = ctx.session!;
  if (s.person.role !== "operator") throw forbidden();
  const body = bodyObject(ctx.body);
  const errors = keyErrors(Object.keys(body), BODIES.peakWindows);
  const { windows } = body;
  if (!errors.windows && (!Array.isArray(windows) || windows.length > 10 || !windows.every(validWindow))) {
    errors.windows = "Peak windows need days and a start before the end, on the quarter hour.";
  }
  const version = rulesVersionOf(body, errors);
  refuseInvalid(errors);
  const clean = (windows as PeakWindow[]).map((w) => ({ days: WEEKDAY_KEYS.filter((d) => w.days.includes(d)), start: w.start, end: w.end }));
  return { status: 200, body: await saveRule(s, version, "peak_windows", JSON.stringify(clean)) };
});

route("PUT", "/api/kitchen/document-requirements", async (ctx) => {
  const s = ctx.session!;
  if (s.person.role !== "operator") throw forbidden();
  const body = bodyObject(ctx.body);
  const errors = keyErrors(Object.keys(body), BODIES.documentRequirements);
  const { required } = body;
  const known = Object.keys(DOCUMENT_TYPES) as DocumentType[];
  if (!errors.required && (!Array.isArray(required) || !required.every((r) => known.includes(r)))) {
    errors.required = "Choose insurance certificate or food-handler card.";
  }
  const version = rulesVersionOf(body, errors);
  refuseInvalid(errors);
  return { status: 200, body: await saveRule(s, version, "required_documents", known.filter((k) => (required as unknown[]).includes(k))) };
});

interface MemberRow { id: string; kitchen_id: string; name: string; email: string; business_name: string; plan_hours: number }

/** A member record in the caller's shape: no email for shift leads. */
function memberJson(m: MemberRow, s: Session): Record<string, unknown> {
  const record = { id: m.id, name: m.name, businessName: m.business_name };
  return s.person.role === "shift_lead" ? record : { ...record, email: m.email };
}

/** A member visible to this session: members see only themselves, staff their kitchen. */
export async function visibleMember(s: Session, id: string): Promise<MemberRow> {
  const { rows } = await pool.query("SELECT * FROM members WHERE id = $1 AND kitchen_id = $2", [id, s.kitchen.id]);
  if (!rows[0] || (s.person.role === "member" && s.person.memberId !== id)) throw notFound();
  return rows[0];
}

route("GET", "/api/members", async (ctx) => {
  const s = ctx.session!;
  if (s.person.role === "member") throw forbidden();
  const q = (ctx.query.get("q") ?? "").normalize("NFC").toLowerCase();
  const { rows } = await pool.query(
    `SELECT * FROM members WHERE kitchen_id = $1 AND (strpos(lower(name), $2) > 0 OR strpos(lower(business_name), $2) > 0)
     ORDER BY lower(business_name), id LIMIT 20`,
    [s.kitchen.id, q],
  );
  return { status: 200, body: { members: rows.map((m) => memberJson(m, s)) } };
});

route("PATCH", "/api/members/me", async (ctx) => {
  const s = ctx.session!;
  if (s.person.role !== "member") throw forbidden();
  const body = bodyObject(ctx.body);
  const errors = keyErrors(Object.keys(body), BODIES.businessName);
  const name = businessName(body.businessName);
  if (!errors.businessName && name === null) errors.businessName = "Business name must be 1 to 80 characters with no line breaks.";
  refuseInvalid(errors);
  const rows = await tx(async (db) => {
    const updated = await db.query("UPDATE members SET business_name = $2 WHERE id = $1 RETURNING *", [s.person.memberId, name]);
    await db.query("INSERT INTO account_names (member_id, name) VALUES ($1, $2)", [s.person.memberId, name]);
    return updated.rows;
  });
  void deliverBilling();
  return { status: 200, body: { member: memberJson(rows[0], s) } };
});

route("GET", "/api/members/:id", async (ctx) => ({ status: 200, body: { member: memberJson(await visibleMember(ctx.session!, ctx.params.id!), ctx.session!) } }));

route("GET", "/api/members/:id/hour-bank", async (ctx) => {
  const member = await visibleMember(ctx.session!, ctx.params.id!);
  return { status: 200, body: await hourBank(pool, member.id, monthParam(ctx)) };
});
