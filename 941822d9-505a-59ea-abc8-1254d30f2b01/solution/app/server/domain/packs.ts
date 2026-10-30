import { randomUUID } from "node:crypto";
import { claimRow, db, isUniqueViolation, one, tx, type Db } from "../db.js";
import { config } from "../config.js";
import { conflict, forbidden, notFound, Validation } from "../http/errors.js";
import type { Reply, SignedInCtx } from "../http/router.js";
import { payerAccountId, purchase } from "../services/killbill.js";
import { formatMoney } from "./amounts.js";
import { hasOpenEnrolment } from "./checkout.js";
import { isId, readableCourse } from "./courses.js";
import { enrolmentJson } from "./enrolments.js";
import { idempotencyKey, idempotent } from "./idempotency.js";
import { nudgeOutbox, queueMail } from "./outbox.js";
import { addCalendarMonths } from "./time.js";
import { hospitalOf, type Organisation, type SessionUser } from "./users.js";

// Seat packs and their paired ledger: every movement is two entries that cancel out.

interface PackRow {
  id: string;
  hospital_id: string;
  course_id: string;
  course_title: string;
  course_state: string;
  course_price_cents: number;
  seats_purchased: number;
  price_total_cents: number;
  purchased_at: Date;
  expires_at: Date;
  state: "active" | "expired";
}

const PACK_SELECT = `
  SELECT p.id, p.hospital_id, p.course_id, c.title AS course_title, c.state AS course_state, c.list_price_cents AS course_price_cents, p.seats_purchased,
         p.price_total_cents, p.purchased_at, p.expires_at, p.state
    FROM seat_packs p JOIN courses c ON c.id = p.course_id`;

type Movement = "purchase" | "assignment" | "return" | "expiry";

/** Posts one ledger movement: two entries whose seats add up to zero. */
async function postMovement(t: Db, packId: string, kind: Movement, entries: [string, number][], assignmentId: string | null, at: Date): Promise<void> {
  const movementId = randomUUID();
  for (const [account, seats] of entries) {
    await t.q("INSERT INTO ledger_entries (movement_id, pack_id, kind, account, seats, assignment_id, posted_at) VALUES ($1, $2, $3, $4, $5, $6, $7)", [
      movementId,
      packId,
      kind,
      account,
      seats,
      assignmentId,
      at,
    ]);
  }
}

/** Pack balances: the sum of each pack's pack-account entries, computed from the ledger. */
async function packBalances(t: Db, packIds: readonly string[]): Promise<Map<string, number>> {
  const rows = await t.q<{ pack_id: string; balance: number }>(
    "SELECT pack_id, sum(seats) AS balance FROM ledger_entries WHERE pack_id = ANY($1::uuid[]) AND account = 'pack' GROUP BY pack_id",
    [packIds],
  );
  return new Map(rows.map((r) => [r.pack_id, r.balance]));
}

const nurseAccount = (nurseId: string): string => `nurse:${nurseId}`;

/** A pack expires 12 calendar months after purchase, or after CREDWELL_SEAT_EXPIRY_SECONDS when set. */
const packExpiry = (purchasedAt: Date): Date =>
  config.clock.seatExpirySeconds === null ? addCalendarMonths(purchasedAt, 12) : new Date(purchasedAt.getTime() + config.clock.seatExpirySeconds * 1000);

/**
 * At or after its expiry instant, the first request touching a pack posts one expiry movement for the remaining
 * balance and marks the pack expired. The pack row is claimed first, so concurrent first touches post one movement.
 */
export async function expireDuePacks(hospitalId: string, at: Date): Promise<void> {
  const due = await db.q<{ id: string }>("SELECT id FROM seat_packs WHERE hospital_id = $1 AND state = 'active' AND expires_at <= $2", [hospitalId, at]);
  for (const { id } of due) {
    await tx(async (t) => {
      await claimRow(t, "seat_packs", id);
      const pack = await one<{ state: string }>(t, "SELECT state FROM seat_packs WHERE id = $1", [id]);
      if (pack?.state !== "active") return;
      const balance = (await packBalances(t, [id])).get(id) ?? 0;
      if (balance > 0) await postMovement(t, id, "expiry", [["pack", -balance], ["expired", balance]], null, at);
      await t.q("UPDATE seat_packs SET state = 'expired' WHERE id = $1", [id]);
    });
  }
}

const packJson = (pack: PackRow, balances: Map<string, number>): Record<string, unknown> => ({
  id: pack.id,
  course_id: pack.course_id,
  course_title: pack.course_title,
  seats_purchased: pack.seats_purchased,
  balance: balances.get(pack.id) ?? 0,
  price_total: formatMoney(pack.price_total_cents),
  purchased_at: pack.purchased_at.toISOString(),
  expires_at: pack.expires_at.toISOString(),
  state: pack.state,
});

