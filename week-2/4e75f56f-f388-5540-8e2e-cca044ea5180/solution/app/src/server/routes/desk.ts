import { lockCertificates, many, oneRow, pool, tx } from "../db.js";
import { certificatePdf, visaLetterPdf } from "../documents.js";
import { ApiError, conflict, validation } from "../http.js";
import { KEY_ERROR, keyIsValid, refuseReuse, replayOf } from "../idempotency.js";
import * as killbill from "../killbill.js";
import { currentInventory } from "../ledger.js";
import { enqueueMail } from "../mail.js";
import { formatDollars } from "../money.js";
import { externalKey, refundKeyPrefix, refundSeat } from "../payments.js";
import {
  balanceCents,
  lockedVisible,
  reload,
  reservationView,
  reservationsWhere,
  transition,
  type ReservationRow,
} from "../reservations.js";
import { SEATS_TOTAL, SOLD_STATES, certificateGaps, depositsOpen, venueToday } from "../rules.js";
import { putObject } from "../s3.js";
import { route } from "../router.js";
import { fields } from "../validate.js";
import { freshLedger } from "../views.js";

const FOOTER = "\n\nSee the details in your account: /account\n\nOpaline Bench Days";

async function kbAmounts(rows: readonly ReservationRow[]): Promise<Map<string, { paid_cents: number; refunded_cents: number }> | null> {
  const buyers = [...new Set(rows.map((row) => row.buyer_id))];
  const groupShares = await many<{ reservation_id: string; amount_cents: number; external_key: string }>(
    pool,
    `SELECT pi.reservation_id, pi.amount_cents, p.external_key FROM payment_items pi JOIN payments p ON p.id = pi.payment_id
     WHERE p.kind = 'group' AND pi.reservation_id = ANY($1)`,
    [rows.map((row) => row.id)],
  );
  try {
    const recorded = new Map<string, { type: string; cents: number }>();
    for (let start = 0; start < buyers.length; start += 12) {
      const batch = await Promise.all(buyers.slice(start, start + 12).map((id) => killbill.accountTransactions(id)));
      for (const found of batch) for (const [key, value] of found) recorded.set(key, value);
    }
    const amounts = new Map<string, { paid_cents: number; refunded_cents: number }>();
    for (const row of rows) {
      let paid = 0;
      let refunded = 0;
      for (const kind of ["deposit", "balance", "full", "upgrade"] as const) {
        const found = recorded.get(externalKey(kind, row.id));
        if (found?.type === "PURCHASE") paid += found.cents;
      }
      for (const share of groupShares.filter((s) => s.reservation_id === row.id)) {
        if (recorded.get(share.external_key)?.type === "PURCHASE") paid += share.amount_cents;
      }
      for (const [key, value] of recorded) {
        if (key.startsWith(refundKeyPrefix(row.id)) && value.type === "REFUND") refunded += value.cents;
      }
      amounts.set(row.id, { paid_cents: paid, refunded_cents: refunded });
    }
    return amounts;
  } catch (error) {
    if (error instanceof ApiError && error.code === "billing_unavailable") return null;
    throw error;
  }
}

route({
  method: "GET",
  path: "/api/desk/reservations",
  access: ["registrar"],
  handle: async (ctx) => {
    await freshLedger(ctx.now);
    const q = (ctx.query.get("q") ?? "").trim();
    const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const rows = await reservationsWhere(
      pool,
      `r.state <> 'released' AND ($1 = '' OR r.attendee_name ILIKE $2 OR a.name ILIKE $2 OR a.clinic_name ILIKE $2 OR r.bench ILIKE $2)`,
      [q, pattern],
    );
    const amounts = await kbAmounts(rows);
    return {
      status: 200,
      body: {
        billing: amounts ? "ok" : "unavailable",
        deposits_open: depositsOpen(venueToday(ctx.now)),
        reservations: rows.map((row) => ({ ...reservationView(row, ctx.now), buyer_email: row.buyer_email, kb: amounts?.get(row.id) ?? null })),
      },
    };
  },
});

route({
  method: "POST",
  path: "/api/desk/reservations/:id/refund",
  access: ["registrar"],
  idempotent: true,
  handle: (ctx) =>
    tx(async (db) => {
      const row = await lockedVisible(db, ctx.params.id ?? "", ctx.account, ["registrar"]);
      if (keyIsValid(ctx.idempotencyKey)) {
        const replay = await replayOf(db, ctx.account.id, ctx.idempotencyKey, ctx.fingerprint);
        if (replay) return { status: replay.status, body: replay.body };
      }
      await refuseReuse(db, ctx.account.id, ctx.idempotencyKey, ctx.fingerprint);
      if (row.state === "refunded") throw conflict("already_refunded", "This seat is already refunded.");
      if (row.state !== "cancelled") throw conflict("not_cancelled", "Only cancelled seats are refunded.");
      if (!keyIsValid(ctx.idempotencyKey)) throw validation(KEY_ERROR);
      const outcome = await refundSeat(db, row);
      await transition(db, [row], "refunded");
      const remaining = row.group_id
        ? (await reservationsWhere(db, "r.group_id = $1 AND r.id <> $2 AND r.state = ANY($3)", [row.group_id, row.id, SOLD_STATES])).map(
            (seat) => `Bench ${seat.bench}: ${seat.attendee_name ?? "Unassigned"}`,
          )
        : [];
      await enqueueMail(db, `refund:${row.id}`, {
        to: row.buyer_email,
        subject: `Refund confirmed: Bench ${row.bench}`,
        body:
          `We refunded $${formatDollars(outcome.amountCents)} for Bench ${row.bench}.` +
          (remaining.length ? `\n\nYour remaining seats:\n${remaining.join("\n")}` : "") +
          FOOTER,
      });
      return {
        status: 200,
        body: {
          reservation: reservationView(await reload(db, row.id), ctx.now),
          refund: { amount_cents: outcome.amountCents, transaction_external_keys: outcome.transactionKeys },
        },
      };
    }),
});

