import { config } from "./config.js";
import type { Client } from "./db.js";
import type { Member } from "./domain.js";
import { decimal } from "./money.js";
import { isUp, reach } from "./services.js";

// Kill Bill calls, made directly with fetch. Amounts leave as decimal strings built from integer
// cents and come back as numbers converted to cents once, here.

const auth = `Basic ${Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString("base64")}`;

class BillingError extends Error {}

async function call(method: string, path: string, body?: unknown): Promise<Response> {
  const response = await fetch(`${config.killbill.url}/1.0/kb${path}`, {
    method,
    headers: {
      Authorization: auth,
      "X-Killbill-ApiKey": config.killbill.apiKey,
      "X-Killbill-ApiSecret": config.killbill.apiSecret,
      "X-Killbill-CreatedBy": "pilotlight",
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status >= 500) throw new BillingError(`Kill Bill answered ${response.status}`);
  return response;
}

interface KillBillItem {
  invoiceItemId: string;
  invoiceId: string;
  amount: number;
}

function isItemList(value: unknown): value is KillBillItem[] {
  return Array.isArray(value) && value.every((v) => typeof v === "object" && v !== null && "invoiceId" in v);
}

function isAccount(value: unknown): value is { accountId: string } {
  return typeof value === "object" && value !== null && "accountId" in value && typeof value.accountId === "string";
}

const toCents = (amount: number): number => Math.round(amount * 100);

export async function probe(): Promise<void> {
  const response = await fetch(`${config.killbill.url}/1.0/healthcheck`, { signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new BillingError(`Kill Bill health ${response.status}`);
}

/** The member's billing account, created the first time the member is charged. */
async function accountFor(member: Member, client: Client): Promise<string> {
  if (member.killbill_account_id) return member.killbill_account_id;
  const lookup = async (): Promise<string | null> => {
    const found = await call("GET", `/accounts?externalKey=${encodeURIComponent(member.id)}`);
    if (found.status === 404) return null;
    const body: unknown = await found.json();
    if (!found.ok || !isAccount(body)) throw new BillingError("Kill Bill account lookup failed");
    return body.accountId;
  };
  let accountId = await lookup();
  if (accountId === null) {
    const created = await call("POST", "/accounts", {
      name: member.business,
      email: member.contact_email,
      externalKey: member.id,
      currency: "USD",
    });
    if (created.status !== 201 && created.status !== 409) throw new BillingError("Kill Bill account creation failed");
    accountId = await lookup();
  }
  if (accountId === null) throw new BillingError("Kill Bill account missing");
  await client.query("UPDATE members SET killbill_account_id = $1 WHERE id = $2", [accountId, member.id]);
  return accountId;
}

export interface PostedInvoice {
  accountId: string;
  invoiceId: string;
  itemIds: string[];
  amountCents: number;
}

/** One billing invoice holding one external charge per item. */
export async function postCharges(
  client: Client,
  member: Member,
  items: { amountCents: number; description: string }[],
): Promise<PostedInvoice> {
  return reach("billing", async () => {
    const accountId = await accountFor(member, client);
    const response = await call(
      "POST",
      `/invoices/charges/${accountId}?autoCommit=true`,
      items.map((item) => ({
        accountId,
        amount: decimal(item.amountCents),
        currency: "USD",
        description: item.description,
      })),
    );
    const body: unknown = await response.json();
    if (response.status !== 201 && response.status !== 200) throw new BillingError("Kill Bill charge refused");
    if (!isItemList(body) || body.length === 0) throw new BillingError("Kill Bill charge answer malformed");
    return {
      accountId,
      invoiceId: body[0]?.invoiceId ?? "",
      itemIds: body.map((item) => item.invoiceItemId),
      amountCents: body.reduce((sum, item) => sum + toCents(item.amount), 0),
    };
  });
}

/** Adjusts every item of a just-posted invoice to zero, so its balance reads $0.00. */
export async function reverseInvoice(posted: PostedInvoice, amounts: number[]): Promise<void> {
  await reach("billing", async () => {
    for (const [i, itemId] of posted.itemIds.entries()) {
      const response = await call("POST", `/invoices/${posted.invoiceId}`, {
        accountId: posted.accountId,
        invoiceId: posted.invoiceId,
        invoiceItemId: itemId,
        amount: decimal(amounts[i] ?? 0),
        currency: "USD",
        description: "Reversed: confirmation email was not accepted",
      });
      if (!response.ok) throw new BillingError("Kill Bill adjustment refused");
    }
  });
}

/** One account credit. */
export async function postCredit(client: Client, member: Member, cents: number, description: string): Promise<void> {
  await reach("billing", async () => {
    const accountId = await accountFor(member, client);
    const response = await call("POST", "/credits?autoCommit=true", [
      { accountId, amount: decimal(cents), currency: "USD", description },
    ]);
    if (!response.ok) throw new BillingError("Kill Bill credit refused");
  });
}

/** Live amounts of every billing invoice on the members' accounts, in cents; null while billing is down. */
export async function invoiceAmounts(accountIds: string[]): Promise<Map<string, number> | null> {
  if (!isUp("billing")) return null;
  try {
    return await reach("billing", async () => {
      const amounts = new Map<string, number>();
      for (const accountId of new Set(accountIds)) {
        const response = await call("GET", `/accounts/${accountId}/invoices?includeInvoiceComponents=true`);
        const body: unknown = await response.json();
        if (!response.ok || !Array.isArray(body)) throw new BillingError("Kill Bill invoice list failed");
        for (const invoice of body) {
          if (typeof invoice === "object" && invoice !== null && "invoiceId" in invoice && "amount" in invoice) {
            if (typeof invoice.invoiceId === "string" && typeof invoice.amount === "number") {
              amounts.set(invoice.invoiceId, toCents(invoice.amount));
            }
          }
        }
      }
      return amounts;
    });
  } catch {
    return null;
  }
}
