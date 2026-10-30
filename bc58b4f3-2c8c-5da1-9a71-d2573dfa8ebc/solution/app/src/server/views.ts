// Role visibility and the four assignment views (offer, holder, organisation, staff).
import { toAgencyIso } from "../shared/time.js";
import { DateTime } from "luxon";
import { type Person, initialsOf } from "./auth.js";
import { billingView } from "./charges.js";
import type { Db } from "./db.js";
import { pool } from "./db.js";
import { ApiError } from "./http.js";
import { type AssignmentRecord, type SeatRecord, endOf, interpreterLanguages, loadAssignments } from "./records.js";

type ViewKind = "offer" | "holder" | "organisation" | "staff";

const OFFERED_STATUSES = new Set(["released", "partially_covered", "covered"]);

/** The holder's initials, or null for an open seat. */
export function seatInitials(seat: SeatRecord): string | null {
  return seat.holderName ? initialsOf(seat.holderName) : null;
}

/** Holds or has served a seat on the assignment. */
export function isHolder(record: AssignmentRecord, personId: string): boolean {
  return record.seats.some((s) => s.holderId === personId && s.status !== "open");
}

/**
 * Which view the person gets of the assignment, or null when it is invisible to them (answered as 404,
 * exactly like a number that does not exist).
 */
export function viewFor(person: Person, record: AssignmentRecord, languages: readonly string[]): ViewKind | null {
  switch (person.role) {
    case "dispatcher":
    case "billing_lead":
      return "staff";
    case "scheduler":
    case "org_admin":
      return record.orgCode === person.orgCode ? "organisation" : null;
    case "interpreter":
      if (isHolder(record, person.id)) return "holder";
      return OFFERED_STATUSES.has(record.status) && languages.includes(record.languageCode) ? "offer" : null;
  }
}

/** Load one assignment by number as the person sees it; 404 when unknown or invisible. */
export async function visibleAssignment(
  person: Person,
  number: string,
  db: Db | typeof pool = pool,
  lock = false,
): Promise<{ record: AssignmentRecord; kind: ViewKind }> {
  const [record] = await loadAssignments("a.number = $1", [number], db, lock);
  const languages = person.role === "interpreter" ? await interpreterLanguages(person.id, db) : [];
  const kind = record ? viewFor(person, record, languages) : null;
  if (!record || !kind) throw new ApiError("not_found");
  return { record, kind };
}

function iso(date: Date): string {
  return toAgencyIso(DateTime.fromJSDate(date));
}

export async function present(record: AssignmentRecord, kind: ViewKind, db: Db | typeof pool = pool): Promise<unknown> {
  const offer = {
    number: record.number,
    status: record.status,
    language: record.languageCode,
    setting: record.setting,
    city: record.city,
    start_at: iso(record.startAt),
    end_at: iso(endOf(record)),
    duration_minutes: record.durationMinutes,
  };
  if (kind === "offer") return { ...offer, seats: record.seats.map((s) => ({ seat: s.seat, status: s.status })) };
  const holder = {
    ...offer,
    street_address: record.streetAddress,
    patient_initials: record.patientInitials,
    medical_notes: record.medicalNotes,
    scheduler: { name: record.schedulerName, phone: record.schedulerPhone },
  };
  const seats = record.seats.map((s) => ({ seat: s.seat, status: s.status, interpreter_initials: seatInitials(s) }));
  if (kind === "holder") return { ...holder, seats };
  const decision = record.cancellation;
  const organisation = {
    ...holder,
    seats,
    cancellation: decision
      ? {
          cancelled_at: iso(decision.cancelledAt),
          fee_applies: decision.feeApplies,
          business_minutes_notice: decision.businessMinutesNotice,
          fee_cents: decision.feeCents,
        }
      : null,
    billing: await billingView(record, db),
  };
  if (kind === "organisation") return organisation;
  return {
    ...organisation,
    org: { code: record.orgCode, name: record.orgName },
    seats: seats.map((s, index) => ({ ...s, interpreter_name: record.seats[index]!.holderName })),
  };
}
