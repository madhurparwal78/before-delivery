import type { PoolClient } from 'pg';
import type { Booking, Invoice, Line, Station } from '../../shared/types.js';
import { formatHours, minutesToHHMM } from '../../shared/format.js';
import { lockKitchenDay, pool, withTransaction } from '../db/pool.js';
import { ApiFailure, failures } from '../http/errors.js';
import {
  ensureBillingAccount,
  postCharges,
  postCredit,
  reverseInvoice,
  type PostedInvoice,
} from '../services/killbill.js';
import { serviceHealth, withService } from '../services/health.js';
import {
  sendCancellationReceipt,
  sendConfirmation,
  sendSeriesConfirmation,
} from '../services/mail.js';
import {
  bookingView,
  canTransition,
  loadBookingCells,
  loadBookingForUpdate,
  loadBookingLines,
  nextBookingRef,
  recordStateChange,
  type BookingRow,
} from './bookings.js';
import { cellKey, occupancyKeys, occupiedCells } from './availability.js';
import { createInvoice, invoiceView, type InvoiceLineInput } from './invoices.js';
import type { KitchenRecord, MemberRecord } from './kitchens.js';
import { drawsOfBooking, recordMovement } from './pack.js';
import type { CellRef, Priced, RateCardRecord, StationRef } from './pricing.js';
import { newId } from './secrets.js';
import { kitchenInstant } from './time.js';

/** Refuses the actions a down service pauses, in precedence order. */
export function requireBillingAndMail(): void {
  if (serviceHealth('billing') === 'down') throw failures.billingUnavailable();
  if (serviceHealth('mail') === 'down') throw failures.mailUnavailable();
}

export function requireBilling(): void {
  if (serviceHealth('billing') === 'down') throw failures.billingUnavailable();
}

function chargeDescription(ref: string, line: Line): string {
  return `${ref} · ${line.station} · tier ${line.tier} · ${line.hours} h`;
}

