/** The transaction feed with cursor paging, literal search, resumable replay and monthly statements. */
import type { Tx } from "../db.js";
import { FEED_MAX_LIMIT, FEED_PAGE, SEARCH_LIMIT, SEARCH_MAX, SEARCH_MIN, TRANSACTION_METHODS } from "../../shared/rules.js";
import { addDays, endOfNewYorkDay, firstOfMonth, newYorkDate, newYorkMidnight } from "../clock.js";
import { Fields, notFound } from "../http/errors.js";
import { codePointLength, hasRefusedCharacter } from "../http/text.js";
import { isId } from "../ids.js";
import { toTransactionRow } from "./ledger.js";
import type { TransactionRow } from "./stream.js";
import { recipientView, type RecipientView } from "./recipients.js";

interface FeedFilters {
  accountId: string | null;
  method: string | null;
  direction: "credit" | "debit" | null;
}

function encodeCursor(row: { created_at: Date; id: string }, filters: FeedFilters): string {
  return Buffer.from(JSON.stringify({ t: row.created_at.getTime(), i: row.id, f: filters })).toString("base64url");
}

function decodeCursor(text: string, filters: FeedFilters): { at: Date; id: string } | null {
  try {
    const parsed = JSON.parse(Buffer.from(text, "base64url").toString("utf8"));
    if (typeof parsed.t !== "number" || !isId(parsed.i) || JSON.stringify(parsed.f) !== JSON.stringify(filters)) return null;
    return { at: new Date(parsed.t), id: parsed.i };
  } catch {
    return null;
  }
}

export async function listTransactions(tx: Tx, companyId: string, query: URLSearchParams): Promise<{ transactions: TransactionRow[]; next_cursor: string | null }> {
  const fields = new Fields();
  const accountParam = query.get("account_id");
  if (accountParam !== null && !isId(accountParam)) throw notFound();
  const method = query.get("method");
  if (method !== null && !(TRANSACTION_METHODS as readonly string[]).includes(method)) fields.fail("method", "Unknown method");
  const direction = query.get("direction");
  if (direction !== null && direction !== "credit" && direction !== "debit") fields.fail("direction", "Unknown direction");
  const limitParam = query.get("limit");
  let limit = FEED_PAGE;
  if (limitParam !== null) {
    if (!/^[0-9]{1,3}$/.test(limitParam) || Number.parseInt(limitParam, 10) < 1 || Number.parseInt(limitParam, 10) > FEED_MAX_LIMIT) fields.fail("limit", "Use a limit from 1 to 100");
    else limit = Number.parseInt(limitParam, 10);
  }
  if (accountParam !== null) {
    const owned = await tx.query("SELECT 1 FROM accounts WHERE id = $1 AND company_id = $2", [accountParam, companyId]);
    if (!owned.rows[0]) throw notFound();
  }
  const filters: FeedFilters = { accountId: accountParam, method, direction: direction as FeedFilters["direction"] };
  let after: { at: Date; id: string } | null = null;
  const cursorParam = query.get("cursor");
  if (cursorParam !== null) {
    after = decodeCursor(cursorParam, filters);
    if (!after) fields.fail("cursor", "This cursor does not match the request");
  }
  fields.raise();

  const found = await tx.query(
    `SELECT * FROM transactions t
     WHERE t.company_id = $1
       AND ($2::uuid IS NULL OR t.account_id = $2)
       AND ($3::text IS NULL OR t.method = $3)
       AND ($4::text IS NULL OR t.direction = $4)
       AND ($5::timestamptz IS NULL OR (t.created_at, t.id) < ($5, $6::uuid))
     ORDER BY t.created_at DESC, t.id DESC
     LIMIT $7`,
    [companyId, filters.accountId, filters.method, filters.direction, after?.at ?? null, after?.id ?? null, limit + 1],
  );
  const page = found.rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    transactions: page.map(toTransactionRow),
    next_cursor: found.rows.length > limit && last ? encodeCursor(last as { created_at: Date; id: string }, filters) : null,
  };
}

