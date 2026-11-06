// Kill Bill over HTTP, from the configured URL, admin credentials and tenant keys.
import { config } from "./config.js";
import { stringifyMoneyJson } from "../shared/json.js";
import type { FeeLine } from "./money.js";
import { plainMoney } from "../shared/format.js";

export class InvoicingUnreachable extends Error {}

async function call(method: string, path: string, body?: unknown): Promise<Response> {
  const auth = Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString("base64");
  try {
    return await fetch(`${config.killbill.url}/1.0/kb${path}`, {
      method,
      headers: {
        Authorization: `Basic ${auth}`,
        "X-Killbill-ApiKey": config.killbill.apiKey,
        "X-Killbill-ApiSecret": config.killbill.apiSecret,
        "X-Killbill-CreatedBy": "lanternline-desk",
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body === undefined ? undefined : stringifyMoneyJson(body),
      signal: AbortSignal.timeout(15000),
    });
  } catch (error) {
    throw new InvoicingUnreachable(`Kill Bill ${method} ${path}: ${String(error)}`);
  }
}

interface KillBillAccount {
  accountId: string;
}

interface KillBillInvoiceItem {
  invoiceId: string;
}

interface InvoiceAccount {
  slug: string;
  legalName: string;
  currency: string;
}

/** The workspace's account, external key `lanternline-<slug>`, created on first use and reused after that. */
async function account(owner: InvoiceAccount): Promise<string> {
  const externalKey = `lanternline-${owner.slug}`;
  const lookup = () => call("GET", `/accounts?externalKey=${encodeURIComponent(externalKey)}`);
  let found = await lookup();
  if (found.status === 404) {
    const created = await call("POST", "/accounts", { name: owner.legalName, externalKey, currency: owner.currency });
    if (created.status !== 201 && created.status !== 409) throw new InvoicingUnreachable(`create account: HTTP ${created.status}`);
    found = await lookup();
  }
  if (!found.ok) throw new InvoicingUnreachable(`account lookup: HTTP ${found.status}`);
  return ((await found.json()) as KillBillAccount).accountId;
}

/** Posts every fee line as an external charge in one call that commits one invoice; returns its id. */
export async function invoiceFeeLines(owner: InvoiceAccount, monthLabel: string, lines: FeeLine[]): Promise<string> {
  const accountId = await account(owner);
  const items = lines.map((line) => ({
    accountId,
    description: `${line.label}, ${line.count} ${line.count === 1 ? "message" : "messages"}, ${monthLabel}`,
    amount: JSON.rawJSON(plainMoney(line.amountCents)),
    currency: owner.currency,
  }));
  const response = await call("POST", `/invoices/charges/${accountId}?autoCommit=true`, items);
  if (response.status !== 201 && response.status !== 200) {
    throw new InvoicingUnreachable(`charges: HTTP ${response.status} ${await response.text()}`);
  }
  const created = (await response.json()) as KillBillInvoiceItem[];
  const invoiceIds = new Set(created.map((item) => item.invoiceId));
  if (invoiceIds.size !== 1) throw new InvoicingUnreachable(`charges returned ${invoiceIds.size} invoices`);
  return [...invoiceIds][0];
}
