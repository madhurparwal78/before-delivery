import { tierOfBench, type Tier } from '../../shared/benches.js';
import type { Account } from '../db/accounts.js';
import { newId } from '../db/ids.js';
import { pool, withLedgerLock, withTransaction, type Queryable } from '../db/pool.js';
import {
  createInvoiceWithCharges,
  ensureBuyerAccount,
  purchaseInvoice,
  type ChargeLine,
} from '../services/killbill.js';
import { putObject } from '../services/s3.js';
import {
  groupInvoiceKey,
  receiptDocumentKind,
  receiptKey,
  renderGroupInvoice,
  renderReceipt,
} from './documents.js';
import { offerFreedBenches } from './holds.js';
import {
  queueDepositReceipt,
  queueGroupReceipt,
  queuePaidInFullReceipt,
  queueUpgradeReceipt,
} from './notifications.js';
import type { PaymentKind } from './reservationState.js';

export interface SeatCharge {
  readonly reservationId: string;
  readonly description: string;
  readonly amountCents: number;
}

export interface RecordedPayment {
  readonly paymentId: string;
  readonly kbInvoiceId: string;
}

interface PaymentRow {
  id: string;
  kind: PaymentKind;
  reservation_id: string | null;
  group_id: string | null;
  amount_cents: number;
  billing_name: string;
  kb_invoice_id: string;
}

export async function markPaymentInFlight(
  client: Queryable,
  reservationIds: readonly string[],
  kind: PaymentKind,
): Promise<void> {
  await client.query(
    'update reservations set payment_in_flight = $2 where id = any($1::text[])',
    [reservationIds, kind],
  );
}

export async function clearPaymentInFlight(reservationIds: readonly string[]): Promise<void> {
  await pool.query('update reservations set payment_in_flight = null where id = any($1::text[])', [
    reservationIds,
  ]);
}

/**
 * Charges Kill Bill once for the given seats and records the confirmed payment.
 * A confirmed transaction already carrying the external key is reused.
 */
export async function chargeThroughKillBill(input: {
  readonly buyer: Account;
  readonly kind: PaymentKind;
  readonly reservationId: string | null;
  readonly groupId: string | null;
  readonly externalKey: string;
  readonly billingName: string;
  readonly charges: readonly SeatCharge[];
}): Promise<RecordedPayment> {
  const existing = await pool.query<{ id: string; kb_invoice_id: string }>(
    'select id, kb_invoice_id from payments where external_key = $1',
    [input.externalKey],
  );
  const already = existing.rows[0];
  if (already !== undefined) {
    return { paymentId: already.id, kbInvoiceId: already.kb_invoice_id };
  }

  const buyerName =
    input.buyer.role === 'clinic' ? (input.buyer.clinicName ?? input.buyer.name) : input.buyer.name;
  const account = await ensureBuyerAccount(input.buyer.id, buyerName, input.buyer.email);
  const lines: ChargeLine[] = input.charges.map((charge) => ({
    description: charge.description,
    amountCents: charge.amountCents,
  }));
  const totalCents = lines.reduce((sum, line) => sum + line.amountCents, 0);
  const invoice = await createInvoiceWithCharges(account.kbAccountId, lines);
  const payment = await purchaseInvoice(
    account.kbAccountId,
    account.paymentMethodId,
    invoice.invoiceId,
    totalCents,
    input.externalKey,
  );

  const paymentId = newId('pay');
  const recorded = await withTransaction(async (client) => {
    const insert = await client.query<{ id: string }>(
      `insert into payments (id, kind, reservation_id, group_id, external_key, amount_cents,
                             billing_name, kb_payment_id, kb_invoice_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (external_key) do nothing
       returning id`,
      [
        paymentId,
        input.kind,
        input.reservationId,
        input.groupId,
        input.externalKey,
        totalCents,
        input.billingName,
        payment.paymentId,
        invoice.invoiceId,
      ],
    );
    const id = insert.rows[0]?.id;
    if (id === undefined) {
      const found = await client.query<{ id: string; kb_invoice_id: string }>(
        'select id, kb_invoice_id from payments where external_key = $1',
        [input.externalKey],
      );
      const row = found.rows[0];
      if (row === undefined) throw new Error('payment row vanished');
      return { paymentId: row.id, kbInvoiceId: row.kb_invoice_id };
    }
    for (const [index, charge] of input.charges.entries()) {
      const item = invoice.items[index];
      if (item === undefined) throw new Error('invoice item missing for charge');
      await client.query(
        `insert into payment_items (payment_id, reservation_id, kb_invoice_item_id, amount_cents)
         values ($1, $2, $3, $4)
         on conflict (payment_id, reservation_id) do nothing`,
        [id, charge.reservationId, item.invoiceItemId, charge.amountCents],
      );
    }
    const seats = input.charges.map((charge) => charge.reservationId);
    await client.query(
      `update reservations set payment_pending = $2, payment_in_flight = null
       where id = any($1::text[])`,
      [seats, input.kind],
    );
    return { paymentId: id, kbInvoiceId: invoice.invoiceId };
  });
  return recorded;
}

