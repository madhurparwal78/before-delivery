// Reading records and writing them in the API's resource shapes.
import type { Db } from "./db.js";
import { rows } from "./db.js";
import { boardCounts, COLUMNS, itemStatus, type Counts, type ItemStatus, type LoanStatus, type PartState } from "./domain/board.js";
import { dueBy, today, type Calendar } from "./domain/calendar.js";
import { overdueSoFar, type FeeLine, type FeeRules } from "./domain/fees.js";
import { HOLD_POSITIONS } from "./domain/holds.js";
import { membershipStatus, type MembershipRow } from "./domain/membership.js";
import { formatInstant } from "./domain/time.js";

interface PartView {
  id: number;
  item_id: number;
  name: string;
  shape: string;
  col: number;
  row: number;
  width: number;
  height: number;
  state: PartState;
}

interface ItemView {
  id: number;
  tag: string;
  name: string;
  replacement_cost_cents: number;
  status: ItemStatus;
  due_date: string | null;
  hold_queue_length: number;
  parts: PartView[];
}

const PART_COLUMNS = `p.id, p.item_id, p.name, p.shape, p.col, p."row", p.width, p.height, p.state`;
const BOARD_ORDER = `p."row", p.col`;

/** Items in their API shape, with status derived at read time. */
export async function loadItems(db: Db, itemIds: readonly number[] | null): Promise<ItemView[]> {
  const filter = itemIds ? `WHERE i.id = ANY($1)` : "";
  const params = itemIds ? [itemIds] : [];
  const [items, parts, loans, holds] = await Promise.all([
    rows<{ id: number; tag: string; name: string; replacement_cost_cents: number }>(
      db,
      `SELECT i.id, i.tag, i.name, i.replacement_cost_cents FROM items i ${filter} ORDER BY i.id`,
      params,
    ),
    rows<PartView>(db, `SELECT ${PART_COLUMNS} FROM parts p ${itemIds ? "WHERE p.item_id = ANY($1)" : ""} ORDER BY ${BOARD_ORDER}`, params),
    rows<{ item_id: number; status: LoanStatus; due_date: string | null }>(
      db,
      `SELECT li.item_id, l.status, l.due_date FROM loan_items li JOIN loans l ON l.id = li.loan_id
       WHERE l.status IN ('reserved','out','pending-photo','returned-partial') ${itemIds ? "AND li.item_id = ANY($1)" : ""}`,
      params,
    ),
    rows<{ item_id: number; waiting: number; ready: number }>(
      db,
      `SELECT item_id, count(*) AS waiting, count(*) FILTER (WHERE status = 'ready') AS ready FROM holds
       WHERE status IN ('queued','ready') ${itemIds ? "AND item_id = ANY($1)" : ""} GROUP BY item_id`,
      params,
    ),
  ]);
  const partsByItem = new Map<number, PartView[]>();
  for (const part of parts) partsByItem.set(part.item_id, [...(partsByItem.get(part.item_id) ?? []), part]);
  const loanByItem = new Map(loans.map((l) => [l.item_id, l]));
  const holdsByItem = new Map(holds.map((h) => [h.item_id, h]));
  return items.map((item) => {
    const itemParts = partsByItem.get(item.id) ?? [];
    const loan = loanByItem.get(item.id) ?? null;
    const status = itemStatus(loan?.status ?? null, itemParts.map((p) => p.state), (holdsByItem.get(item.id)?.ready ?? 0) > 0);
    return {
      ...item,
      status,
      due_date: status === "out" || status === "pending-photo" ? loan!.due_date : null,
      hold_queue_length: holdsByItem.get(item.id)?.waiting ?? 0,
      parts: itemParts,
    };
  });
}

export async function loadBoard(db: Db): Promise<{ counts: Counts; columns: number; rows: number; items: ItemView[] }> {
  const items = await loadItems(db, null);
  const parts = items.flatMap((item) => item.parts);
  return {
    counts: boardCounts(parts.map((p) => p.state)),
    columns: COLUMNS,
    rows: parts.reduce((max, p) => Math.max(max, p.row + p.height), 0),
    items,
  };
}

export async function loadCounts(db: Db): Promise<Counts> {
  const parts = await rows<{ state: PartState }>(db, `SELECT state FROM parts`);
  return boardCounts(parts.map((p) => p.state));
}

interface PhotoView {
  id: number;
  event: "checkout" | "checkin";
  content_type: string;
  byte_size: number;
  sha256: string;
  captured_at: string;
  received_at: string;
  url: string;
}

interface LoanRow {
  id: number;
  ref: string;
  member_id: number;
  member_name: string;
  status: LoanStatus;
  checked_out_at: Date | null;
  due_date: string | null;
  fee_rules: FeeRules | null;
  returned_at: Date | null;
  recorded_open_days_late: number | null;
  recorded_late_fee_cents: number | null;
  fee_id: number | null;
}

