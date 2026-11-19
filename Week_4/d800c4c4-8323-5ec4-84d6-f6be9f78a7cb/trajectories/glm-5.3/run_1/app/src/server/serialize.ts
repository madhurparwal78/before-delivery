// Serialization: rows to the published API shapes. Timestamps carry the library offset.

import type { Db } from './db';
import type { Board, Fee, FeeLine, FeeRules, Item, Loan, LoanStatus, Part, Photo } from '../shared/api';
import type { Calendar } from './calendar';
import { boardCounts, overdueSoFar } from './domain';
import { isoInZone } from './libraryTime';
import { dueBy as dueByFor } from './calendar';

export interface LoanRowFull {
  id: number;
  ref: string;
  member_id: number;
  member_name: string;
  status: LoanStatus;
  checked_out_at: Date | null;
  due_date: string | null;
  returned_at: Date | null;
  returned_day: string | null;
  open_days_late: number | null;
  late_fee_so_far_cents: number | null;
  fee_rules: FeeRules | null;
  fee_id: number | null;
  checked_out_day: string | null;
}

export interface PartRow {
  id: number;
  item_id: number;
  name: string;
  shape: Part['shape'];
  col: number;
  row: number;
  width: number;
  height: number;
  state: Part['state'];
}

export interface ItemRow {
  id: number;
  tag: string;
  name: string;
  replacement_cost_cents: number;
  status: Item['status'];
  due_date: string | null;
}

export function serializePart(part: PartRow): Part {
  return {
    id: part.id,
    item_id: part.item_id,
    name: part.name,
    shape: part.shape,
    col: part.col,
    row: part.row,
    width: part.width,
    height: part.height,
    state: part.state,
  };
}

export async function loanToApi(db: Db, calendar: Calendar, row: LoanRowFull, now: Date): Promise<Loan> {
  const itemRows = await db.query<{ id: number; tag: string; name: string; grade: string | null }>(
    `SELECT i.id, i.tag, i.name, li.grade FROM loan_items li JOIN items i ON i.id = li.item_id WHERE li.loan_id = $1 ORDER BY i.id`,
    [row.id],
  );
  const partRows = await db.query<PartRow>(
    `SELECT p.id, p.item_id, p.name, p.shape, p.col, p.row, p.width, p.height, p.state
     FROM parts p JOIN loan_items li ON li.item_id = p.item_id
     WHERE li.loan_id = $1 ORDER BY p.row, p.col`,
    [row.id],
  );
  const photoRows = await db.query<{ id: number; event: 'checkout' | 'checkin'; content_type: string; byte_size: number; sha256: string; captured_at: Date; received_at: Date; storage_key: string }>(
    'SELECT id, event, content_type, byte_size, sha256, captured_at, received_at, storage_key FROM photos WHERE loan_id = $1 ORDER BY id',
    [row.id],
  );
  const missing = await db.query<{ name: string }>(
    `SELECT p.name FROM parts p JOIN loan_items li ON li.item_id = p.item_id
     WHERE li.loan_id = $1 AND p.state = 'missing' ORDER BY p.row, p.col`,
    [row.id],
  );

  const reserved = row.status === 'reserved';
  let openDaysLate: number | null = null;
  let lateFeeSoFar: number | null = null;
  if (!reserved) {
    if (row.status === 'out') {
      const figures = overdueSoFar(calendar, { due_date: row.due_date, fee_rules: row.fee_rules, items: itemRows.map((i) => ({ id: i.id })) }, now);
      openDaysLate = figures.open_days_late;
      lateFeeSoFar = figures.late_fee_so_far_cents;
    } else if (row.status === 'pending-photo') {
      openDaysLate = row.open_days_late;
      lateFeeSoFar = row.late_fee_so_far_cents;
    } else {
      openDaysLate = row.open_days_late ?? 0;
      lateFeeSoFar = row.late_fee_so_far_cents ?? 0;
    }
  }

  return {
    id: row.id,
    ref: row.ref,
    member_id: row.member_id,
    member_name: row.member_name,
    status: row.status,
    checked_out_at: row.checked_out_at === null ? null : isoInZone(row.checked_out_at, calendar.zone),
    due_date: row.due_date,
    due_by: row.due_date === null ? null : dueByFor(calendar, row.due_date),
    fee_rules: reserved ? null : row.fee_rules,
    open_days_late: openDaysLate,
    late_fee_so_far_cents: lateFeeSoFar,
    returned_at: row.returned_at === null ? null : isoInZone(row.returned_at, calendar.zone),
    items: itemRows.map((i) => ({ id: i.id, tag: i.tag, name: i.name, grade: (i.grade as 'good' | 'worn' | 'damaged' | null) ?? null })),
    parts: partRows.map(serializePart),
    missing_parts: missing.map((m) => m.name),
    photos: photoRows.map((p) => photoToApi(p)),
    fee_id: row.fee_id,
  };
}

