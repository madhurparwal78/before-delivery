import { createHmac } from 'node:crypto';
import { config } from '../../config.js';

export interface KbAccount { accountId: string }
export interface KbInvoice { invoiceId: string; amount: number; balance?: number; status: string; items: { subscriptionId?: string; planName?: string; amount?: number }[] }
export interface KbPayment {
  paymentId: string;
  purchasedAmount?: number;
  amount?: number;
  status?: string;
  transactions?: { status: string; amount: number; transactionType?: string }[];
}

const authHeader = (): string => {
  const raw = `${config.killbillUsername}:${config.killbillPassword}`;
  return `Basic ${Buffer.from(raw).toString('base64')}`;
};

const headers = (extra: Record<string, string> = {}): Record<string, string> => ({
  Authorization: authHeader(),
  'X-Killbill-ApiKey': config.killbillApiKey,
  'X-Killbill-ApiSecret': config.killbillApiSecret,
  'X-Killbill-CreatedBy': 'phosphene-yard',
  'Content-Type': 'application/json',
  ...extra
});

async function kbFetch<T>(path: string, init: RequestInit, timeoutMs = 15_000): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${config.killbillUrl}${path}`, { ...init, headers: { ...headers(), ...(init.headers as Record<string, string>) }, signal: controller.signal });
    if (res.status === 404) return null;
    const text = await res.text();
    if (!res.ok) throw new Error(`killbill ${res.status}: ${text.slice(0, 300)}`);
    if (!text) {
      // Kill Bill answers 201 with an empty body and the new resource in Location.
      const location = res.headers.get('location') ?? '';
      const id = location.split('/').pop() ?? '';
      return { id } as unknown as T;
    }
    return (text ? JSON.parse(text) : null) as T;
  } catch (err) {
    if ((err as Error).message.startsWith('killbill')) throw err;
    throw new Error('killbill_unreachable');
  } finally {
    clearTimeout(timer);
  }
}

/** POST that returns the created resource's id from the Location header. */
async function kbCreate(path: string, init: RequestInit, timeoutMs = 15_000): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${config.killbillUrl}${path}`, { ...init, headers: { ...headers(), ...(init.headers as Record<string, string>) }, signal: controller.signal });
    if (res.ok) {
      const location = res.headers.get('location') ?? '';
      const text = await res.text();
      if (text) {
        try {
          const parsed = JSON.parse(text) as Record<string, unknown>;
          if (parsed.accountId) return String(parsed.accountId);
          if (parsed.invoiceId) return String(parsed.invoiceId);
          if (parsed.subscriptionId) return String(parsed.subscriptionId);
        } catch {
          // fall through to the Location header
        }
      }
      const id = location.split('/').pop();
      return id && id.length > 0 ? id : null;
    }
    const text = await res.text();
    throw new Error(`killbill ${res.status}: ${text.slice(0, 300)}`);
  } catch (err) {
    if ((err as Error).message.startsWith('killbill')) throw err;
    throw new Error('killbill_unreachable');
  } finally {
    clearTimeout(timer);
  }
}

async function kbStatus(path: string): Promise<number | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    const res = await fetch(`${config.killbillUrl}${path}`, { method: 'GET', headers: headers(), signal: controller.signal });
    clearTimeout(timer);
    return res.status;
  } catch {
    return null;
  }
}

export class KillBillClient {
  async probe(): Promise<boolean> {
    const status = await kbStatus('/1.0/kb/security/subject');
    return status !== null && status < 500;
  }

  async ensureAccount(userId: string, name: string, email: string): Promise<KbAccount | null> {
    const existing = await kbFetch<KbAccount[]>(`/1.0/kb/accounts/search/${encodeURIComponent(userId)}`, { method: 'GET' }).catch(() => null);
    if (existing && existing.length > 0 && existing[0]?.accountId) return existing[0];
    const createdId = await kbCreate('/1.0/kb/accounts?withAccountData=false', {
      method: 'POST',
      body: JSON.stringify({ name, externalKey: userId, email, currency: 'USD', timeZone: 'UTC', billCycleDayLocal: 1 })
    });
    if (!createdId) {
      // A concurrent instance may have created it first; re-read by search.
      const again = await kbFetch<KbAccount[]>(`/1.0/kb/accounts/search/${encodeURIComponent(userId)}`, { method: 'GET' }).catch(() => null);
      if (again && again.length > 0 && again[0]?.accountId) return again[0];
      throw new Error('killbill_create_account_failed');
    }
    return { accountId: createdId };
  }

  async createChargeInvoice(accountId: string, amount: number, description: string): Promise<KbInvoice> {
    // External charge: the invoice amount is dollars; commit it before paying.
    const items = await kbFetch<{ invoiceId: string }[]>(
      `/1.0/kb/invoices/charges/${accountId}?autoCommit=false`,
      { method: 'POST', body: JSON.stringify([{ amount: amount / 100, description, itemDetails: description }]) }
    );
    const invoiceId = items && items.length > 0 ? items[0].invoiceId : null;
    if (!invoiceId) throw new Error('killbill_invoice_failed');
    const commit = await fetch(`${config.killbillUrl}/1.0/kb/invoices/${invoiceId}/commitInvoice`, {
      method: 'PUT',
      headers: headers(),
      body: '{}'
    });
    if (!commit.ok) throw new Error(`killbill commit ${commit.status}`);
    return { invoiceId, amount, status: 'COMMITTED', items: [] };
  }

