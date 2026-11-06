// Kill Bill: accounts per member, one draft invoice per member and month, and the outbox worker
// that records charges and credits there. Items queued by this instance carry its configured
// address and are retried against that same address until it answers.

import { config } from "./config.js";
import { pool } from "./db.js";
import { send, type Reply } from "./outbound.js";
import { markService } from "./status.js";
import { centsOfDecimal, plainMoney } from "../shared/format.js";

const TIMEOUT_MS = 20_000;
const PROBE_TIMEOUT_MS = 5000;
const API_ROOT = "/1.0/kb";

export class BillingDown extends Error {
  /** True when the connection was refused, so the request certainly never reached Kill Bill. */
  constructor(readonly refused: boolean) {
    super("Kill Bill is unreachable");
  }
}
/** Kill Bill answered but refused the request; billing itself is up. */
class BillingRefused extends Error {}

function isJson(response: Reply): boolean {
  try {
    response.json();
    return true;
  } catch {
    return false;
  }
}

async function kb(method: string, path: string, body?: unknown, timeoutMs = TIMEOUT_MS): Promise<Reply> {
  const { url, username, password, apiKey, apiSecret } = config.killbill;
  let response: Reply;
  try {
    response = await send(`${url}${API_ROOT}${path}`, {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
        "X-Killbill-ApiKey": apiKey, "X-Killbill-ApiSecret": apiSecret, "X-Killbill-CreatedBy": "lineboard",
        "Content-Type": "application/json", Accept: "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      timeoutMs,
    });
  } catch (error) {
    markService("billing", false);
    throw new BillingDown((error as NodeJS.ErrnoException).code === "ECONNREFUSED");
  }
  // A refused login, or an error that is not Kill Bill's JSON, means the address is not answering
  // as our Kill Bill tenant.
  if (response.status === 401 || response.status === 403 || (response.status >= 400 && !isJson(response))) {
    markService("billing", false);
    throw new BillingDown(false);
  }
  markService("billing", true);
  if (response.status >= 400) throw new BillingRefused(`Kill Bill ${method} ${path.split("?")[0]} answered ${response.status}: ${response.text().slice(0, 200)}`);
  return response;
}

/**
 * True when the configured address answers as our Kill Bill. An authenticated API read, not the
 * healthcheck: that also fails while Kill Bill's internal queues are busy, when it is still reachable.
 */
export async function probeBilling(): Promise<boolean> {
  try {
    await kb("GET", "/nodesInfo", undefined, PROBE_TIMEOUT_MS);
    return true;
  } catch {
    return false;
  }
}

async function accountByKey(memberId: string): Promise<string | null> {
  try {
    const response = await kb("GET", `/accounts?externalKey=${encodeURIComponent(memberId)}`);
    return (response.json() as { accountId: string }).accountId;
  } catch (error) {
    if (error instanceof BillingRefused) return null;
    throw error;
  }
}

/** Kill Bill stores only Basic Multilingual Plane characters: each one above U+FFFF goes as U+FFFD. */
function accountName(businessName: string): string {
  return Array.from(businessName, (ch) => (ch.codePointAt(0)! > 0xffff ? "\ufffd" : ch)).join("");
}

/** Creates any missing Kill Bill accounts, named with the member's current business name. */
async function createAccounts(): Promise<void> {
  const { rows } = await pool.query(
    "SELECT m.id, m.business_name FROM members m LEFT JOIN kb_accounts a ON a.member_id = m.id WHERE a.member_id IS NULL",
  );
  for (const row of rows) {
    try {
      let accountId = await accountByKey(row.id);
      if (!accountId) {
        await kb("POST", "/accounts", { externalKey: row.id, name: accountName(row.business_name), currency: "USD" });
        accountId = await accountByKey(row.id);
      }
      await pool.query(
        "INSERT INTO kb_accounts (member_id, kb_account_id, name) VALUES ($1, $2, $3) ON CONFLICT (member_id) DO NOTHING",
        [row.id, accountId, row.business_name],
      );
    } catch (error) {
      if (!(error instanceof BillingRefused)) throw error;
      noteRefusal(`account ${row.id}`, error.message);
    }
  }
}