export interface LoanView {
  id: number;
  ref: string;
  member_id: number;
  member_name: string;
  status: LoanStatus;
  checked_out_at: string | null;
  due_date: string | null;
  due_by: string | null;
  fee_rules: FeeRules | null;
  open_days_late: number | null;
  late_fee_so_far_cents: number | null;
  returned_at: string | null;
  items: Array<{ id: number; tag: string; name: string; grade: "good" | "worn" | "damaged" | null }>;
  parts: PartView[];
  missing_parts: string[];
  photos: PhotoView[];
  fee_id: number | null;
}

interface LoanFilter {
  ids?: readonly number[];
  memberId?: number;
  statuses?: readonly string[];
}

export async function loadPhotos(db: Db, loanIds: readonly number[], calendar: Calendar): Promise<Map<number, PhotoView[]>> {
  const photos = await rows<{
    id: number;
    loan_id: number;
    event: "checkout" | "checkin";
    content_type: string;
    byte_size: number;
    sha256: string;
    captured_at: Date;
    received_at: Date;
  }>(
    db,
    `SELECT id, loan_id, event, content_type, byte_size, sha256, captured_at, received_at FROM photos
     WHERE loan_id = ANY($1) ORDER BY event = 'checkin', id`,
    [loanIds],
  );
  const byLoan = new Map<number, PhotoView[]>();
  for (const { loan_id, captured_at, received_at, ...photo } of photos) {
    byLoan.set(loan_id, [
      ...(byLoan.get(loan_id) ?? []),
      {
        ...photo,
        captured_at: formatInstant(calendar.zone, captured_at.getTime()),
        received_at: formatInstant(calendar.zone, received_at.getTime()),
        url: `/api/photos/${photo.id}`,
      },
    ]);
  }
  return byLoan;
}

export async function loadLoans(db: Db, filter: LoanFilter, calendar: Calendar, now: number): Promise<LoanView[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.ids) where.push(`l.id = ANY($${params.push(filter.ids)})`);
  if (filter.memberId !== undefined) where.push(`l.member_id = $${params.push(filter.memberId)}`);
  if (filter.statuses) where.push(`l.status = ANY($${params.push(filter.statuses)})`);
  const loans = await rows<LoanRow>(
    db,
    `SELECT l.id, l.ref, l.member_id, u.name AS member_name, l.status, l.checked_out_at, l.due_date, l.fee_rules,
            l.returned_at, l.recorded_open_days_late, l.recorded_late_fee_cents, f.id AS fee_id
     FROM loans l JOIN users u ON u.id = l.member_id LEFT JOIN fees f ON f.loan_id = l.id
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY l.id`,
    params,
  );
  if (loans.length === 0) return [];
  const loanIds = loans.map((l) => l.id);
  const [items, parts, photos] = await Promise.all([
    rows<{ loan_id: number; id: number; tag: string; name: string; grade: "good" | "worn" | "damaged" | null }>(
      db,
      `SELECT li.loan_id, i.id, i.tag, i.name, li.grade FROM loan_items li JOIN items i ON i.id = li.item_id
       WHERE li.loan_id = ANY($1) ORDER BY li.loan_id, li.position`,
      [loanIds],
    ),
    rows<PartView & { loan_id: number }>(
      db,
      `SELECT li.loan_id, ${PART_COLUMNS} FROM loan_items li JOIN parts p ON p.item_id = li.item_id
       WHERE li.loan_id = ANY($1) ORDER BY ${BOARD_ORDER}`,
      [loanIds],
    ),
    loadPhotos(db, loanIds, calendar),
  ]);
  const group = <T extends { loan_id: number }>(list: T[]) => {
    const map = new Map<number, Array<Omit<T, "loan_id">>>();
    for (const { loan_id, ...rest } of list) map.set(loan_id, [...(map.get(loan_id) ?? []), rest]);
    return map;
  };
  const itemsByLoan = group(items);
  const partsByLoan = group(parts);
  return loans.map((loan) => {
    const loanItems = itemsByLoan.get(loan.id) ?? [];
    const loanParts = (partsByLoan.get(loan.id) ?? []) as PartView[];
    const overdue = overdueSoFar(loan, loanItems.map((i) => i.id), calendar, now);
    return {
      id: loan.id,
      ref: loan.ref,
      member_id: loan.member_id,
      member_name: loan.member_name,
      status: loan.status,
      checked_out_at: loan.checked_out_at ? formatInstant(calendar.zone, loan.checked_out_at.getTime()) : null,
      due_date: loan.status === "reserved" ? null : loan.due_date,
      due_by: loan.status === "reserved" ? null : dueBy(calendar, loan.due_date!),
      fee_rules: loan.status === "reserved" ? null : loan.fee_rules,
      ...overdue,
      returned_at: loan.returned_at ? formatInstant(calendar.zone, loan.returned_at.getTime()) : null,
      items: loanItems,
      parts: loanParts,
      missing_parts: loan.status === "returned-partial" ? loanParts.filter((p) => p.state === "missing").map((p) => p.name) : [],
      photos: photos.get(loan.id) ?? [],
      fee_id: loan.fee_id,
    };
  });
}

