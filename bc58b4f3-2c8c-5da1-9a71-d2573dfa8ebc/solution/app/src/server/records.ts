// Loading assignments with their seats and cancellation decision.
import type { Db } from "./db.js";
import { pool } from "./db.js";

export interface SeatRecord {
  seat: number;
  status: "open" | "held" | "served";
  holderId: string | null;
  holderName: string | null;
}

interface CancellationRecord {
  cancelledAt: Date;
  feeApplies: boolean;
  businessMinutesNotice: number;
  feeCents: number;
  seats: number;
  rate: { effectiveFrom: string; hourlyRateCents: number; mileageCentsPerMile: number } | null;
}

export interface ChargeLine {
  seat: number;
  actual_minutes: number | null;
  billable_minutes: number;
  amount_cents: number;
  round_trip_miles: number;
  billable_miles: number;
  mileage_cents: number;
}

export interface Charges {
  number: string;
  kind: "service" | "late_cancellation";
  rate: { effective_from: string; hourly_rate_cents: number; mileage_cents_per_mile: number };
  lines: ChargeLine[];
  total_cents: number;
}

export type AssignmentStatus =
  | "draft"
  | "released"
  | "partially_covered"
  | "covered"
  | "served"
  | "verified"
  | "invoiced"
  | "cancelled";

export interface AssignmentRecord {
  id: number;
  number: string;
  orgCode: string;
  orgName: string;
  schedulerId: string;
  schedulerName: string;
  schedulerPhone: string;
  languageCode: string;
  languageName: string;
  setting: string;
  startAt: Date;
  durationMinutes: number;
  streetAddress: string;
  city: string;
  patientInitials: string;
  medicalNotes: string;
  status: AssignmentStatus;
  billingStatus: "none" | "ready" | "queued" | "posted";
  invoiceId: string | null;
  billedCharges: Charges | null;
  seats: SeatRecord[];
  cancellation: CancellationRecord | null;
}

interface AssignmentRow {
  id: number;
  number: string;
  org_code: string;
  org_name: string;
  scheduler_id: string;
  scheduler_name: string;
  scheduler_phone: string;
  language_code: string;
  language_name: string;
  setting: string;
  start_at: Date;
  duration_minutes: number;
  street_address: string;
  city: string;
  patient_initials: string;
  medical_notes: string;
  status: AssignmentStatus;
  billing_status: AssignmentRecord["billingStatus"];
  invoice_id: string | null;
  billed_charges: Charges | null;
}

interface SeatRow {
  assignment_id: number;
  seat: number;
  status: SeatRecord["status"];
  holder_id: string | null;
  holder_name: string | null;
}

interface CancellationRow {
  assignment_id: number;
  cancelled_at: Date;
  fee_applies: boolean;
  business_minutes_notice: number;
  fee_cents: number;
  seats: number;
  rate_effective_from: string | null;
  hourly_rate_cents: number | null;
  mileage_cents_per_mile: number | null;
}

/**
 * Load assignments matching `where` (SQL over alias `a`), soonest start first.
 * `lock` takes a row lock on the assignments read, for the transaction that changes them.
 */
export async function loadAssignments(
  where: string,
  params: unknown[],
  db: Db | typeof pool = pool,
  lock = false,
): Promise<AssignmentRecord[]> {
  const rows = await db.query<AssignmentRow>(
    `SELECT a.id, a.number, a.org_code, o.name AS org_name, a.scheduler_id, s.name AS scheduler_name,
            s.phone AS scheduler_phone, a.language_code, l.name AS language_name, a.setting, a.start_at,
            a.duration_minutes, a.street_address, a.city, a.patient_initials, a.medical_notes, a.status,
            a.billing_status, a.invoice_id, a.billed_charges
       FROM assignments a
       JOIN organisations o ON o.code = a.org_code
       JOIN languages l ON l.code = a.language_code
       JOIN people s ON s.id = a.scheduler_id
      WHERE ${where}
      ORDER BY a.start_at, a.id
      ${lock ? "FOR UPDATE OF a" : ""}`,
    params,
  );
  if (rows.rows.length === 0) return [];
  const ids = rows.rows.map((r) => r.id);
  const seats = await db.query<SeatRow>(
    `SELECT st.assignment_id, st.seat, st.status, st.holder_id, p.name AS holder_name
       FROM seats st LEFT JOIN people p ON p.id = st.holder_id
      WHERE st.assignment_id = ANY($1) ORDER BY st.seat`,
    [ids],
  );
  const cancellations = await db.query<CancellationRow>("SELECT * FROM cancellations WHERE assignment_id = ANY($1)", [
    ids,
  ]);
  return rows.rows.map((row) => {
    const decision = cancellations.rows.find((c) => c.assignment_id === row.id);
    return {
      id: row.id,
      number: row.number,
      orgCode: row.org_code,
      orgName: row.org_name,
      schedulerId: row.scheduler_id,
      schedulerName: row.scheduler_name,
      schedulerPhone: row.scheduler_phone,
      languageCode: row.language_code,
      languageName: row.language_name,
      setting: row.setting,
      startAt: row.start_at,
      durationMinutes: row.duration_minutes,
      streetAddress: row.street_address,
      city: row.city,
      patientInitials: row.patient_initials,
      medicalNotes: row.medical_notes,
      status: row.status,
      billingStatus: row.billing_status,
      invoiceId: row.invoice_id,
      billedCharges: row.billed_charges,
      seats: seats.rows
        .filter((s) => s.assignment_id === row.id)
        .map((s) => ({ seat: s.seat, status: s.status, holderId: s.holder_id, holderName: s.holder_name })),
      cancellation: decision
        ? {
            cancelledAt: decision.cancelled_at,
            feeApplies: decision.fee_applies,
            businessMinutesNotice: decision.business_minutes_notice,
            feeCents: decision.fee_cents,
            seats: decision.seats,
            rate:
              decision.rate_effective_from !== null &&
              decision.hourly_rate_cents !== null &&
              decision.mileage_cents_per_mile !== null
                ? {
                    effectiveFrom: decision.rate_effective_from,
                    hourlyRateCents: decision.hourly_rate_cents,
                    mileageCentsPerMile: decision.mileage_cents_per_mile,
                  }
                : null,
          }
        : null,
    };
  });
}

/** Re-read an assignment inside the transaction that just changed it. */
export async function reloadAssignment(db: Db, id: number): Promise<AssignmentRecord> {
  const [record] = await loadAssignments("a.id = $1", [id], db);
  return record!;
}

export function endOf(record: AssignmentRecord): Date {
  return new Date(record.startAt.getTime() + record.durationMinutes * 60_000);
}

export async function interpreterLanguages(personId: string, db: Db | typeof pool = pool): Promise<string[]> {
  const rows = await db.query<{ language_code: string }>(
    "SELECT language_code FROM interpreter_languages WHERE person_id = $1",
    [personId],
  );
  return rows.rows.map((r) => r.language_code);
}
