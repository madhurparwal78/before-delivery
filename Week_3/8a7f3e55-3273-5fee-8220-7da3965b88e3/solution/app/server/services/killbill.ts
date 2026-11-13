import { config } from "../config.js";

const TIMEOUT_MS = 8_000;

export class BillingUnavailable extends Error {}

export interface BillingItem {
  invoiceItemId: string;
  linkedInvoiceItemId: string | null;
  description: string;
  amountCents: number;
}

interface RawItem {
  invoiceItemId: string;
  linkedInvoiceItemId: string | null;
  description: string | null;
  amount: number;
}

interface RawInvoice {
  items?: RawItem[] | null;
}

const authorization = `Basic ${Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString("base64")}`;

const dollarsToCents = (dollars: number): number => Number(dollars.toFixed(2).replace(".", ""));
const centsToDollarText = (cents: number): string => `${Math.trunc(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;

async function call(method: "GET" | "POST", path: string, body?: string): Promise<Response> {
  try {
    return await fetch(`${config.killbill.url}/1.0/kb${path}`, {
      method,
      headers: {
        authorization,
        "content-type": "application/json",
        "x-killbill-apikey": config.killbill.apiKey,
        "x-killbill-apisecret": config.killbill.apiSecret,
        "x-killbill-createdby": "relayline",
      },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new BillingUnavailable("Kill Bill cannot be reached");
  }
}

async function readJson<T>(response: Response): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    throw new BillingUnavailable("Kill Bill answered something unreadable");
  }
}

/** The Kill Bill account id for an organisation, or null when it has none yet. */
export async function findAccountId(orgId: string): Promise<string | null> {
  const response = await call("GET", `/accounts?externalKey=${encodeURIComponent(orgId)}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new BillingUnavailable(`accounts answered ${response.status}`);
  return (await readJson<{ accountId: string }>(response)).accountId;
}

export async function ensureAccountId(orgId: string, orgName: string): Promise<string> {
  const existing = await findAccountId(orgId);
  if (existing !== null) return existing;
  const created = await call("POST", "/accounts", JSON.stringify({ name: orgName, externalKey: orgId, currency: "USD" }));
  if (!created.ok && created.status !== 409) throw new BillingUnavailable(`account creation answered ${created.status}`);
  const found = await findAccountId(orgId);
  if (found === null) throw new BillingUnavailable("account is missing after creation");
  return found;
}

/** Every invoice item on the account: the charges and the adjustments recorded against them. */
export async function invoiceItems(accountId: string): Promise<BillingItem[]> {
  const response = await call("GET", `/accounts/${accountId}/invoices?includeInvoiceComponents=true`);
  if (!response.ok) throw new BillingUnavailable(`invoices answered ${response.status}`);
  const invoices = await readJson<RawInvoice[]>(response);
  return invoices.flatMap((invoice) =>
    (invoice.items ?? []).map((item) => ({
      invoiceItemId: item.invoiceItemId,
      linkedInvoiceItemId: item.linkedInvoiceItemId,
      description: item.description ?? "",
      amountCents: dollarsToCents(item.amount),
    })),
  );
}

export async function postCharge(accountId: string, amountCents: number, description: string): Promise<void> {
  const body =
    `[{"accountId":${JSON.stringify(accountId)},"amount":${centsToDollarText(amountCents)},` +
    `"currency":"USD","description":${JSON.stringify(description)}}]`;
  const response = await call("POST", `/invoices/charges/${accountId}?autoCommit=true`, body);
  if (!response.ok) throw new BillingUnavailable(`charge answered ${response.status}`);
}

/** The charge whose description starts with `<line ref> <booking ref> `, if Kill Bill holds one. */
export const chargeForLine = (items: readonly BillingItem[], lineRef: string, bookingRef: string): BillingItem | undefined =>
  items.find((item) => item.linkedInvoiceItemId === null && item.description.startsWith(`${lineRef} ${bookingRef} `));

/** Kill Bill's current amount for a charge: the charge plus every adjustment recorded against it. */
export const currentAmountCents = (items: readonly BillingItem[], charge: BillingItem): number =>
  items.reduce((sum, item) => (item.linkedInvoiceItemId === charge.invoiceItemId ? sum + item.amountCents : sum), charge.amountCents);
