// Horses, visits, photos, marks and invoices as the API prints them, with the visibility and role field projection
// each record has (brief: API, Objects and Visibility).
import type { Caller } from "./auth.js";
import type { Queryable } from "./db.js";
import { type Alignment, type Hoof, type Line, HOOVES, degrees } from "./domain/hoofMarks.js";
import { lastVisitDateSql, nextDue } from "./domain/nextDue.js";
import { notFound } from "./errors.js";
import { businessDateOf, stamp, today } from "./practice.js";
import { type Signer, signer } from "./signedPaths.js";

const staff = (caller: Caller): boolean => caller.role === "farrier" || caller.role === "apprentice";
const hoofOrder = (hoof: Hoof): number => HOOVES.indexOf(hoof);

// ---- Horses ----

export interface HorseRecord {
  id: string;
  name: string;
  barn_id: string;
  barn_name: string;
  stall: string;
  cycle_weeks: number;
  owner_id: string;
  owner_name: string;
  owner_email: string;
  owner_phone: string | null;
  last_visit_date: string | null;
}

export const HORSE_SELECT = `
  SELECT h.id, h.name, h.barn_id, b.name AS barn_name, h.stall, h.cycle_weeks, h.owner_id, u.name AS owner_name,
         u.email AS owner_email, u.phone AS owner_phone,
         ${lastVisitDateSql("h.id")} AS last_visit_date
    FROM horses h JOIN barns b ON b.id = h.barn_id JOIN users u ON u.id = h.owner_id`;

/** Horses the caller may read: all for the farrier and apprentice, their own for an owner, none for a manager. */
export function horseVisibility(caller: Caller, offset = 0): { sql: string; params: unknown[] } {
  if (caller.role === "owner") return { sql: `h.owner_id = $${offset + 1}`, params: [caller.id] };
  if (caller.role === "barn_manager") return { sql: "false", params: [] };
  return { sql: "true", params: [] };
}

export async function visibleHorse(client: Queryable, caller: Caller, id: string): Promise<HorseRecord> {
  const visibility = horseVisibility(caller, 1);
  const { rows } = await client.query<HorseRecord>(`${HORSE_SELECT} WHERE h.id = $1 AND ${visibility.sql}`, [id, ...visibility.params]);
  const horse = rows[0];
  if (!horse) throw notFound();
  return horse;
}

export function horseJson(horse: HorseRecord, caller: Caller, at: number): Record<string, unknown> {
  return {
    id: horse.id,
    name: horse.name,
    barn: { id: horse.barn_id, name: horse.barn_name },
    stall: horse.stall,
    cycle_weeks: horse.cycle_weeks,
    ...nextDue(horse.last_visit_date, horse.cycle_weeks, today(at)),
    ...(caller.role === "farrier"
      ? { owner: { id: horse.owner_id, name: horse.owner_name, email: horse.owner_email, phone: horse.owner_phone } }
      : {}),
  };
}

// ---- Photos and marks ----

export interface PhotoRecord {
  id: string;
  visit_id: string;
  hoof: Hoof;
  phase: "before" | "after";
  content_type: string;
  width: number;
  height: number;
  size_bytes: number;
  object_key: string;
  thumbnail_status: "pending" | "ready" | "failed";
  thumbnail_key: string | null;
}

export function photoJson(photo: PhotoRecord, sign: Signer): Record<string, unknown> {
  const signed = sign("photo", photo.id);
  return {
    id: photo.id,
    visit_id: photo.visit_id,
    hoof: photo.hoof,
    phase: photo.phase,
    content_type: photo.content_type,
    width: photo.width,
    height: photo.height,
    url: signed.url,
    url_expires_at: stamp(signed.expiresAt),
    thumbnail_status: photo.thumbnail_status,
    thumbnail_url: photo.thumbnail_status === "ready" ? sign("thumb", photo.id).url : null,
  };
}

export interface MarksRecord {
  visit_id: string;
  hoof: Hoof;
  version: number;
  hoof_wall: Line;
  pastern: Line;
  wall_tenths: number;
  pastern_tenths: number;
  alignment: Alignment;
  saved_by_id: string;
  saved_by_name: string;
  saved_by_role: string;
  saved_at: Date;
  restored_from: number | null;
}