/** The coordinator's hospital; only coordinators use the sponsor endpoints. */
export function sponsorHospital(viewer: SessionUser): Organisation {
  const hospital = hospitalOf(viewer);
  if (viewer.role !== "coordinator" || !hospital) throw forbidden();
  return hospital;
}

/** A pack of the coordinator's own hospital; any other id (or caller) answers 404. */
async function ownPack(viewer: SessionUser, id: unknown): Promise<PackRow> {
  const hospital = hospitalOf(viewer);
  const pack = isId(id) ? await one<PackRow>(db, `${PACK_SELECT} WHERE p.id = $1`, [id]) : undefined;
  if (!pack || viewer.role !== "coordinator" || pack.hospital_id !== hospital?.id) throw notFound();
  return pack;
}

export async function listPacks(viewer: SessionUser, at: Date): Promise<Record<string, unknown>[]> {
  const hospital = sponsorHospital(viewer);
  await expireDuePacks(hospital.id, at);
  const packs = await db.q<PackRow>(`${PACK_SELECT} WHERE p.hospital_id = $1 ORDER BY p.purchased_at DESC`, [hospital.id]);
  const balances = await packBalances(db, packs.map((p) => p.id));
  return packs.map((p) => packJson(p, balances));
}

export async function packLedger(viewer: SessionUser, id: unknown, at: Date): Promise<Record<string, unknown>> {
  const pack = await ownPack(viewer, id);
  await expireDuePacks(pack.hospital_id, at);
  const entries = await db.q<{ movement_id: string; kind: Movement; account: string; seats: number; assignment_id: string | null; posted_at: Date }>(
    "SELECT movement_id, kind, account, seats, assignment_id, posted_at FROM ledger_entries WHERE pack_id = $1 ORDER BY id",
    [pack.id],
  );
  return {
    pack_id: pack.id,
    balance: (await packBalances(db, [pack.id])).get(pack.id) ?? 0,
    entries: entries.map((e) => ({ ...e, posted_at: e.posted_at.toISOString() })),
  };
}

const validSeats = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 500;

export async function buyPack(ctx: SignedInCtx): Promise<Reply> {
  const { user: coordinator, body, now } = ctx;
  const course = await readableCourse(db, coordinator, body.course_id);
  const hospital = sponsorHospital(coordinator);
  const key = idempotencyKey(ctx.headers);
  return idempotent(coordinator.id, key, body, now, async () => {
    if (course.state === "withdrawn") throw conflict("course_not_open");
    const v = new Validation(body, ["course_id", "seats"]);
    if (course.format !== "self_paced") v.add("course_id", "Seat packs are sold for self-paced courses only.");
    const seats = body.seats;
    if (!validSeats(seats)) v.add("seats", "Buy from 1 to 500 seats.");
    v.done();
    const count = validSeats(seats) ? seats : 0;
    const packId = randomUUID();
    const totalCents = count * course.list_price_cents;
    const account = await payerAccountId({ externalKey: `credwell-hospital-${hospital.slug}`, name: hospital.name, email: null }, coordinator.id);
    await purchase(account, `pack-${packId}`, totalCents, coordinator.id);
    await tx(async (t) => {
      await t.q(
        `INSERT INTO seat_packs (id, hospital_id, course_id, seats_purchased, price_total_cents, purchased_at, expires_at, state, purchased_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', $8)`,
        [packId, hospital.id, course.id, count, totalCents, now, packExpiry(now), coordinator.id],
      );
      await postMovement(t, packId, "purchase", [["pack", count], ["purchases", -count]], null, now);
    });
    const pack = await one<PackRow>(db, `${PACK_SELECT} WHERE p.id = $1`, [packId]);
    if (!pack) throw notFound();
    return { status: 201, json: { pack: packJson(pack, await packBalances(db, [packId])) } };
  });
}

