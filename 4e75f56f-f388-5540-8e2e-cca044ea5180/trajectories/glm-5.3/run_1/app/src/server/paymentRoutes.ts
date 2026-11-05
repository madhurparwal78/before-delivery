import { Router } from "express";
import type { Config } from "./config.js";
import { PRICES } from "./config.js";
import { query, withTransaction, withLedgerLock } from "./db.js";
import { requireAccount, type Account } from "./auth.js";
import { conflict, err, validation } from "./errors.js";
import { fetchReservation, fetchReservationClient, reservationWithDocs, offerBenchToWaitlist, countAtelierActiveClient } from "./reservations.js";
import { idempotentWrap, validIdempotencyKey, chargeSeat, chargeGroup, finishSeatReceipt, finishGroupInvoice, type PaymentContext, type BuyerRef, type GroupSeat } from "./payments.js";
import { finishUpgrade } from "./upgradeFinish.js";
import { venueDate, depositsOpen } from "./time.js";
import { tierName } from "./format.js";
import { ATELIER_CAP } from "./config.js";

type Buyer = Account & { email: string };

async function buyerRef(account: Account): Promise<BuyerRef> {
  return { id: account.id, name: account.clinic_name ?? account.name, email: account.email };
}

function requireIdempotencyKey(req: { headers: Record<string, unknown> }): string {
  const key = req.headers["idempotency-key"];
  if (!validIdempotencyKey(key)) {
    throw validation({ idempotency_key: "Send an Idempotency-Key of 8 to 128 letters, digits, - or _." });
  }
  return key as string;
}

function billingNameOf(body: unknown): { billingName: string } {
  const name = (body as { billing_name?: unknown } | undefined)?.billing_name;
  if (typeof name !== "string" || name.length < 1 || name.length > 120) {
    throw validation({ billing_name: "Enter a name of 1 to 120 characters for the receipt." });
  }
  return { billingName: name };
}

/**
 * A payment request received before expires_at keeps the hold from being
 * released while the request runs.
 */
async function markInFlight(reservationId: string, pending: string): Promise<void> {
  await query("UPDATE reservations SET payment_in_flight = TRUE, payment_pending = $2 WHERE id = $1 AND payment_pending IS NULL", [reservationId, pending]);
}

async function clearInFlight(reservationId: string, kind?: string): Promise<void> {
  if (kind) {
    await query(
      "UPDATE reservations SET payment_in_flight = FALSE, payment_pending = NULL WHERE id = $1 AND payment_pending = $2 AND state = 'held'",
      [reservationId, kind]
    );
    return;
  }
  await query("UPDATE reservations SET payment_in_flight = FALSE WHERE id = $1", [reservationId]);
}

