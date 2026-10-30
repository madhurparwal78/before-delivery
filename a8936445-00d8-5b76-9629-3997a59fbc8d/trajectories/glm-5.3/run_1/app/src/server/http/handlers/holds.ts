/** Holds: placement (with weekly repeats), release, expiry and confirmation. */

import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import {
  addDays,
  isValidKitchenDate,
  isValidLocalTime,
  wallMinutes
} from "../../../shared/kitchen-time.js";
import type { KitchenDate, LocalTime } from "../../../shared/kitchen-time.js";
import { minutesAtHourlyRate } from "../../../shared/money.js";
import type { Booking } from "../../../shared/api-types.js";
import { Db, uuid, writeLedgerMovement } from "../../db.js";
import {
  CLEANING_MINUTES,
  isFree,
  loadDayBookings,
  toMinuteBlocks,
  type BookingRow
} from "../../domain/bookings.js";
import {
  REQUIRED_KINDS,
  loadTenantDetail,
  requiredDocuments,
  loadTenantDocuments,
  resolveTenantStatuses
} from "../../domain/tenants.js";
import { UnitOfWorkRunner } from "../../domain/unit-of-work.js";
import { bookingConfirmationEmail } from "../../email.js";
import { err, notFound, validation } from "../errors.js";
import type { App, RouteContext } from "../server.js";
import { int, json, noContent, readJson, requireIdempotencyKey, requireUser, str } from "./helpers.js";
import { bookingJson } from "./booking-json.js";

const MIN_LENGTH_MINUTES = 60;
const MAX_LENGTH_MINUTES = 480;
const MAX_AHEAD_DAYS = 365;
const STEP_MINUTES = 15;

interface OccurrencePlan {
  date: KitchenDate;
  startLocal: LocalTime;
  endLocal: LocalTime;
  start: number;
  end: number;
  elapsedMinutes: number;
}

