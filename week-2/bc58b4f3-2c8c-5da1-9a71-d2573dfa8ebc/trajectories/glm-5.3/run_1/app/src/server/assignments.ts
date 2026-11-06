import { randomBytes } from "node:crypto";
import { ApiError, validationError } from "./errors";
import { LANGUAGES, Role, seatCountFor } from "../shared/domain";
import { isoCentral, centralDateISO, minutesOfDayCentral, parseInstant, partsCentral, sameCentralDay } from "../shared/time";
import { Tx } from "./config";
import { seatCount, serviceLine } from "./rules";

export interface AssignmentRow {
  id: number;
  number: string;
  org_code: string;
  language_code: string;
  setting: string;
  start_at: Date;
  end_at: Date;
  duration_minutes: number;
  street_address: string;
  city: string;
  patient_initials: string;
  medical_notes: string;
  status: string;
  scheduler_id: number;
  scheduler_name: string;
  scheduler_phone: string;
}

export interface SeatRow {
  id: number;
  seat: number;
  status: "open" | "held" | "served";
  holder_id: number | null;
  holder_name: string | null;
  holder_initials: string | null;
  actual_minutes: number | null;
  round_trip_miles: number | null;
  form_object_key: string | null;
  form_content_type: string | null;
}

const ASSIGNMENT_SELECT = `
  SELECT a.id, a.number, a.org_code, a.language_code, a.setting, a.start_at, a.end_at,
         a.duration_minutes, a.street_address, a.city, a.patient_initials, a.medical_notes,
         a.status, a.scheduler_id,
         s.name AS scheduler_name, s.phone AS scheduler_phone
    FROM assignments a
    JOIN people s ON s.id = a.scheduler_id
`;

/** Load one assignment by number, answering not_found when unknown. */
export async function loadAssignment(tx: Tx, number: string): Promise<AssignmentRow> {
  const res = await tx.query(`${ASSIGNMENT_SELECT} WHERE a.number = $1`, [number]);
  const row = res.rows[0] as AssignmentRow | undefined;
  if (!row) throw new ApiError("not_found", "No such request.");
  return row;
}

/** Look up an assignment without throwing; null when unknown. */
export async function findAssignment(tx: Tx, number: string): Promise<AssignmentRow | null> {
  const res = await tx.query(`${ASSIGNMENT_SELECT} WHERE a.number = $1`, [number]);
  return (res.rows[0] as AssignmentRow) ?? null;
}

export async function loadSeats(tx: Tx, assignmentId: number): Promise<SeatRow[]> {
  const res = await tx.query(
    `SELECT st.id, st.seat, st.status::text AS status, st.holder_id,
            p.name AS holder_name, p.initials AS holder_initials,
            st.actual_minutes, st.round_trip_miles,
            st.form_object_key, st.form_content_type
       FROM seats st
       LEFT JOIN people p ON p.id = st.holder_id
      WHERE st.assignment_id = $1
      ORDER BY st.seat`,
    [assignmentId],
  );
  return res.rows as SeatRow[];
}

export async function loadBilling(tx: Tx, assignmentId: number): Promise<{ status: string; invoice_id: string | null; total_cents: number | null }> {
  const res = await tx.query(
    `SELECT status::text AS status, invoice_id, total_cents FROM billing WHERE assignment_id = $1`,
    [assignmentId],
  );
  if (!res.rows.length) return { status: "none", invoice_id: null, total_cents: null };
  const row = res.rows[0] as { status: string; invoice_id: string | null; total_cents: number | null };
  return { status: row.status, invoice_id: row.invoice_id, total_cents: row.total_cents };
}

