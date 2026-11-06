import { Router } from "express";
import type { Config } from "./config.js";
import { COURSE } from "./config.js";
import { query, withTransaction, withLedgerLock } from "./db.js";
import { requireRole } from "./auth.js";
import { conflict, err, validation } from "./errors.js";
import { fetchReservation, fetchReservationClient, reservationWithDocs, offerBenchToWaitlist } from "./reservations.js";
import type { PaymentContext } from "./payments.js";
import { idempotentWrap, validIdempotencyKey } from "./payments.js";
import { queueMail } from "./mail.js";
import { deskInventory } from "./ledger.js";
import { venueDate } from "./time.js";
import { renderVisaLetterPdf, renderCertificatePdf } from "./pdfs.js";
import { newId } from "./ids.js";
import { CERTIFICATE_LOCK_KEY } from "./locks.js";

export function makeDeskRouter(cfg: Config, ctx: PaymentContext): Router {
  const router = Router();

  // GET /api/desk/reservations?q= — registrar.
  router.get("/desk/reservations", async (req, res, next) => {
    try {
      await requireRole(req, "registrar");
      const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
      const { rows } = await query<import("./reservations.js").ReservationRow>(
        `SELECT r.*, a.name AS buyer_name, a.role AS buyer_kind, r.licence_state AS licence_state_name
         FROM reservations r JOIN accounts a ON a.id = r.buyer_id
         WHERE r.state <> 'released'
           AND ($1 = '' OR r.attendee_name ILIKE '%' || $1 || '%' OR a.name ILIKE '%' || $1 || '%' OR r.bench ILIKE '%' || $1 || '%')
         ORDER BY r.bench`,
        [q]
      );
      // Read the Kill Bill amounts each time the desk loads.
      let billing: "ok" | "unavailable" = "ok";
      const reachable = await ctx.kb.isReachable();
      if (!reachable) billing = "unavailable";
      const seats = [];
      for (const r of rows) {
        let kb: { paid_cents: number; refunded_cents: number } | null = null;
        if (billing === "ok") {
          const paid = await seatPaidFromRows(r.id);
          const refunded = await seatRefundedFromRows(r.id);
          kb = { paid_cents: paid, refunded_cents: refunded };
        }
        const buyerEmail = await buyerEmailOf(r.buyer_id);
        seats.push({
          ...(await reservationWithDocs(r)),
          buyer_email: buyerEmail,
          kb,
        });
      }
      res.json({ billing, reservations: seats });
    } catch (e) {
      next(e);
    }
  });

  // POST /api/desk/reservations/{id}/refund — registrar.
  router.post("/desk/reservations/:id/refund", async (req, res, next) => {
    try {
      const account = await requireRole(req, "registrar");
      const key = req.headers["idempotency-key"];
      if (!validIdempotencyKey(key)) {
        res.status(422).json({ error: "validation", message: "Some fields need attention.", errors: { idempotency_key: "Send an Idempotency-Key of 8 to 128 letters, digits, - or _." } });
        return;
      }
      const { id } = req.params;
      const endpoint = `POST /api/desk/reservations/${id}/refund`;
      const outcome = await idempotentWrap(account.id, key as string, endpoint, null, async () => {
        const r = await fetchReservation(id!);
        if (!r) throw err(404, "not_found", "Nothing here.");
        if (r.state === "refunded") throw conflict("already_refunded", "This seat is already refunded.");
        if (r.state !== "cancelled") throw conflict("not_cancelled", "Only a cancelled seat can be refunded.");
        const due = r.refund_due_cents ?? 0;
        // The refund split: newest payment first, each part no larger than what
        // that payment paid for this seat.
        const { rows: payments } = await query<{ id: string; external_key: string; payment_id: string | null; payment_external_key: string | null; invoice_id: string | null; invoice_item_id: string | null; amount_cents: number; refunded_cents: number }>(
          `SELECT id, external_key, payment_id, payment_external_key, invoice_id, invoice_item_id, amount_cents, refunded_cents
           FROM kb_payments WHERE reservation_id = $1 AND confirmed_at IS NOT NULL
           ORDER BY confirmed_at DESC, id`,
          [id]
        );
        const parts: { paymentRowId: string; paymentId: string | null; paymentExternalKey: string | null; invoiceItemId: string | null; amountCents: number }[] = [];
        let remaining = due;
        for (const p of payments) {
          if (remaining <= 0) break;
          const room = p.amount_cents - p.refunded_cents;
          if (room <= 0) continue;
          const part = Math.min(room, remaining);
          remaining -= part;
          parts.push({ paymentRowId: p.id, paymentId: p.payment_id, paymentExternalKey: p.payment_external_key ?? p.external_key, invoiceItemId: p.invoice_item_id, amountCents: part });
        }
        const keys: string[] = [];
        for (let i = 0; i < parts.length; i++) {
          const part = parts[i]!;
          const n = i + 1;
          const refundKey = `ob-refund-${id}-${n}`;
          keys.push(refundKey);
          const { rows: prior } = await query("SELECT external_key FROM kb_refunds WHERE external_key = $1", [refundKey]);
          if (!prior[0]) {
            if (!part.paymentId || !part.invoiceItemId) {
              // The payment record is incomplete; look the payment up in Kill Bill.
              const found = await ctx.kb.lookupTransaction(part.paymentExternalKey ?? refundKey);
              if (!found) throw err(503, "billing_unavailable", "Billing is offline right now.");
              part.paymentId = found.paymentId;
            }
            const confirmed = await ctx.kb.refund(part.paymentId, part.invoiceItemId!, part.amountCents, refundKey, part.paymentExternalKey ?? refundKey);
            if (!confirmed) throw err(503, "billing_unavailable", "Billing is offline right now.");
            await query(
              "INSERT INTO kb_refunds (external_key, reservation_id, kb_payment_id, amount_cents, ord) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (external_key) DO NOTHING",
              [refundKey, id, part.paymentRowId, part.amountCents, n]
            );
            await query("UPDATE kb_payments SET refunded_cents = refunded_cents + $2 WHERE id = $1", [part.paymentRowId, part.amountCents]);
          }
        }
        await query("UPDATE reservations SET state = 'refunded' WHERE id = $1 AND state = 'cancelled'", [id]);
        const { rows: emailClaim } = await query(
          "UPDATE reservations SET refund_email_sent = TRUE WHERE id = $1 AND refund_email_sent = FALSE RETURNING id",
          [id]
        );
        if (emailClaim.length === 0) {
          const row = await fetchReservation(id!);
          return { status: 200, response: { reservation: row ? await reservationWithDocs(row) : null, refund: { amount_cents: due, transaction_external_keys: keys } } };
        }
        const buyer = await buyerOf(r.buyer_id);
        let body = refundEmailBody(r.bench, due);
        if (r.group_id) {
          const { rows: remaining } = await query<{ bench: string; attendee_name: string | null }>(
            `SELECT bench, attendee_name FROM reservations WHERE group_id = $1 AND state <> 'refunded' ORDER BY bench`,
            [r.group_id]
          );
          const lines = remaining.map((s) => `Bench ${s.bench}: ${s.attendee_name ?? "Unassigned"}`).join("\n");
          body += `\n\nRemaining seats on the group invoice:\n${lines}`;
        }
        await queueMail(buyer.email, `Refund confirmed: Bench ${r.bench}`, body);
        const row = await fetchReservation(id!);
        return {
          status: 200,
          response: {
            reservation: row ? await reservationWithDocs(row) : null,
            refund: { amount_cents: due, transaction_external_keys: keys },
          },
        };
      });
      res.status(outcome.status).json(outcome.response);
    } catch (e) {
      next(e);
    }
  });

  // POST /api/desk/reservations/{id}/licence-review — registrar.
  router.post("/desk/reservations/:id/licence-review", async (req, res, next) => {
    try {
      await requireRole(req, "registrar");
      const decision = req.body?.decision;
      if (decision !== "matched" && decision !== "rejected") {
        res.status(422).json({ error: "validation", message: "Some fields need attention.", errors: { decision: "Choose matched or rejected." } });
        return;
      }
      const { id } = req.params;
      const r = await fetchReservation(id!);
      if (!r) {
        res.status(404).json({ error: "not_found", message: "Nothing here." });
        return;
      }
      if (r.licence_status !== "submitted" && r.licence_status !== "rejected") {
        res.status(409).json({ error: "no_licence", message: "There is no licence to review." });
        return;
      }
      const note = typeof req.body?.note === "string" ? req.body.note : null;
      await query("UPDATE reservations SET licence_status = $2, licence_reviewed_note = $3 WHERE id = $1", [id, decision, note]);
      const row = await fetchReservation(id!);
      res.json({ reservation: row ? await reservationWithDocs(row) : null });
    } catch (e) {
      next(e);
    }
  });

  // POST /api/desk/reservations/{id}/visa-letter — registrar.
  router.post("/desk/reservations/:id/visa-letter", async (req, res, next) => {
    try {
      await requireRole(req, "registrar");
      const { id } = req.params;
      const r = await fetchReservation(id!);
      if (!r) {
        res.status(404).json({ error: "not_found", message: "Nothing here." });
        return;
      }
      const existing = await visaKeyFor(id!);
      if (existing) {
        res.status(200).json({ reservation: await reservationWithDocs(r) });
        return;
      }
      const paidStates = ["deposit_paid", "paid_in_full", "checked_in_day1", "checked_in_day2", "certificate_issued"];
      if (!paidStates.includes(r.state)) {
        res.status(409).json({ error: "not_paid", message: "The seat must be paid for a visa letter." });
        return;
      }
      if (r.passport_status !== "submitted" || !r.passport_object_key) {
        res.status(409).json({ error: "passport_missing", message: "There is no passport scan on file." });
        return;
      }
      const key = `visa-letters/${id}.pdf`;
      let pdf: Buffer;
      try {
        pdf = await renderVisaLetterPdf({
          name: r.passport_full_name ?? r.attendee_name ?? "",
          nationality: r.passport_nationality ?? "",
          passportNumber: r.passport_number ?? "",
          bench: r.bench,
        });
        await ctx.s3.put(key, pdf, "application/pdf");
      } catch {
        res.status(503).json({ error: "storage_unavailable", message: "Document storage is not answering." });
        return;
      }
      await query(
        "INSERT INTO documents (reservation_id, kind, object_key) VALUES ($1, 'visa-letter', $2) ON CONFLICT (reservation_id, kind) DO NOTHING",
        [id, key]
      );
      const attendeeEmail = r.attendee_email!;
      await queueMail(attendeeEmail, "Your visa-support letter for Opaline Bench Days", "Your visa-support letter is ready. Download it from your account: /account");
      res.status(201).json({ reservation: await reservationWithDocs((await fetchReservation(id!))!) });
    } catch (e) {
      next(e);
    }
  });

        // POST /api/desk/reservations/{id}/certificate — registrar.
  router.post("/desk/reservations/:id/certificate", async (req, res, next) => {
    try {
      await requireRole(req, "registrar");
      const { id } = req.params;
      const r = await fetchReservation(id!);
      if (!r) {
        res.status(404).json({ error: "not_found", message: "Nothing here." });
        return;
      }
      const existing = await certificateFor(id!);
      if (existing !== null) {
        res.status(200).json({ reservation: await reservationWithDocs(r), certificate_number: certificateString(existing) });
        return;
      }
      const missing: string[] = [];
      if (r.paid_cents < r.price_cents) missing.push("balance_unpaid");
      if (!r.checked_in_day1) missing.push("day1_check_in");
      if (!r.checked_in_day2) missing.push("day2_check_in");
      if (r.licence_status !== "matched") missing.push("licence_not_matched");
      if (missing.length > 0) {
        res.status(409).json({ error: "certificate_not_eligible", message: "Certificate not ready.", missing });
        return;
      }
      // The certificate number is taken together with a stored PDF, gapless,
      // under the certificate lock: an attempt that fails to store records
      // nothing and uses no number.
      const issued = await withTransaction(async (client) => {
        return certificateIssue(client, ctx, { id: r.id, attendee_name: r.attendee_name, licence_number: r.licence_number, licence_state: r.licence_state_name });
      });
      if (issued.stored) {
        await queueMail(r.attendee_email!, "Your CE certificate for Opaline Bench Days", `Your CE certificate (${certificateString(issued.number!)}) is ready. Download it from your account: /account`);
        const row = await fetchReservation(id!);
        res.status(issued.isNew ? 201 : 200).json({ reservation: row ? await reservationWithDocs(row) : null, certificate_number: certificateString(issued.number!) });
        return;
      }
      res.status(503).json({ error: "storage_unavailable", message: "Document storage is not answering." });
    } catch (e) {
      next(e);
    }
  });

  // GET /api/desk/inventory — registrar, director.
  router.get("/desk/inventory", async (req, res, next) => {
    try {
      await requireRole(req, "registrar", "director");
      const inv = await deskInventory();
      res.json({
        seats_total: inv.seats_total,
        seats_remaining: inv.seats_remaining,
        held: inv.held,
        sold: inv.sold,
        waitlisted: inv.waitlisted,
        atelier: inv.atelier,
      });
    } catch (e) {
      next(e);
    }
  });

  return router;
}

