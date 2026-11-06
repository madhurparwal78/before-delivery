import { config } from './config.js';

/** Kill Bill API client. Every call carries an explicit timeout (DP standards). */
export class KillBillError extends Error {
  constructor(readonly kind: 'unreachable' | 'server') {
    super(kind);
  }
}

function headers(): Record<string, string> {
  return {
    'Authorization': 'Basic ' + Buffer.from(`${config.killbillUsername}:${config.killbillPassword}`).toString('base64'),
    'X-Killbill-Apikey': config.killbillApiKey,
    'X-Killbill-ApiSecret': config.killbillApiSecret,
    'X-Killbill-CreatedBy': 'clinchline',
    'Content-Type': 'application/json'
  };
}

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const url = `${config.killbillUrl}/1.0/kb${path}`;
  try {
    const res = await fetch(url, {
      method,
      headers: headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(5000)
    });
    const text = await res.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    if (res.status >= 500) throw new KillBillError('server');
    return { status: res.status, json };
  } catch (e) {
    if (e instanceof KillBillError) throw e;
    throw new KillBillError('unreachable');
  }
}

const usd = (cents: number) => Math.round(cents) / 100;

/** One account per owner, created once (Services, Kill Bill). */
export async function ensureAccount(ownerEmail: string, ownerName: string): Promise<string> {
  const found = await call('GET', `/accounts?externalKey=${encodeURIComponent(ownerEmail)}`);
  if (found.status === 200 && found.json && found.json.accountId) return found.json.accountId;
  const created = await call('POST', `/accounts?createdBy=clinchline`, {
    externalKey: ownerEmail, name: ownerName, currency: 'USD'
  });
  if (created.status === 201 && created.json && created.json.accountId) return created.json.accountId;
  const again = await call('GET', `/accounts?externalKey=${encodeURIComponent(ownerEmail)}`);
  if (again.status === 200 && again.json && again.json.accountId) return again.json.accountId;
  throw new KillBillError('server');
}

export async function getAccount(ownerEmail: string): Promise<any | null> {
  const found = await call('GET', `/accounts?externalKey=${encodeURIComponent(ownerEmail)}`);
  return found.status === 200 ? found.json : null;
}

/** Creates the external-charge invoice. Returns null when a charge with the marker already exists. */
export async function createInvoiceWithCharges(
  accountId: string, invoiceDate: string, charges: Array<{ description: string; amount_cents: number }>
): Promise<{ invoiceId: string | null; created: boolean }> {
  const items = charges.map(c => ({
    itemType: 'EXTERNAL_CHARGE', description: c.description, amount: usd(c.amount_cents), currency: 'USD', startDate: invoiceDate
  }));
  const res = await call('POST', `/invoices/charges/${accountId}?autoCommit=true&targetDate=${invoiceDate}`, items);
  if ((res.status === 200 || res.status === 201) && Array.isArray(res.json) && res.json.length > 0) {
    return { invoiceId: res.json[0].invoiceId, created: true };
  }
  throw new KillBillError('server');
}

export async function findInvoiceIdByMarker(accountId: string, marker: string): Promise<string | null> {
  const res = await call('GET', `/accounts/${accountId}/invoices`);
  if (res.status !== 200 || !Array.isArray(res.json)) return null;
  for (const inv of res.json) {
    for (const item of inv.items ?? []) {
      if (typeof item.description === 'string' && item.description.includes(marker)) return inv.invoiceId;
    }
  }
  return null;
}

export async function getInvoiceBalance(invoiceId: string): Promise<{ balance: number; paid: number; refunded: number; total: number } | null> {
  const res = await call('GET', `/invoices/${invoiceId}`);
  if (res.status !== 200 || !res.json) return null;
  const inv = res.json;
  // `amount` reflects the charges after item adjustments.
  const total = Math.round((inv.amount ?? 0) * 100);
  const pay = await call('GET', `/invoices/${invoiceId}/payments`);
  let paid = 0;
  let refunded = 0;
  if (pay.status === 200 && Array.isArray(pay.json)) {
    for (const p of pay.json) {
      paid += Math.round((p.purchasedAmount ?? 0) * 100);
      refunded += Math.round((p.refundedAmount ?? 0) * 100);
    }
  }
  return { balance: Math.round((inv.balance ?? 0) * 100), paid, refunded, total };
}

/**
 * Full read-back for reconciliation (DP-71). CREDIT refunds appear as separate
 * account payments carrying their transaction key, so `creditPrefix` names the
 * app invoice whose paired refund legs count as this invoice's refunds.
 */
export async function getInvoiceReadback(
  accountId: string, invoiceId: string, creditPrefix: string
): Promise<{ balance: number; paid: number; refunded: number; total: number } | null> {
  const base = await getInvoiceBalance(invoiceId);
  if (!base) return null;
  const acctPay = await call('GET', `/accounts/${accountId}/payments`);
  let credited = 0;
  if (acctPay.status === 200 && Array.isArray(acctPay.json)) {
    for (const p of acctPay.json) {
      for (const t of p.transactions ?? []) {
        if (typeof t.transactionExternalKey === 'string' && t.transactionExternalKey.startsWith(creditPrefix)) {
          credited += Math.round((p.creditedAmount ?? t.amount ?? 0) * 100);
        }
      }
    }
  }
  return { ...base, refunded: base.refunded + credited };
}

