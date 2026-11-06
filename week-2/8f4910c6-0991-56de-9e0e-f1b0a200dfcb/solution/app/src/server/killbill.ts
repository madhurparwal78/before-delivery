// Kill Bill REST client: client accounts, draft and committed external charges, commits, voids and credits.

import { config } from "./config.js";
import { billingUnavailable } from "./errors.js";
import { plainAmount } from "../shared/format.js";
import { exec, the, type Db } from "./db.js";

const { url, username, password, apiKey, apiSecret } = config.killbill;
const AUTH = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;

async function call(method: string, path: string, body?: string, missingOk = false): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${url}/1.0/kb${path}`, {
      method,
      headers: {
        Authorization: AUTH,
        "X-Killbill-ApiKey": apiKey,
        "X-Killbill-ApiSecret": apiSecret,
        "X-Killbill-CreatedBy": "rungboard",
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body,
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw billingUnavailable();
  }
  if (response.status >= 400 && !(missingOk && response.status === 404)) {
    console.error(`kill bill ${method} ${path}: ${response.status} ${(await response.text()).slice(0, 300)}`);
    throw billingUnavailable();
  }
  return response;
}

export interface BillingClient {
  id: string;
  slug: string;
  company: string;
  contact_email: string;
  killbill_account_id: string | null;
}

/** The client's CAD account (`rungboard-client-<slug>`), created on first use. */
export async function accountFor(db: Db, client: BillingClient): Promise<string> {
  if (client.killbill_account_id) return client.killbill_account_id;
  const externalKey = `rungboard-client-${client.slug}`;
  let found = await call("GET", `/accounts?externalKey=${encodeURIComponent(externalKey)}`, undefined, true);
  if (found.status === 404) {
    await call("POST", "/accounts", JSON.stringify({
      name: client.company, email: client.contact_email, currency: "CAD", externalKey,
    }));
    found = await call("GET", `/accounts?externalKey=${encodeURIComponent(externalKey)}`);
  }
  const account = (await found.json()) as { accountId: string };
  await exec(db, "UPDATE clients SET killbill_account_id = $2 WHERE id = $1", [client.id, account.accountId]);
  return account.accountId;
}

export interface Charge {
  description: string;
  amountCents: number;
}

/** Amounts go out as dollar decimal literals written from integer cents (no float maths). */
async function addCharges(accountId: string, charges: Charge[], autoCommit: boolean): Promise<string> {
  const items = charges.map((charge) =>
    `{"accountId":${JSON.stringify(accountId)},"description":${JSON.stringify(charge.description)},` +
    `"amount":${plainAmount(charge.amountCents)},"currency":"CAD"}`);
  const response = await call("POST", `/invoices/charges/${accountId}?autoCommit=${autoCommit}`, `[${items.join(",")}]`);
  const created = (await response.json()) as Array<{ invoiceId: string }>;
  return created[0].invoiceId;
}

/** One DRAFT invoice holding one external charge per line; returns Kill Bill's invoice id. */
export function draftInvoice(accountId: string, charges: Charge[]): Promise<string> {
  return addCharges(accountId, charges, false);
}

/** One committed external charge; returns Kill Bill's invoice id. */
export function committedCharge(accountId: string, charge: Charge): Promise<string> {
  return addCharges(accountId, [charge], true);
}

export async function commitInvoice(invoiceId: string): Promise<void> {
  await call("PUT", `/invoices/${invoiceId}/commitInvoice`);
}

export async function voidInvoice(invoiceId: string): Promise<void> {
  await call("PUT", `/invoices/${invoiceId}/voidInvoice`);
}

export async function credit(accountId: string, charge: Charge): Promise<void> {
  await call("POST", "/credits?autoCommit=true",
    `[{"accountId":${JSON.stringify(accountId)},"amount":${plainAmount(charge.amountCents)},` +
    `"currency":"CAD","description":${JSON.stringify(charge.description)}}]`);
}

export async function billingClient(db: Db, clientId: string): Promise<BillingClient> {
  return the<BillingClient>(db, "SELECT id, slug, company, contact_email, killbill_account_id FROM clients WHERE id = $1",
    [clientId]);
}
