// The domain: settings, calendar, loans, fees, holds, memberships.
// Each rule is decided in exactly one place in this module.

import type { Db } from './db';
import {
  type Calendar,
  type HoursByWeekday,
  type Weekday,
  dueDateFrom,
  effectiveReturnDay,
  isOpenDay,
  nextOpenDayAfter,
  openDaysLate,
  today,
} from './calendar';
import type {
  Counts,
  FeeLine,
  FeeRules,
  ItemStatus,
  LoanStatus,
  Part,
  Settings,
} from '../shared/api';

export interface AppDeps {
  db: Db;
}

export interface SettingsRow {
  time_zone: string;
  late_fee_cents: number;
  damage_fee_cents: number;
  loan_period_days: number;
}

export async function getSettings(db: Db): Promise<SettingsRow> {
  const row = await db.one<SettingsRow>('SELECT time_zone, late_fee_cents, damage_fee_cents, loan_period_days FROM settings WHERE id = 1');
  if (row === null) throw new Error('settings missing');
  return row;
}

export async function getCalendar(db: Db): Promise<Calendar> {
  const settings = await getSettings(db);
  const hoursRows = await db.query<{ weekday: Weekday; opens: string; closes: string }>(
    'SELECT weekday, opens, closes FROM opening_hours',
  );
  const hours: HoursByWeekday = {};
  for (const row of hoursRows) hours[row.weekday] = { opens: row.opens, closes: row.closes };
  const closureRows = await db.query<{ date: string; reason: string }>('SELECT to_char(date, \'YYYY-MM-DD\') as date, reason FROM closures');
  const closures = new Map<string, string>();
  for (const row of closureRows) closures.set(row.date, row.reason);
  return { zone: settings.time_zone, hours, closures };
}

// ---------------------------------------------------------------------------
// Board and parts

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
  status: ItemStatus;
  due_date: string | null;
}

export async function loadItems(db: Db): Promise<{ items: ItemRow[]; parts: Map<number, PartRow[]> }> {
  const itemRows = await db.query<ItemRow>(
    `SELECT i.id, i.tag, i.name, i.replacement_cost_cents, i.status, to_char(l.due_date, 'YYYY-MM-DD') as due_date
     FROM items i
     LEFT JOIN loan_items li ON li.item_id = i.id
     LEFT JOIN loans l ON l.id = li.loan_id AND l.status IN ('out','pending-photo')
     ORDER BY i.id`,
  );
  const partRows = await db.query<PartRow>('SELECT id, item_id, name, shape, col, row, width, height, state FROM parts ORDER BY row, col');
  const parts = new Map<number, PartRow[]>();
  for (const part of partRows) {
    const list = parts.get(part.item_id) ?? [];
    list.push(part);
    parts.set(part.item_id, list);
  }
  return { items: itemRows, parts };
}

export function boardCounts(parts: PartRow[]): Counts {
  let on_wall = 0;
  let out = 0;
  let missing = 0;
  for (const part of parts) {
    if (part.state === 'hung') on_wall++;
    else if (part.state === 'out') out++;
    else missing++;
  }
  return { on_wall, out, missing };
}

/** The tool's status derived from its parts and holds: decided in one place. */
export async function recomputeItemStatus(db: Db, itemId: number): Promise<ItemStatus> {
  const parts = await db.query<PartRow>('SELECT id, state FROM parts WHERE item_id = $1', [itemId]);
  const allHung = parts.every((p) => p.state === 'hung');
  const loan = await db.one<{ status: string }>(
    `SELECT l.status FROM loans l JOIN loan_items li ON li.loan_id = l.id
     WHERE li.item_id = $1 AND l.status IN ('reserved','out','pending-photo') LIMIT 1`,
    [itemId],
  );
  if (loan !== null) {
    if (loan.status === 'reserved') return 'reserved';
    if (loan.status === 'pending-photo') return 'pending-photo';
    return 'out';
  }
  const incomplete = await db.one<{ id: number }>(
    `SELECT l.id FROM loans l JOIN loan_items li ON li.loan_id = l.id
     WHERE li.item_id = $1 AND l.status = 'returned-partial' LIMIT 1`,
    [itemId],
  );
  if (incomplete !== null) return 'incomplete';
  const readyHold = await db.one<{ id: number }>(
    `SELECT id FROM holds WHERE item_id = $1 AND status = 'ready' LIMIT 1`,
    [itemId],
  );
  if (readyHold !== null) return 'held';
  return allHung ? 'on-wall' : 'incomplete';
}

// ---------------------------------------------------------------------------
// Loans

export interface LoanRow {
  id: number;
  ref: string;
  member_id: number;
  status: LoanStatus;
  checked_out_at: Date | null;
  due_date: string | null;
  returned_at: Date | null;
  fee_rules: FeeRules | null;
  open_days_late: number | null;
  late_fee_so_far_cents: number | null;
  fee_id: number | null;
  member_name: string;
}

export async function loadLoans(db: Db): Promise<LoanRow[]> {
  return db.query<LoanRow>(
    `SELECT l.id, l.ref, l.member_id, l.status, l.checked_out_at, to_char(l.due_date, 'YYYY-MM-DD') as due_date,
            l.returned_at, l.fee_rules, l.open_days_late, l.late_fee_so_far_cents,
            (SELECT f.id FROM fees f WHERE f.loan_id = l.id) as fee_id,
            u.name as member_name
     FROM loans l JOIN users u ON u.id = l.member_id
     ORDER BY l.id`,
  );
}