/** External payment against an invoice; idempotent on the payment external key. */
export async function createExternalPayment(
  invoiceId: string, accountId: string, amountCents: number, paymentExternalKey: string, transactionExternalKey: string
): Promise<{ paymentId: string | null; created: boolean }> {
  // Idempotent on the payment external key we own.
  const existing = await findPaymentIdByKey(invoiceId, paymentExternalKey);
  if (existing) return { paymentId: existing, created: false };
  const res = await call('POST', `/invoices/${invoiceId}/payments?externalPayment=true`, {
    accountId,
    targetInvoiceId: invoiceId,
    purchasedAmount: usd(amountCents),
    paymentExternalKey,
    transactions: [{ transactionType: 'PURCHASE', amount: usd(amountCents), currency: 'USD', transactionExternalKey }]
  });
  // Kill Bill answers 204 with no body for external payments; look the payment up by its key.
  if (res.status === 200 || res.status === 201 || res.status === 204) {
    const found = await findPaymentIdByKey(invoiceId, paymentExternalKey);
    if (found) return { paymentId: found, created: true };
    if (res.json && res.json.paymentId) return { paymentId: res.json.paymentId, created: true };
  }
  throw new KillBillError('server');
}

export async function findPaymentIdByKey(invoiceId: string, paymentExternalKey: string): Promise<string | null> {
  const res = await call('GET', `/invoices/${invoiceId}/payments`);
  if (res.status !== 200 || !Array.isArray(res.json)) return null;
  for (const p of res.json) {
    if (p.paymentExternalKey === paymentExternalKey) return p.paymentId;
  }
  return null;
}

/**
 * The deposit credit's out leg: a refund of the deposit-in purchase with an
 * item adjustment, so the credit adjusts this invoice's charges (DP-69).
 */
export async function transferDepositCreditOut(
  accountId: string, invoiceId: string, depositInPaymentId: string, amountCents: number, transactionExternalKey: string
): Promise<boolean> {
  const exists = await findCreditTransaction(accountId, transactionExternalKey);
  if (exists) return false;
  const items = await call('GET', `/invoices/${invoiceId}`);
  let adjustments: Array<{ invoiceItemId: string; amount: number }> = [];
  if ((items.status === 200 || items.status === 201) && Array.isArray(items.json?.items)) {
    const charge = items.json.items.find((i: { itemType: string }) => i.itemType === 'EXTERNAL_CHARGE');
    if (charge) adjustments = [{ invoiceItemId: charge.invoiceItemId, amount: usd(amountCents) }];
  }
  const res = await call('POST', `/invoicePayments/${depositInPaymentId}/refunds?externalPayment=true`, {
    transactionType: 'CREDIT', amount: usd(amountCents), currency: 'USD',
    isAdjusted: true, adjustments, transactionExternalKey
  });
  if (res.status === 200 || res.status === 201 || res.status === 204) return true;
  throw new KillBillError('server');
}

/** Refund as a CREDIT transaction with an item adjustment so the credit stays on that invoice (Services, Kill Bill). */
export async function createRefund(
  accountId: string, paymentId: string, invoiceId: string, amountCents: number, transactionExternalKey: string
): Promise<{ created: boolean }> {
  const existing = await findCreditTransaction(accountId, transactionExternalKey);
  if (existing) return { created: false };
  const items = await call('GET', `/invoices/${invoiceId}`);
  let adjustments: Array<{ invoiceItemId: string; amount: number }> = [];
  if ((items.status === 200 || items.status === 201) && Array.isArray(items.json?.items)) {
    const charge = items.json.items.find((i: { itemType: string }) => i.itemType === 'EXTERNAL_CHARGE');
    if (charge) adjustments = [{ invoiceItemId: charge.invoiceItemId, amount: usd(amountCents) }];
  }
  const res = await call('POST', `/invoicePayments/${paymentId}/refunds?externalPayment=true`, {
    transactionType: 'CREDIT', amount: usd(amountCents), currency: 'USD',
    isAdjusted: true, adjustments, transactionExternalKey
  });
  if (res.status === 200 || res.status === 201 || res.status === 204) return { created: true };
  throw new KillBillError('server');
}

export async function findPaymentIdByTransactionKey(invoiceId: string, transactionExternalKey: string): Promise<string | null> {
  // Kill Bill rewrites transaction external keys to its own ids, so match the
  // payment external key we sent for the capture instead.
  const res = await call('GET', `/invoices/${invoiceId}/payments`);
  if (res.status !== 200 || !Array.isArray(res.json)) return null;
  for (const p of res.json) {
    if (p.paymentExternalKey === transactionExternalKey) return p.paymentId;
    for (const t of p.transactions ?? []) {
      if (t.transactionExternalKey === transactionExternalKey) return p.paymentId;
    }
  }
  return null;
}

/** CREDIT refunds appear as separate payments on the account, each carrying the refund id as its transaction key. */
export async function findCreditTransaction(accountId: string, transactionExternalKey: string): Promise<boolean> {
  const res = await call('GET', `/accounts/${accountId}/payments`);
  if (res.status !== 200 || !Array.isArray(res.json)) return false;
  for (const p of res.json) {
    for (const t of p.transactions ?? []) {
      if (t.transactionExternalKey === transactionExternalKey) return true;
    }
  }
  return false;
}

export async function killbillUp(): Promise<boolean> {
  try {
    await fetch(`${config.killbillUrl}/1.0/kb/health`, {
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${config.killbillUsername}:${config.killbillPassword}`).toString('base64'),
        'X-Killbill-Apikey': config.killbillApiKey,
        'X-Killbill-ApiSecret': config.killbillApiSecret
      },
      signal: AbortSignal.timeout(2000)
    });
    return true;
  } catch {
    return false;
  }
}
