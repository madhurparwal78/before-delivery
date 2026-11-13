import { Deps, PackRow, inWriteTx, inReadTx } from '../store.js';
import { ApiError, messages } from '../api/errors.js';
import { ruleCopy } from '../api/copy.js';
import { PACK_CATALOG, refundCents, durationText, dollars } from '../domain/rules.js';
import { writeMovement, packBalance, packHeldMinutes, packHasUpcomingBooking } from './packs.js';
import { queueEmail } from '../mail/queue.js';
import { KillBill, BillingDown } from '../billing/killbill.js';
import { newId } from '../domain/crypto.js';
import { Config } from '../config.js';

export interface PurchaseOutcome {
  status: 'created' | 'pending';
  pack: PackRow;
}

// Buying an hour pack: the Kill Bill invoice is created and paid before any
// hours are credited, and the pack row, purchase movement and receipt email are
// written in one database step afterwards.
export async function purchasePack(deps: Deps, kb: KillBill, tenantId: string, hours: 10 | 20 | 40, attemptId: string): Promise<PurchaseOutcome> {
  const priceCents = PACK_CATALOG.find((p) => p.hours === hours)!.priceCents;
  const amount = (priceCents / 100).toFixed(2);
  const description = `Stationhouse ${hours}-hour pack`;

  const tenant = await inReadTx(deps, async (tx) => {
    const r = await tx.query<{ business_name: string; contact_name: string; email: string }>(
      `SELECT t.business_name, t.contact_name, u.email FROM tenants t JOIN users u ON u.id=t.user_id WHERE t.id=$1`,
      [tenantId],
    );
    return r.rows[0];
  });

  let invoiceId: string;
  let paymentId: string;
  const paymentKey = `stationhouse-attempt-${attemptId}`;
  try {
    const accountId = await kb.ensureAccount(tenantId, tenant.business_name, tenant.email);
    const paid = await kb.createPaidInvoice(accountId, description, amount, attemptId);
    invoiceId = paid.invoiceId;
    paymentId = paid.paymentId;
  } catch (e) {
    if (e instanceof BillingDown) {
      // The attempt row may already hold a payment from a crashed earlier try;
      // otherwise look for the payment by its attempt key in Kill Bill, so a
      // paid-but-not-recorded purchase finishes without a second charge.
      const existing = await findExistingPayment(deps, attemptId);
      if (existing) {
        invoiceId = existing.invoiceId;
        paymentId = existing.paymentId;
      } else {
        const payment = await kb.findPaymentByKey(paymentKey);
        const recoveredInvoice = payment ? await kb.invoiceOfPayment(payment.paymentId) : null;
        if (payment && recoveredInvoice) {
          invoiceId = recoveredInvoice;
          paymentId = payment.paymentId;
        } else {
          throw new ApiError(503, 'billing_unavailable', messages.billingUnavailablePurchase);
        }
      }
    } else {
      throw e;
    }
  }

  return inWriteTx(deps, async (tx, now) => {
    const packId = newId();
    const purchasedMinutes = hours * 60;
    await tx.query(
      `INSERT INTO packs (id, tenant_id, hours, price_cents, status, invoice_id, purchased_at)
       VALUES ($1,$2,$3,$4,'active',$5,$6)`,
      [packId, tenantId, hours, priceCents, invoiceId, now],
    );
    await writeMovement(tx, 'purchase', packId, purchasedMinutes, null, now);
    await tx.query(`UPDATE purchase_attempts SET status='complete', invoice_id=$2, payment_id=$3 WHERE id=$1`, [attemptId, invoiceId, paymentId]);
    await queueEmail(tx, tenantId, {
      kind: 'pack_receipt',
      recordId: packId,
      toName: tenant.contact_name,
      toEmail: tenant.email,
      subject: `Receipt: ${hours}-hour pack`,
      body: [
        `Hours added: ${hours} h`,
        `Amount: $${amount}`,
        `Invoice: ${invoiceId}`,
        `Purchased: ${deps.clock.longDateFromKey(deps.clock.dateKey(now))} ${deps.clock.hhmm(now)} ${deps.clock.zoneLabel()}`,
      ].join('\n'),
    }, now);
    const packR = await tx.query<PackRow>(`SELECT * FROM packs WHERE id=$1`, [packId]);
    return { status: 'created' as const, pack: packR.rows[0] };
  });
}