async function insertBooking(
  client: PoolClient,
  input: {
    kitchen: KitchenRecord;
    memberId: string;
    date: string;
    cells: readonly CellRef[];
    priced: Priced;
    rateCard: RateCardRecord;
    seriesId: string | null;
    actorId: string;
    now: Date;
  },
): Promise<{ id: string; ref: string; row: BookingRow }> {
  const id = newId('bkg');
  const ref = await nextBookingRef(client);
  const minutes = input.cells.map((cell) => cell.start_minute);
  const startMinute = Math.min(...minutes);
  const endMinute = Math.max(...minutes) + 15;
  const startsAt = kitchenInstant(input.kitchen.timezone, input.date, startMinute);
  const endsAt = kitchenInstant(input.kitchen.timezone, input.date, endMinute);

  await client.query(
    `INSERT INTO bookings
       (id, ref, kitchen_id, member_id, series_id, invoice_id, date, state, rate_card_id,
        cancellation_window_hours, pack_quarters, total_cents, starts_at, ends_at, confirmed_at)
     VALUES ($1, $2, $3, $4, $5, NULL, $6, 'confirmed', $7, $8, $9, $10, $11, $12, $13)`,
    [
      id,
      ref,
      input.kitchen.id,
      input.memberId,
      input.seriesId,
      input.date,
      input.rateCard.id,
      input.rateCard.cancellation_window_hours,
      input.priced.pack_quarters,
      input.priced.total_cents,
      startsAt,
      endsAt,
      input.now,
    ],
  );
  for (const cell of input.cells) {
    await client.query(
      'INSERT INTO booking_cells (booking_id, station_id, start_minute) VALUES ($1, $2, $3)',
      [id, cell.station_id, cell.start_minute],
    );
  }
  for (const [index, line] of input.priced.lines.entries()) {
    await client.query(
      `INSERT INTO booking_lines
         (booking_id, idx, station_id, tier, paid_by, quarters, hourly_rate_cents, amount_cents)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        id,
        index,
        line.station_id,
        line.tier,
        line.paid_by,
        line.quarters,
        line.hourly_rate_cents,
        line.amount_cents,
      ],
    );
  }
  if (input.priced.pack_quarters > 0) {
    await recordMovement(client, {
      memberId: input.memberId,
      kind: 'draw',
      quarters: input.priced.pack_quarters,
      bookingId: id,
      reverses: null,
      now: input.now,
    });
  }
  await recordStateChange(client, {
    actorId: input.actorId,
    kitchenId: input.kitchen.id,
    subject: 'booking',
    subjectId: id,
    from: null,
    to: 'confirmed',
    now: input.now,
  });

  const row: BookingRow = {
    id,
    ref,
    kitchen_id: input.kitchen.id,
    member_id: input.memberId,
    series_id: input.seriesId,
    invoice_id: null,
    date: input.date,
    state: 'confirmed',
    rate_card_id: input.rateCard.id,
    cancellation_window_hours: input.rateCard.cancellation_window_hours,
    pack_quarters: input.priced.pack_quarters,
    total_cents: input.priced.total_cents,
    starts_at: startsAt,
    ends_at: endsAt,
    confirmed_at: input.now,
    business: '',
  };
  return { id, ref, row };
}

async function postBillingInvoice(
  member: MemberRecord,
  charges: { description: string; amount_cents: number }[],
): Promise<{ accountId: string; posted: PostedInvoice } | null> {
  if (charges.length === 0) return null;
  const accountId = await withService('billing', () =>
    ensureBillingAccount({
      memberId: member.id,
      business: member.business,
      contactEmail: member.contact_email,
    }),
  );
  const posted = await withService('billing', () => postCharges(accountId, charges));
  return { accountId, posted };
}

export interface ConfirmContext {
  kitchen: KitchenRecord;
  member: MemberRecord;
  stations: Station[];
  stationsById: Map<string, StationRef>;
  rateCard: RateCardRecord;
  actorId: string;
  now: Date;
}

/**
 * One confirm: booking, pack draws, billing charges, one email and the hold,
 * all together or none of them.
 */
export async function confirmHeldBlock(
  context: ConfirmContext,
  input: {
    holdId: string;
    date: string;
    cells: readonly CellRef[];
    priced: Priced;
  },
): Promise<{ booking: Booking; invoice: Invoice }> {
  try {
    requireBillingAndMail();
  } catch (error) {
    await releaseHoldAfterFailure(input.holdId, context);
    throw error;
  }
  let billing: { accountId: string; posted: PostedInvoice } | null = null;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { id, ref, row } = await insertBooking(client, {
      kitchen: context.kitchen,
      memberId: context.member.id,
      date: input.date,
      cells: input.cells,
      priced: input.priced,
      rateCard: context.rateCard,
      seriesId: null,
      actorId: context.actorId,
      now: context.now,
    });

    const charges = input.priced.lines
      .filter((line) => line.paid_by === 'cash' && line.amount_cents > 0)
      .map((line) => ({ description: chargeDescription(ref, line), amount_cents: line.amount_cents }));
    billing = await postBillingInvoice(context.member, charges);

    const invoiceLines: InvoiceLineInput[] = input.priced.lines.map((line) => ({
      booking_id: id,
      cell_date: input.date,
      line,
      amount_cents: line.amount_cents,
    }));
    const invoice = await createInvoice(client, {
      kitchenId: context.kitchen.id,
      memberId: context.member.id,
      kind: 'booking',
      lines: invoiceLines,
      totalCents: input.priced.total_cents,
      killbillInvoiceId: billing ? billing.posted.killbillInvoiceId : null,
      now: context.now,
    });
    await client.query('UPDATE bookings SET invoice_id = $2 WHERE id = $1', [id, invoice.id]);
    await client.query("UPDATE holds SET state = 'confirmed' WHERE id = $1", [input.holdId]);
    await recordStateChange(client, {
      actorId: context.actorId,
      kitchenId: context.kitchen.id,
      subject: 'hold',
      subjectId: input.holdId,
      from: 'held',
      to: 'confirmed',
      now: context.now,
    });

    row.invoice_id = invoice.id;
    row.business = context.member.business;
    const bookingBody = bookingView(row, input.cells, [], context.stationsById);
    bookingBody.lines = input.priced.lines;

    await withService('mail', () =>
      sendConfirmation(context.member.contact_email, context.kitchen.name, bookingBody),
    );

    await client.query('COMMIT');
    return {
      booking: bookingBody,
      invoice: invoiceView(
        {
          id: invoice.id,
          ref: invoice.ref,
          kitchen_id: context.kitchen.id,
          member_id: context.member.id,
          kind: 'booking',
          total_cents: input.priced.total_cents,
          killbill_invoice_id: billing ? billing.posted.killbillInvoiceId : null,
          issued_at: context.now,
        },
        invoiceLines.map((line) => ({
          invoice_id: invoice.id,
          booking_id: line.booking_id ?? null,
          cell_date: line.cell_date ?? null,
          station_id: line.line ? line.line.station_id : null,
          tier: line.line ? line.line.tier : null,
          paid_by: line.line ? line.line.paid_by : null,
          quarters: line.line ? line.line.quarters : null,
          hourly_rate_cents: line.line ? line.line.hourly_rate_cents : null,
          description: null,
          amount_cents: line.amount_cents,
        })),
        [id],
        context.stationsById,
        input.priced.total_cents,
      ),
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    if (billing) {
      await reverseInvoice(billing.accountId, billing.posted).catch(() => undefined);
    }
    await releaseHoldAfterFailure(input.holdId, context);
    throw mapDependencyFailure(error);
  } finally {
    client.release();
  }
}

async function releaseHoldAfterFailure(holdId: string, context: ConfirmContext): Promise<void> {
  await withTransaction(async (client) => {
    await client.query("UPDATE holds SET state = 'released' WHERE id = $1 AND state = 'held'", [
      holdId,
    ]);
    await recordStateChange(client, {
      actorId: context.actorId,
      kitchenId: context.kitchen.id,
      subject: 'hold',
      subjectId: holdId,
      from: 'held',
      to: 'released',
      now: context.now,
    });
  }).catch(() => undefined);
}

export function mapDependencyFailure(error: unknown): unknown {
  if (error instanceof ApiFailure) return error;
  if (serviceHealth('billing') === 'down') return failures.billingUnavailable();
  if (serviceHealth('mail') === 'down') return failures.mailUnavailable();
  return error;
}

export interface SeriesPlan {
  occurrences: { date: string; cells: CellRef[]; priced: Priced }[];
  stationIds: string[];
  startMinute: number;
  endMinute: number;
  weeks: number;
  totalCents: number;
}

/** A weekly series: one booking per occurrence, one invoice, one email. */
export async function createSeriesBookings(
  context: ConfirmContext,
  plan: SeriesPlan,
): Promise<{ seriesId: string; bookings: Booking[]; invoice: Invoice; bookingIds: string[] }> {
  requireBillingAndMail();
  let billing: { accountId: string; posted: PostedInvoice } | null = null;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const date of [...plan.occurrences.map((item) => item.date)].sort()) {
      await lockKitchenDay(client, context.kitchen.id, date);
    }
    const conflicts = await findSeriesConflicts(client, context, plan);
    if (conflicts.dates.length > 0) {
      throw failures.seriesConflict(conflicts.dates, conflicts.taken);
    }

    const seriesId = newId('ser');
    const first = plan.occurrences[0];
    await client.query(
      `INSERT INTO series (id, kitchen_id, member_id, weekday, start_minute, end_minute, station_ids, weeks, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        seriesId,
        context.kitchen.id,
        context.member.id,
        new Date(`${first.date}T00:00:00Z`).getUTCDay(),
        plan.startMinute,
        plan.endMinute,
        plan.stationIds,
        plan.weeks,
        context.now,
      ],
    );

    const rows: { row: BookingRow; cells: CellRef[]; priced: Priced }[] = [];
    const charges: { description: string; amount_cents: number }[] = [];
    const invoiceLines: InvoiceLineInput[] = [];
    for (const occurrence of plan.occurrences) {
      const inserted = await insertBooking(client, {
        kitchen: context.kitchen,
        memberId: context.member.id,
        date: occurrence.date,
        cells: occurrence.cells,
        priced: occurrence.priced,
        rateCard: context.rateCard,
        seriesId,
        actorId: context.actorId,
        now: context.now,
      });
      rows.push({ row: inserted.row, cells: occurrence.cells, priced: occurrence.priced });
      for (const line of occurrence.priced.lines) {
        if (line.paid_by === 'cash' && line.amount_cents > 0) {
          charges.push({
            description: chargeDescription(inserted.ref, line),
            amount_cents: line.amount_cents,
          });
        }
        invoiceLines.push({
          booking_id: inserted.id,
          cell_date: occurrence.date,
          line,
          amount_cents: line.amount_cents,
        });
      }
    }

    billing = await postBillingInvoice(context.member, charges);
    const invoice = await createInvoice(client, {
      kitchenId: context.kitchen.id,
      memberId: context.member.id,
      kind: 'series',
      lines: invoiceLines,
      totalCents: plan.totalCents,
      killbillInvoiceId: billing ? billing.posted.killbillInvoiceId : null,
      now: context.now,
    });
    const bookingIds = rows.map((entry) => entry.row.id);
    await client.query('UPDATE bookings SET invoice_id = $2 WHERE id = ANY($1::text[])', [
      bookingIds,
      invoice.id,
    ]);

    const bookings = rows.map((entry) => {
      entry.row.invoice_id = invoice.id;
      entry.row.business = context.member.business;
      const view = bookingView(entry.row, entry.cells, [], context.stationsById);
      view.lines = entry.priced.lines;
      return view;
    });

    await withService('mail', () =>
      sendSeriesConfirmation(
        context.member.contact_email,
        context.kitchen.name,
        bookings,
        plan.totalCents,
      ),
    );
    await client.query('COMMIT');

    return {
      seriesId,
      bookings,
      bookingIds,
      invoice: invoiceView(
        {
          id: invoice.id,
          ref: invoice.ref,
          kitchen_id: context.kitchen.id,
          member_id: context.member.id,
          kind: 'series',
          total_cents: plan.totalCents,
          killbill_invoice_id: billing ? billing.posted.killbillInvoiceId : null,
          issued_at: context.now,
        },
        invoiceLines.map((line) => ({
          invoice_id: invoice.id,
          booking_id: line.booking_id ?? null,
          cell_date: line.cell_date ?? null,
          station_id: line.line ? line.line.station_id : null,
          tier: line.line ? line.line.tier : null,
          paid_by: line.line ? line.line.paid_by : null,
          quarters: line.line ? line.line.quarters : null,
          hourly_rate_cents: line.line ? line.line.hourly_rate_cents : null,
          description: null,
          amount_cents: line.amount_cents,
        })),
        bookingIds,
        context.stationsById,
        plan.totalCents,
      ),
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    if (billing) await reverseInvoice(billing.accountId, billing.posted).catch(() => undefined);
    throw mapDependencyFailure(error);
  } finally {
    client.release();
  }
}

export async function findSeriesConflicts(
  client: PoolClient,
  context: ConfirmContext,
  plan: SeriesPlan,
): Promise<{ dates: string[]; taken: { date: string; station_id: string; start: string }[] }> {
  const dates: string[] = [];
  const taken: { date: string; station_id: string; start: string }[] = [];
  for (const occurrence of plan.occurrences) {
    // The member's own live hold is the block being turned into a series, so it
    // is not in the way; it is released once the series is booked.
    const occupied = occupancyKeys(
      (await occupiedCells(client, context.kitchen.id, occurrence.date, context.now)).filter(
        (cell) => !(cell.kind === 'hold' && cell.member_id === context.member.id),
      ),
    );
    const clashes = occurrence.cells.filter((cell) =>
      occupied.has(cellKey(cell.station_id, cell.start_minute)),
    );
    if (clashes.length > 0) {
      dates.push(occurrence.date);
      for (const cell of clashes) {
        taken.push({
          date: occurrence.date,
          station_id: cell.station_id,
          start: minutesToHHMM(cell.start_minute),
        });
      }
    }
  }
  return { dates, taken };
}

/** A cancellation: state, pack refunds, the billing credit and one receipt. */
export async function cancelBookingUnit(
  context: ConfirmContext,
  bookingId: string,
): Promise<{ booking: Booking; refund: { pack_quarters: number; amount_cents: number } }> {
  requireBillingAndMail();
  const client = await pool.connect();
  let credited: { accountId: string; amountCents: number } | null = null;
  try {
    await client.query('BEGIN');
    const row = await loadBookingForUpdate(client, bookingId);
    if (!row) throw failures.notFound();
    const inWindow =
      context.now.getTime() <=
      row.starts_at.getTime() - row.cancellation_window_hours * 3600000;
    const target = inWindow ? 'cancelled_in_window' : 'cancelled_late';
    if (!canTransition(row.state, target)) {
      throw failures.invalidTransition(row.state, 'cancelled');
    }

    await client.query('UPDATE bookings SET state = $2 WHERE id = $1', [bookingId, target]);
    await recordStateChange(client, {
      actorId: context.actorId,
      kitchenId: context.kitchen.id,
      subject: 'booking',
      subjectId: bookingId,
      from: row.state,
      to: target,
      now: context.now,
    });

    let refundedQuarters = 0;
    let refundedCents = 0;
    if (inWindow) {
      for (const draw of await drawsOfBooking(client, bookingId)) {
        await recordMovement(client, {
          memberId: row.member_id,
          kind: 'refund',
          quarters: draw.quarters,
          bookingId,
          reverses: draw.id,
          now: context.now,
        });
        refundedQuarters += draw.quarters;
      }
      refundedCents = row.total_cents;
      if (refundedCents > 0) {
        const accountId = await withService('billing', () =>
          ensureBillingAccount({
            memberId: context.member.id,
            business: context.member.business,
            contactEmail: context.member.contact_email,
          }),
        );
        await withService('billing', () =>
          postCredit(accountId, refundedCents, `${row.ref} cancelled in window`),
        );
        credited = { accountId, amountCents: refundedCents };
      }
    }

    row.state = target;
    const cells = await loadBookingCells(client, bookingId);
    const lines = await loadBookingLines(client, [bookingId]);
    const view = bookingView(row, cells, lines, context.stationsById);
    await withService('mail', () =>
      sendCancellationReceipt(
        context.member.contact_email,
        view,
        { pack_quarters: refundedQuarters, amount_cents: refundedCents },
        inWindow,
      ),
    );
    await client.query('COMMIT');
    return {
      booking: view,
      refund: { pack_quarters: refundedQuarters, amount_cents: refundedCents },
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    if (credited) {
      await postCredit(
        credited.accountId,
        -credited.amountCents,
        'Reversal of a cancellation credit',
      ).catch(() => undefined);
    }
    throw mapDependencyFailure(error);
  } finally {
    client.release();
  }
}

export function cancelPreview(
  row: { starts_at: Date; cancellation_window_hours: number; total_cents: number; pack_quarters: number },
  now: Date,
): { in_window: boolean; pack_quarters: number; amount_cents: number; hours: string } {
  const inWindow =
    now.getTime() <= row.starts_at.getTime() - row.cancellation_window_hours * 3600000;
  return {
    in_window: inWindow,
    pack_quarters: inWindow ? row.pack_quarters : 0,
    amount_cents: inWindow ? row.total_cents : 0,
    hours: formatHours(inWindow ? row.pack_quarters : 0),
  };
}