/** Recipients and transactions whose text contains the query as literal, case-insensitive text. */
export async function search(tx: Tx, companyId: string, rawQuery: string | null): Promise<{ recipients: RecipientView[]; transactions: TransactionRow[] }> {
  const fields = new Fields();
  const text = (rawQuery ?? "").trim();
  const length = codePointLength(text);
  if (rawQuery === null || length < SEARCH_MIN || length > SEARCH_MAX || hasRefusedCharacter(text, "plain")) fields.fail("q", "Enter 2 to 100 characters");
  fields.raise();
  const recipients = await tx.query(
    `SELECT * FROM recipients WHERE company_id = $1 AND status <> 'removed' AND strpos(lower(display_name), lower($2)) > 0
     ORDER BY created_at, id LIMIT $3`,
    [companyId, text, SEARCH_LIMIT],
  );
  const transactions = await tx.query(
    `SELECT * FROM transactions WHERE company_id = $1
       AND (strpos(lower(counterparty), lower($2)) > 0 OR strpos(lower(coalesce(memo, '')), lower($2)) > 0)
     ORDER BY created_at DESC, id DESC LIMIT $3`,
    [companyId, text, SEARCH_LIMIT],
  );
  return { recipients: recipients.rows.map(recipientView), transactions: transactions.rows.map(toTransactionRow) };
}

/** Company transactions created after the given event, oldest first. Unknown or foreign events replay nothing. */
export async function transactionsAfter(tx: Tx, companyId: string, eventId: string | null): Promise<TransactionRow[]> {
  if (!isId(eventId)) return [];
  const anchor = await tx.query("SELECT created_at, id FROM transactions WHERE id = $1 AND company_id = $2", [eventId, companyId]);
  const row = anchor.rows[0];
  if (!row) return [];
  const found = await tx.query(
    "SELECT * FROM transactions WHERE company_id = $1 AND (created_at, id) > ($2, $3::uuid) ORDER BY created_at, id",
    [companyId, row.created_at, row.id],
  );
  return found.rows.map(toTransactionRow);
}

function csvMoney(cents: number): string {
  const magnitude = Math.abs(cents);
  const fraction = magnitude % 100;
  return `${cents < 0 ? "-" : ""}${Math.floor(magnitude / 100)}.${fraction < 10 ? "0" : ""}${fraction}`;
}

/** A value that could run as a spreadsheet formula is written as harmless text. */
function neutralise(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

interface Statement {
  csv: string;
  fileName: string;
}

export async function statementFor(tx: Tx, account: Record<string, any>, monthParam: string | null, now: Date): Promise<Statement> {
  const today = newYorkDate(now);
  let from: Date | null = null;
  let to: Date | null = null;
  if (monthParam !== null) {
    const fields = new Fields();
    const valid = /^\d{4}-(0[1-9]|1[0-2])$/.test(monthParam);
    if (!valid || monthParam > today.slice(0, 7)) fields.fail("month", "Choose a month up to the current month");
    fields.raise();
    from = newYorkMidnight(firstOfMonth(monthParam));
    let lastDay = firstOfMonth(monthParam);
    while (addDays(lastDay, 1).slice(0, 7) === monthParam) lastDay = addDays(lastDay, 1);
    to = endOfNewYorkDay(lastDay);
  }
  const opening = from
    ? (await tx.query<{ n: number }>(
        `SELECT COALESCE(SUM(CASE direction WHEN 'credit' THEN amount_cents ELSE -amount_cents END), 0)::bigint AS n
         FROM transactions WHERE account_id = $1 AND created_at < $2`,
        [account.id, from],
      )).rows[0]?.n ?? 0
    : 0;
  const rows = await tx.query(
    `SELECT * FROM transactions WHERE account_id = $1 AND ($2::timestamptz IS NULL OR (created_at >= $2 AND created_at <= $3))
     ORDER BY created_at, id`,
    [account.id, from, to],
  );
  let running = opening;
  const lines = ["date,counterparty,memo,direction,amount,balance"];
  for (const row of rows.rows) {
    const signed = row.direction === "credit" ? row.amount_cents : -row.amount_cents;
    running += signed;
    lines.push(
      [newYorkDate(row.created_at), csvField(neutralise(row.counterparty)), csvField(neutralise(row.memo ?? "")), row.direction, csvMoney(signed), csvMoney(running)].join(","),
    );
  }
  return { csv: `${lines.join("\r\n")}\r\n`, fileName: `${account.name}-statement-${monthParam ?? "all"}.csv` };
}

/** Content-Disposition for a download whose name may hold any script. */
export function attachmentHeader(fileName: string): string {
  const fallback = [...fileName].map((char) => (/^[\x20-\x7e]$/.test(char) && char !== '"' && char !== "\\" ? char : "_")).join("");
  const encoded = [...Buffer.from(fileName, "utf8")]
    .map((byte) => {
      const char = String.fromCharCode(byte);
      return /^[A-Za-z0-9!#$&+\-.^_`|~]$/.test(char) ? char : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
    })
    .join("");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
