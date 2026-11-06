// Kill Bill: one account per requester organisation, external charges, invoice reads.
import { config } from "./config.js";
import { ApiError } from "./errors.js";
import { decimalTextToCents, formatCents } from "./money.js";

/** Kill Bill must first answer within this budget, so an unreachable Kill Bill is reported inside 5 s. */
const BUDGET_MS = 4000;
/** Once Kill Bill has answered, a slow but reachable Kill Bill gets this long to finish the operation. */
const REACHABLE_MS = 20000;

/** One billing operation's time limit; it widens once Kill Bill has answered. */
export interface Deadline {
  at: number;
  answered: boolean;
}

type Json = null | boolean | string | Json[] | { [key: string]: Json };

/** Parses Kill Bill JSON keeping every number as its exact source text. */
function parseExact(text: string): Json {
  return JSON.parse(text, (_key, value: unknown, context?: { source?: string }) =>
    typeof value === "number" ? (context?.source ?? String(value)) : value,
  ) as Json;
}

/** Logs why a call failed by method and path only, never the protected base URL. */
function unavailable(method: string, path: string, cause: string): ApiError {
  console.error(`killbill ${method} ${path.split("?")[0]}: ${cause}`);
  return new ApiError("billing_unavailable");
}

/** Refused, unanswered (the charge may or may not have landed) and 5xx all read as billing_unavailable. */
async function call(method: string, path: string, deadline: Deadline, body?: string): Promise<{ status: number; json: Json }> {
  const remaining = Math.max(250, deadline.at - Date.now());
  let response: Response;
  try {
    response = await fetch(`${config.killbill.url}/1.0/kb${path}`, {
      method,
      headers: {
        authorization: `Basic ${config.killbill.basicAuth}`,
        "x-killbill-apikey": config.killbill.apiKey,
        "x-killbill-apisecret": config.killbill.apiSecret,
        "x-killbill-createdby": "seatweaver",
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body,
      signal: AbortSignal.timeout(remaining),
    });
  } catch (error) {
    throw unavailable(method, path, error instanceof Error ? (error.cause instanceof Error ? error.cause.message : error.name) : "no answer");
  }
  if (!deadline.answered) {
    deadline.answered = true;
    deadline.at = Math.max(deadline.at, Date.now() + REACHABLE_MS);
  }
  const text = await response.text().catch(() => "");
  if (response.status >= 500) throw unavailable(method, path, `status ${response.status}`);
  return { status: response.status, json: text ? parseExact(text) : null };
}

const field = (value: Json | undefined): string => (typeof value === "string" ? value : "");
const list = (value: Json | undefined): Json[] => (Array.isArray(value) ? value : []);
const record = (value: Json | undefined): Record<string, Json> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};

export const deadlineFromNow = (): Deadline => ({ at: Date.now() + BUDGET_MS, answered: false });

/** The account for an organisation, created when missing and never duplicated. */
export async function ensureAccount(orgId: string, orgName: string, deadline: Deadline): Promise<string> {
  const externalKey = `fernhollow-${orgId}`;
  const lookup = async (): Promise<string | null> => {
    const found = await call("GET", `/accounts?externalKey=${encodeURIComponent(externalKey)}`, deadline);
    return found.status === 200 ? field(record(found.json).accountId) || null : null;
  };
  const existing = await lookup();
  if (existing) return existing;
  const created = await call("POST", "/accounts", deadline, JSON.stringify({ name: orgName, externalKey, currency: "USD" }));
  if (created.status !== 201 && created.status !== 409) throw unavailable("POST", "/accounts", `status ${created.status}`);
  const id = await lookup();
  if (!id) throw unavailable("GET", "/accounts", "account missing after create");
  return id;
}

export interface KillBillItem {
  invoiceId: string;
  description: string;
  amountCents: number;
}

interface KillBillInvoice {
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate: string;
  amountCents: number;
  balanceCents: number;
  items: KillBillItem[];
}

const cents = (value: Json | undefined): number => decimalTextToCents(field(value) || "0");

/**
 * Every invoice with its items. The listing grows with the account and can be slow, so a cheap
 * account read goes first: once Kill Bill has answered that, the listing gets the reachable budget.
 */
export async function listInvoices(accountId: string, deadline: Deadline): Promise<KillBillInvoice[]> {
  const path = `/accounts/${encodeURIComponent(accountId)}`;
  const account = await call("GET", path, deadline);
  if (account.status !== 200) throw unavailable("GET", path, `status ${account.status}`);
  const found = await call("GET", `${path}/invoices?includeInvoiceComponents=true`, deadline);
  if (found.status !== 200) throw unavailable("GET", `${path}/invoices`, `status ${found.status}`);
  return list(found.json).map((raw) => {
    const invoice = record(raw);
    return {
      invoiceId: field(invoice.invoiceId),
      invoiceNumber: field(invoice.invoiceNumber),
      invoiceDate: field(invoice.invoiceDate),
      amountCents: cents(invoice.amount),
      balanceCents: cents(invoice.balance),
      items: list(invoice.items).map((rawItem) => {
        const item = record(rawItem);
        return { invoiceId: field(item.invoiceId), description: field(item.description), amountCents: cents(item.amount) };
      }),
    };
  });
}

/** Posts one external charge and commits it on a new invoice; returns that invoice's id. */
export async function postCharge(accountId: string, amountCents: number, description: string, deadline: Deadline): Promise<string> {
  const body = `[{"accountId":${JSON.stringify(accountId)},"amount":${formatCents(amountCents)},"currency":"USD","description":${JSON.stringify(description)}}]`;
  const posted = await call("POST", `/invoices/charges/${encodeURIComponent(accountId)}?autoCommit=true`, deadline, body);
  if (posted.status !== 201 && posted.status !== 200) throw unavailable("POST", "/invoices/charges", `status ${posted.status}`);
  return field(record(list(posted.json)[0]).invoiceId);
}

export async function killBillReachable(): Promise<boolean> {
  try {
    const response = await fetch(`${config.killbill.url}/1.0/healthcheck`, { signal: AbortSignal.timeout(2000) });
    await response.arrayBuffer();
    return response.ok;
  } catch {
    return false;
  }
}
