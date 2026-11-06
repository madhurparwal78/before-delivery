// Reading holds and loans, and turning rows into exactly the response fields the brief lists. Nothing here
// ever selects an email, phone, password hash or billing id.

import type { Hold, HoldStatus, Loan, LoanStatus, Photo, PhotoStage, Settlement, User } from "../../shared/api.js";
import type { Db } from "../db.js";
import { pool } from "../db.js";
import { ApiError } from "../http/errors.js";
import { holdStatusSql, loanStatusSql } from "./status.js";

type Queryable = Pick<Db, "query">;

export interface HoldRow {
  id: string;
  member_id: string;
  member_name: string;
  item_id: string;
  item_name: string;
  unit_id: string;
  unit_label: string;
  lane_index: number;
  status: HoldStatus;
  start_date: string;
  end_date: string;
  ready_at: Date | null;
  pickup_deadline: Date | null;
  created_at: Date;
}

export const HOLD_SELECT = `
  SELECT h.id, h.member_id, m.name AS member_name, h.item_id, i.name AS item_name, h.unit_id,
         u.label AS unit_label, u.lane_index, ${holdStatusSql()} AS status, h.start_date, h.end_date,
         h.ready_at, h.pickup_deadline, h.created_at
  FROM hold h JOIN person m ON m.id = h.member_id JOIN item i ON i.id = h.item_id JOIN unit u ON u.id = h.unit_id`;

export interface LoanRow {
  id: string;
  member_id: string;
  member_name: string;
  item_id: string;
  item_name: string;
  unit_id: string;
  unit_label: string;
  lane_index: number;
  hold_id: string | null;
  status: LoanStatus;
  checked_out_at: Date;
  due_date: string;
  due_at: Date;
  renewed_at: Date | null;
  returned_at: Date | null;
  on_time: boolean | null;
  late_days: number | null;
  deposit_cents: number;
  replacement_cents: number;
  inspection_outcome: "ok" | "damaged" | null;
  inspection_note: string | null;
  inspected_at: Date | null;
  fixed_damage_cents: number | null;
  settlement: SettlementRow | null;
}

interface SettlementRow {
  deposit_cents: number;
  released_cents: number;
  damage_cents: number;
  damage_from_deposit_cents: number;
  extra_damage_cents: number;
  late_days: number;
  late_fee_cents: number;
  total_charged_cents: number;
  settled_at: string;
}

export const LOAN_SELECT = `
  SELECT l.id, l.member_id, m.name AS member_name, l.item_id, i.name AS item_name, l.unit_id,
         u.label AS unit_label, u.lane_index, l.hold_id, ${loanStatusSql()} AS status, l.checked_out_at,
         l.due_date, l.due_at, l.renewed_at, l.returned_at, l.on_time, l.late_days, l.deposit_cents,
         l.replacement_cents, l.inspection_outcome, l.inspection_note, l.inspected_at, l.fixed_damage_cents,
         CASE WHEN s.loan_id IS NULL THEN NULL ELSE json_build_object(
           'deposit_cents', s.deposit_cents, 'released_cents', s.released_cents, 'damage_cents', s.damage_cents,
           'damage_from_deposit_cents', s.damage_from_deposit_cents, 'extra_damage_cents', s.extra_damage_cents,
           'late_days', s.late_days, 'late_fee_cents', s.late_fee_cents,
           'total_charged_cents', s.total_charged_cents,
           'settled_at', to_char(s.settled_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) END AS settlement
  FROM loan l JOIN person m ON m.id = l.member_id JOIN item i ON i.id = l.item_id JOIN unit u ON u.id = l.unit_id
  LEFT JOIN settlement s ON s.loan_id = l.id`;

interface PhotoRow {
  id: string;
  loan_id: string;
  stage: PhotoStage;
  content_type: string;
  size_bytes: number;
}

const iso = (value: Date | null): string | null => (value ? value.toISOString() : null);

export function holdJson(row: HoldRow): Hold {
  return {
    id: row.id,
    item: { id: row.item_id, name: row.item_name },
    unit: { id: row.unit_id, label: row.unit_label, lane_index: row.lane_index },
    member: { id: row.member_id, name: row.member_name },
    status: row.status,
    start_date: row.start_date,
    end_date: row.end_date,
    ready_at: iso(row.ready_at),
    pickup_deadline: iso(row.pickup_deadline),
    created_at: row.created_at.toISOString(),
  };
}

