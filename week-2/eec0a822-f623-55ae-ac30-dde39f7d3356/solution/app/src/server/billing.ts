// Kill Bill: one account and one committed invoice of external charges per recorded deposit.
import { config } from "./config";
import { minorToDecimal } from "../shared/money";

const { url, username, password, apiKey, apiSecret } = config.killbill;

async function kb(method: string, path: string, body?: unknown): Promise<Response> {
  return fetch(`${url}/1.0/kb${path}`, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
      "X-Killbill-ApiKey": apiKey,
      "X-Killbill-ApiSecret": apiSecret,
      "X-Killbill-CreatedBy": "tidewright",
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
}

interface InvoiceRequest {
  charterId: string;
  clientName: string;
  clientEmail: string;
  currency: string;
  items: { description: string; amountMinor: number }[];
}

/** Creates the account and the invoice; resolves with Kill Bill's invoice id or rejects. */
export async function createInvoice(request: InvoiceRequest): Promise<string> {
  const account = await kb("POST", "/accounts", {
    name: request.clientName,
    email: request.clientEmail,
    currency: request.currency,
    externalKey: `tidewright-${request.charterId}`,
  });
  if (account.status !== 201) throw new Error(`account: ${account.status} ${await account.text()}`);
  const accountId = account.headers.get("location")?.split("/").pop();
  if (!accountId) throw new Error("account: no id");
  const charges = await kb(
    "POST",
    `/invoices/charges/${accountId}?autoCommit=true`,
    request.items.map((item) => ({
      accountId,
      description: item.description,
      amount: Number(minorToDecimal(item.amountMinor)),
      currency: request.currency,
    })),
  );
  if (charges.status !== 201 && charges.status !== 200) throw new Error(`charges: ${charges.status} ${await charges.text()}`);
  const created = (await charges.json()) as { invoiceId?: string }[];
  const invoiceId = created[0]?.invoiceId;
  if (!invoiceId || created.some((item) => item.invoiceId !== invoiceId)) throw new Error("charges: no single invoice");
  return invoiceId;
}

export async function voidInvoice(invoiceId: string): Promise<void> {
  const res = await kb("PUT", `/invoices/${invoiceId}/voidInvoice`);
  if (!res.ok) throw new Error(`void: ${res.status}`);
}