export function registerHoldRoutes(
  app: App,
  uow: UnitOfWorkRunner,
  holdTtlSeconds: number
): void {
  app.route("POST", "/api/holds", "signed_in", async (rc) => {
    const user = await requireUser(rc);
    const body = await readJson(rc.ctx);
    const clock = rc.db.clock;
    const today = clock.today();

    const stationId = str(body["station_id"]) ?? "";
    const date = str(body["date"]) ?? "";
    const startLocal = str(body["start_local"]) ?? "";
    const endLocal = str(body["end_local"]) ?? "";
    const weeks = body["weeks"] === undefined ? 1 : int(body["weeks"]);
    if (weeks === undefined || weeks < 1 || weeks > 12) {
      throw validation({ weeks: "Repeat weekly from 1 to 12 weeks." });
    }
    const weeksCount = weeks;
    const notes = str(body["notes"]) ?? "";
    const tenantIdFromUser = user.tenant_id;
    const tenantIdFromOperator = str(body["tenant_id"]);

    let tenantId: string;
    if (user.role === "operator") {
      if (tenantIdFromOperator === undefined) {
        throw validation({ tenant_id: "Choose the tenant this hold is for." });
      }
      tenantId = tenantIdFromOperator;
    } else {
      if (tenantIdFromOperator !== undefined) {
        throw validation({ tenant_id: "Your business is chosen by your account." });
      }
      tenantId = tenantIdFromUser as string;
    }

    const details: Record<string, string> = {};
    if (!isValidKitchenDate(date)) details["date"] = "Give the kitchen date to hold.";
    if (!isValidLocalTime(startLocal)) details["start_local"] = "Start must be on a quarter hour.";
    if (!isValidLocalTime(endLocal)) details["end_local"] = "End must be on a quarter hour or 24:00.";
    if (Object.keys(details).length === 0 && wallMinutes(startLocal, endLocal) <= 0) {
      details["end_local"] = "End must be after start on the same day.";
    }
    if (Object.keys(details).length === 0) {
      const length = wallMinutes(startLocal, endLocal);
      if (length < MIN_LENGTH_MINUTES || length > MAX_LENGTH_MINUTES) {
        details["end_local"] = "A hold lasts from 1 to 8 hours.";
      }
    }
    if (notes.length > 500) {
      details["notes"] = "Notes are at most 500 characters.";
    }
    if (Object.keys(details).length > 0) {
      throw validation(details);
    }

    if (clock.daysBetween(today, date) > MAX_AHEAD_DAYS) {
      throw validation({ date: "The kitchen books at most 365 days ahead." });
    }

    // The first occurrence may not start before the current 15-minute step of kitchen today.
    const currentStepStart = clock.minuteOfDayNow();
    const stepFloor = currentStepStart - (currentStepStart % STEP_MINUTES);
    const todayStepInstant = clock.localToInstant(today, clock.localTimeOfMinute(stepFloor));
    if (todayStepInstant !== null && clock.localToInstant(date, startLocal)! < todayStepInstant) {
      throw validation({ start_local: "The first occurrence may not start in the past." });
    }

    // Resolve each occurrence's instants; skipped local times on a spring-forward day are refused.
    const occurrences: OccurrencePlan[] = [];
    const dstDetails: Record<string, string> = {};
    for (let k = 0; k < weeksCount; k++) {
      const occDate = addDays(date, 7 * k);
      const start = clock.localToInstant(occDate, startLocal);
      const end = clock.localToInstant(occDate, endLocal);
      if (start === null) {
        dstDetails["start_local"] = `${startLocal} does not exist on ${occDate}.`;
        break;
      }
      if (end === null) {
        dstDetails["end_local"] = `${endLocal} does not exist on ${occDate}.`;
        break;
      }
      occurrences.push({
        date: occDate,
        startLocal,
        endLocal,
        start,
        end,
        elapsedMinutes: Math.round((end - start) / 60_000)
      });
    }
    if (Object.keys(dstDetails).length > 0) {
      throw validation(dstDetails);
    }

    const tenantRows = await rc.db.query<{ id: string; business_name: string; status: string; owner_email: string }>(
      "SELECT id, business_name, status, owner_email FROM tenants WHERE id = $1",
      [tenantId]
    );
    if (tenantRows.length === 0 || (user.role !== "operator" && tenantRows[0].id !== tenantId)) {
      throw notFound();
    }
    const tenant = tenantRows[0];
    if (tenant.status !== "active") {
      throw err(409, "tenant_not_active", "Your business can't book right now. Check Documents.");
    }

    // Document validity: every occurrence must end no later than each required kind's edge.
    const docs = await loadTenantDocuments(rc.db, tenantId);
    const required = requiredDocuments(docs, today);
    const blockedKinds: string[] = [];
    const blockedDates: string[] = [];
    for (const kind of REQUIRED_KINDS) {
      const edge = required[kind].expires_on;
      if (edge === null) {
        blockedKinds.push(kind);
        blockedDates.push(occurrences.map((o) => o.date).join(", "));
        continue;
      }
      const edgeInstant = clock.localToInstant(addDays(edge, 1), "00:00")!;
      const firstEnding = occurrences.filter((o) => o.end > edgeInstant);
      if (firstEnding.length > 0) {
        blockedKinds.push(kind);
        blockedDates.push(...firstEnding.map((o) => o.date));
      }
    }
    if (blockedKinds.length > 0) {
      throw err(409, "document_expires_before_booking", "A required document expires before this booking.", {
        kinds: blockedKinds,
        dates: blockedDates
      });
    }

    const stationRows = await rc.db.query<{ id: string; name: string; kind: string; hourly_rate_cents: number }>(
      "SELECT id, name, kind, hourly_rate_cents FROM stations WHERE id = $1",
      [stationId]
    );
    if (stationRows.length === 0) {
      throw validation({ station_id: "Choose a station." });
    }

    // Slot freedom is decided one claim at a time per station.
    const conflictDates = await rc.db.withTransaction(async (client) => {
      await rc.db.advisoryXactLock(client, `station-${stationId}`);
      const takenDates: string[] = [];
      for (const occ of occurrences) {
        const rows = (await client.query(
          `SELECT b.*, h.expires_at AS hold_expires_at FROM bookings b
           JOIN holds h ON h.ref = b.hold_ref
           WHERE b.station_id = $1 AND b.date = $2::date AND b.status = ANY($3::text[])
             AND (b.status <> 'held' OR h.expires_at > now())`,
          [stationId, occ.date, ["held", "confirmed", "checked_in", "completed"]]
        )) as unknown as { rows: Array<{ tenant_id: string; start_local: LocalTime; end_local: LocalTime }> };
        const blocks = rows.rows.map((r) => ({
          tenantId: r.tenant_id,
          start: clock.minuteOfDay(r.start_local),
          end: clock.minuteOfDay(r.end_local)
        }));
        const candidate = {
          tenantId,
          start: clock.minuteOfDay(occ.startLocal),
          end: clock.minuteOfDay(occ.endLocal)
        };
        if (!isFree(candidate, blocks)) {
          takenDates.push(occ.date);
        }
      }
      return takenDates;
    });
    if (conflictDates.length > 0) {
      throw err(409, "slot_taken", "The station isn't free for that whole time.", {
        dates: conflictDates
      });
    }

    // Place the hold and its held bookings, assigning the next hold ref.
    const placed = await rc.db.withTransaction(async (client) => {
      const seq = await client.query<{ value: string }>(
        "SELECT value FROM seed_state WHERE id = 'hold_ref_sequence' FOR UPDATE"
      );
      const nextRef = Number(seq.rows[0].value) + 1;
      await client.query("UPDATE seed_state SET value = $1 WHERE id = 'hold_ref_sequence'", [
        String(nextRef)
      ]);
      const ref = `SK-${nextRef}`;
      const expiresAt = new Date(Date.now() + holdTtlSeconds * 1000);
      await client.query(
        `INSERT INTO holds (ref, tenant_id, station_id, weeks, expires_at, created_at)
         VALUES ($1,$2,$3,$4,$5, now())`,
        [ref, tenantId, stationId, weeksCount, expiresAt]
      );
      const created: BookingRow[] = [];
      for (let i = 0; i < occurrences.length; i++) {
        const occ = occurrences[i];
        const id = uuid();
        const bookingRef = `${ref}-${i + 1}`;
        await client.query(
          `INSERT INTO bookings
           (id, ref, hold_ref, tenant_id, station_id, date, start_local, end_local, start, "end",
            elapsed_minutes, status, pay_with, amount_cents, policy_version, notes, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'held',NULL,NULL,NULL,$12, now())`,
          [
            id,
            bookingRef,
            ref,
            tenantId,
            stationId,
            occ.date,
            occ.startLocal,
            occ.endLocal,
            new Date(occ.start).toISOString(),
            new Date(occ.end).toISOString(),
            occ.elapsedMinutes,
            notes
          ]
        );
        created.push({
          id,
          ref: bookingRef,
          hold_ref: ref,
          tenant_id: tenantId,
          station_id: stationId,
          date: occ.date,
          start_local: occ.startLocal,
          end_local: occ.endLocal,
          start: new Date(occ.start),
          end: new Date(occ.end),
          elapsed_minutes: occ.elapsedMinutes,
          status: "held",
          pay_with: null,
          amount_cents: null,
          policy_version: null,
          notes,
          checked_in_at: null,
          checked_out_at: null,
          holdover_reported_minutes: null,
          holdover_billed_minutes: null,
          holdover_cents: null,
          cancelled_at: null,
          cancelled_late: null,
          fee_cents: 0,
          fee_minutes: 0,
          fee_refunded: false,
          created_at: new Date()
        } as BookingRow);
      }
      await client.query(
        "INSERT INTO audit_log (id, at, actor_user_id, action, entity, entity_id, detail) VALUES ($1, now(), $2, 'place_hold', 'hold', $3, $4)",
        [uuid(), user.id, ref, JSON.stringify({ station_id: stationId, weeks: weeksCount, dates: occurrences.map((o) => o.date) })]
      );
      return { ref, expiresAt, created };
    });

    const bookings = placed.created.map((row) => bookingJson(row, clock, user.role === "operator"));
    return json(201, {
      ref: placed.ref,
      tenant_id: tenantId,
      station_id: stationId,
      weeks: weeksCount,
      expires_at: clock.isoOf(placed.expiresAt.getTime()),
      bookings
    });
  });

  app.route("GET", "/api/holds/:ref", "signed_in", async (rc) => {
    const user = await requireUser(rc);
    const hold = await loadLiveHold(rc, user, rc.ctx.params["ref"] ?? "");
    const bookings = await loadHoldBookings(rc.db, hold.ref);
    const clock = rc.db.clock;
    return json(200, {
      ref: hold.ref,
      tenant_id: hold.tenant_id,
      station_id: hold.station_id,
      weeks: hold.weeks,
      expires_at: clock.isoOf(hold.expires_at.getTime()),
      bookings: bookings.map((row) => bookingJson(row, clock, user.role === "operator"))
    });
  });

  app.route("DELETE", "/api/holds/:ref", "signed_in", async (rc) => {
    const user = await requireUser(rc);
    const ref = rc.ctx.params["ref"] ?? "";
    const hold = await loadLiveHold(rc, user, ref);
    await rc.db.query("DELETE FROM bookings WHERE hold_ref = $1 AND status = 'held'", [hold.ref]);
    await rc.db.query("DELETE FROM holds WHERE ref = $1", [hold.ref]);
    await rc.db.audit(user.id, "release_hold", "hold", hold.ref, {});
    return noContent();
  });

  app.route("POST", "/api/holds/:ref/confirm", "signed_in", async (rc) => {
    const user = await requireUser(rc);
    requireIdempotencyKey(rc.ctx);
    const body = await readJson(rc.ctx);
    const payWith = str(body["pay_with"]);
    if (payWith !== "account" && payWith !== "hour_pack") {
      throw validation({ pay_with: "Choose Account or Hour pack." });
    }
    const ref = rc.ctx.params["ref"] ?? "";
    await confirmHold(rc, uow, user, ref, payWith);
    const clock = rc.db.clock;
    const bookings = await loadHoldBookings(rc.db, ref);
    return json(200, {
      ref,
      bookings: bookings.map((row) => bookingJson(row, clock, user.role === "operator"))
    });
  });
}