export const MARKS_SELECT = `
  SELECT m.visit_id, m.hoof, m.version, m.hoof_wall, m.pastern, m.wall_tenths, m.pastern_tenths, m.alignment,
         m.saved_by AS saved_by_id, u.name AS saved_by_name, u.role AS saved_by_role, m.saved_at, m.restored_from
    FROM hoof_marks m JOIN users u ON u.id = m.saved_by`;

/** The current marks of every hoof of the given visits: the newest version of each. */
export const CURRENT_MARKS = `${MARKS_SELECT}
   WHERE m.visit_id = ANY($1) AND m.version = (SELECT max(x.version) FROM hoof_marks x WHERE x.visit_id = m.visit_id AND x.hoof = m.hoof)`;

const lineWithAngle = (line: Line, tenths: number): Record<string, number> => ({ ...line, angle: degrees(tenths) });

/** Hoof marks; the farrier and apprentice also see who saved them, when, and what was restored. */
export function marksJson(marks: MarksRecord, withAttribution: boolean): Record<string, unknown> {
  return {
    hoof: marks.hoof,
    version: marks.version,
    hoof_wall: lineWithAngle(marks.hoof_wall, marks.wall_tenths),
    pastern: lineWithAngle(marks.pastern, marks.pastern_tenths),
    alignment: marks.alignment,
    ...(withAttribution
      ? {
          saved_by: { id: marks.saved_by_id, name: marks.saved_by_name, role: marks.saved_by_role },
          saved_at: stamp(marks.saved_at),
          restored_from: marks.restored_from,
        }
      : {}),
  };
}

export function historyJson(marks: MarksRecord): Record<string, unknown> {
  return {
    version: marks.version,
    hoof_wall: lineWithAngle(marks.hoof_wall, marks.wall_tenths),
    pastern: lineWithAngle(marks.pastern, marks.pastern_tenths),
    alignment: marks.alignment,
    saved_by: { id: marks.saved_by_id, name: marks.saved_by_name, role: marks.saved_by_role },
    saved_at: stamp(marks.saved_at),
    restored_from: marks.restored_from,
  };
}

// ---- Invoices ----

export interface InvoiceRecord {
  id: string;
  kind: "visit" | "trip";
  status: "pending" | "unpaid" | "paid";
  horse_id: string;
  horse_name: string;
  owner_id: string;
  visit_id: string | null;
  booking_id: string | null;
  business_date: string;
  items: Array<{ description: string; amount_cents: number }>;
  total_cents: number;
  balance_cents: number;
  killbill_invoice_id: string | null;
  dunning_state: string;
  retry_at: Date[] | null;
  reconciliation: string;
  created_at: Date;
}

export const INVOICE_SELECT = `
  SELECT i.id, i.kind, i.status, i.horse_id, h.name AS horse_name, i.owner_id, i.visit_id, i.booking_id, i.business_date,
         i.items, i.total_cents, i.balance_cents, i.killbill_invoice_id, i.dunning_state, i.retry_at, i.reconciliation, i.created_at
    FROM invoices i JOIN horses h ON h.id = i.horse_id`;

/** The business date of the invoice's next dunning retry, or of its last one when none remain. */
export function nextTryDate(invoice: Pick<InvoiceRecord, "retry_at">, at: number): string | null {
  const retries = invoice.retry_at ?? [];
  if (!retries.length) return null;
  const next = retries.find((instant) => instant.getTime() > at) ?? retries[retries.length - 1];
  return next ? businessDateOf(next) : null;
}

export function invoiceJson(invoice: InvoiceRecord, at: number): Record<string, unknown> {
  return {
    id: invoice.id,
    kind: invoice.kind,
    status: invoice.status,
    horse: { id: invoice.horse_id, name: invoice.horse_name },
    business_date: invoice.business_date,
    items: invoice.items,
    total_cents: invoice.total_cents,
    balance_cents: invoice.balance_cents,
    killbill_invoice_id: invoice.status === "pending" ? null : invoice.killbill_invoice_id,
    dunning_state: invoice.dunning_state,
    dunning_next_try: nextTryDate(invoice, at),
    reconciliation: invoice.reconciliation,
  };
}