export async function loadCancellation(tx: Tx, assignmentId: number): Promise<Record<string, unknown> | null> {
  const res = await tx.query(
    `SELECT cancelled_at, fee_applies, business_minutes_notice, fee_cents
       FROM cancellations WHERE assignment_id = $1`,
    [assignmentId],
  );
  if (!res.rows.length) return null;
  const row = res.rows[0] as { cancelled_at: Date; fee_applies: boolean; business_minutes_notice: number; fee_cents: number };
  return {
    cancelled_at: isoCentral(row.cancelled_at),
    fee_applies: row.fee_applies,
    business_minutes_notice: row.business_minutes_notice,
    fee_cents: row.fee_cents,
  };
}

// ── View builders ────────────────────────────────────────────────────────────

export type Viewer =
  | { kind: "offer" }
  | { kind: "holder" }
  | { kind: "org" }
  | { kind: "staff" };

export function buildView(a: AssignmentRow, seats: SeatRow[], viewer: Viewer, extra: { cancellation: Record<string, unknown> | null; billing: { status: string; invoice_id: string | null; total_cents: number | null } }): Record<string, unknown> {
  const base = {
    number: a.number,
    status: a.status,
    language: a.language_code,
    setting: a.setting,
    city: a.city,
    start_at: isoCentral(a.start_at),
    end_at: isoCentral(a.end_at),
    duration_minutes: a.duration_minutes,
  };
  // The offer view carries seat states plus co-holder initials so the losing
  // claimant's lane can show the winner after a refresh (DP-17); no other
  // scheduler or patient fields are exposed.
  const offerSeats = seats.map((s) => ({ seat: s.seat, status: s.status, interpreter_initials: s.holder_initials }));
  if (viewer.kind === "offer") {
    return { ...base, seats: offerSeats };
  }
  const holderSeats = seats.map((s) => ({ seat: s.seat, status: s.status, interpreter_initials: s.holder_initials }));
  const holder = {
    ...base,
    street_address: a.street_address,
    patient_initials: a.patient_initials,
    medical_notes: a.medical_notes,
    scheduler: { name: a.scheduler_name, phone: a.scheduler_phone },
    seats: holderSeats,
  };
  if (viewer.kind === "holder") return holder;
  const org = {
    ...holder,
    cancellation: extra.cancellation,
    billing: {
      status: extra.billing.status,
      invoice_id: extra.billing.invoice_id,
      total_cents: extra.billing.total_cents,
    },
  };
  if (viewer.kind === "org") return org;
  return {
    ...org,
    org: { code: a.org_code, name: orgName(a.org_code) },
    seats: seats.map((s) => ({ seat: s.seat, status: s.status, interpreter_initials: s.holder_initials, interpreter_name: s.holder_name })),
  };
}

// orgName is filled from a cache the router session layer populates; kept simple here.
const ORG_NAMES = new Map<string, string>();
export function rememberOrgNames(pairs: { code: string; name: string }[]): void {
  for (const p of pairs) ORG_NAMES.set(p.code, p.name);
}
function orgName(code: string): string {
  return ORG_NAMES.get(code) ?? code;
}

// ── Visibility (single source of truth) ──────────────────────────────────────

export interface Caller {
  id: number;
  role: Role;
  orgCode: string | null;
  languages: string[];
}

export async function canSeeAssignment(tx: Tx, caller: Caller, a: AssignmentRow): Promise<boolean> {
  switch (caller.role) {
    case "dispatcher":
    case "billing_lead":
      return true;
    case "scheduler":
    case "org_admin":
      return a.org_code === caller.orgCode;
    case "interpreter": {
      if (!caller.languages.includes(a.language_code)) return false;
      const held = await holdsSeat(tx, caller.id, a.id);
      if (held) return true;
      return a.status === "released" || a.status === "partially_covered" || a.status === "covered";
    }
  }
}

/** Whether the interpreter holds or has served a seat on the assignment. */
export async function holdsSeat(tx: Tx, personId: number, assignmentId: number): Promise<boolean> {
  const res = await tx.query(
    `SELECT 1 FROM seats WHERE assignment_id = $1 AND holder_id = $2`,
    [assignmentId, personId],
  );
  return res.rows.length > 0;
}

