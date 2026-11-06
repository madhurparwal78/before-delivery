// Renters: applications, the renter record, operator transitions, document review and adjustments.

import { randomUUID } from "node:crypto";
import type { BookingStatus, DocumentView, RenterStatus, RenterSummary, UserView } from "../../shared/api.js";
import { iso, kitchenToday, now } from "../clock.js";
import { type Db, type Tx, isUniqueViolation, only, pool, rows, transaction } from "../db.js";
import type { JsonObject } from "../http/body.js";
import { FieldErrors, fail, invalid } from "../http/errors.js";
import { callerByUserId, startSession, userView } from "../http/session.js";
import { hashPassword } from "../passwords.js";
import { coiAndCardCurrent, complianceOf, readyForActivation } from "./compliance.js";
import { type ReviewDecision, decideDocument, documentView, documentsOf } from "./documents.js";
import { effectiveStatus } from "./bookings.js";
import { balancesOf, lockRenterHours, recordMovement } from "./ledger.js";
import { RENTER_STATUSES, assertOperatorTransition, changeRenterStatus } from "./renterStatus.js";

export interface RenterRow {
  id: string;
  business_name: string;
  contact_name: string;
  email: string;
  phone: string;
  status: RenterStatus;
  created_at: Date;
}

export function renterRow(db: Db, renterId: string): Promise<RenterRow> {
  return only<RenterRow>(db, "SELECT * FROM renters WHERE id = $1", [renterId]);
}

export async function renterSummary(db: Db, renter: RenterRow): Promise<RenterSummary> {
  return {
    id: renter.id,
    business_name: renter.business_name,
    contact_name: renter.contact_name,
    email: renter.email,
    phone: renter.phone,
    status: renter.status,
    ...(await balancesOf(db, renter.id)),
    compliance: complianceOf(await documentsOf(db, renter.id), kitchenToday()),
  };
}

export async function listRenters(): Promise<RenterSummary[]> {
  const renters = await rows<RenterRow>(pool, "SELECT * FROM renters ORDER BY business_name");
  return Promise.all(renters.map((renter) => renterSummary(pool, renter)));
}