// ---- Visits ----

export interface VisitRecord {
  id: string;
  status: "open" | "closed" | "invoice_pending" | "invoiced";
  horse_id: string;
  horse_name: string;
  owner_id: string;
  booking_id: string | null;
  business_date: string;
  note: string;
}

export const VISIT_SELECT = `
  SELECT v.id, v.status, v.horse_id, h.name AS horse_name, h.owner_id, v.booking_id, v.business_date, v.note
    FROM visits v JOIN horses h ON h.id = v.horse_id`;

/** Visits the caller may read: all for the farrier and apprentice; an owner's own horses' visits once not open. */
function visitVisibility(caller: Caller, offset = 0): { sql: string; params: unknown[] } {
  if (caller.role === "owner") return { sql: `h.owner_id = $${offset + 1} AND v.status <> 'open'`, params: [caller.id] };
  if (caller.role === "barn_manager") return { sql: "false", params: [] };
  return { sql: "true", params: [] };
}

export async function visibleVisit(client: Queryable, caller: Caller, id: string): Promise<VisitRecord> {
  const visibility = visitVisibility(caller, 1);
  const { rows } = await client.query<VisitRecord>(`${VISIT_SELECT} WHERE v.id = $1 AND ${visibility.sql}`, [id, ...visibility.params]);
  const visit = rows[0];
  if (!visit) throw notFound();
  return visit;
}

/** Visits as the API prints them; the apprentice always receives `invoice` null and owners no attribution. */
export async function visitsJson(client: Queryable, visits: VisitRecord[], caller: Caller, at: number): Promise<Record<string, unknown>[]> {
  if (!visits.length) return [];
  const ids = visits.map((visit) => visit.id);
  const sign = await signer(client, at);
  const [photos, marks, invoices] = await Promise.all([
    client.query<PhotoRecord>(`SELECT * FROM photos WHERE visit_id = ANY($1)`, [ids]),
    client.query<MarksRecord>(CURRENT_MARKS, [ids]),
    client.query<InvoiceRecord>(`${INVOICE_SELECT} WHERE i.visit_id = ANY($1)`, [ids]),
  ]);
  return visits.map((visit) => {
    const invoice = caller.role === "apprentice" ? undefined : invoices.rows.find((row) => row.visit_id === visit.id);
    return {
      id: visit.id,
      status: visit.status,
      horse: { id: visit.horse_id, name: visit.horse_name },
      booking_id: visit.booking_id,
      business_date: visit.business_date,
      note: visit.note,
      photos: photos.rows
        .filter((photo) => photo.visit_id === visit.id)
        .sort((a, b) => hoofOrder(a.hoof) - hoofOrder(b.hoof) || (a.phase < b.phase ? 1 : -1))
        .map((photo) => photoJson(photo, sign)),
      marks: marks.rows
        .filter((row) => row.visit_id === visit.id)
        .sort((a, b) => hoofOrder(a.hoof) - hoofOrder(b.hoof))
        .map((row) => marksJson(row, staff(caller))),
      invoice: invoice ? invoiceJson(invoice, at) : null,
    };
  });
}

export async function visitJson(client: Queryable, visit: VisitRecord, caller: Caller, at: number): Promise<Record<string, unknown>> {
  const [json] = await visitsJson(client, [visit], caller, at);
  if (!json) throw notFound();
  return json;
}

export interface PairVisit {
  id: string;
  business_date: string;
}

/**
 * A vet link's live pair: its horse's two most recent visits that are not open, judged at each read, as
 * [previous, current]; null while fewer than two exist (brief: Vet links, Live pair).
 */
export async function livePair(client: Queryable, horseId: string): Promise<[PairVisit, PairVisit] | null> {
  const { rows } = await client.query<PairVisit>(
    `SELECT id, business_date FROM visits WHERE horse_id = $1 AND status <> 'open' ORDER BY business_date DESC, created_at DESC LIMIT 2`,
    [horseId],
  );
  const [current, previous] = rows;
  return current && previous ? [previous, current] : null;
}