async function findExistingPayment(deps: Deps, attemptId: string): Promise<{ invoiceId: string; paymentId: string } | null> {
  const row = await inReadTx(deps, async (tx) => {
    const r = await tx.query<{ invoice_id: string | null; payment_id: string | null }>(
      `SELECT invoice_id, payment_id FROM purchase_attempts WHERE id=$1`, [attemptId],
    );
    return r.rows[0];
  });
  if (row && row.invoice_id && row.payment_id) return { invoiceId: row.invoice_id, paymentId: row.payment_id };
  return null;
}

// The prorated refund of a pack's unused hours, checked under the pack's lock.
export async function refundPack(deps: Deps, kb: KillBill, packId: string, expectedCents: number): Promise<PackRow> {
  const locked = await inWriteTx(deps, async (tx, now) => {
    const lock = await tx.query(`SELECT id FROM packs WHERE id=$1 FOR UPDATE`, [packId]);
    if (lock.rows.length === 0) throw new ApiError(404, 'not_found', "That record isn't available.");
    const packR = await tx.query<PackRow>(`SELECT * FROM packs WHERE id=$1`, [packId]);
    const pack = packR.rows[0];
    const balance = await packBalance(tx, packId);
    const held = await packHeldMinutes(tx, packId, now);
    const refundable = refundCents(pack.price_cents, balance, pack.hours * 60);
    if (pack.status === 'refunded') return { error: new ApiError(409, 'invalid_transition', ruleCopy.refundAlready) };
    if (balance === 0) return { error: new ApiError(409, 'pack_empty', ruleCopy.refundEmpty) };
    if (held > 0 || (await packHasUpcomingBooking(tx, packId))) return { error: new ApiError(409, 'pack_in_use', ruleCopy.refundInUse) };
    if (expectedCents !== refundable) return { error: new ApiError(412, 'refund_amount_changed', `${ruleCopy.refundAmountChanged} ${refundable}`) };
    return { pack, balance, refundable };
  });

  if ('error' in locked && locked.error) {
    throw locked.error;
  }
  if ('error' in locked) {
    throw new ApiError(500, 'internal_error', messages.internal);
  }

  const amount = (locked.refundable / 100).toFixed(2);
  try {
    await kb.refundPayment(await findPackPaymentId(deps, locked.pack), amount, `stationhouse-refund-${packId}`);
  } catch (e) {
    if (e instanceof BillingDown) throw new ApiError(503, 'billing_unavailable', messages.billingUnavailableRefund);
    throw e;
  }

  return inWriteTx(deps, async (tx, now) => {
    await tx.query(`SELECT id FROM packs WHERE id=$1 FOR UPDATE`, [packId]);
    await writeMovement(tx, 'refund', packId, -locked.balance, null, now);
    await tx.query(`UPDATE packs SET status='refunded', refunded_cents=$2 WHERE id=$1`, [packId, locked.refundable]);
    const packR = await tx.query<PackRow>(`SELECT * FROM packs WHERE id=$1`, [packId]);
    return packR.rows[0];
  });
}

async function findPackPaymentId(deps: Deps, pack: PackRow): Promise<string> {
  const row = await inReadTx(deps, async (tx) => {
    const r = await tx.query<{ payment_id: string | null }>(
      `SELECT payment_id FROM purchase_attempts WHERE invoice_id=$1`, [pack.invoice_id],
    );
    return r.rows[0];
  });
  if (row?.payment_id) return row.payment_id;
  throw new ApiError(500, 'internal_error', messages.internal);
}

export function packRefundableCents(priceCents: number, balanceMinutes: number, purchasedMinutes: number): number {
  return refundCents(priceCents, balanceMinutes, purchasedMinutes);
}

export function durationOf(minutes: number): string {
  return durationText(minutes);
}

export function dollarsOf(cents: number): string {
  return dollars(cents);
}

export function configCheck(config: Config): void {
  void config;
}
