import { pool, withCertificateLock } from '../db/pool.js';
import { newId } from '../db/ids.js';
import {
  loadReservation,
  serializeReservation,
  type ReservationDetail,
} from '../db/reservations.js';
import { certificateGaps, formatCertificateNumber } from '../domain/certificate.js';
import {
  certificateKey,
  renderCertificate,
  renderVisaLetter,
  visaLetterKey,
} from '../domain/documents.js';
import { sweepIfDue } from '../domain/holds.js';
import { computeLedger } from '../domain/ledger.js';
import { queueCertificate, queueRefundConfirmed, queueVisaLetter } from '../domain/notifications.js';
import { sendRefund } from '../domain/refunds.js';
import { SOLD_STATES } from '../domain/reservationState.js';
import { serverNow } from '../domain/venue.js';
import { BillingUnavailable, getInvoice, getPayment, ping } from '../services/killbill.js';
import { putObject } from '../services/s3.js';
import type { Route } from '../http/context.js';
import {
  ApiError,
  conflict,
  invalidTransition,
  notFound,
  validation,
} from '../http/errors.js';

interface SeatPaymentRow {
  reservation_id: string;
  kb_payment_id: string;
  kb_invoice_id: string;
  kb_invoice_item_id: string;
}

interface KbSeatAmounts {
  paid_cents: number;
  refunded_cents: number;
}

async function killBillAmounts(
  reservationIds: readonly string[],
): Promise<Map<string, KbSeatAmounts> | null> {
  try {
    await ping();
  } catch (error) {
    if (error instanceof BillingUnavailable) return null;
    throw error;
  }
  if (reservationIds.length === 0) return new Map();
  const rows = await pool.query<SeatPaymentRow>(
    `select item.reservation_id, p.kb_payment_id, p.kb_invoice_id, item.kb_invoice_item_id
     from payment_items item
     join payments p on p.id = item.payment_id
     where item.reservation_id = any($1::text[])`,
    [reservationIds],
  );

  const amounts = new Map<string, KbSeatAmounts>();
  for (const id of reservationIds) amounts.set(id, { paid_cents: 0, refunded_cents: 0 });

  try {
    const invoices = new Map<string, Awaited<ReturnType<typeof getInvoice>>>();
    const payments = new Map<string, Awaited<ReturnType<typeof getPayment>>>();
    for (const row of rows.rows) {
      if (!invoices.has(row.kb_invoice_id)) {
        invoices.set(row.kb_invoice_id, await getInvoice(row.kb_invoice_id));
      }
      if (!payments.has(row.kb_payment_id)) {
        payments.set(row.kb_payment_id, await getPayment(row.kb_payment_id));
      }
    }
    for (const row of rows.rows) {
      const seat = amounts.get(row.reservation_id);
      if (seat === undefined) continue;
      const invoice = invoices.get(row.kb_invoice_id);
      const item = invoice?.items.find(
        (candidate) => candidate.invoiceItemId === row.kb_invoice_item_id,
      );
      if (item !== undefined) seat.paid_cents += item.amountCents;
      const payment = payments.get(row.kb_payment_id);
      const prefix = `ob-refund-${row.reservation_id}-`;
      for (const transaction of payment?.transactions ?? []) {
        if (
          transaction.transactionType === 'REFUND' &&
          transaction.status === 'SUCCESS' &&
          transaction.transactionExternalKey.startsWith(prefix)
        ) {
          seat.refunded_cents += transaction.amountCents;
        }
      }
    }
  } catch (error) {
    if (error instanceof BillingUnavailable) return null;
    throw error;
  }
  return amounts;
}

async function groupSeatLines(
  groupId: string,
  excludeReservationId: string,
): Promise<{ bench: string; name: string | null }[]> {
  const result = await pool.query<{ bench: string; assignee_name: string | null }>(
    `select bench, assignee_name from reservations
     where group_id = $1 and id <> $2 and state = any($3::text[])
     order by bench`,
    [groupId, excludeReservationId, SOLD_STATES],
  );
  return result.rows.map((row) => ({ bench: row.bench, name: row.assignee_name }));
}