export interface LiveHold {
  ref: string;
  tenant_id: string;
  station_id: string;
  weeks: number;
  expires_at: Date;
}

/** A live hold for this viewer: unknown, expired, consumed or another tenant's hold is a 404. */
export async function loadLiveHold(
  rc: RouteContext,
  user: { role: string; tenant_id: string | null },
  ref: string
): Promise<LiveHold> {
  const rows = await rc.db.query<LiveHold>(
    "SELECT ref, tenant_id, station_id, weeks, expires_at FROM holds WHERE ref = $1",
    [ref]
  );
  if (rows.length === 0) {
    throw notFound();
  }
  if (user.role !== "operator" && rows[0].tenant_id !== user.tenant_id) {
    throw notFound();
  }
  if (rows[0].expires_at.getTime() <= Date.now()) {
    throw notFound();
  }
  // A confirmed hold is no longer live.
  const consumed = await rc.db.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM bookings WHERE hold_ref = $1 AND status <> 'held'",
    [ref]
  );
  if (Number(consumed[0].count) > 0) {
    throw notFound();
  }
  return rows[0];
}

export async function loadHoldBookings(db: Db, ref: string): Promise<Array<BookingRow & { tenant_name?: string; contact_email?: string; free_window_hours?: number; late_fee_percent?: number }>> {
  return db.query<BookingRow>(
    `SELECT b.id, b.ref, b.hold_ref, b.tenant_id, b.station_id, b.date::text AS date, b.start_local, b.end_local,
            b.start, b."end", b.elapsed_minutes, b.status, b.pay_with, b.amount_cents, b.policy_version, b.notes,
            b.checked_in_at, b.checked_out_at, b.holdover_reported_minutes, b.holdover_billed_minutes, b.holdover_cents,
            b.cancelled_at, b.cancelled_late, b.fee_cents, b.fee_minutes, b.fee_refunded, b.created_at,
            pv.free_window_hours, pv.late_fee_percent
     FROM bookings b LEFT JOIN policy_versions pv ON pv.version = b.policy_version
     WHERE b.hold_ref = $1 ORDER BY b.start`,
    [ref]
  );
}

