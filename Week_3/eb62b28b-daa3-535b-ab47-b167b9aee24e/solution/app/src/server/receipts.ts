// Receipts as the desk recorded them. Nothing here reads a member's health data.

import type { ReceiptItem, ReceiptView } from "../shared/api";
import { wholeSeconds } from "../shared/time";
import { PRACTICE } from "./catalog";
import { one, pool, rows } from "./db";
import { invalid } from "./errors";

const PAGE_SIZE = 25;

interface ReceiptRow {
  id: string;
  number: number;
  member_id: string;
  member_name: string;
  invoice_id: string;
  paid_at: Date;
  paid_date: string;
  amount_cents: number;
  currency: string;
  items: ReceiptView["items"];
}

const SELECT_RECEIPT = `SELECT r.*, p.name AS member_name FROM receipts r JOIN people p ON p.id = r.member_id`;

function listItem(row: ReceiptRow): ReceiptItem {
  return {
    id: row.id,
    number: `OLC-${String(row.number).padStart(6, "0")}`,
    memberName: row.member_name,
    paidAt: wholeSeconds(row.paid_at),
    paidDate: row.paid_date,
    amountCents: row.amount_cents,
    currency: row.currency,
  };
}

export function receiptView(row: ReceiptRow): ReceiptView {
  return { ...listItem(row), invoiceId: row.invoice_id, items: row.items, practice: PRACTICE };
}

export async function locateReceipt(id: string): Promise<ReceiptRow | undefined> {
  return one<ReceiptRow>(pool, `${SELECT_RECEIPT} WHERE r.id = $1`, [id]);
}

export async function memberReceipts(memberId: string): Promise<ReceiptItem[]> {
  const found = await rows<ReceiptRow>(pool, `${SELECT_RECEIPT} WHERE r.member_id = $1 ORDER BY r.number DESC`, [memberId]);
  return found.map(listItem);
}

const encodeCursor = (number: number): string => Buffer.from(`after:${number}`).toString("base64url");

function decodeCursor(cursor: string): number | null {
  const match = /^after:(\d+)$/.exec(Buffer.from(cursor, "base64url").toString("utf8"));
  return match ? Number(match[1]) : null;
}

// The cursor marks the last receipt returned, so one recorded later always lands after it.
export async function receiptPage(month: string | null, cursor: string | null): Promise<{ receipts: ReceiptItem[]; nextCursor: string | null }> {
  if (month === null || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw invalid({ month: "Choose a month as YYYY-MM." });
  const after = cursor === null ? 0 : decodeCursor(cursor);
  if (after === null) throw invalid({ cursor: "That page link is no longer valid." });
  const found = await rows<ReceiptRow>(
    pool,
    `${SELECT_RECEIPT} WHERE r.paid_date LIKE $1 AND r.number > $2 ORDER BY r.number LIMIT $3`,
    [`${month}-%`, after, PAGE_SIZE + 1],
  );
  const page = found.slice(0, PAGE_SIZE);
  const last = page.at(-1);
  return { receipts: page.map(listItem), nextCursor: found.length > PAGE_SIZE && last ? encodeCursor(last.number) : null };
}