export function makePaymentsRouter(cfg: Config, ctx: PaymentContext): Router {
  const router = Router();

  const seatPayment = (
    kind: "deposit" | "full" | "balance",
    stateCheck: (r: { state: string; tier: string; paid_cents: number; price_cents: number; hold_expires_at: Date | null; payment_in_flight: boolean; payment_pending: string | null }) => { ok: true; amountCents: number } | { ok: false; code: string; message: string }
  ) => {
    return async (req: import("express").Request, res: import("express").Response, next: (e: unknown) => void) => {
      try {
        const account = await requireAccount(req);
        if (account.role !== "practitioner" && account.role !== "clinic") {
          res.status(403).json({ error: "forbidden", message: "You may not do that." });
          return;
        }
        const key = requireIdempotencyKey(req);
        const { billingName } = billingNameOf(req.body);
        const { id } = req.params;
        const buyer = await buyerRef(account);
        const endpoint = `POST /api/reservations/${id}/${kind}`;
        const body = { billing_name: billingName };

        const outcome = await idempotentWrap(account.id, key, endpoint, body, async () => {
          const r = await fetchReservation(id!);
          if (!r || r.buyer_id !== account.id) throw err(404, "not_found", "Nothing here.");
          const check = stateCheck(r);
          if (!check.ok) {
            if (check.code === "deposits_closed" || check.code === "hold_expired" || check.code === "already_paid" || check.code === "not_deposit_paid") {
              throw conflict(check.code, check.message);
            }
            throw conflict(check.code, check.message);
          }
          const wasHeld = r.state === "held";
          if (wasHeld) await markInFlight(r.id, kind);
          let reservationJson: Record<string, unknown> | null = null;
          try {
            await chargeSeat(
              ctx,
              buyer,
              { id: r.id, bench: r.bench, tier: r.tier },
              kind,
              check.amountCents,
              `Bench ${r.bench} ${tierName(r.tier)} ${kind === "deposit" ? "deposit" : kind === "full" ? "full price" : "balance"}`
            );
          } catch (e) {
            if (wasHeld) await clearInFlight(r.id, kind);
            throw e;
          }
          // Kill Bill confirmed: the payment stands even if the hold has ended,
          // and the receipt may finish in a retry.
          await clearInFlight(r.id);
          const stored = await finishSeatReceipt(ctx, r.id, kind, check.amountCents, buyer, billingName);
          if (!stored) {
            const row = await fetchReservation(r.id);
            reservationJson = row ? await reservationWithDocs(row) : null;
            return { status: 202, response: { reservation: reservationJson } };
          }
          const row = await fetchReservation(r.id);
          reservationJson = row ? await reservationWithDocs(row) : null;
          return { status: 201, response: { reservation: reservationJson } };
        });
        res.status(outcome.status).json(outcome.response);
      } catch (e) {
        next(e);
      }
    };
  };

  // POST /api/reservations/{id}/deposit
  router.post("/reservations/:id/deposit", seatPayment("deposit", (r) => {
    if (r.state !== "held") {
      if (r.state === "deposit_paid" || r.state === "paid_in_full" || r.state === "checked_in_day1" || r.state === "checked_in_day2" || r.state === "certificate_issued") {
        return { ok: false, code: "already_paid", message: "This seat is already paid at this step." };
      }
      if (r.state === "released" && r.hold_expires_at && r.hold_expires_at.getTime() <= Date.now()) {
        return { ok: false, code: "hold_expired", message: "Your hold has ended." };
      }
      return { ok: false, code: "hold_expired", message: "Your hold has ended." };
    }
    if (!depositsOpen(venueDate(cfg.benchDaysNow))) {
      return { ok: false, code: "deposits_closed", message: "Deposits closed on 19 March 2027." };
    }
    return { ok: true, amountCents: r.tier === "atelier" ? PRICES.atelier.deposit : PRICES.bench.deposit };
  }));

  // POST /api/reservations/{id}/full
  router.post("/reservations/:id/full", seatPayment("full", (r) => {
    if (r.state !== "held") {
      if (r.state === "deposit_paid" || r.state === "paid_in_full" || r.state === "checked_in_day1" || r.state === "checked_in_day2" || r.state === "certificate_issued") {
        return { ok: false, code: "already_paid", message: "This seat is already paid at this step." };
      }
      return { ok: false, code: "hold_expired", message: "Your hold has ended." };
    }
    return { ok: true, amountCents: r.price_cents };
  }));

  // POST /api/reservations/{id}/balance
  router.post("/reservations/:id/balance", seatPayment("balance", (r) => {
    if (r.state !== "deposit_paid") {
      if (r.state === "held" || r.state === "released") {
        return { ok: false, code: "not_deposit_paid", message: "Pay the deposit first." };
      }
      return { ok: false, code: "already_paid", message: "This seat is already paid in full." };
    }
    return { ok: true, amountCents: Math.max(0, r.price_cents - r.paid_cents) };
  }));

  // POST /api/reservations/{id}/upgrade
  router.post("/reservations/:id/upgrade", async (req, res, next) => {
    try {
      const account = await requireAccount(req);
      if (account.role !== "practitioner" && account.role !== "clinic") {
        res.status(403).json({ error: "forbidden", message: "You may not do that." });
        return;
      }
      const key = requireIdempotencyKey(req);
      const { billingName } = billingNameOf(req.body);
      const bench = req.body?.bench;
      if (typeof bench !== "string" || !/^[AB][1-6]$/.test(bench)) {
        res.status(422).json({
          error: "validation",
          message: "Some fields need attention.",
          errors: { bench: "Choose an Atelier bench in row A or B." },
        });
        return;
      }
      const { id } = req.params;
      const buyer = await buyerRef(account);
      const endpoint = `POST /api/reservations/${id}/upgrade`;
      const body = { billing_name: billingName, bench };

      const outcome = await idempotentWrap(account.id, key, endpoint, body, async () => {
        const venue = venueDate(cfg.benchDaysNow);
        const upgradePlan = await withTransaction(async (client) => {
          return withLedgerLock(client, async () => {
            const r = await fetchReservationClient(client, id!);
            if (!r || r.buyer_id !== account.id) return { code: "not_found" as const };
            if (r.state === "held" || r.state === "released" || r.state === "cancelled" || r.state === "refunded") {
              return { code: "not_paid" as const };
            }
            if (r.tier === "atelier") return { code: "already_atelier" as const };
            // Target bench must be open.
            const { rows: taken } = await client.query(
              `SELECT 1 FROM reservations WHERE bench = $1
                 AND state IN ('held','deposit_paid','paid_in_full','checked_in_day1','checked_in_day2','certificate_issued')
                 AND (state <> 'held' OR hold_expires_at > now() OR payment_in_flight OR payment_pending IS NOT NULL)`,
              [bench]
            );
            const { rows: offered } = await client.query(
              "SELECT 1 FROM waitlist WHERE bench = $1 AND state = 'offered' AND offer_expires_at > now()",
              [bench]
            );
            const { rows: pendingUpgrades } = await client.query(
              "SELECT 1 FROM reservations WHERE upgrade_bench = $1 AND payment_pending = 'upgrade'",
              [bench]
            );
            if (taken.length > 0 || offered.length > 0 || pendingUpgrades.length > 0) {
              return { code: "bench_taken" as const };
            }
            const active = await countAtelierActiveClient(client);
            const pendingCount = await client.query<{ count: number }>(
              "SELECT count(*)::int AS count FROM reservations WHERE upgrade_bench IS NOT NULL AND payment_pending = 'upgrade'"
            );
            if (active + (pendingCount.rows[0]?.count ?? 0) + 1 > ATELIER_CAP) {
              return { code: "atelier_sold_out" as const };
            }
            // The upgrade split, decided in one place from state and venue date.
            let charged: number;
            if (r.state === "paid_in_full") {
              charged = 245000;
            } else if (venue <= "2027-03-19") {
              charged = 60000;
            } else {
              charged = 245000;
            }
            return {
              code: "ok" as const,
              reservationId: r.id,
              state: r.state,
              charged,
              newPrice: PRICES.atelier.price,
              oldBench: r.bench,
            };
          });
        });
        if ("code" in upgradePlan && upgradePlan.code !== "ok") {
          if (upgradePlan.code === "not_found") throw err(404, "not_found", "Nothing here.");
          throw conflict(upgradePlan.code, upgradePlan.code === "not_paid" ? "Only a paid seat can be upgraded." : upgradePlan.code === "already_atelier" ? "This seat is already Atelier." : upgradePlan.code === "bench_taken" ? `Bench ${bench} was just taken.` : "Atelier is sold out.");
        }
        const plan = upgradePlan as { code: "ok"; reservationId: string; state: string; charged: number; newPrice: number; oldBench: string };

        // Reserve the target bench and mark the upgrade pending.
        await withTransaction(async (client) => {
          await client.query(
            "UPDATE reservations SET upgrade_bench = $2, payment_in_flight = TRUE, payment_pending = 'upgrade' WHERE id = $1 AND payment_pending IS NULL",
            [plan.reservationId, bench]
          );
        });
        try {
          await chargeSeat(
            ctx,
            buyer,
            { id: plan.reservationId, bench, tier: "atelier" },
            "upgrade",
            plan.charged,
            `Bench ${bench} Atelier upgrade`
          );
        } catch (e) {
          await query("UPDATE reservations SET upgrade_bench = NULL, payment_in_flight = FALSE, payment_pending = NULL WHERE id = $1 AND payment_pending = 'upgrade'", [plan.reservationId]);
          throw e;
        }
        // The charged amount is on the books; the seat's price is Atelier now.
        await query("UPDATE reservations SET price_cents = $2 WHERE id = $1", [plan.reservationId, plan.newPrice]);

        const stored = await finishUpgrade(ctx, plan.reservationId, plan.charged, buyer, billingName);
        const row = await fetchReservation(plan.reservationId);
        const reservationJson = row ? await reservationWithDocs(row) : null;
        if (!stored) {
          return { status: 202, response: { reservation: reservationJson } };
        }
        return { status: 201, response: { reservation: reservationJson } };
      });
      res.status(outcome.status).json(outcome.response);
    } catch (e) {
      next(e);
    }
  });

  // POST /api/groups/{id}/checkout
  router.post("/groups/:id/checkout", async (req, res, next) => {
    try {
      const account = await requireAccount(req);
      if (account.role !== "clinic") {
        if (account.role === "practitioner") {
          res.status(404).json({ error: "not_found", message: "Nothing here." });
          return;
        }
        res.status(403).json({ error: "forbidden", message: "You may not do that." });
        return;
      }
      const key = requireIdempotencyKey(req);
      const { billingName } = billingNameOf(req.body);
      const { id } = req.params;
      const buyer = await buyerRef(account);
      const endpoint = `POST /api/groups/${id}/checkout`;

      const assignments = req.body?.assignments;
      const { rows: groupSeats } = await query<{ id: string; bench: string; tier: string; price_cents: number; attendee_name: string | null }>(
        `SELECT id, bench, tier, price_cents, attendee_name FROM reservations WHERE group_id = $1 ORDER BY bench`,
        [id]
      );
      const { rows: groupRow } = await query<{ id: string; buyer_id: string }>("SELECT id, buyer_id FROM groups WHERE id = $1", [id]);
      if (!groupRow[0] || groupRow[0].buyer_id !== account.id) {
        res.status(404).json({ error: "not_found", message: "Nothing here." });
        return;
      }
      const body = { billing_name: billingName, assignments: assignments ?? [] };

      const outcome = await idempotentWrap(account.id, key, endpoint, body, async () => {
        const { rows: seatsNow } = await query<{ id: string; bench: string; tier: string; state: string; price_cents: number }>(
          "SELECT id, bench, tier, state, price_cents FROM reservations WHERE group_id = $1 ORDER BY bench",
          [id]
        );
        const unheld = seatsNow.filter((s) => s.state !== "held");
        if (seatsNow.length === 0 || unheld.length > 0) {
          const anyUnpaid = unheld.some((s) => s.state === "deposit_paid" || s.state === "paid_in_full");
          throw conflict(anyUnpaid ? "already_paid" : "hold_expired", anyUnpaid ? "This group is already paid." : "Your hold has ended.");
        }
        // Validate optional assignments: each names a bench of the group.
        if (Array.isArray(assignments)) {
          const benchSet = new Set(seatsNow.map((s) => s.bench));
          const errors: Record<string, string> = {};
          const seen = new Set<string>();
          for (const a of assignments) {
            if (!a || typeof a !== "object") {
              errors.assignments = "Each assignment names a bench, a name and an email.";
              break;
            }
            const { bench: abench, name, email } = a as Record<string, unknown>;
            if (typeof abench !== "string" || !benchSet.has(abench) || seen.has(abench)) {
              errors.assignments = "Each assignment names a bench of the group.";
              break;
            }
            seen.add(abench);
            if (typeof name !== "string" || name.length < 1 || name.length > 120) {
              errors.assignments = "Enter a colleague name of 1 to 120 characters.";
              break;
            }
            if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
              errors.assignments = "Enter a valid email for the colleague.";
              break;
            }
          }
          if (Object.keys(errors).length > 0) {
            throw validation(errors);
          }
        }
        // already_attending: an assignment email already attends another seat.
        if (Array.isArray(assignments)) {
          for (const a of assignments as { bench: string; name: string; email: string }[]) {
            const { rows: attending } = await query(
              `SELECT id FROM reservations
               WHERE attendee_email = $1 AND attendee_accepted = true
                 AND state IN ('deposit_paid','paid_in_full','checked_in_day1','checked_in_day2','certificate_issued')`,
              [a.email]
            );
            if (attending.length > 0) {
              throw conflict("already_attending", "That colleague already attends a seat.");
            }
          }
        }

        // Pin the group holds while the payment runs.
        await withTransaction(async (client) => {
          for (const s of seatsNow) {
            await client.query("UPDATE reservations SET payment_in_flight = TRUE, payment_pending = 'group' WHERE id = $1 AND payment_pending IS NULL", [s.id]);
          }
        });

        try {
          const seats: GroupSeat[] = seatsNow.map((s) => ({
            reservationId: s.id,
            bench: s.bench,
            tier: s.tier,
            amountCents: s.price_cents,
            attendeeName: null,
          }));
          // Apply assignments after payment.
          await chargeGroup(ctx, buyer, id!, seats);
          for (const s of seatsNow) {
            await query("UPDATE reservations SET payment_in_flight = FALSE WHERE id = $1", [s.id]);
          }
        } catch (e) {
          await withTransaction(async (client) => {
            for (const s of seatsNow) {
              await client.query(
                "UPDATE reservations SET payment_in_flight = FALSE, payment_pending = NULL WHERE id = $1 AND payment_pending = 'group'",
                [s.id]
              );
            }
          });
          throw e;
        }

        if (Array.isArray(assignments)) {
          for (const a of assignments as { bench: string; name: string; email: string }[]) {
            const seat = seatsNow.find((s) => s.bench === a.bench);
            if (!seat) continue;
            await query(
              "UPDATE reservations SET attendee_name = $2, attendee_email = $3, attendee_accepted = FALSE WHERE id = $1",
              [seat.id, a.name, a.email]
            );
            const { queueMail } = await import("./mail.js");
            await queueMail(a.email, `${account.clinic_name ?? account.name} assigned you Bench ${a.bench} at Opaline Bench Days`, "You have been assigned a seat at Opaline Bench Days. Sign in and accept it in your account: /account");
          }
        }

        const { rows: seatsFinal } = await query<{ id: string; bench: string; tier: string; price_cents: number; attendee_name: string | null }>(
          "SELECT id, bench, tier, price_cents, attendee_name FROM reservations WHERE group_id = $1 ORDER BY bench",
          [id]
        );
        const seats: GroupSeat[] = seatsFinal.map((s) => ({
          reservationId: s.id,
          bench: s.bench,
          tier: s.tier,
          amountCents: s.price_cents,
          attendeeName: s.attendee_name,
        }));
        const stored = await finishGroupInvoice(ctx, id!, buyer, seats, billingName);
        const groupJson = await groupPayload(id!);
        if (!stored) {
          return { status: 202, response: { group: groupJson } };
        }
        return { status: 201, response: { group: groupJson } };
      });
      res.status(outcome.status).json(outcome.response);
    } catch (e) {
      next(e);
    }
  });

  return router;
}