interface PolicyVersionRow {
  version: number;
  free_window_hours: number;
  late_fee_percent: number;
}

/**
 * Confirm a live hold: checks in the fixed order, then one unit of work covering the
 * bookings, their Kill Bill charges and the confirmation email.
 */
async function confirmHold(
  rc: RouteContext,
  uow: UnitOfWorkRunner,
  user: { id: string; role: string; tenant_id: string | null },
  ref: string,
  payWith: "account" | "hour_pack"
): Promise<void> {
  const db = rc.db;
  const clock = db.clock;
  const rows = await db.query<LiveHold & { business_name: string; owner_email: string }>(
    `SELECT h.ref, h.tenant_id, h.station_id, h.weeks, h.expires_at, t.business_name, t.owner_email
     FROM holds h JOIN tenants t ON t.id = h.tenant_id WHERE h.ref = $1`,
    [ref]
  );
  if (rows.length === 0 || (user.role !== "operator" && rows[0].tenant_id !== user.tenant_id)) {
    throw notFound();
  }
  const hold = rows[0];
  const now = Date.now();
  if (hold.expires_at.getTime() <= now) {
    throw err(410, "hold_expired", "This hold expired. Place it again if the time is still free.");
  }

  const tenantRows = await db.query<{ status: string }>("SELECT status FROM tenants WHERE id = $1", [
    hold.tenant_id
  ]);
  if (tenantRows.length === 0 || tenantRows[0].status !== "active") {
    throw err(409, "tenant_not_active", "Your business can't book right now. Check Documents.");
  }

  const bookings = await loadHoldBookings(db, ref);
  const stationRows = await db.query<{ hourly_rate_cents: number; name: string }>(
    "SELECT hourly_rate_cents, name FROM stations WHERE id = $1",
    [hold.station_id]
  );
  const hourlyRate = stationRows[0].hourly_rate_cents;
  const stationName = stationRows[0].name;

  // Document expiry is checked again at confirmation.
  const docs = await loadTenantDocuments(db, hold.tenant_id);
  const required = requiredDocuments(docs, clock.today());
  const blockedKinds: string[] = [];
  const blockedDates: string[] = [];
  for (const kind of REQUIRED_KINDS) {
    const edge = required[kind].expires_on;
    if (edge === null) {
      blockedKinds.push(kind);
      blockedDates.push(bookings.map((b) => b.date).join(", "));
      continue;
    }
    const edgeInstant = clock.localToInstant(addDays(edge, 1), "00:00")!;
    const firstEnding = bookings.filter((b) => b.end.getTime() > edgeInstant);
    if (firstEnding.length > 0) {
      blockedKinds.push(kind);
      blockedDates.push(...firstEnding.map((b) => b.date));
    }
  }
  if (blockedKinds.length > 0) {
    throw err(409, "document_expires_before_booking", "A required document expires before this booking.", {
      kinds: blockedKinds,
      dates: blockedDates
    });
  }

  if (bookings.some((b) => b.status !== "held")) {
    throw err(409, "invalid_transition", "This hold is already confirmed.");
  }

  const policyRows = await db.query<PolicyVersionRow>(
    "SELECT version, free_window_hours, late_fee_percent FROM policy_versions ORDER BY version DESC LIMIT 1"
  );
  const policy = policyRows[0];

  const totalElapsed = bookings.reduce((sum, b) => sum + b.elapsed_minutes, 0);
  const balanceRows = await db.query<{ balance: string }>(
    "SELECT coalesce(sum(minutes),0)::text AS balance FROM hour_ledger_entries WHERE tenant_id = $1 AND account = 'tenant_pack'",
    [hold.tenant_id]
  );
  const balance = Number(balanceRows[0].balance);
  if (payWith === "hour_pack" && totalElapsed > balance) {
    throw err(409, "insufficient_hours", "Your hour pack doesn't have enough hours for this booking.", {
      needed_minutes: totalElapsed,
      balance_minutes: balance
    });
  }

  await resolveTenantStatuses(db);

  // Confirming with the hour pack draws on one tenant's balance; claims are decided one at a time.
  const amountCentsByBooking = new Map<string, number>();
  for (const b of bookings) {
    amountCentsByBooking.set(b.id, minutesAtHourlyRate(b.elapsed_minutes, hourlyRate));
  }

  await uow.run({
    write: async (client) => {
      await db.advisoryXactLock(client, `hours-${hold.tenant_id}`);
      if (payWith === "hour_pack") {
        const fresh = await client.query<{ balance: string }>(
          "SELECT coalesce(sum(minutes),0)::text AS balance FROM hour_ledger_entries WHERE tenant_id = $1 AND account = 'tenant_pack'",
          [hold.tenant_id]
        );
        if (totalElapsed > Number(fresh.rows[0].balance)) {
          throw err(409, "insufficient_hours", "Your hour pack doesn't have enough hours for this booking.", {
            needed_minutes: totalElapsed,
            balance_minutes: Number(fresh.rows[0].balance)
          });
        }
      }
      for (const b of bookings) {
        await client.query(
          `UPDATE bookings SET status = 'confirmed', pay_with = $1, amount_cents = $2,
                 policy_version = $3 WHERE id = $4 AND status = 'held'`,
          [payWith, payWith === "account" ? amountCentsByBooking.get(b.id) : null, policy.version, b.id]
        );
        if (payWith === "hour_pack") {
          await writeLedgerMovement(
            client,
            randomUUID(),
            hold.tenant_id,
            -b.elapsed_minutes,
            "booking",
            b.id
          );
        }
      }
    },
    killBill:
      payWith === "account"
        ? bookings.map((b) => ({
            tenantId: hold.tenant_id,
            businessName: hold.business_name,
            kind: "charge" as const,
            charge: {
              kind: "charge" as const,
              description: `Station time ${b.ref}`,
              amountCents: amountCentsByBooking.get(b.id) ?? 0
            }
          }))
        : undefined,
    syncEmail: bookingConfirmationEmail(
      hold.owner_email,
      ref,
      bookings.map((b) => ({
        ref: b.ref,
        stationName,
        date: b.date,
        startLocal: b.start_local,
        endLocal: b.end_local,
        payment: payWith === "account" ? "account" : "hour pack"
      })),
      {
        version: policy.version,
        free_window_hours: policy.free_window_hours,
        late_fee_percent: policy.late_fee_percent
      }
    )
  });
  await db.audit(user.id, "confirm_hold", "hold", ref, { pay_with: payWith });
}
