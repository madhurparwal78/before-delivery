import { config } from "../config.js";
import { billingUnavailable } from "../http/errors.js";
import { plainAmount, type Currency } from "../../shared/format.js";

// Kill Bill: one account per project and one committed invoice holding one external charge per sign-off
// (brief: Services, Kill Bill). Any failure to reach it, or any error it answers, is 503 billing_unavailable.

export interface StageInvoice {
  killbillInvoiceId: string;
  invoiceNumber: string;
  amountCents: number;
  currency: Currency;
}

async function call(method: string, path: string, body?: string): Promise<Response> {
  const { url, username, password, apiKey, apiSecret } = config.killbill;
  let response: Response;
  try {
    response = await fetch(`${url}/1.0/kb${path}`, {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
        "X-Killbill-ApiKey": apiKey,
        "X-Killbill-ApiSecret": apiSecret,
        "X-Killbill-CreatedBy": "plumbline",
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body,
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw billingUnavailable();
  }
  return response;
}

async function accountId(externalKey: string, name: string, currency: Currency): Promise<string> {
  const path = `/accounts?externalKey=${encodeURIComponent(externalKey)}`;
  let found = await call("GET", path);
  if (found.status === 404) {
    const created = await call("POST", "/accounts", JSON.stringify({ name, externalKey, currency }));
    if (created.status !== 201) throw billingUnavailable();
    found = await call("GET", path);
  }
  if (found.status !== 200) throw billingUnavailable();
  return ((await found.json()) as { accountId: string }).accountId;
}

export async function raiseStageInvoice(charge: {
  externalKey: string; accountName: string; currency: Currency; amountCents: number; description: string;
}): Promise<StageInvoice> {
  const account = await accountId(charge.externalKey, charge.accountName, charge.currency);
  // The amount goes out as a decimal literal built from whole cents, never through a float.
  const items = `[{"accountId":${JSON.stringify(account)},"amount":${plainAmount(charge.amountCents)},` +
    `"currency":"${charge.currency}","description":${JSON.stringify(charge.description)}}]`;
  const created = await call("POST", `/invoices/charges/${account}?autoCommit=true`, items);
  if (created.status !== 200 && created.status !== 201) throw billingUnavailable();
  const [item] = (await created.json()) as { invoiceId: string }[];
  const invoice = await call("GET", `/invoices/${item.invoiceId}`);
  if (invoice.status !== 200) throw billingUnavailable();
  const { invoiceNumber } = (await invoice.json()) as { invoiceNumber: number | string };
  return { killbillInvoiceId: item.invoiceId, invoiceNumber: String(invoiceNumber), amountCents: charge.amountCents, currency: charge.currency };
}

/** Voids an invoice whose sign-off could not be recorded (brief: Sign-off is all or nothing). */
export async function voidInvoice(invoiceId: string): Promise<void> {
  await call("PUT", `/invoices/${invoiceId}/voidInvoice`);
}
