// Kill Bill: member accounts by external key, PURCHASE payments, refunds and external-charge invoices.
import { config } from "./config.ts";
import { ApiError } from "./http.ts";
import { usdAmount } from "../shared/format.ts";
import type { Cents } from "../shared/rules.ts";

const BASE = `${config.killbill.url}/1.0/kb`;

function headers(): Record<string, string> {
  const basic = Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString("base64");
  return {
    Authorization: `Basic ${basic}`,
    "X-Killbill-ApiKey": config.killbill.apiKey,
    "X-Killbill-ApiSecret": config.killbill.apiSecret,
    "X-Killbill-CreatedBy": "pilotlight",
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

/** A provider body that cannot be read is an outage like any other. */
async function readJson<T>(response: Response): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    throw new ApiError("billing_unavailable");
  }
}

/** Any transport failure or error status means billing is unavailable. */
async function call(method: string, path: string, body?: unknown): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      headers: headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    console.error(`kill bill ${method} ${path} unreachable:`, error instanceof Error ? error.message : error);
    throw new ApiError("billing_unavailable");
  }
  return response;
}

async function failure(response: Response): Promise<ApiError> {
  console.error(`kill bill ${response.status}: ${(await response.text()).slice(0, 300)}`);
  return new ApiError("billing_unavailable");
}

async function expectOk(response: Response): Promise<Response> {
  if (!response.ok) throw await failure(response);
  return response;
}

function idFromLocation(response: Response): string {
  const id = response.headers.get("location")?.split("?")[0]?.split("/").filter(Boolean).pop();
  if (!id) throw new ApiError("billing_unavailable");
  return id;
}

interface BillingMember {
  id: string;
  businessName: string;
  email: string;
}

interface Account {
  accountId: string;
  paymentMethodId: string | null;
}

async function findAccount(externalKey: string): Promise<Account | null> {
  const response = await call("GET", `/accounts?externalKey=${encodeURIComponent(externalKey)}`);
  if (response.status === 404) return null;
  return readJson<Account>(await expectOk(response));
}

/**
 * The member's account (external key = member id), created on first need, with Kill Bill's built-in
 * external payment method as its default — added again if an earlier attempt stopped short of it.
 */
async function ensureAccount(member: BillingMember): Promise<string> {
  let account = await findAccount(member.id);
  if (!account) {
    const created = await call("POST", "/accounts", { externalKey: member.id, name: member.businessName, email: member.email, currency: "USD" });
    // A refused create may be a concurrent first need that already made the account.
    account = created.ok ? { accountId: idFromLocation(created), paymentMethodId: null } : await findAccount(member.id);
    if (!account) throw await failure(created);
  }
  if (!account.paymentMethodId) {
    await expectOk(await call("POST", `/accounts/${account.accountId}/paymentMethods?isDefault=true`, { pluginName: "__EXTERNAL_PAYMENT__" }));
  }
  return account.accountId;
}

/** One payment with a PURCHASE transaction; both external keys are the purchase id. Returns the payment id. */
export async function chargePack(member: BillingMember, purchaseId: string, priceCents: Cents): Promise<string> {
  const accountId = await ensureAccount(member);
  const response = await expectOk(
    await call("POST", `/accounts/${accountId}/payments`, {
      transactionType: "PURCHASE",
      amount: usdAmount(priceCents),
      currency: "USD",
      paymentExternalKey: purchaseId,
      transactionExternalKey: purchaseId,
    }),
  );
  return idFromLocation(response);
}

export async function refundPack(paymentId: string, priceCents: Cents): Promise<void> {
  await expectOk(
    await call("POST", `/payments/${paymentId}/refunds`, { transactionType: "REFUND", amount: usdAmount(priceCents), currency: "USD" }),
  );
}

interface Invoice {
  invoiceId: string;
  status: string;
  amount: number;
  items: { itemType: string; amount: number; description: string | null }[];
}

/** The invoice as Kill Bill reports it now. */
async function readInvoice(invoiceId: string): Promise<Invoice> {
  return readJson<Invoice>(await expectOk(await call("GET", `/invoices/${invoiceId}?includeInvoiceComponents=true`)));
}

/** Voids an overage invoice, so that nothing survives a check-out that did not commit. */
export async function voidInvoice(invoiceId: string): Promise<void> {
  await expectOk(await call("PUT", `/invoices/${invoiceId}/voidInvoice`));
}

/**
 * Committing an overage invoice, the one place it is decided: one invoice with one external charge item, reported
 * COMMITTED by Kill Bill with exactly that amount. A draft is committed first; any failure after the invoice was
 * created voids it before the 503. A booking never gets a second one: a live invoice already carrying its item
 * (from a process that stopped before its commit) is taken over and checked the same way.
 */
export async function invoiceOverage(member: BillingMember, reference: string, totalCents: Cents, description: string): Promise<string> {
  const accountId = await ensureAccount(member);
  const existing = await readJson<Invoice[]>(await expectOk(await call("GET", `/accounts/${accountId}/invoices?includeInvoiceComponents=true`)));
  const earlier = existing.find((invoice) => invoice.status !== "VOID" && invoice.items.some((item) => item.description?.startsWith(`Overage ${reference}:`)));
  let invoiceId = earlier?.invoiceId;
  if (!invoiceId) {
    const response = await expectOk(
      await call("POST", `/invoices/charges/${accountId}?autoCommit=true`, [
        { accountId, amount: usdAmount(totalCents), currency: "USD", description, itemType: "EXTERNAL_CHARGE" },
      ]),
    );
    invoiceId = (await readJson<{ invoiceId: string }[]>(response))[0]?.invoiceId;
    if (!invoiceId) throw new ApiError("billing_unavailable");
  }
  try {
    let invoice = await readInvoice(invoiceId);
    if (invoice.status === "DRAFT") {
      await expectOk(await call("PUT", `/invoices/${invoiceId}/commitInvoice`));
      invoice = await readInvoice(invoiceId);
    }
    const [item, ...others] = invoice.items;
    const amount = usdAmount(totalCents);
    if (invoice.status !== "COMMITTED" || !item || others.length > 0 || item.itemType !== "EXTERNAL_CHARGE" || item.amount !== amount || invoice.amount !== amount || item.description !== description) {
      throw new ApiError("billing_unavailable");
    }
    return invoiceId;
  } catch (error) {
    await voidInvoice(invoiceId).catch((failure: unknown) => console.error("kill bill void failed:", failure instanceof Error ? failure.message : failure));
    throw error;
  }
}