export async function loadCallerLanguages(tx: Tx, personId: number): Promise<string[]> {
  const res = await tx.query(`SELECT language_code FROM interpreter_languages WHERE person_id = $1`, [personId]);
  return res.rows.map((r) => r.language_code as string);
}

// ── Validation (single source of truth for field rules) ──────────────────────

const LANGUAGE_CODES = LANGUAGES.map((l) => l.code);
const SETTING_VALUES = ["hospital", "clinic", "school"];

export interface AssignmentInput {
  language: string;
  setting: string;
  start_at: string;
  duration_minutes: number;
  street_address: string;
  city: string;
  patient_initials: string;
  medical_notes: string;
}

function validateTextField(value: unknown, field: string, max: number, required: boolean, fields: Record<string, string>): string | null {
  if (typeof value !== "string") {
    fields[field] = required ? "This field is required." : "Must be text.";
    return null;
  }
  const trimmed = value;
  if (required && trimmed.trim().length === 0) {
    fields[field] = "This field is required.";
    return null;
  }
  if (trimmed.length > max) {
    fields[field] = `Keep this under ${max + 1} characters.`;
    return null;
  }
  if (!required && trimmed.length === 0) return "";
  return trimmed;
}

/** Validate the request window rules (used for creation and any time change). */
export function validateTimeWindow(start: Date, duration: number, now: Date): void {
  const fields: Record<string, string> = {};
  const startMin = minutesOfDayCentral(start);
  if (start.getTime() < now.getTime() + 60 * 60000) {
    fields.start_at = "Start must be at least 60 minutes from now.";
  } else if (start.getTime() > now.getTime() + 365 * 24 * 3600 * 1000) {
    fields.start_at = "Start must be within 365 days.";
  } else if (startMin % 15 !== 0) {
    fields.start_at = "Start must be on a quarter hour (Central time).";
  } else if (startMin < 360 || startMin >= 1320) {
    fields.start_at = "Start must be between 06:00 and 22:00 Central.";
  } else {
    const end = new Date(start.getTime() + duration * 60000);
    if (!sameCentralDay(start, end)) {
      fields.start_at = "The request must end by 22:00 Central on the same day.";
    }
  }
  if (Object.keys(fields).length > 0) throw validationError(fields);
}

/**
 * Validate assignment fields. In `partial` mode only the fields present in the
 * body are validated and returned; creation mode requires every field.
 * Returns the cleaned values present in the body (partial) or all of them (creation).
 */
export function validateAssignmentInput(body: Record<string, unknown>, now: Date, partial: boolean): Partial<AssignmentInput> {
  const fields: Record<string, string> = {};
  const input: Partial<AssignmentInput> = {};

  const wants = (field: string): boolean => body[field] !== undefined || !partial;

  if (wants("language")) {
    if (typeof body.language === "string" && LANGUAGE_CODES.includes(body.language)) {
      input.language = body.language;
    } else {
      fields.language = "Pick a seeded language.";
    }
  }
  if (wants("setting")) {
    if (typeof body.setting === "string" && SETTING_VALUES.includes(body.setting)) {
      input.setting = body.setting;
    } else {
      fields.setting = "Pick hospital, clinic or school.";
    }
  }

  let start: Date | null = null;
  let duration: number | null = null;
  if (wants("start_at")) {
    start = parseInstant(body.start_at as unknown as string);
    if (!start) {
      fields.start_at = "Enter a valid time.";
    }
  }
  if (wants("duration_minutes")) {
    const d = body.duration_minutes;
    if (typeof d === "number" && Number.isInteger(d) && d >= 30 && d <= 480 && d % 15 === 0) {
      duration = d;
    } else {
      fields.duration_minutes = "Duration must be 30 to 480 minutes in steps of 15.";
    }
  }
  if (start && duration) {
    try {
      validateTimeWindow(start, duration, now);
      input.start_at = start.toISOString();
      input.duration_minutes = duration;
    } catch (e) {
      const verr = e as { fields?: Record<string, string> };
      Object.assign(fields, verr.fields ?? {});
    }
  }

  if (wants("street_address")) {
    const v = validateTextField(body.street_address, "street_address", 200, true, fields);
    if (v !== null) input.street_address = v;
  }
  if (wants("city")) {
    const v = validateTextField(body.city, "city", 80, true, fields);
    if (v !== null) input.city = v;
  }
  if (wants("patient_initials")) {
    if (typeof body.patient_initials === "string" && /^[A-Z]{2,3}$/.test(body.patient_initials)) {
      input.patient_initials = body.patient_initials;
    } else {
      fields.patient_initials = "Enter 2 or 3 capital letters A–Z.";
    }
  }
  if (body.medical_notes !== undefined) {
    const v = validateTextField(body.medical_notes, "medical_notes", 1000, false, fields);
    if (v !== null) input.medical_notes = v;
  } else if (!partial) {
    input.medical_notes = "";
  }

  if (Object.keys(fields).length > 0) throw validationError(fields);
  return input;
}

