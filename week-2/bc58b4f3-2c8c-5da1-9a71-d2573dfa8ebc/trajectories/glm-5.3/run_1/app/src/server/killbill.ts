import { Config } from "./config";

export interface KbChargeResult {
  invoiceId: string;
}

interface KbInvoiceItem {
  invoiceId?: string;
  invoiceItemId?: string;
  description?: string;
  amount?: number;
}

interface KbInvoice {
  invoiceId: string;
  items: KbInvoiceItem[];
}

const KB_TIMEOUT_MS = 8000;

async function kbRequest(config: Config, method: "GET" | "POST", path: string, body?: unknown): Promise<{ status: number; json: unknown }> {
  const url = new URL(config.killbillUrl + path);
  const auth = Buffer.from(`${config.killbillUsername}:${config.killbillPassword}`).toString("base64");
  const headers: Record<string, string> = {
    Authorization: `Basic ${auth}`,
    "X-Killbill-ApiKey": config.killbillApiKey,
    "X-Killbill-ApiSecret": config.killbillApiSecret,
    "X-Killbill-CreatedBy": "teamseat",
  };
  const init: RequestInit = { method, headers, signal: AbortSignal.timeout(KB_TIMEOUT_MS) };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url, init);
  const text = await res.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  return { status: res.status, json };
}

export class KillBillUnavailable extends Error {}

function assertReachable(status: number, json: unknown): void {
  if (status === 0 || status >= 500 || status === 404 && json === null) {
    throw new KillBillUnavailable("Kill Bill is unreachable.");
  }
}

/** Find the account for an org, or create it on first use. Returns null when Kill Bill is down. */
export async function findOrCreateAccount(config: Config, orgCode: string, orgName: string): Promise<string | null> {
  const externalKey = `teamseat-${orgCode}`;
  let res;
  try {
    res = await kbRequest(config, "GET", `/1.0/kb/accounts?externalKey=${encodeURIComponent(externalKey)}`);
  } catch {
    return null;
  }
  if (res.status >= 500) return null;
  const account = res.json as { accountId?: string } | null;
  if (account && account.accountId) return account.accountId;
  if (res.status === 404) {
    // fall through to create
  } else if (!account) {
    return null;
  }
  try {
    const created = await kbRequest(config, "POST", "/1.0/kb/accounts", {
      name: orgName,
      externalKey,
      currency: "USD",
    });
    if (created.status === 201) {
      const got = await kbRequest(config, "GET", `/1.0/kb/accounts?externalKey=${encodeURIComponent(externalKey)}`);
      const found = got.json as { accountId?: string } | null;
      if (found && found.accountId) return found.accountId;
    }
    if (created.status === 409) {
      // Already created by a concurrent request; fetch it.
      const got = await kbRequest(config, "GET", `/1.0/kb/accounts?externalKey=${encodeURIComponent(externalKey)}`);
      const found = got.json as { accountId?: string } | null;
      if (found && found.accountId) return found.accountId;
    }
    return null;
  } catch {
    return null;
  }
}

async function listInvoices(config: Config, accountId: string): Promise<string[]> {
  const res = await kbRequest(config, "GET", `/1.0/kb/accounts/${accountId}/invoices`);
  assertReachable(res.status, res.json);
  if (!Array.isArray(res.json)) return [];
  return (res.json as { invoiceId?: string }[]).map((inv) => inv.invoiceId).filter((id): id is string => Boolean(id));
}

async function invoiceItems(config: Config, invoiceId: string): Promise<KbInvoiceItem[]> {
  const res = await kbRequest(config, "GET", `/1.0/kb/invoices/${invoiceId}`);
  assertReachable(res.status, res.json);
  const invoice = res.json as KbInvoice | null;
  return invoice?.items ?? [];
}

/** Look for an existing charge with our unique description (crash-safe exactly-once). */
async function findExistingCharge(config: Config, accountId: string, description: string, totalCents: number): Promise<KbChargeResult | null> {
  const invoiceIds = await listInvoices(config, accountId);
  for (const invoiceId of invoiceIds) {
    const items = await invoiceItems(config, invoiceId);
    for (const item of items) {
      if (item.description === description && item.invoiceId && Math.round(Number(item.amount) * 100) === totalCents) {
        return { invoiceId: item.invoiceId };
      }
    }
  }
  return null;
}

/**
 * Post one external charge. Resolves with the invoice id, or throws KillBillUnavailable.
 * Safe against retries: a charge with the same description already on the account
 * returns its invoice instead of creating a second item.
 */
export async function postCharge(
  config: Config,
  orgCode: string,
  orgName: string,
  totalCents: number,
  description: string,
): Promise<KbChargeResult> {
  const accountId = await findOrCreateAccount(config, orgCode, orgName);
  if (!accountId) throw new KillBillUnavailable("Kill Bill is unreachable.");
  const existing = await findExistingCharge(config, accountId, description, totalCents);
  if (existing) return existing;
  const amount = totalCents / 100;
  const res = await kbRequest(
    config,
    "POST",
    `/1.0/kb/invoices/charges/${accountId}?autoCommit=true`,
    [{ amount, currency: "USD", description, itemType: "EXTERNAL_CHARGE" }],
  );
  if (res.status >= 500) throw new KillBillUnavailable("Kill Bill is unreachable.");
  const items = res.json as { invoiceId?: string }[];
  if (Array.isArray(items) && items[0]?.invoiceId) {
    return { invoiceId: items[0].invoiceId };
  }
  // The item may still have been created; resolve it by description and amount.
  const found = await findExistingCharge(config, accountId, description, totalCents);
  if (found) return found;
  throw new KillBillUnavailable("Kill Bill did not answer with an invoice id.");
}

export async function killbillHealthy(config: Config): Promise<boolean> {
  try {
    const res = await kbRequest(config, "GET", "/1.0/kb/security/subject");
    return res.status === 200;
  } catch {
    return false;
  }
}