  async payInvoice(invoiceId: string, accountId: string, amount: number, externalKey: string): Promise<KbPayment> {
    const res = await fetch(`${config.killbillUrl}/1.0/kb/invoices/${invoiceId}/payments?externalPayment=true&pluginProperty=null`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ targetInvoiceId: invoiceId, accountId, purchasedAmount: amount / 100, currency: 'USD', paymentExternalKey: externalKey, auditLogs: [] })
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`killbill ${res.status}: ${text.slice(0, 300)}`);
    }
    const payments = await this.getInvoicePayments(invoiceId);
    const found = payments.find((p) => (p.purchasedAmount ?? p.amount ?? 0) >= amount / 100 - 0.005);
    if (found) return found;
    return { paymentId: '', amount, status: 'SUCCESS', transactions: [{ status: 'SUCCESS', amount }] };
  }

  async getInvoicePayments(invoiceId: string): Promise<KbPayment[]> {
    const payments = await kbFetch<KbPayment[]>(`/1.0/kb/invoices/${invoiceId}/payments?withPluginInfo=false&withAttempts=false&audit=NONE`, { method: 'GET' });
    return payments ?? [];
  }

  async getInvoice(invoiceId: string): Promise<KbInvoice | null> {
    return kbFetch<KbInvoice>(`/1.0/kb/invoices/${invoiceId}?audit=NONE`, { method: 'GET' });
  }

  async refundPayment(paymentId: string, amount: number, externalKey: string): Promise<KbPayment> {
    await kbCreate(`/1.0/kb/payments/${paymentId}/refunds?pluginProperty=null`, {
      method: 'POST',
      body: JSON.stringify({ amount: amount / 100, currency: 'USD', transactionExternalKey: externalKey, auditLogs: [] })
    });
    return { paymentId, amount, status: 'SUCCESS', transactions: [{ status: 'REFUNDED', amount }] };
  }

  async createSubscription(accountId: string, planName: string, bundleExternalKey: string): Promise<{ subscriptionId: string; bundleId: string }> {
    const bundles = await kbFetch<{ bundleId: string; subscriptions: { subscriptionId: string; state: string }[] }[]>(`/1.0/kb/accounts/${accountId}/bundles?externalKey=${encodeURIComponent(bundleExternalKey)}`, {
      method: 'GET'
    }).catch(() => null);
    for (const bundle of bundles ?? []) {
      const active = bundle.subscriptions?.find((sub) => sub.state === 'ACTIVE');
      if (active) return { subscriptionId: active.subscriptionId, bundleId: bundle.bundleId };
    }
    let subscriptionId: string | null = null;
    try {
      subscriptionId = await kbCreate(`/1.0/kb/subscriptions`, {
        method: 'POST',
        body: JSON.stringify({ accountId, planName, bundleExternalKey, phaseType: 'EVERGREEN' })
      });
    } catch (err) {
      // A concurrent instance may have created the base subscription first.
      if (!(err instanceof Error) || !err.message.includes('1015')) throw err;
      const again = await kbFetch<{ bundleId: string; subscriptions: { subscriptionId: string; state: string }[] }[]>(`/1.0/kb/accounts/${accountId}/bundles?externalKey=${encodeURIComponent(bundleExternalKey)}`, { method: 'GET' }).catch(() => null);
      const active = again?.[0]?.subscriptions?.find((sub) => sub.state === 'ACTIVE');
      if (!active) throw err;
      subscriptionId = active.subscriptionId;
    }
    if (!subscriptionId) throw new Error('killbill_subscription_failed');
    return { subscriptionId, bundleId: bundleExternalKey };
  }

  async cancelSubscription(subscriptionId: string): Promise<{ chargedThroughDate: string | null }> {
    await kbCreate(`/1.0/kb/subscriptions/${subscriptionId}?useRequestedDateForBilling=true`, {
      method: 'DELETE',
      body: JSON.stringify({})
    }).catch(() => null);
    const sub = await kbFetch<{ chargedThroughDate: string | null }>(`/1.0/kb/subscriptions/${subscriptionId}?audit=NONE`, { method: 'GET' });
    return sub ?? { chargedThroughDate: null };
  }

  async accountInvoices(accountId: string): Promise<KbInvoice[]> {
    const result = await kbFetch<KbInvoice[]>(`/1.0/kb/accounts/${accountId}/invoices?withItems=false&audit=NONE`, { method: 'GET' });
    if (Array.isArray(result)) return result;
    return (result as unknown as { invoices?: KbInvoice[] })?.invoices ?? [];
  }

  async ensureCatalog(): Promise<void> {
    // Register the two monthly plans through the simple-plan endpoint; a second
    // boot skips the ones that already exist.
    for (const plan of [
      { planId: 'studio-monthly', productName: 'Studio', productCategory: 'BASE', amount: 12, currency: 'USD', billingPeriod: 'MONTHLY', trialLength: 0 },
      { planId: 'pro-monthly', productName: 'Pro', productCategory: 'BASE', amount: 36, currency: 'USD', billingPeriod: 'MONTHLY', trialLength: 0 }
    ]) {
      await kbCreate('/1.0/kb/catalog/simplePlan', { method: 'POST', body: JSON.stringify(plan) }).catch(() => null);
    }
  }

  async registerCallback(token: string): Promise<void> {
    await kbFetch<null>(`/1.0/kb/tenants/registerNotificationCallback?callCompletion=false`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ callbackKey: 'phosphene-events', callbackUrl: `${config.appPublicUrl}/api/billing/killbill-events?token=${token}` })
    }).catch(() => null);
  }
}

export function callbackToken(): string {
  return createHmac('sha256', config.killbillApiSecret).update(config.killbillApiKey).digest('hex');
}

export function expectedCallbackToken(apiKey: string, apiSecret: string): string {
  return createHmac('sha256', apiSecret).update(apiKey).digest('hex');
}
