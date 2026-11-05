// Read-only contract endpoints: the contract, the list, the invoice, the equity statement, quotes and the bill of sale.

import type { EquityStatement, User } from "../../shared/api.js";
import { isoSecond } from "../../shared/storeTime.js";
import type { LedgerKind } from "../../shared/vocabulary.js";
import { storeToday } from "../clock.js";
import { pool, query } from "../db/pool.js";
import { ApiError, notFound, validationFailed } from "../http/errors.js";
import type { Reply } from "../http/router.js";
import { billOfSaleKey, getObject } from "../services/storage.js";
import { contractBody, contractSummary, loadContractRows, requireVisible, type ContractRow } from "./contracts.js";
import { contractMonth, contractTerms, invoiceFor, loadPriceLists, quoteFor } from "./terms.js";

const TERMINAL = ["expired", "exchanged", "paid_off", "returned", "written_off"];

export async function getContract(user: User, id: string): Promise<unknown> {
  const row = await requireVisible(user, id);
  return { contract: await contractBody(pool, row) };
}

export async function listContracts(user: User): Promise<unknown> {
  const rows = user.role === "parent" ? await loadContractRows(pool, "s.family_id = $1", [user.family_id])
    : await loadContractRows(pool, "TRUE", []);
  return { contracts: rows.map(contractSummary) };
}

export async function getInvoice(user: User, id: string): Promise<unknown> {
  const row = await requireVisible(user, id);
  const lists = await loadPriceLists(pool);
  const today = storeToday();
  return { invoice: invoiceFor(row, contractTerms(row, lists, today), lists, today) };
}

export async function getEquity(user: User, id: string): Promise<EquityStatement> {
  const row = await requireVisible(user, id);
  const terms = contractTerms(row, await loadPriceLists(pool), storeToday());
  const entries = await query<{ id: string; kind: LedgerKind; amount_cents: number; transfer_id: string | null;
    payment_id: string | null; reversed: boolean; created_at: Date; payment_amount_cents: number | null }>(pool, `
    SELECT l.id, l.kind, l.amount_cents, l.transfer_id, l.payment_id, l.created_at,
      EXISTS (SELECT 1 FROM reversals r WHERE r.payment_id = l.payment_id) AS reversed,
      p.amount_cents AS payment_amount_cents
    FROM ledger_entries l LEFT JOIN payments p ON p.id = l.payment_id AND l.kind = 'payment'
    WHERE l.contract_id = $1 ORDER BY l.created_order`, [id]);
  return {
    equity_cents: row.equity_cents, purchase_price_cents: terms.purchase_price_cents,
    contract_month: contractMonth(row.equity_cents, terms), closed: TERMINAL.includes(row.status),
    entries: entries.map((e) => ({ id: e.id, kind: e.kind, amount_cents: e.amount_cents, transfer_id: e.transfer_id,
      payment_id: e.payment_id, reversed: e.kind === "payment" ? e.reversed : null, created_at: isoSecond(e.created_at),
      payment_amount_cents: e.payment_amount_cents })),
  };
}

function quotable(row: ContractRow): void {
  if (row.status !== "signed" && row.status !== "active") {
    throw new ApiError(409, "no_quote", "Quotes exist for signed and active contracts only.");
  }
}

export async function getQuote(user: User, id: string, month: string | null): Promise<unknown> {
  const row = await requireVisible(user, id);
  quotable(row);
  const today = storeToday();
  const terms = contractTerms(row, await loadPriceLists(pool), today);
  const n = month !== null && /^\d{1,6}$/.test(month) ? Number(month) : null;
  if (n === null || n > terms.term_months) throw validationFailed({ month: "invalid" });
  return { quote: quoteFor(id, terms, row.equity_cents, n, today) };
}

export async function getQuotes(user: User, id: string): Promise<unknown> {
  const row = await requireVisible(user, id);
  quotable(row);
  const today = storeToday();
  const terms = contractTerms(row, await loadPriceLists(pool), today);
  return { quotes: Array.from({ length: terms.term_months + 1 }, (_, n) => quoteFor(id, terms, row.equity_cents, n, today)) };
}

export async function downloadBillOfSale(user: User, id: string): Promise<Reply> {
  const row = await requireVisible(user, id);
  const missing = notFound("bill_of_sale_not_stored", "No bill of sale is stored for this contract.");
  if (!row.bill_of_sale_stored) throw missing;
  const bytes = await getObject(billOfSaleKey(id));
  if (bytes === null) throw missing;
  return { status: 200, bytes, type: "application/pdf", disposition: `inline; filename="bill-of-sale-${id}.pdf"` };
}
