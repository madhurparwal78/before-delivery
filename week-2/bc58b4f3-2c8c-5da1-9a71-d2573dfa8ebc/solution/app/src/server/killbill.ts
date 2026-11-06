// Kill Bill: one account per client organisation and one external charge per billable assignment.
import { plainDollars } from "../shared/money.js";
import { config } from "./config.js";

/** Kill Bill could not be reached (or answered with a server error); the post is queued. */
export class KillBillUnreachable extends Error {}

const auth = `Basic ${Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString("base64")}`;

async function call(method: string, path: string, body?: string): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${config.killbill.url}/1.0/kb${path}`, {
      method,
      headers: {
        Authorization: auth,
        "X-Killbill-ApiKey": config.killbill.apiKey,
        "X-Killbill-ApiSecret": config.killbill.apiSecret,
        "X-Killbill-CreatedBy": "teamseat",
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    throw new KillBillUnreachable(error instanceof Error ? error.message : String(error));
  }
  if (response.status >= 500) throw new KillBillUnreachable(`Kill Bill answered ${response.status}`);
  return response;
}

async function findAccount(externalKey: string): Promise<string | null> {
  const response = await call("GET", `/accounts?externalKey=${encodeURIComponent(externalKey)}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Kill Bill account lookup answered ${response.status}`);
  return ((await response.json()) as { accountId: string }).accountId;
}

/** The organisation's account (`teamseat-<code>`), created the first time it is needed. */
async function accountFor(orgCode: string, orgName: string): Promise<string> {
  const externalKey = `teamseat-${orgCode}`;
  const existing = await findAccount(externalKey);
  if (existing) return existing;
  const created = await call("POST", "/accounts", JSON.stringify({ name: orgName, externalKey, currency: "USD" }));
  if (created.status !== 201 && created.status !== 409) {
    throw new Error(`Kill Bill account creation answered ${created.status}: ${await created.text()}`);
  }
  return (await findAccount(externalKey))!;
}

interface InvoiceItem {
  invoiceId: string;
  description?: string;
  itemType?: string;
}

/** An external charge already on the account for this description (an earlier attempt whose answer was lost). */
async function existingCharge(accountId: string, description: string): Promise<string | null> {
  const response = await call("GET", `/accounts/${accountId}/invoices?includeInvoiceComponents=true`);
  if (!response.ok) throw new Error(`Kill Bill invoice lookup answered ${response.status}`);
  const invoices = (await response.json()) as Array<{ items?: InvoiceItem[] }>;
  for (const invoice of invoices) {
    const item = invoice.items?.find((i) => i.itemType === "EXTERNAL_CHARGE" && i.description === description);
    if (item) return item.invoiceId;
  }
  return null;
}

/** Create the single external charge of `totalCents` and return its invoice id. */
export async function postExternalCharge(
  org: { code: string; name: string },
  description: string,
  totalCents: number,
): Promise<string> {
  const accountId = await accountFor(org.code, org.name);
  const already = await existingCharge(accountId, description);
  if (already) return already;
  // The amount is written as a decimal literal built from integer cents, never through a float.
  const body =
    `[{"accountId":${JSON.stringify(accountId)},"amount":${plainDollars(totalCents)},"currency":"USD",` +
    `"itemType":"EXTERNAL_CHARGE","description":${JSON.stringify(description)}}]`;
  const response = await call("POST", `/invoices/charges/${accountId}?autoCommit=true`, body);
  if (!response.ok) throw new Error(`Kill Bill charge answered ${response.status}: ${await response.text()}`);
  const items = (await response.json()) as InvoiceItem[];
  const invoiceId = items[0]?.invoiceId;
  if (!invoiceId) throw new Error("Kill Bill charge returned no invoice id");
  return invoiceId;
}