async function certificateIssue(
  client: import("pg").PoolClient,
  ctx: PaymentContext,
  r: { id: string; attendee_name: string | null; licence_number: string | null; licence_state: string | null }
): Promise<{ stored: boolean; number?: number; isNew: boolean }> {
  await client.query("SELECT pg_advisory_xact_lock($1)", [CERTIFICATE_LOCK_KEY]);
  const { rows: existing } = await client.query<{ certificate_number: number }>(
    "SELECT certificate_number FROM certificates WHERE reservation_id = $1",
    [r.id]
  );
  if (existing[0]) return { stored: true, number: existing[0].certificate_number, isNew: false };
  const { rows: next } = await client.query<{ n: number }>(
    "SELECT coalesce(max(certificate_number), 0) + 1 AS n FROM certificates"
  );
  const number = next[0]?.n ?? 1;
  const finalPdf = await renderCertificatePdf({
    attendeeName: r.attendee_name ?? "",
    licenceNumber: r.licence_number ?? "",
    licenceState: r.licence_state ?? "",
    certificateNumber: certificateString(number),
  });
  const key = `certificates/${r.id}.pdf`;
  try {
    await ctx.s3.put(key, finalPdf, "application/pdf");
  } catch {
    return { stored: false, isNew: false };
  }
  await client.query(
    "INSERT INTO certificates (reservation_id, certificate_number, object_key) VALUES ($1, $2, $3)",
    [r.id, number, key]
  );
  await client.query(
    "INSERT INTO documents (reservation_id, kind, object_key) VALUES ($1, 'certificate', $2) ON CONFLICT (reservation_id, kind) DO NOTHING",
    [r.id, key]
  );
  await client.query("UPDATE reservations SET state = 'certificate_issued' WHERE id = $1", [r.id]);
  return { stored: true, number, isNew: true };
}