export function photoToApi(row: { id: number; event: string; content_type: string; byte_size: number; sha256: string; captured_at: Date; received_at: Date }): Photo {
  return {
    id: row.id,
    event: row.event as 'checkout' | 'checkin',
    content_type: row.content_type,
    byte_size: row.byte_size,
    sha256: row.sha256,
    captured_at: row.captured_at.toISOString(),
    received_at: row.received_at.toISOString(),
    url: `/api/photos/${row.id}`,
  };
}

export interface FeeRowFull {
  id: number;
  loan_id: number;
  loan_ref: string;
  member_id: number;
  status: Fee['status'];
  total_cents: number;
  lines: FeeLine[];
  killbill_invoice_id: string | null;
}

export interface WaiverRow {
  fee_id: number;
  status: 'requested' | 'approved' | 'declined';
  reason: string;
  requested_at: Date;
  decided_at: Date | null;
}

export async function feeToApi(db: Db, calendar: Calendar, row: FeeRowFull): Promise<Fee> {
  const waiver = await db.one<WaiverRow>('SELECT fee_id, status, reason, requested_at, decided_at FROM waivers WHERE fee_id = $1', [row.id]);
  return {
    id: row.id,
    loan_id: row.loan_id,
    loan_ref: row.loan_ref,
    member_id: row.member_id,
    status: row.status,
    total_cents: row.total_cents,
    lines: row.lines,
    killbill_invoice_id: row.killbill_invoice_id ?? '',
    waiver:
      waiver === null
        ? null
        : {
            status: waiver.status,
            reason: waiver.reason,
            requested_at: isoInZone(waiver.requested_at, calendar.zone),
            decided_at: waiver.decided_at === null ? null : isoInZone(waiver.decided_at, calendar.zone),
          },
  };
}

export async function readBoard(db: Db): Promise<Board> {
  const itemRows = await db.query<ItemRow>(
    `SELECT i.id, i.tag, i.name, i.replacement_cost_cents, i.status,
            to_char(l.due_date, 'YYYY-MM-DD') as due_date
     FROM items i
     LEFT JOIN LATERAL (
       SELECT l.due_date FROM loans l JOIN loan_items li ON li.loan_id = l.id
       WHERE li.item_id = i.id AND l.status IN ('out','pending-photo') LIMIT 1
     ) l ON true
     ORDER BY i.id`,
  );
  const partRows = await db.query<PartRow>('SELECT id, item_id, name, shape, col, row, width, height, state FROM parts ORDER BY row, col');
  const holdCounts = await db.query<{ item_id: number; n: string }>(
    `SELECT item_id, count(*)::text as n FROM holds WHERE status IN ('queued','ready') GROUP BY item_id`,
  );
  const holdMap = new Map<number, number>();
  for (const h of holdCounts) holdMap.set(h.item_id, Number(h.n));
  const parts = new Map<number, PartRow[]>();
  for (const part of partRows) {
    const list = parts.get(part.item_id) ?? [];
    list.push(part);
    parts.set(part.item_id, list);
  }
  const counts = boardCounts(partRows);
  let rows = 0;
  for (const part of partRows) rows = Math.max(rows, part.row + part.height);
  return {
    counts,
    columns: 10,
    rows,
    items: itemRows.map((item) => ({
      id: item.id,
      tag: item.tag,
      name: item.name,
      replacement_cost_cents: item.replacement_cost_cents,
      status: item.status,
      due_date: item.due_date,
      hold_queue_length: holdMap.get(item.id) ?? 0,
      parts: (parts.get(item.id) ?? []).map(serializePart),
    })),
  };
}

export async function loadLoanRow(db: Db, loanId: number): Promise<LoanRowFull | null> {
  return db.one<LoanRowFull>(
    `SELECT l.id, l.ref, l.member_id, u.name as member_name, l.status, l.checked_out_at,
            to_char(l.due_date, 'YYYY-MM-DD') as due_date, l.returned_at,
            to_char(l.returned_at, 'YYYY-MM-DD') as returned_day,
            l.open_days_late, l.late_fee_so_far_cents, l.fee_rules,
            (SELECT f.id FROM fees f WHERE f.loan_id = l.id) as fee_id
     FROM loans l JOIN users u ON u.id = l.member_id WHERE l.id = $1`,
    [loanId],
  );
}

export async function loadFeeRow(db: Db, feeId: number): Promise<FeeRowFull | null> {
  return db.one<FeeRowFull>(
    `SELECT f.id, f.loan_id, l.ref as loan_ref, f.member_id, f.status, f.total_cents, f.lines, f.killbill_invoice_id
     FROM fees f JOIN loans l ON l.id = f.loan_id WHERE f.id = $1`,
    [feeId],
  );
}