export async function groupPayload(groupId: string): Promise<Record<string, unknown> | null> {
  const { rows } = await query<{ id: string; state: string }>("SELECT id, state FROM groups WHERE id = $1", [groupId]);
  const g = rows[0];
  if (!g) return null;
  const { rows: seats } = await query<{ id: string }>(
    "SELECT id FROM reservations WHERE group_id = $1 ORDER BY bench",
    [groupId]
  );
  const reservations = [];
  for (const s of seats) {
    const row = await fetchReservation(s.id);
    if (row) reservations.push(await reservationWithDocs(row));
  }
  const { rows: items } = await query<{ bench: string; amount_cents: number; refunded_cents: number }>(
    `SELECT r.bench, k.amount_cents, k.refunded_cents
     FROM kb_payments k JOIN reservations r ON r.id = k.reservation_id
     WHERE k.external_key = 'ob-group-item-' || $1 || '-' || k.reservation_id
     ORDER BY r.bench`,
    [groupId]
  );
  const { rows: invoice } = await query<{ invoice_id: string }>(
    "SELECT invoice_id FROM kb_invoices WHERE external_key = $1",
    [`ob-group-${groupId}`]
  );
  return {
    id: g.id,
    state: g.state,
    reservations,
    invoice: invoice[0]
      ? {
          kb_invoice_id: invoice[0].invoice_id,
          items: items.map((i) => ({ bench: i.bench, amount_cents: i.amount_cents - i.refunded_cents })),
          total_cents: items.reduce((s, i) => s + i.amount_cents - i.refunded_cents, 0),
        }
      : null,
  };
}