export function certificateString(n: number): string {
  return `OB-2027-${String(n).padStart(4, "0")}`;
}

async function certificateFor(id: string): Promise<number | null> {
  const { rows } = await query<{ certificate_number: number }>("SELECT certificate_number FROM certificates WHERE reservation_id = $1", [id]);
  return rows[0]?.certificate_number ?? null;
}

async function visaKeyFor(id: string): Promise<string | null> {
  const { rows } = await query<{ object_key: string }>("SELECT object_key FROM documents WHERE reservation_id = $1 AND kind = 'visa-letter'", [id]);
  return rows[0]?.object_key ?? null;
}

async function buyerEmailOf(buyerId: string): Promise<string> {
  const { rows } = await query<{ email: string }>("SELECT email FROM accounts WHERE id = $1", [buyerId]);
  return rows[0]?.email ?? "";
}

async function buyerOf(buyerId: string): Promise<{ name: string; email: string }> {
  const { rows } = await query<{ name: string; email: string }>("SELECT name, email FROM accounts WHERE id = $1", [buyerId]);
  return rows[0] ?? { name: "", email: "" };
}

async function seatPaidFromRows(reservationId: string): Promise<number> {
  const { rows } = await query<{ total: number }>(
    "SELECT coalesce(sum(amount_cents), 0)::int AS total FROM kb_payments WHERE reservation_id = $1 AND confirmed_at IS NOT NULL",
    [reservationId]
  );
  return rows[0]?.total ?? 0;
}

async function seatRefundedFromRows(reservationId: string): Promise<number> {
  const { rows } = await query<{ total: number }>(
    "SELECT coalesce(sum(amount_cents), 0)::int AS total FROM kb_refunds WHERE reservation_id = $1",
    [reservationId]
  );
  return rows[0]?.total ?? 0;
}

function refundEmailBody(bench: string, dueCents: number): string {
  return `Your refund of $${(dueCents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })} for Bench ${bench} has been sent.\n\n${COURSE.title}.`;
}