route({
  method: "POST",
  path: "/api/desk/reservations/:id/licence-review",
  access: ["registrar"],
  handle: (ctx) =>
    tx(async (db) => {
      const row = await lockedVisible(db, ctx.params.id ?? "", ctx.account, ["registrar"]);
      if (row.licence_status === "none") throw conflict("no_licence", "No licence has been uploaded for this seat.");
      if (row.licence_status === "matched") throw conflict("invalid_transition", "A matched licence is locked.");
      const decision = fields(ctx.body).decision;
      if (decision !== "matched" && decision !== "rejected") throw validation({ decision: "Choose matched or rejected." });
      await db.query("UPDATE reservations SET licence_status = $2 WHERE id = $1", [row.id, decision]);
      return { status: 200, body: { reservation: reservationView(await reload(db, row.id), ctx.now) } };
    }),
});

route({
  method: "POST",
  path: "/api/desk/reservations/:id/visa-letter",
  access: ["registrar"],
  handle: (ctx) =>
    tx(async (db) => {
      const row = await lockedVisible(db, ctx.params.id ?? "", ctx.account, ["registrar"]);
      if (row.documents.includes("visa-letter")) return { status: 200, body: { reservation: reservationView(row, ctx.now) } };
      if (!row.passport_key || !row.passport_full_name || !row.passport_nationality || !row.passport_number) {
        throw conflict("passport_missing", "No passport scan is on file for this seat.");
      }
      if (!SOLD_STATES.includes(row.state)) throw conflict("not_paid", "Visa letters are for paid seats.");
      const key = `visa-letters/${row.id}.pdf`;
      const pdf = visaLetterPdf({ fullName: row.passport_full_name, nationality: row.passport_nationality, number: row.passport_number }, row.bench, ctx.now);
      await putObject(key, pdf, "application/pdf");
      await db.query("INSERT INTO documents (owner_id, kind, object_key) VALUES ($1, 'visa-letter', $2)", [row.id, key]);
      await enqueueMail(db, `visa:${row.id}`, {
        to: row.attendee_email ?? row.buyer_email,
        subject: "Your visa-support letter for Opaline Bench Days",
        body: `Your visa-support letter for Bench ${row.bench} is ready to download.${FOOTER}`,
      });
      return { status: 201, body: { reservation: reservationView(await reload(db, row.id), ctx.now) } };
    }),
});

route({
  method: "POST",
  path: "/api/desk/reservations/:id/certificate",
  access: ["registrar"],
  handle: (ctx) =>
    tx(async (db) => {
      const row = await lockedVisible(db, ctx.params.id ?? "", ctx.account, ["registrar"]);
      if (row.certificate_number) {
        return { status: 200, body: { reservation: reservationView(row, ctx.now), certificate_number: row.certificate_number } };
      }
      const missing = certificateGaps({
        balanceCents: balanceCents(row),
        checkedIn: { day1: row.checked_in_day1, day2: row.checked_in_day2 },
        licenceStatus: row.licence_status,
      });
      if (missing.length) throw conflict("certificate_not_eligible", "This attendee is not eligible yet.", { missing });
      await lockCertificates(db);
      const issued = await oneRow<{ n: number }>(db, "SELECT count(*)::int AS n FROM reservations WHERE certificate_number IS NOT NULL");
      const number = `OB-2027-${String(issued.n + 1).padStart(4, "0")}`;
      const key = `certificates/${row.id}.pdf`;
      const pdf = certificatePdf({
        attendee: row.attendee_name ?? "",
        licenceNumber: row.licence_number ?? "",
        licenceState: row.licence_state ?? "",
        number,
      });
      await putObject(key, pdf, "application/pdf");
      await transition(db, [row], "certificate_issued", { certificate_number: number });
      await db.query("INSERT INTO documents (owner_id, kind, object_key) VALUES ($1, 'certificate', $2)", [row.id, key]);
      await enqueueMail(db, `certificate:${row.id}`, {
        to: row.attendee_email ?? row.buyer_email,
        subject: "Your CE certificate for Opaline Bench Days",
        body: `Your CE certificate (${number}) for the Layered Composite Masterclass is ready to download.${FOOTER}`,
      });
      return { status: 201, body: { reservation: reservationView(await reload(db, row.id), ctx.now), certificate_number: number } };
    }),
});

route({
  method: "GET",
  path: "/api/desk/inventory",
  access: ["registrar", "director"],
  handle: async (ctx) => {
    await freshLedger(ctx.now);
    const stock = await currentInventory(pool);
    const waiting = await many<{ tier: string; n: number }>(
      pool,
      "SELECT tier, count(*)::int AS n FROM waitlist_entries WHERE state = 'waitlisted' GROUP BY tier",
    );
    const count = (tier: string) => waiting.find((row) => row.tier === tier)?.n ?? 0;
    return {
      status: 200,
      body: {
        seats_total: SEATS_TOTAL,
        seats_remaining: stock.seatsRemaining,
        held: stock.held,
        sold: stock.sold,
        waitlisted: { bench: count("bench"), atelier: count("atelier") },
        atelier: { active: stock.atelier.active, cap: stock.atelier.cap, remaining: stock.atelier.remaining, sold_out: stock.atelier.soldOut },
      },
    };
  },
});