interface SeatForReceipt {
  id: string;
  bench: string;
  tier: Tier;
  assignee_name: string | null;
  purchased_cents: number;
  price_cents: number;
  buyer_email: string;
  buyer_name: string;
  buyer_clinic: string | null;
  buyer_role: string;
  state: string;
}

async function seatsForPayment(
  client: Queryable,
  paymentId: string,
): Promise<SeatForReceipt[]> {
  const result = await client.query<SeatForReceipt>(
    `select r.id, r.bench, r.tier, r.assignee_name, r.price_cents, r.state,
       a.email as buyer_email, a.name as buyer_name, a.clinic_name as buyer_clinic, a.role as buyer_role,
       coalesce((select sum(pi.amount_cents) from payment_items pi where pi.reservation_id = r.id), 0)::int
         as purchased_cents
     from payment_items item
     join reservations r on r.id = item.reservation_id
     join accounts a on a.id = r.buyer_id
     where item.payment_id = $1
     order by r.bench`,
    [paymentId],
  );
  return result.rows;
}

/**
 * Stores the receipt, moves the seats to their paid state and queues the
 * receipt email. Throws StorageUnavailable while MinIO is unreachable, leaving
 * the payment pending for the next attempt.
 */
export async function finishPayment(paymentId: string): Promise<void> {
  const paymentResult = await pool.query<PaymentRow>(
    `select id, kind, reservation_id, group_id, amount_cents, billing_name, kb_invoice_id
     from payments where id = $1`,
    [paymentId],
  );
  const payment = paymentResult.rows[0];
  if (payment === undefined) throw new Error(`payment ${paymentId} is not recorded`);

  const seats = await seatsForPayment(pool, paymentId);
  if (seats.length === 0) throw new Error(`payment ${paymentId} has no seats`);
  const first = seats[0] as SeatForReceipt;
  const billedTo =
    payment.billing_name === ''
      ? first.buyer_role === 'clinic'
        ? (first.buyer_clinic ?? first.buyer_name)
        : first.buyer_name
      : payment.billing_name;

  if (payment.kind === 'group') {
    const groupId = payment.group_id;
    if (groupId === null) throw new Error('a group payment needs a group');
    const key = groupInvoiceKey(groupId);
    const pdf = renderGroupInvoice({
      billingName: billedTo,
      seats: seats.map((seat) => ({
        bench: seat.bench,
        tier: seat.tier,
        attendeeName: seat.assignee_name,
        amountCents: seat.price_cents,
      })),
      totalCents: payment.amount_cents,
    });
    await putObject(key, pdf, 'application/pdf');
    await withTransaction(async (client) => {
      await client.query(
        `insert into documents (id, group_id, kind, s3_key) values ($1, $2, 'invoice', $3)
         on conflict (group_id, kind) where group_id is not null do nothing`,
        [newId('doc'), groupId, key],
      );
      await client.query(
        `update reservations set state = 'paid_in_full', payment_pending = null,
           hold_expires_at = null, hold_duration_seconds = null
         where group_id = $1 and state = 'held'`,
        [groupId],
      );
      await client.query(`update groups set state = 'paid_in_full' where id = $1`, [groupId]);
      await queueGroupReceipt(
        client,
        groupId,
        first.buyer_email,
        seats.map((seat) => ({ bench: seat.bench, name: seat.assignee_name })),
        payment.amount_cents,
      );
    });
    return;
  }

  const kind = payment.kind;
  const seat = first;
  if (kind === 'upgrade') {
    await finishUpgrade(seat, payment.amount_cents, billedTo);
    return;
  }
  const key = receiptKey(seat.id, kind);
  const pdf = renderReceipt({
    kind,
    bench: seat.bench,
    tier: seat.tier,
    attendeeName: seat.assignee_name,
    billingName: billedTo,
    amountCents: payment.amount_cents,
    paidCents: seat.purchased_cents,
    priceCents: seat.price_cents,
  });
  await putObject(key, pdf, 'application/pdf');

  await withTransaction(async (client) => {
    await client.query(
      `insert into documents (id, reservation_id, kind, s3_key) values ($1, $2, $3, $4)
       on conflict (reservation_id, kind) where reservation_id is not null do nothing`,
      [newId('doc'), seat.id, receiptDocumentKind(kind), key],
    );
    if (kind === 'deposit') {
      await client.query(
        `update reservations set state = 'deposit_paid', payment_pending = null,
           hold_expires_at = null, hold_duration_seconds = null
         where id = $1 and state = 'held'`,
        [seat.id],
      );
      await queueDepositReceipt(
        client,
        seat.id,
        seat.buyer_email,
        seat.bench,
        payment.amount_cents,
      );
    } else if (kind === 'full') {
      await client.query(
        `update reservations set state = 'paid_in_full', payment_pending = null,
           hold_expires_at = null, hold_duration_seconds = null
         where id = $1 and state = 'held'`,
        [seat.id],
      );
      await queuePaidInFullReceipt(
        client,
        seat.id,
        'full',
        seat.buyer_email,
        seat.bench,
        payment.amount_cents,
      );
    } else if (kind === 'balance') {
      await client.query(
        `update reservations set state = 'paid_in_full', payment_pending = null
         where id = $1 and state = 'deposit_paid'`,
        [seat.id],
      );
      await queuePaidInFullReceipt(
        client,
        seat.id,
        'balance',
        seat.buyer_email,
        seat.bench,
        payment.amount_cents,
      );
    } else {
      throw new Error(`payment kind ${kind} has no receipt step`);
    }
  });
}

