import { tierLabel } from '../../shared/labels';
import { one, text, type Queryable } from '../db';
import type { OrderAggregate } from '../data/orders';
import type { OrderFigures } from '../domain/figures';
import {
  ensureGrowerAccount,
  recordAccountCredit,
  recordExternalCharges,
  recordExternalPayment,
  unpaidInvoiceId,
  voidInvoice,
  type ChargeLine,
} from './killbill';

async function growerAccountId(client: Queryable, order: OrderAggregate): Promise<string> {
  const cached = await one(
    client,
    'select killbill_account_id from grower_accounts where grower_id = $1',
    [order.orchard.growerId],
  );
  if (cached !== null) return text(cached.killbill_account_id);
  const accountId = await ensureGrowerAccount({
    growerId: order.orchard.growerId,
    businessName: order.orchard.growerName,
    email: order.orchard.growerEmail,
  });
  await client.query(
    `insert into grower_accounts (grower_id, killbill_account_id) values ($1,$2)
       on conflict (grower_id) do nothing`,
    [order.orchard.growerId, accountId],
  );
  return accountId;
}

/** One invoice holding the deposit charge for a newly opened order. */
export async function recordDepositInvoice(
  client: Queryable,
  order: OrderAggregate,
  figures: OrderFigures,
): Promise<void> {
  const accountId = await growerAccountId(client, order);
  const invoiceId = await recordExternalCharges(accountId, [
    { description: `Deposit · ${order.ref}`, cents: figures.depositCents },
  ]);
  await client.query(
    `insert into order_billing (order_id, deposit_invoice_id, deposit_recorded_at)
     values ($1,$2, now())
     on conflict (order_id) do update set deposit_invoice_id = $2, deposit_recorded_at = now()`,
    [order.id, invoiceId],
  );
}

export async function voidDepositInvoice(client: Queryable, order: OrderAggregate): Promise<void> {
  const billing = await one(
    client,
    'select deposit_invoice_id from order_billing where order_id = $1',
    [order.id],
  );
  const invoiceId = billing === null ? null : billing.deposit_invoice_id;
  if (typeof invoiceId !== 'string') return;
  await voidInvoice(invoiceId);
}

function balanceChargeLines(order: OrderAggregate, figures: OrderFigures): ChargeLine[] {
  return order.blocks.flatMap((block) => {
    const strength = figures.blocks.get(block.blockId);
    if (strength === undefined || strength.payableCents === 0) return [];
    return [
      {
        description: `${order.ref} · ${block.name} · ${tierLabel(strength.tier)} · ${strength.hivesDelivered} hives`,
        cents: strength.payableCents,
      },
    ];
  });
}

export interface BalanceInvoiceResult {
  accountId: string;
  balanceInvoiceId: string | null;
}

/**
 * The tier-adjusted balance invoice followed by the deposit credit, so the
 * grower's account balance equals the orchard payable.
 */
export async function recordBalanceInvoice(
  client: Queryable,
  order: OrderAggregate,
  figures: OrderFigures,
): Promise<BalanceInvoiceResult> {
  const accountId = await growerAccountId(client, order);
  const lines = balanceChargeLines(order, figures);
  const balanceInvoiceId = lines.length === 0 ? null : await recordExternalCharges(accountId, lines);
  await recordAccountCredit(accountId, figures.depositCents, `Deposit applied · ${order.ref}`);
  return { accountId, balanceInvoiceId };
}

export async function saveBalanceInvoiceId(
  client: Queryable,
  orderId: string,
  balanceInvoiceId: string | null,
): Promise<void> {
  await client.query(
    `insert into order_billing (order_id, balance_invoice_id, balance_recorded_at)
     values ($1,$2, now())
     on conflict (order_id) do update set balance_invoice_id = $2, balance_recorded_at = now()`,
    [orderId, balanceInvoiceId],
  );
}

/** One external payment of the orchard payable, idempotent on its external key. */
export async function recordSettlementPayment(
  client: Queryable,
  order: OrderAggregate,
  payableCents: number,
): Promise<void> {
  if (payableCents === 0) return;
  const accountId = await growerAccountId(client, order);
  const billing = await one(
    client,
    'select balance_invoice_id from order_billing where order_id = $1',
    [order.id],
  );
  const stored = billing === null ? null : billing.balance_invoice_id;
  const invoiceId = typeof stored === 'string' ? stored : await unpaidInvoiceId(accountId);
  if (invoiceId === null) return;
  await recordExternalPayment({
    accountId,
    invoiceId,
    cents: payableCents,
    externalKey: `settle-${order.id}`,
  });
  await client.query(
    `insert into order_billing (order_id, payment_recorded_at) values ($1, now())
       on conflict (order_id) do update set payment_recorded_at = now()`,
    [order.id],
  );
}

export async function voidBalanceInvoice(invoiceId: string | null): Promise<void> {
  if (invoiceId === null) return;
  await voidInvoice(invoiceId);
}