// ── Creation ─────────────────────────────────────────────────────────────────

export async function createAssignment(tx: Tx, schedulerId: number, orgCode: string, input: AssignmentInput): Promise<AssignmentRow> {
  const seqRes = await tx.query(`UPDATE assignment_seq SET last_seq = last_seq + 1 WHERE id = 1 RETURNING last_seq`);
  const seq = seqRes.rows[0].last_seq as number;
  const number = `A-${seq}`;
  const startAt = new Date(input.start_at);
  const endAt = new Date(startAt.getTime() + input.duration_minutes * 60000);
  const res = await tx.query(
    `INSERT INTO assignments
       (number, seq, org_code, language_code, setting, start_at, end_at, duration_minutes,
        street_address, city, patient_initials, medical_notes, status, scheduler_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'draft',$13)
     RETURNING id`,
    [number, seq, orgCode, input.language, input.setting, startAt, endAt, input.duration_minutes,
      input.street_address, input.city, input.patient_initials, input.medical_notes, schedulerId],
  );
  const id = res.rows[0].id as number;
  const count = seatCount(input.language, input.duration_minutes);
  for (let seat = 1; seat <= count; seat++) {
    await tx.query(`INSERT INTO seats (assignment_id, seat) VALUES ($1,$2)`, [id, seat]);
  }
  const created = await loadAssignment(tx, number);
  return created as AssignmentRow;
}

/** Recompute seat count after a time change: free held seats and rebuild seat rows. */
export async function rebuildSeats(tx: Tx, assignmentId: number, language: string, durationMinutes: number): Promise<{ freed: SeatRow[] }> {
  const existing = await loadSeats(tx, assignmentId);
  const freed = existing.filter((s) => s.status !== "open");
  const target = seatCountFor(language, durationMinutes);
  await tx.query(`DELETE FROM seats WHERE assignment_id = $1`, [assignmentId]);
  for (let seat = 1; seat <= target; seat++) {
    await tx.query(`INSERT INTO seats (assignment_id, seat) VALUES ($1,$2)`, [assignmentId, seat]);
  }
  return { freed };
}

export async function assignmentStatusAfterSeatChange(tx: Tx, assignmentId: number): Promise<string> {
  const seats = await loadSeats(tx, assignmentId);
  const open = seats.filter((s) => s.status === "open").length;
  const held = seats.filter((s) => s.status === "held" || s.status === "served").length;
  if (open > 0) return held > 0 ? "partially_covered" : "released";
  return held > 0 ? "covered" : "released";
}

export function freshFormToken(): string {
  return randomBytes(24).toString("base64url");
}

export function startDateCentral(a: AssignmentRow): string {
  return centralDateISO(a.start_at);
}

export { serviceLine, partsCentral };
