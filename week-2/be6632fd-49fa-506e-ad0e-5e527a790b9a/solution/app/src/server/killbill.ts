// Kill Bill over its REST API (brief: Services → Kill Bill). Any failure to reach it, or a refusal, is the
// billing outage: the caller rolls its transaction back and answers 503.
import { COPY } from "../shared/copy";
import { majorUnits } from "../shared/format";
import { config } from "./config";
import { ApiError } from "./http";

function billingDown(): ApiError {
  return new ApiError(503, "billing_unavailable", COPY.billingUnavailable);
}

async function call(method: string, path: string, body?: unknown): Promise<Response> {
  const { url, username, password, apiKey, apiSecret } = config.killbill;
  try {
    return await fetch(`${url}/1.0/kb${path}`, {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
        "X-Killbill-ApiKey": apiKey,
        "X-Killbill-ApiSecret": apiSecret,
        "X-Killbill-CreatedBy": "hourline",
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw billingDown();
  }
}

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) throw billingDown();
  return (await response.json()) as T;
}

/** The stockist's account, created at its first confirmation with external key `hourline-<stockistId>`. */
export async function accountFor(stockistId: string, name: string, currency: string): Promise<string> {
  const externalKey = `hourline-${stockistId}`;
  const found = await call("GET", `/accounts?externalKey=${encodeURIComponent(externalKey)}`);
  if (found.status === 200) return (await json<{ accountId: string }>(found)).accountId;
  if (found.status !== 404) throw billingDown();
  const created = await call("POST", "/accounts", { name, externalKey, currency });
  if (created.status !== 201) throw billingDown();
  return (await json<{ accountId: string }>(await call("GET", `/accounts?externalKey=${encodeURIComponent(externalKey)}`))).accountId;
}

interface Charge {
  description: string;
  lineTotalMinor: number;
}

/** One committed invoice with one external charge per priced line; returns the invoice's id and number. */
export async function invoice(accountId: string, currency: string, charges: Charge[]): Promise<{ invoiceId: string; invoiceNumber: string }> {
  const items = await json<Array<{ invoiceId: string }>>(
    await call(
      "POST",
      `/invoices/charges/${accountId}?autoCommit=true`,
      charges.map((c) => ({ accountId, description: c.description, amount: majorUnits(c.lineTotalMinor, currency), currency })),
    ),
  );
  const invoiceId = items[0]?.invoiceId;
  if (!invoiceId || items.some((i) => i.invoiceId !== invoiceId)) throw billingDown();
  const found = await json<{ invoiceId: string; invoiceNumber: number | string }>(await call("GET", `/invoices/${invoiceId}`));
  return { invoiceId: found.invoiceId, invoiceNumber: String(found.invoiceNumber) };
}