/** The upgrade's receipt, and the old bench handed to the Bench-tier waitlist. */
async function finishUpgrade(
  seat: SeatForReceipt,
  amountCents: number,
  billedTo: string,
): Promise<void> {
  const key = receiptKey(seat.id, 'upgrade');
  const pdf = renderReceipt({
    kind: 'upgrade',
    bench: seat.bench,
    tier: seat.tier,
    attendeeName: seat.assignee_name,
    billingName: billedTo,
    amountCents,
    paidCents: seat.purchased_cents,
    priceCents: seat.price_cents,
  });
  await putObject(key, pdf, 'application/pdf');

  await withLedgerLock(async (client) => {
    await client.query(
      `insert into documents (id, reservation_id, kind, s3_key) values ($1, $2, 'upgrade-receipt', $3)
       on conflict (reservation_id, kind) where reservation_id is not null do nothing`,
      [newId('doc'), seat.id, key],
    );
    const freed = await client.query<{ upgrade_from_bench: string | null }>(
      `update reservations set payment_pending = null, upgrade_from_bench = null
       where id = $1 returning upgrade_from_bench`,
      [seat.id],
    );
    await queueUpgradeReceipt(client, seat.id, seat.buyer_email, seat.bench, amountCents);
    const oldBench = freed.rows[0]?.upgrade_from_bench ?? null;
    if (oldBench !== null) {
      await offerFreedBenches(client, [{ bench: oldBench, tier: tierOfBench(oldBench) }]);
    }
  });
}

export async function pendingPaymentIds(): Promise<string[]> {
  const result = await pool.query<{ payment_id: string }>(
    `select distinct item.payment_id
     from payment_items item
     join reservations r on r.id = item.reservation_id
     where r.payment_pending is not null`,
  );
  return result.rows.map((row) => row.payment_id);
}