/**
 * Sends every saved business name to its Kill Bill account in save order, so each account ends
 * with the last saved name. A refused name holds that member's later names without holding up
 * any charge or credit.
 */
async function deliverAccountNames(): Promise<void> {
  const { rows } = await pool.query(
    `SELECT n.id, n.member_id, n.name, a.kb_account_id FROM account_names n JOIN kb_accounts a ON a.member_id = n.member_id
     WHERE n.delivered_at IS NULL ORDER BY n.id`,
  );
  const held = new Set<string>();
  for (const row of rows) {
    if (held.has(row.member_id)) continue;
    try {
      await kb("PUT", `/accounts/${row.kb_account_id}`, { name: accountName(row.name) });
      await pool.query("UPDATE account_names SET delivered_at = now() WHERE id = $1", [row.id]);
    } catch (error) {
      if (!(error instanceof BillingRefused)) throw error;
      held.add(row.member_id);
      noteRefusal(`account name ${row.id}`, error.message);
    }
  }
}

const lastRefusal = new Map<string, string>();

/** Logs a refusal once per subject until it changes. */
type SourceReviver = (key: string, value: unknown, context: { source?: string }) => unknown;

/**
 * Parses a Kill Bill answer with every money `amount` read from its decimal text straight into
 * integer `amountCents`, so no amount ever passes through floating point.
 */
function kbJson<T>(response: Reply): T {
  const reviver: SourceReviver = (key, value, context) => {
    if (key === "amount" && typeof value === "number") return centsOfDecimal(context.source!);
    if (value && typeof value === "object" && !Array.isArray(value) && "amount" in value) {
      const { amount, ...rest } = value as Record<string, unknown>;
      return { ...rest, amountCents: amount };
    }
    return value;
  };
  return JSON.parse(response.text(), reviver as unknown as (key: string, value: unknown) => unknown) as T;
}

function noteRefusal(subject: string, message: string): void {
  if (lastRefusal.get(subject) === message) return;
  lastRefusal.set(subject, message);
  console.error(`billing refused ${subject}: ${message}`);
}

interface QueuedItem { id: number; member_id: string; month: string; description: string; amount_cents: number; attempted: boolean }
interface KbItem { invoiceItemId: string; invoiceId: string; description: string; amountCents: number }

/**
 * An earlier attempt that failed without an answer may still have landed: find its item on the
 * account (same description and amount, not yet matched to another queued item).
 */
async function landedEarlier(accountId: string, item: QueuedItem): Promise<KbItem | null> {
  const invoices = kbJson<Array<{ items: KbItem[] }>>(await kb("GET", `/accounts/${accountId}/invoices?includeInvoiceComponents=true`));
  const { rows } = await pool.query("SELECT kb_item_id FROM billing_items WHERE member_id = $1 AND kb_item_id IS NOT NULL", [item.member_id]);
  const claimed = new Set(rows.map((r) => r.kb_item_id as string));
  const amount = Math.abs(item.amount_cents);
  return invoices.flatMap((i) => i.items).find((i) =>
    i.description === item.description && Math.abs(i.amountCents) === amount && !claimed.has(i.invoiceItemId)) ?? null;
}

async function recordItem(item: QueuedItem): Promise<void> {
  const { rows } = await pool.query(
    `SELECT a.kb_account_id, i.kb_invoice_id FROM kb_accounts a LEFT JOIN kb_invoices i ON i.member_id = a.member_id AND i.month = $2
     WHERE a.member_id = $1`,
    [item.member_id, item.month],
  );
  const { kb_account_id: accountId, kb_invoice_id: invoiceId } = rows[0] as { kb_account_id: string; kb_invoice_id: string | null };
  let created = item.attempted ? await landedEarlier(accountId, item) : null;
  if (!created) {
    await pool.query("UPDATE billing_items SET attempted = true WHERE id = $1", [item.id]);
    const line = {
      accountId, ...(invoiceId ? { invoiceId } : {}), amount: plainMoney(Math.abs(item.amount_cents)), currency: "USD",
      description: item.description, startDate: `${item.month}-01`,
    };
    const path = item.amount_cents < 0 ? "/credits?autoCommit=false" : `/invoices/charges/${accountId}?autoCommit=false`;
    try {
      created = kbJson<KbItem[]>(await kb("POST", path, [line]))[0]!;
    } catch (error) {
      if (error instanceof BillingDown && error.refused) await pool.query("UPDATE billing_items SET attempted = false WHERE id = $1", [item.id]);
      throw error;
    }
  }
  await pool.query(
    `INSERT INTO kb_invoices (member_id, month, kb_invoice_id) VALUES ($1, $2, $3) ON CONFLICT (member_id, month) DO NOTHING`,
    [item.member_id, item.month, created.invoiceId],
  );
  await pool.query("UPDATE billing_items SET recorded_at = now(), kb_item_id = $2 WHERE id = $1", [item.id, created.invoiceItemId]);
}