export const deskRoutes: readonly Route[] = [
  {
    method: 'GET',
    pattern: '/api/desk/reservations',
    access: ['registrar'],
    handler: async (ctx) => {
      await sweepIfDue();
      const query = (ctx.query.get('q') ?? '').trim();
      const result = await pool.query<ReservationDetail>(
        `select r.*,
           b.name as buyer_name, b.email as buyer_email, b.role as buyer_role,
           b.clinic_name as buyer_clinic,
           coalesce((select sum(pi.amount_cents) from payment_items pi where pi.reservation_id = r.id), 0)::int
             as purchased_cents,
           coalesce((select sum(rf.amount_cents) from refunds rf where rf.reservation_id = r.id), 0)::int
             as refunded_cents,
           coalesce((select json_agg(d.kind order by d.created_at) from documents d
                     where d.reservation_id = r.id), '[]'::json) as documents,
           (select l.status from licences l where l.reservation_id = r.id) as licence_status,
           exists(select 1 from passports p where p.reservation_id = r.id) as has_passport,
           exists(select 1 from checkins c where c.reservation_id = r.id and c.day = 1) as day1,
           exists(select 1 from checkins c where c.reservation_id = r.id and c.day = 2) as day2
         from reservations r
         join accounts b on b.id = r.buyer_id
         where r.state <> 'released'
           and ($1 = '' or r.bench ilike '%' || $1 || '%'
                or coalesce(r.assignee_name, '') ilike '%' || $1 || '%'
                or b.name ilike '%' || $1 || '%'
                or coalesce(b.clinic_name, '') ilike '%' || $1 || '%')
         order by r.bench`,
        [query],
      );

      const amounts = await killBillAmounts(result.rows.map((row) => row.id));
      const at = serverNow();
      return {
        status: 200,
        body: {
          billing: amounts === null ? 'unavailable' : 'ok',
          reservations: result.rows.map((row) => ({
            ...serializeReservation(row, at),
            buyer_email: row.buyer_email,
            kb: amounts === null ? null : (amounts.get(row.id) ?? null),
          })),
        },
      };
    },
  },
  {
    method: 'POST',
    pattern: '/api/desk/reservations/:id/licence-review',
    access: ['registrar'],
    handler: async (ctx) => {
      const id = ctx.param('id');
      const body = ctx.json();
      const reservation = await loadReservation(pool, id);
      if (reservation === null) throw notFound();
      if (reservation.licence_status === null) {
        throw conflict('no_licence', 'This seat has no licence on file.');
      }
      if (reservation.licence_status === 'matched') throw invalidTransition();

      const decision = body['decision'];
      if (decision !== 'matched' && decision !== 'rejected') {
        throw validation({ decision: 'Choose matched or rejected.' });
      }
      const note = typeof body['note'] === 'string' ? body['note'].slice(0, 600) : null;
      await pool.query('update licences set status = $2, note = $3 where reservation_id = $1', [
        id,
        decision,
        note,
      ]);
      const refreshed = await loadReservation(pool, id);
      if (refreshed === null) throw notFound();
      return { status: 200, body: { reservation: serializeReservation(refreshed, serverNow()) } };
    },
  },
  {
    method: 'POST',
    pattern: '/api/desk/reservations/:id/visa-letter',
    access: ['registrar'],
    handler: async (ctx) => {
      const id = ctx.param('id');
      const reservation = await loadReservation(pool, id);
      if (reservation === null) throw notFound();

      const existing = await pool.query<{ id: string }>(
        `select id from documents where reservation_id = $1 and kind = 'visa-letter'`,
        [id],
      );
      if (existing.rows.length > 0) {
        return { status: 200, body: { reservation: serializeReservation(reservation, serverNow()) } };
      }

      if (!SOLD_STATES.includes(reservation.state)) {
        throw conflict('not_paid', 'This seat is not paid.');
      }
      const passport = await pool.query<{ full_name: string; nationality: string }>(
        'select full_name, nationality from passports where reservation_id = $1',
        [id],
      );
      const scan = passport.rows[0];
      if (scan === undefined) {
        throw conflict('passport_missing', 'This attendee has no passport scan.');
      }

      const key = visaLetterKey(id);
      const pdf = renderVisaLetter({
        fullName: scan.full_name,
        nationality: scan.nationality,
        bench: reservation.bench,
        tier: reservation.tier,
      });
      await putObject(key, pdf, 'application/pdf');
      await pool.query(
        `insert into documents (id, reservation_id, kind, s3_key) values ($1, $2, 'visa-letter', $3)
         on conflict (reservation_id, kind) where reservation_id is not null do nothing`,
        [newId('doc'), id, key],
      );
      if (reservation.assignee_email !== null) {
        await queueVisaLetter(pool, id, reservation.assignee_email);
      }
      const refreshed = await loadReservation(pool, id);
      if (refreshed === null) throw notFound();
      return { status: 201, body: { reservation: serializeReservation(refreshed, serverNow()) } };
    },
  },
  {
    method: 'POST',
    pattern: '/api/desk/reservations/:id/certificate',
    access: ['registrar'],
    handler: async (ctx) => {
      const id = ctx.param('id');
      const before = await loadReservation(pool, id);
      if (before === null) throw notFound();

      const outcome = await withCertificateLock(async (client) => {
        const existing = await client.query<{ number: number }>(
          'select number from certificates where reservation_id = $1',
          [id],
        );
        const already = existing.rows[0];
        if (already !== undefined) {
          return { status: 200 as const, number: formatCertificateNumber(already.number) };
        }

        const reservation = await loadReservation(client, id);
        if (reservation === null) throw notFound();
        const gaps = certificateGaps({
          balanceCents: reservation.price_cents - reservation.purchased_cents,
          day1: reservation.day1,
          day2: reservation.day2,
          licenceStatus: reservation.licence_status ?? 'none',
        });
        if (gaps.length > 0) {
          throw new ApiError(
            409,
            'certificate_not_eligible',
            'This attendee is not eligible for a certificate yet.',
            { missing: gaps },
          );
        }
        const licence = await client.query<{ licence_number: string; licence_state: string }>(
          'select licence_number, licence_state from licences where reservation_id = $1',
          [id],
        );
        const licenceRow = licence.rows[0];
        if (licenceRow === undefined) throw notFound();

        const next = await client.query<{ n: number }>(
          'select coalesce(max(number), 0) + 1 as n from certificates',
        );
        const sequence = next.rows[0]?.n ?? 1;
        const number = formatCertificateNumber(sequence);
        const key = certificateKey(id);
        const pdf = renderCertificate({
          attendeeName: reservation.assignee_name ?? reservation.buyer_name,
          licenceNumber: licenceRow.licence_number,
          licenceState: licenceRow.licence_state,
          certificateNumber: number,
        });
        await putObject(key, pdf, 'application/pdf');
        await client.query(
          'insert into certificates (reservation_id, number, s3_key) values ($1, $2, $3)',
          [id, sequence, key],
        );
        await client.query(
          `insert into documents (id, reservation_id, kind, s3_key) values ($1, $2, 'certificate', $3)
           on conflict (reservation_id, kind) where reservation_id is not null do nothing`,
          [newId('doc'), id, key],
        );
        await client.query(
          `update reservations set state = 'certificate_issued'
           where id = $1 and state = 'checked_in_day2'`,
          [id],
        );
        if (reservation.assignee_email !== null) {
          await queueCertificate(client, id, reservation.assignee_email);
        }
        return { status: 201 as const, number };
      });

      const refreshed = await loadReservation(pool, id);
      if (refreshed === null) throw notFound();
      return {
        status: outcome.status,
        body: {
          reservation: serializeReservation(refreshed, serverNow()),
          certificate_number: outcome.number,
        },
      };
    },
  },
  {
    method: 'POST',
    pattern: '/api/desk/reservations/:id/refund',
    access: ['registrar'],
    idempotent: true,
    handler: async (ctx) => {
      const id = ctx.param('id');
      const reservation = await loadReservation(pool, id);
      if (reservation === null) throw notFound();
      if (ctx.idempotencyConflict()) {
        throw conflict('idempotency_conflict', 'This Idempotency-Key was used for a different request.');
      }
      if (reservation.state === 'refunded') {
        throw conflict('already_refunded', 'This seat is already refunded.');
      }
      if (reservation.state !== 'cancelled') {
        throw conflict('not_cancelled', 'Cancel the seat before refunding it.');
      }
      ctx.idempotencyKey();

      const refundDue = reservation.refund_due_cents ?? 0;
      const sent = await sendRefund(id, refundDue);
      const remaining =
        reservation.group_id === null ? null : await groupSeatLines(reservation.group_id, id);
      await queueRefundConfirmed(
        pool,
        id,
        reservation.buyer_email,
        reservation.bench,
        sent.amountCents,
        remaining,
      );

      const refreshed = await loadReservation(pool, id);
      if (refreshed === null) throw notFound();
      return {
        status: 200,
        body: {
          reservation: serializeReservation(refreshed, serverNow()),
          refund: {
            amount_cents: sent.amountCents,
            transaction_external_keys: sent.transactionExternalKeys,
          },
        },
      };
    },
  },
  {
    method: 'GET',
    pattern: '/api/desk/inventory',
    access: ['registrar', 'director'],
    handler: async () => {
      await sweepIfDue();
      const ledger = await computeLedger(pool, null);
      return {
        status: 200,
        body: {
          seats_total: ledger.seatsTotal,
          seats_remaining: ledger.seatsRemaining,
          held: ledger.held,
          sold: ledger.sold,
          waitlisted: { bench: ledger.waitlisted.bench, atelier: ledger.waitlisted.atelier },
          atelier: {
            active: ledger.tiers.atelier.active,
            cap: ledger.tiers.atelier.cap,
            remaining: ledger.tiers.atelier.remaining,
            sold_out: ledger.tiers.atelier.soldOut,
          },
        },
      };
    },
  },
];
