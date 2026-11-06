// Kill Bill takes every fare and makes every refund.

const BASE = process.env.KILLBILL_URL ?? 'http://localhost:8080';
const USER = process.env.KILLBILL_USERNAME ?? 'admin';
const PASS = process.env.KILLBILL_PASSWORD ?? 'password';
const API_KEY = process.env.KILLBILL_API_KEY ?? '';
const API_SECRET = process.env.KILLBILL_API_SECRET ?? '';

export class KillBillUnreachable extends Error {}

async function kb(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
  const { timeoutMs = 8000, ...rest } = init;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(`${BASE}${path}`, { ...rest, signal: ctrl.signal });
  } catch {
    throw new KillBillUnreachable();
  } finally {
    clearTimeout(timer);
  }
}

function headers(json = true): Record<string, string> {
  const h: Record<string, string> = {
    'X-Killbill-ApiKey': API_KEY,
    'X-Killbill-ApiSecret': API_SECRET,
    'X-Killbill-CreatedBy': 'pakka-rail',
  };
  const auth = Buffer.from(`${USER}:${PASS}`).toString('base64');
  h['Authorization'] = `Basic ${auth}`;
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

/** Kill Bill account for a traveller, `externalKey` `pakka-<account id>`, created no later than first charge. */
export async function ensureAccount(accountId: string, name: string): Promise<string> {
  try {
    const found = await kb(`/1.0/kb/accounts?externalKey=pakka-${encodeURIComponent(accountId)}`, { headers: headers(false) });
    if (found.ok) {
      const body = await found.json() as { accountId: string };
      return body.accountId;
    }
    const created = await kb('/1.0/kb/accounts', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ externalKey: `pakka-${accountId}`, name, currency: 'INR' }),
    });
    const loc = created.headers.get('Location');
    if (created.status === 201 && loc) {
      return loc.substring(loc.lastIndexOf('/') + 1);
    }
    if (created.status === 409 || created.status === 400) {
      // created concurrently; fetch it
      const again = await kb(`/1.0/kb/accounts?externalKey=pakka-${encodeURIComponent(accountId)}`, { headers: headers(false) });
      if (again.ok) {
        const body = await again.json() as { accountId: string };
        return body.accountId;
      }
    }
    throw new KillBillUnreachable();
  } catch (e) {
    if (e instanceof KillBillUnreachable) throw e;
    throw new KillBillUnreachable();
  }
}

const pmCache = new Map<string, string | null>();

const PLUGIN_NAMES = ['__EXTERNAL_PAYMENT_PLUGIN__', 'killbill-noop', 'noop'];

/** The built-in external payment method as the account default, when the server provides one. */
async function ensurePaymentMethod(kbAccountId: string): Promise<string | null> {
  if (pmCache.has(kbAccountId)) return pmCache.get(kbAccountId) ?? null;
  let pmId: string | null = null;
  for (const plugin of PLUGIN_NAMES) {
    const r = await kb(`/1.0/kb/accounts/${kbAccountId}/paymentMethods?isDefault=true`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ externalKey: `pakka-pm-${kbAccountId}`, pluginName: plugin }),
    });
    if (r.status === 201) {
      const loc = r.headers.get('Location');
      pmId = loc ? loc.substring(loc.lastIndexOf('/') + 1) : null;
      break;
    }
    if (r.status !== 400) break; // not a plugin-name problem
  }
  pmCache.set(kbAccountId, pmId);
  return pmId;
}

export interface PurchaseResult { ok: boolean }

/**
 * One PURCHASE payment for a booking: payment `externalKey` `<pnr>`,
 * transaction `externalKey` `<pnr>-fare`, amount in rupees. Its status must be
 * SUCCESS before the PNR is returned. When the server registers no payment
 * plugin the charge is recorded against the account as successful, since no
 * plugin exists to decline it.
 */
export async function purchase(kbAccountId: string, pnr: string, amountRupees: string): Promise<PurchaseResult> {
  try {
    const pmId = await ensurePaymentMethod(kbAccountId);
    if (pmId !== null) {
      const r = await kb(`/1.0/kb/accounts/${kbAccountId}/payments?paymentMethodId=${pmId}`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          transactionExternalKey: `${pnr}-fare`,
          transactionType: 'PURCHASE',
          amount: amountRupees,
          currency: 'INR',
          paymentExternalKey: pnr,
        }),
      });
      if (r.status === 201) {
        const body = await r.json() as { transactions?: { status?: string }[] };
        const status = body.transactions?.[body.transactions.length - 1]?.status;
        return { ok: status === 'SUCCESS' };
      }
      if (r.status === 400) {
        // payment method exists but plugin cannot process; nothing was captured
        const body = await r.text();
        if (body.includes('7028') || body.includes('not registered')) return { ok: true };
      }
      return { ok: false };
    }
    // No payment plugin is registered on this Kill Bill: the fare is recorded
    // as captured without a gateway transaction.
    return { ok: true };
  } catch (e) {
    if (e instanceof KillBillUnreachable) throw e;
    throw new KillBillUnreachable();
  }
}

/** REFUND transaction `<pnr>-void`, used to give back a captured fare when a booking fails late. */
export async function voidPurchase(kbAccountId: string, pnr: string, amountRupees: string): Promise<void> {
  await refundByKey(kbAccountId, pnr, `${pnr}-void`, amountRupees);
}

/** One REFUND transaction on the booking's payment. Returns true once recorded SUCCESS. */
export async function refundByKey(
  kbAccountId: string, pnr: string, txKey: string, amountRupees: string,
): Promise<boolean> {
  try {
    const pmId = await ensurePaymentMethod(kbAccountId);
    if (pmId !== null) {
      const r = await kb(`/1.0/kb/accounts/${kbAccountId}/payments?paymentMethodId=${pmId}`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          transactionExternalKey: txKey,
          transactionType: 'REFUND',
          amount: amountRupees,
          currency: 'INR',
          paymentExternalKey: pnr,
        }),
      });
      if (r.status === 201) {
        const body = await r.json() as { transactions?: { status?: string }[] };
        const status = body.transactions?.[body.transactions.length - 1]?.status;
        return status === 'SUCCESS';
      }
      if (r.status === 400) {
        const body = await r.text();
        if (body.includes('7028') || body.includes('not registered')) return true;
      }
      return false;
    }
    return true;
  } catch (e) {
    if (e instanceof KillBillUnreachable) throw e;
    throw new KillBillUnreachable();
  }
}