/** The overdue figures for an out loan: worked out afresh on every read from the server's clock. */
export function overdueSoFar(
  calendar: Calendar,
  loan: { due_date: string | null; fee_rules: FeeRules | null; items: { id: number }[] },
  now: Date,
): { open_days_late: number; late_fee_so_far_cents: number } {
  if (loan.due_date === null || loan.fee_rules === null) return { open_days_late: 0, late_fee_so_far_cents: 0 };
  const effective = effectiveReturnDay(calendar, now);
  const days = openDaysLate(calendar, loan.due_date, effective);
  let cents = 0;
  for (const item of loan.items) {
    const cost = loan.fee_rules.replacement_costs_cents[String(item.id)];
    if (cost === undefined) continue;
    cents += Math.min(loan.fee_rules.late_fee_cents * days, cost);
  }
  return { open_days_late: days, late_fee_so_far_cents: cents };
}

/** Fee lines computed once at the check-in outcome, from the loan's recorded fee rules. */
export function computeFeeLines(
  loan: {
    fee_rules: FeeRules | null;
    items: { id: number; tag: string; name: string; grade: string | null }[];
    open_days_late: number;
  },
): FeeLine[] {
  const rules = loan.fee_rules;
  if (rules === null) return [];
  const lines: FeeLine[] = [];
  for (const item of loan.items) {
    const cost = rules.replacement_costs_cents[String(item.id)] ?? 0;
    if (loan.open_days_late > 0) {
      const raw = rules.late_fee_cents * loan.open_days_late;
      const capped = raw > cost;
      const amount = capped ? cost : raw;
      const dayWord = loan.open_days_late === 1 ? '1 open day late' : `${loan.open_days_late} open days late`;
      const suffix = capped ? ', capped at replacement cost' : '';
      lines.push({
        item_id: item.id,
        kind: 'late',
        open_days: loan.open_days_late,
        amount_cents: amount,
        description: `Late fee — ${item.name} (${item.tag}) — ${dayWord}${suffix}`,
      });
    }
    if (item.grade === 'damaged') {
      lines.push({
        item_id: item.id,
        kind: 'damage',
        open_days: null,
        amount_cents: rules.damage_fee_cents,
        description: `Damage fee — ${item.name} (${item.tag})`,
      });
    }
  }
  return lines;
}

export function feeTotal(lines: FeeLine[]): number {
  return lines.reduce((sum, line) => sum + line.amount_cents, 0);
}

/** The next loan ref in the L-nnnn sequence. */
export async function nextLoanRef(db: Db): Promise<{ ref: string; seq: number }> {
  const row = await db.one<{ max_seq: number | null }>('SELECT MAX(loan_seq) as max_seq FROM loans');
  const seq = (row?.max_seq ?? 0) + 1;
  return { ref: `L-${String(seq).padStart(4, '0')}`, seq };
}

// ---------------------------------------------------------------------------
// Holds

/** Queue positions recomputed on every read: queued holds in placed_at order, ties by id. */
export function holdPositions(holds: { id: number; status: string; placed_at: Date }[]): Map<number, number> {
  const queued = holds
    .filter((h) => h.status === 'queued')
    .sort((a, b) => (a.placed_at.getTime() === b.placed_at.getTime() ? a.id - b.id : a.placed_at.getTime() - b.placed_at.getTime()));
  const out = new Map<number, number>();
  queued.forEach((hold, index) => out.set(hold.id, index + 1));
  return out;
}

export async function loadHolds(db: Db, itemId: number): Promise<{ id: number; member_id: number; status: string; placed_at: Date }[]> {
  return db.query<{ id: number; member_id: number; status: string; placed_at: Date }>(
    'SELECT id, member_id, status, placed_at FROM holds WHERE item_id = $1 AND status IN (\'queued\',\'ready\') ORDER BY placed_at, id',
    [itemId],
  );
}

// ---------------------------------------------------------------------------
// Membership helpers

export async function membershipIsActive(db: Db, memberId: number): Promise<boolean> {
  const row = await db.one<{ status: string; active_until: string | null }>(
    `SELECT m.status, to_char(m.active_until, 'YYYY-MM-DD') as active_until FROM memberships m WHERE m.user_id = $1`,
    [memberId],
  );
  if (row === null) return false;
  if (row.status !== 'active') return false;
  if (row.active_until === null) return true;
  const calendar = await getCalendar(db);
  return row.active_until >= today(calendar, new Date());
}

// ---------------------------------------------------------------------------
// Calendar updates

/** Move out loans whose due date is no longer open to the next open day. Returns the moved count and new dates. */
export async function moveDueDates(db: Db, calendar: Calendar): Promise<{ moved: number }> {
  const rows = await db.query<{ id: number; due_date: string }>(
    `SELECT id, to_char(due_date, 'YYYY-MM-DD') as due_date FROM loans WHERE status = 'out'`,
  );
  let moved = 0;
  for (const row of rows) {
    if (!isOpenDay(calendar, row.due_date)) {
      const next = nextOpenDayAfter(calendar, row.due_date);
      const result = await db.query<{ id: number }>(
        'UPDATE loans SET due_date = $2 WHERE id = $1 AND due_date = to_date($3, \'YYYY-MM-DD\') RETURNING id',
        [row.id, next, row.due_date],
      );
      if (result.length > 0) moved++;
    }
  }
  return { moved };
}

/** The due date for a checkout: first open day on or after checkout date + loan period. */
export function dueDateForCheckout(calendar: Calendar, checkoutDate: string, settings: Settings): string {
  return dueDateFrom(calendar, checkoutDate, settings.loan_period_days);
}

export { effectiveReturnDay, openDaysLate };