export function settlementJson(loanId: string, s: SettlementRow): Settlement {
  return {
    loan_id: loanId,
    deposit_cents: s.deposit_cents,
    released_cents: s.released_cents,
    damage_cents: s.damage_cents,
    damage_from_deposit_cents: s.damage_from_deposit_cents,
    extra_damage_cents: s.extra_damage_cents,
    late_days: s.late_days,
    late_fee_cents: s.late_fee_cents,
    total_charged_cents: s.total_charged_cents,
    settled_at: s.settled_at,
  };
}

function photoJson(row: PhotoRow): Photo {
  return {
    id: row.id,
    stage: row.stage,
    content_type: row.content_type,
    size_bytes: row.size_bytes,
    url: `/api/loans/${row.loan_id}/photos/${row.id}`,
  };
}

/** Loans with their photos, in photo-number order. */
export async function loansJson(db: Queryable, rows: LoanRow[]): Promise<Loan[]> {
  const photos = await db.query<PhotoRow>(
    "SELECT id, loan_id, stage, content_type, size_bytes FROM photo WHERE loan_id = ANY($1::uuid[]) ORDER BY seq",
    [rows.map((row) => row.id)],
  );
  return rows.map((row) => ({
    id: row.id,
    item: { id: row.item_id, name: row.item_name },
    unit: { id: row.unit_id, label: row.unit_label, lane_index: row.lane_index },
    member: { id: row.member_id, name: row.member_name },
    hold_id: row.hold_id,
    status: row.status,
    checked_out_at: row.checked_out_at.toISOString(),
    due_date: row.due_date,
    due_at: row.due_at.toISOString(),
    renewed_at: iso(row.renewed_at),
    returned_at: iso(row.returned_at),
    on_time: row.on_time,
    late_days: row.late_days,
    deposit_cents: row.deposit_cents,
    replacement_cents: row.replacement_cents,
    inspection:
      row.inspection_outcome && row.inspected_at
        ? { outcome: row.inspection_outcome, note: row.inspection_note ?? "", inspected_at: row.inspected_at.toISOString() }
        : null,
    settlement: row.settlement ? settlementJson(row.id, row.settlement) : null,
    photos: photos.rows.filter((photo) => photo.loan_id === row.id).map(photoJson),
  }));
}

export async function loanJson(db: Queryable, row: LoanRow): Promise<Loan> {
  const [loan] = await loansJson(db, [row]);
  if (!loan) throw new Error("loan serialisation lost its row");
  return loan;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/** A hold by id, as the caller may see it: members only their own. Locks the row when `forUpdate`. */
export async function readHold(db: Queryable, now: Date, id: string, forUpdate = false): Promise<HoldRow | undefined> {
  if (!isUuid(id)) return undefined;
  const found = await db.query<HoldRow>(`${HOLD_SELECT} WHERE h.id = $2${forUpdate ? " FOR UPDATE OF h" : ""}`, [now, id]);
  return found.rows[0];
}

export async function readLoan(db: Queryable, now: Date, id: string, forUpdate = false): Promise<LoanRow | undefined> {
  if (!isUuid(id)) return undefined;
  const found = await db.query<LoanRow>(`${LOAN_SELECT} WHERE l.id = $2${forUpdate ? " FOR UPDATE OF l" : ""}`, [now, id]);
  return found.rows[0];
}

/** The own-records rule: a member sees only their own holds and loans; staff see all (null). */
export function ownerFilter(user: User): string | null {
  return user.role === "member" ? user.id : null;
}

function visibleTo(user: User, memberId: string): boolean {
  const owner = ownerFilter(user);
  return owner === null || owner === memberId;
}

/** Step 4 of the precedence order: an id the caller may not see answers exactly like a missing one. */
export async function findHold(user: User, now: Date, id: string): Promise<HoldRow> {
  const row = await readHold(pool, now, id);
  if (!row || !visibleTo(user, row.member_id)) throw ApiError.of("not_found");
  return row;
}

export async function findLoan(user: User, now: Date, id: string): Promise<LoanRow> {
  const row = await readLoan(pool, now, id);
  if (!row || !visibleTo(user, row.member_id)) throw ApiError.of("not_found");
  return row;
}