let pass: Promise<void> | null = null;
let again = false;

async function deliverOnce(): Promise<void> {
  const lock = await pool.connect();
  try {
    const { rows } = await lock.query("SELECT pg_try_advisory_lock(hashtext($1)) AS ok", ["billing-delivery"]);
    if (!rows[0].ok) return;
    try {
      await createAccounts();
      await deliverAccountNames();
      for (;;) {
        const queued = await pool.query(
          `SELECT id, member_id, month, description, amount_cents, attempted FROM billing_items
           WHERE recorded_at IS NULL ORDER BY id LIMIT 50`,
        );
        if (!queued.rows.length) return;
        const held = new Set<string>();
        for (const item of queued.rows) {
          if (held.has(item.member_id)) continue;
          try {
            await recordItem(item);
          } catch (error) {
            if (!(error instanceof BillingRefused)) throw error;
            // Later items of this member wait behind it, so each member's items keep their order.
            held.add(item.member_id);
            noteRefusal(`item ${item.id}`, error.message);
          }
        }
        if (held.size) return;
      }
    } finally {
      await lock.query("SELECT pg_advisory_unlock(hashtext($1))", ["billing-delivery"]);
    }
  } catch (error) {
    if (!(error instanceof BillingDown)) console.error(`billing delivery waiting: ${(error as Error).message}`);
  } finally {
    lock.release();
  }
}

/** Runs a delivery pass; a call made during a pass gets a fresh pass right after it. */
export function deliverBilling(): Promise<void> {
  if (pass) {
    again = true;
    return pass;
  }
  pass = (async () => {
    do {
      again = false;
      await deliverOnce();
    } while (again);
  })().finally(() => {
    pass = null;
  });
  return pass;
}

export async function commitInvoice(invoiceId: string): Promise<void> {
  await kb("PUT", `/invoices/${invoiceId}/commitInvoice`);
}

interface KbInvoice { invoiceId: string; status: string; items?: Array<{ itemType: string; amountCents: number; startDate?: string | null }> }

/** An invoice's Kill Bill amount: every item except CBA_ADJ, in cents (never Kill Bill's `balance`). */
const kbAmountCents = (invoice: KbInvoice): number =>
  (invoice.items ?? []).filter((i) => i.itemType !== "CBA_ADJ").reduce((sum, i) => sum + i.amountCents, 0);

/**
 * Reads back the Kill Bill amount of a member's invoices for the month: the invoice Lineboard records
 * charges on (a draft, or committed by an earlier partial close) plus any other draft holding items
 * for that month, so a charge added in Kill Bill by anyone else counts; $0.00 when there is none.
 */
export async function killBillAmount(memberId: string, month: string, invoiceId: string | null): Promise<number> {
  const { rows } = await pool.query("SELECT kb_account_id FROM kb_accounts WHERE member_id = $1", [memberId]);
  const accountId = (rows[0]?.kb_account_id as string | undefined) ?? (await accountByKey(memberId));
  if (!accountId) return 0;
  let invoices: KbInvoice[];
  try {
    invoices = kbJson<KbInvoice[]>(await kb("GET", `/accounts/${accountId}/invoices?includeInvoiceComponents=true`));
  } catch (error) {
    if (error instanceof BillingRefused) return 0;
    throw error;
  }
  const ofMonth = invoices.filter((i) => i.invoiceId === invoiceId
    || (i.status === "DRAFT" && (i.items ?? []).some((it) => it.itemType !== "CBA_ADJ" && it.startDate?.startsWith(month))));
  return ofMonth.reduce((sum, i) => sum + kbAmountCents(i), 0);
}