interface FeeView {
  id: number;
  loan_id: number;
  loan_ref: string;
  member_id: number;
  status: "raised" | "settled" | "waived-by-coordinator";
  total_cents: number;
  lines: FeeLine[];
  killbill_invoice_id: string;
  waiver: null | { status: "requested" | "approved" | "declined"; reason: string; requested_at: string; decided_at: string | null };
}

export async function loadFees(db: Db, filter: { ids?: readonly number[]; memberId?: number; status?: string }, calendar: Calendar): Promise<FeeView[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.ids) where.push(`f.id = ANY($${params.push(filter.ids)})`);
  if (filter.memberId !== undefined) where.push(`f.member_id = $${params.push(filter.memberId)}`);
  if (filter.status !== undefined) where.push(`f.status = $${params.push(filter.status)}`);
  const fees = await rows<{
    id: number;
    loan_id: number;
    loan_ref: string;
    member_id: number;
    status: FeeView["status"];
    total_cents: number;
    killbill_invoice_id: string;
    waiver_status: "requested" | "approved" | "declined" | null;
    waiver_reason: string | null;
    waiver_requested_at: Date | null;
    waiver_decided_at: Date | null;
  }>(
    db,
    `SELECT f.id, f.loan_id, l.ref AS loan_ref, f.member_id, f.status, f.total_cents, f.killbill_invoice_id,
            f.waiver_status, f.waiver_reason, f.waiver_requested_at, f.waiver_decided_at
     FROM fees f JOIN loans l ON l.id = f.loan_id ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY f.id`,
    params,
  );
  if (fees.length === 0) return [];
  const lines = await rows<FeeLine & { fee_id: number }>(
    db,
    `SELECT fee_id, item_id, kind, open_days, amount_cents, description FROM fee_lines WHERE fee_id = ANY($1) ORDER BY fee_id, position`,
    [fees.map((f) => f.id)],
  );
  return fees.map((fee) => ({
    id: fee.id,
    loan_id: fee.loan_id,
    loan_ref: fee.loan_ref,
    member_id: fee.member_id,
    status: fee.status,
    total_cents: fee.total_cents,
    lines: lines.filter((l) => l.fee_id === fee.id).map(({ fee_id: _fee, ...line }) => line),
    killbill_invoice_id: fee.killbill_invoice_id,
    waiver: fee.waiver_status
      ? {
          status: fee.waiver_status,
          reason: fee.waiver_reason!,
          requested_at: formatInstant(calendar.zone, fee.waiver_requested_at!.getTime()),
          decided_at: fee.waiver_decided_at ? formatInstant(calendar.zone, fee.waiver_decided_at.getTime()) : null,
        }
      : null,
  }));
}

interface HoldView {
  id: number;
  item_id: number;
  member_id: number;
  status: "queued" | "ready" | "collected" | "cancelled";
  position: number | null;
  placed_at: string;
}

export async function loadHolds(db: Db, filter: { ids?: readonly number[]; memberId?: number; itemId?: number }, calendar: Calendar): Promise<HoldView[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.ids) where.push(`h.id = ANY($${params.push(filter.ids)})`);
  if (filter.memberId !== undefined) where.push(`h.member_id = $${params.push(filter.memberId)}`);
  if (filter.itemId !== undefined) where.push(`h.item_id = $${params.push(filter.itemId)}`);
  const holds = await rows<Omit<HoldView, "placed_at"> & { placed_at: Date }>(
    db,
    `SELECT h.id, h.item_id, h.member_id, h.status, q.position, h.placed_at
     FROM holds h LEFT JOIN (${HOLD_POSITIONS}) q ON q.id = h.id
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY h.id`,
    params,
  );
  return holds.map((h) => ({ ...h, placed_at: formatInstant(calendar.zone, h.placed_at.getTime()) }));
}

interface MembershipView {
  status: "pending-payment" | "active" | "lapsed";
  tier: string;
  active_until: string | null;
  ends_at_term: boolean;
}

export function membershipView(row: MembershipRow, calendar: Calendar, now: number): MembershipView {
  return {
    status: membershipStatus(row, today(calendar, now)),
    tier: row.tier,
    active_until: row.active_until,
    ends_at_term: row.ends_at_term,
  };
}
