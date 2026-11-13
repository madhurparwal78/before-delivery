/**
 * Kill Bill: each charge becomes exactly one external-charge invoice item on the client
 * organisation's account. Posting runs with the charge row locked, and first looks for an item
 * already marked (in its item details) with the charge's request and kind, which identify the
 * charge for good, so retries, timeouts, rolled-back attempts and several instances sharing the
 * database never post twice.
 */
import type pg from "pg";
import { config } from "./config.js";
import { transaction } from "./db.js";
import { dollars } from "./rules.js";

const TIMEOUT_MS = 10_000;

class KillBillUnavailable extends Error {}

async function call(method: string, path: string, body?: string): Promise<Response> {
  const headers: Record<string, string> = {
    Authorization: `Basic ${Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString("base64")}`,
    "X-Killbill-ApiKey": config.killbill.apiKey,
    "X-Killbill-ApiSecret": config.killbill.apiSecret,
    "X-Killbill-CreatedBy": "crosshand-relay",
    Accept: "application/json",
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  let response: Response;
  try {
    response = await fetch(`${config.killbill.url}/1.0/kb${path}`, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new KillBillUnavailable(error instanceof Error ? error.message : String(error));
  }
  if (response.status >= 500) throw new KillBillUnavailable(`Kill Bill answered ${response.status}`);
  return response;
}

async function expect(response: Response, statuses: number[]): Promise<Response> {
  if (!statuses.includes(response.status)) {
    throw new KillBillUnavailable(`Kill Bill answered ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
  return response;
}

interface Account {
  accountId: string;
}

async function findAccount(externalKey: string): Promise<Account | null> {
  const response = await expect(await call("GET", `/accounts?externalKey=${encodeURIComponent(externalKey)}`), [200, 404]);
  return response.status === 200 ? ((await response.json()) as Account) : null;
}

/** The organisation's account (external key crosshand-<code>, USD), created on its first charge. */
async function accountFor(organisation: { code: string; name: string }): Promise<string> {
  const externalKey = `crosshand-${organisation.code}`;
  const existing = await findAccount(externalKey);
  if (existing) return existing.accountId;
  const created = await call("POST", "/accounts", JSON.stringify({ name: organisation.name, externalKey, currency: "USD" }));
  await expect(created, [201, 409]);
  const account = await findAccount(externalKey);
  if (!account) throw new KillBillUnavailable(`account ${externalKey} missing after creation`);
  return account.accountId;
}

interface InvoiceItem {
  invoiceId: string;
  itemType: string;
  itemDetails?: string | null;
}

/** The marker stored on the Kill Bill item: a request has at most one charge of each kind. */
const marker = (row: ChargeRow): string => JSON.stringify({ crosshandRequestId: row.request_id, kind: row.kind });

async function existingItem(accountId: string, row: ChargeRow): Promise<InvoiceItem | undefined> {
  const response = await expect(await call("GET", `/accounts/${accountId}/invoices?includeInvoiceComponents=true`), [200]);
  const invoices = (await response.json()) as { items?: InvoiceItem[] }[];
  return invoices
    .flatMap((invoice) => invoice.items ?? [])
    .find((item) => item.itemType === "EXTERNAL_CHARGE" && item.itemDetails === marker(row));
}

interface ChargeRow {
  id: string;
  request_id: string;
  amount_cents: number;
  kind: "interpreting" | "late_cancellation";
  reference: string;
  organisation_code: string;
  organisation_name: string;
}

const CHARGE_SELECT = `
  SELECT ch.id, ch.request_id, ch.amount_cents, ch.kind, r.reference, o.code AS organisation_code, o.name AS organisation_name
  FROM charges ch JOIN requests r ON r.id = ch.request_id JOIN organisations o ON o.id = r.organisation_id`;

/** `<reference> interpreting` for a close, `<reference> late cancellation` for a fee. */
function description(row: ChargeRow): string {
  return `${row.reference} ${row.kind === "interpreting" ? "interpreting" : "late cancellation"}`;
}

async function post(client: pg.PoolClient, row: ChargeRow): Promise<string | null> {
  try {
    const accountId = await accountFor({ code: row.organisation_code, name: row.organisation_name });
    let item = await existingItem(accountId, row);
    if (!item) {
      // The amount is the stored decimal string, written into the JSON as-is.
      const body = `[{"accountId":${JSON.stringify(accountId)},"amount":${dollars(row.amount_cents)},"currency":"USD","description":${JSON.stringify(description(row))},"itemType":"EXTERNAL_CHARGE","itemDetails":${JSON.stringify(marker(row))}}]`;
      const response = await expect(await call("POST", `/invoices/charges/${accountId}?autoCommit=true`, body), [200, 201]);
      [item] = (await response.json()) as InvoiceItem[];
    }
    if (!item) throw new KillBillUnavailable("Kill Bill returned no invoice item");
    await client.query("UPDATE charges SET killbill_invoice_id = $1 WHERE id = $2", [item.invoiceId, row.id]);
    return item.invoiceId;
  } catch (error) {
    if (!(error instanceof KillBillUnavailable)) throw error;
    console.error(`charge ${row.id} left invoice pending:`, error.message);
    return null;
  }
}

/**
 * Posts a charge just written in the caller's transaction (so no other instance can see it yet).
 * Returns the Kill Bill invoice id, or null when Kill Bill is unreachable: the charge stays
 * invoice pending and the retry worker posts it.
 */
export async function postNewCharge(client: pg.PoolClient, chargeId: string): Promise<string | null> {
  const { rows } = await client.query<ChargeRow>(`${CHARGE_SELECT} WHERE ch.id = $1`, [chargeId]);
  const [row] = rows;
  return row ? post(client, row) : null;
}

/** Retries pending charges from any instance; rows locked elsewhere are another instance's work. */
export async function postPendingCharges(): Promise<void> {
  await transaction(async (client) => {
    const { rows } = await client.query<ChargeRow>(
      `${CHARGE_SELECT} WHERE ch.killbill_invoice_id IS NULL ORDER BY ch.position LIMIT 20 FOR UPDATE OF ch SKIP LOCKED`,
    );
    for (const row of rows) await post(client, row);
  }).catch((error: Error) => console.error("pending charges deferred:", error.message));
}

export const CHARGE_RETRY_MS = 10_000;