/** Assigns one seat: a confirmed seat enrolment, a paired assignment movement and the invitation email. */
export async function assignSeat(ctx: SignedInCtx): Promise<Reply> {
  const { user: coordinator, body, now } = ctx;
  const pack = await ownPack(coordinator, ctx.params.id);
  const nurse = isId(body.nurse_id)
    ? await one<{ id: string; email: string; display_name: string }>(
        db,
        "SELECT id, email, display_name FROM users WHERE id = $1 AND role = 'learner' AND organisation_id = $2",
        [body.nurse_id, pack.hospital_id],
      )
    : undefined;
  if (!nurse) throw notFound();
  const hospital = sponsorHospital(coordinator);
  const v = new Validation(body, ["nurse_id"]);
  await expireDuePacks(hospital.id, now);
  const created = await tx(async (t) => {
    await claimRow(t, "seat_packs", pack.id);
    const current = await one<{ state: string }>(t, "SELECT state FROM seat_packs WHERE id = $1", [pack.id]);
    if (pack.course_state === "withdrawn") throw conflict("course_not_open");
    if (current?.state === "expired") throw conflict("pack_expired");
    if (await hasOpenEnrolment(t, nurse.id, pack.course_id)) throw conflict("already_enrolled");
    if (((await packBalances(t, [pack.id])).get(pack.id) ?? 0) <= 0) throw conflict("pack_empty");
    v.done();
    const assignmentId = randomUUID();
    const enrolmentId = randomUUID();
    try {
      await t.q(
        `INSERT INTO enrolments (id, learner_id, course_id, state, funding, funding_hospital_id, assignment_id, list_price_cents,
                                 employer_share_cents, learner_share_cents, enrolled_at)
         VALUES ($1, $2, $3, 'confirmed', 'seat', $4, $5, $6, $6, 0, $7)`,
        [enrolmentId, nurse.id, pack.course_id, pack.hospital_id, assignmentId, pack.course_price_cents, now],
      );
    } catch (error) {
      if (isUniqueViolation(error)) throw conflict("already_enrolled");
      throw error;
    }
    await t.q("INSERT INTO seat_assignments (id, pack_id, nurse_id, enrolment_id, state, assigned_at) VALUES ($1, $2, $3, $4, 'assigned', $5)", [
      assignmentId,
      pack.id,
      nurse.id,
      enrolmentId,
      now,
    ]);
    await postMovement(t, pack.id, "assignment", [["pack", -1], [nurseAccount(nurse.id), 1]], assignmentId, now);
    await queueMail(
      t,
      {
        eventKey: `seat-invitation:${assignmentId}`,
        to: nurse.email,
        subject: `Your Credwell seat: ${pack.course_title}`,
        text: [
          `Hello ${nurse.display_name},`,
          "",
          `${hospital.name} has assigned you a seat in "${pack.course_title}" with Sorrel & Pike Learning.`,
          "Your enrolment is confirmed and you can start whenever you are ready:",
          `${ctx.origin}/courses/${pack.course_id}`,
        ].join("\n"),
      },
      now,
    );
    return { assignmentId, enrolmentId };
  });
  nudgeOutbox();
  return {
    status: 201,
    json: {
      assignment: { id: created.assignmentId, pack_id: pack.id, nurse_id: nurse.id, enrolment_id: created.enrolmentId, state: "assigned" },
      enrolment: await enrolmentJson(db, created.enrolmentId),
    },
  };
}

/** Returns a seat whose nurse has verified nothing: the enrolment is withdrawn and the seat goes back to the pack. */
export async function returnSeat(ctx: SignedInCtx): Promise<Reply> {
  const { user: coordinator, body, now } = ctx;
  const hospital = hospitalOf(coordinator);
  const assignment = isId(ctx.params.id)
    ? await one<{ id: string; pack_id: string; nurse_id: string; enrolment_id: string; hospital_id: string }>(
        db,
        "SELECT a.id, a.pack_id, a.nurse_id, a.enrolment_id, p.hospital_id FROM seat_assignments a JOIN seat_packs p ON p.id = a.pack_id WHERE a.id = $1",
        [ctx.params.id],
      )
    : undefined;
  if (!assignment || coordinator.role !== "coordinator" || assignment.hospital_id !== hospital?.id) throw notFound();
  const v = new Validation(body, []);
  await tx(async (t) => {
    await claimRow(t, "seat_packs", assignment.pack_id);
    const current = await one<{ state: string; enrolment_state: string; verified: number }>(
      t,
      `SELECT a.state, e.state AS enrolment_state, (SELECT count(*) FROM module_verifications v WHERE v.enrolment_id = e.id) AS verified
         FROM seat_assignments a JOIN enrolments e ON e.id = a.enrolment_id WHERE a.id = $1`,
      [assignment.id],
    );
    if (current?.state === "returned") throw conflict("already_returned");
    if (current?.enrolment_state !== "confirmed" || current.verified > 0) throw conflict("seat_in_use");
    v.done();
    await t.q("UPDATE seat_assignments SET state = 'returned', returned_at = $2 WHERE id = $1", [assignment.id, now]);
    await t.q("UPDATE enrolments SET state = 'withdrawn' WHERE id = $1", [assignment.enrolment_id]);
    await postMovement(t, assignment.pack_id, "return", [["pack", 1], [nurseAccount(assignment.nurse_id), -1]], assignment.id, now);
  });
  return {
    status: 200,
    json: {
      assignment: { id: assignment.id, pack_id: assignment.pack_id, nurse_id: assignment.nurse_id, enrolment_id: assignment.enrolment_id, state: "returned" },
      enrolment: await enrolmentJson(db, assignment.enrolment_id),
    },
  };
}