function text(body: JsonObject, field: string): string {
  const value = body[field];
  return typeof value === "string" ? value.trim() : "";
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Application {
  status: 201;
  body: { user: UserView; renter: { id: string; status: "applied" } };
  cookie: string;
}

export async function apply(body: JsonObject): Promise<Application> {
  const businessName = text(body, "business_name");
  const contactName = text(body, "contact_name");
  const email = text(body, "email").toLowerCase();
  const phone = text(body, "phone");
  const password = typeof body.password === "string" ? body.password : "";
  const errors = new FieldErrors();
  if (businessName.length < 1 || businessName.length > 120) errors.add("business_name", "Enter your business name (up to 120 characters).");
  if (contactName.length < 1 || contactName.length > 120) errors.add("contact_name", "Enter your name (up to 120 characters).");
  if (!EMAIL.test(email) || email.length > 254) errors.add("email", "Enter an email address like name@example.com.");
  if (phone.length < 7 || phone.length > 30 || !/^[0-9+().\-\s]+$/.test(phone)) errors.add("phone", "Enter a phone number of 7 to 30 digits or symbols.");
  if (password.length < 10 || password.length > 200) errors.add("password", "Use a password of 10 to 200 characters.");
  errors.throwIfAny();
  const passwordHash = await hashPassword(password);
  try {
    return await transaction(async (tx) => {
      const renterId = randomUUID();
      const userId = randomUUID();
      await tx.query(
        "INSERT INTO renters (id, business_name, contact_name, email, phone, status, created_at) VALUES ($1, $2, $3, $4, $5, 'applied', $6)",
        [renterId, businessName, contactName, email, phone, iso(now())],
      );
      await tx.query("INSERT INTO users (id, email, name, role, password_hash, renter_id) VALUES ($1, $2, $3, 'renter', $4, $5)", [
        userId,
        email,
        contactName,
        passwordHash,
        renterId,
      ]);
      const cookie = await startSession(tx, userId);
      return {
        status: 201 as const,
        body: { user: userView(await callerByUserId(tx, userId)), renter: { id: renterId, status: "applied" as const } },
        cookie,
      };
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw invalid({ email: "That email already has an account." });
    throw error;
  }
}

/** A live hold or a confirmed booking that starts in the future keeps a renter from being offboarded. */
async function hasFutureBookings(tx: Tx, renterId: string): Promise<boolean> {
  const at = now();
  const future = await rows<{ status: BookingStatus; hold_expires_at: Date }>(
    tx,
    "SELECT status, hold_expires_at FROM bookings WHERE renter_id = $1 AND starts_at > $2 AND status IN ('hold', 'confirmed')",
    [renterId, iso(at)],
  );
  return future.some((booking) => effectiveStatus(booking, at) !== "expired");
}

export async function transitionRenter(renterId: string, body: JsonObject): Promise<RenterSummary> {
  const to = RENTER_STATUSES.find((status) => status === body.to);
  return transaction(async (tx) => {
    const renter = await only<RenterRow>(tx, "SELECT * FROM renters WHERE id = $1 FOR UPDATE", [renterId]);
    if (!to) throw invalid({ to: "Choose active or offboarded." });
    assertOperatorTransition(renter.status, to);
    const documents = await documentsOf(tx, renterId);
    const today = kitchenToday();
    if (to === "active") {
      const ready = renter.status === "suspended" ? coiAndCardCurrent(documents, today) : readyForActivation(documents, today);
      if (!ready) throw fail(409, "documents_incomplete");
    }
    if (to === "offboarded" && (await hasFutureBookings(tx, renterId))) throw fail(409, "has_future_bookings");
    await changeRenterStatus(tx, renterId, renter.status, to);
    return renterSummary(tx, await renterRow(tx, renterId));
  });
}

export async function reviewDocument(documentId: string, body: JsonObject): Promise<{ document: DocumentView; renter: RenterSummary }> {
  const decision: ReviewDecision | null = body.decision === "approve" || body.decision === "reject" ? body.decision : null;
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) || null : null;
  if (!decision) throw invalid({ decision: "Choose approve or reject." });
  return transaction(async (tx) => {
    const document = await decideDocument(tx, documentId, decision, note);
    const renter = await only<RenterRow>(tx, "SELECT * FROM renters WHERE id = $1 FOR UPDATE", [document.renter_id]);
    if (decision === "approve" && renter.status === "suspended" && coiAndCardCurrent(await documentsOf(tx, renter.id), kitchenToday())) {
      await changeRenterStatus(tx, renter.id, "suspended", "active");
    }
    return { document: documentView(document), renter: await renterSummary(tx, await renterRow(tx, renter.id)) };
  });
}

const ADJUSTMENT_LIMIT = 24_000;

export async function recordAdjustment(renterId: string, body: JsonObject): Promise<{ movement_id: string; balance_minutes: number }> {
  const minutes = body.minutes;
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  const errors = new FieldErrors();
  if (typeof minutes !== "number" || !Number.isInteger(minutes) || minutes === 0 || minutes % 15 !== 0 || Math.abs(minutes) > ADJUSTMENT_LIMIT) {
    errors.add("minutes", "Enter a non-zero multiple of 15 minutes between −24000 and 24000.");
  }
  if (reason.length < 1 || reason.length > 200) errors.add("reason", "Give a reason of up to 200 characters.");
  if (typeof minutes !== "number" || !errors.empty) throw errors.error();
  return transaction(async (tx) => {
    await lockRenterHours(tx, renterId);
    const movementId = await recordMovement(tx, renterId, "adjustment", minutes, { note: reason });
    return { movement_id: movementId, balance_minutes: (await balancesOf(tx, renterId)).balance_minutes };
  });
}
