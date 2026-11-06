import type { LocalDate } from '../../domain/calendar.js';
import type { HoldStatus, LoanStatus, StoredLoanStatus } from '../../domain/states.js';
import type { Queryable } from '../db/queryable.js';

export interface UnitDetails {
  readonly id: string;
  readonly label: string;
  readonly laneIndex: number;
}

export interface HoldRecord {
  readonly id: string;
  readonly itemId: string;
  readonly itemName: string;
  readonly unit: UnitDetails;
  readonly memberId: string;
  readonly memberName: string;
  readonly storedStatus: HoldStatus;
  readonly startDate: LocalDate;
  readonly endDate: LocalDate;
  readonly readyAt: Date | null;
  readonly pickupDeadline: Date | null;
  readonly createdAt: Date;
}

export interface InspectionRecord {
  readonly outcome: 'ok' | 'damaged';
  readonly note: string;
  readonly inspectedAt: Date;
}

export interface SettlementRecord {
  readonly depositCents: number;
  readonly releasedCents: number;
  readonly damageCents: number;
  readonly damageFromDepositCents: number;
  readonly extraDamageCents: number;
  readonly lateDays: number;
  readonly lateFeeCents: number;
  readonly totalChargedCents: number;
  readonly settledAt: Date;
}

export interface PhotoRecord {
  readonly id: string;
  readonly loanId: string;
  readonly stage: 'checkout' | 'return';
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly extension: string;
  readonly seq: number;
}

export interface LoanRecord {
  readonly id: string;
  readonly itemId: string;
  readonly itemName: string;
  readonly unit: UnitDetails;
  readonly memberId: string;
  readonly memberName: string;
  readonly holdId: string | null;
  readonly storedStatus: StoredLoanStatus;
  readonly checkedOutAt: Date;
  readonly dueDate: LocalDate;
  readonly dueAt: Date;
  readonly renewedAt: Date | null;
  readonly returnedAt: Date | null;
  readonly onTime: boolean | null;
  readonly lateDays: number | null;
  readonly depositCents: number;
  readonly replacementCents: number;
  readonly inspection: InspectionRecord | null;
  readonly settlement: SettlementRecord | null;
  readonly photos: readonly PhotoRecord[];
}

const HOLD_COLUMNS = `
  h.id, h.item_id, i.name as item_name, h.unit_id, u.label as unit_label, u.lane_index,
  h.member_id, p.name as member_name, h.status, h.start_date, h.end_date,
  h.ready_at, h.pickup_deadline, h.created_at`;

const HOLD_FROM = `
  from hold h
  join item i on i.id = h.item_id
  join unit u on u.id = h.unit_id
  join person p on p.id = h.member_id`;

interface HoldRow {
  id: string;
  item_id: string;
  item_name: string;
  unit_id: string;
  unit_label: string;
  lane_index: number;
  member_id: string;
  member_name: string;
  status: string;
  start_date: LocalDate;
  end_date: LocalDate;
  ready_at: Date | null;
  pickup_deadline: Date | null;
  created_at: Date;
}

function toHold(row: HoldRow): HoldRecord {
  return {
    id: row.id,
    itemId: row.item_id,
    itemName: row.item_name,
    unit: { id: row.unit_id, label: row.unit_label, laneIndex: row.lane_index },
    memberId: row.member_id,
    memberName: row.member_name,
    storedStatus: row.status as HoldStatus,
    startDate: row.start_date,
    endDate: row.end_date,
    readyAt: row.ready_at,
    pickupDeadline: row.pickup_deadline,
    createdAt: row.created_at,
  };
}

export async function findHold(db: Queryable, holdId: string): Promise<HoldRecord | null> {
  if (!isUuid(holdId)) return null;
  const result = await db.query<HoldRow>(
    `select ${HOLD_COLUMNS} ${HOLD_FROM} where h.id = $1`,
    [holdId],
  );
  const row = result.rows[0];
  return row === undefined ? null : toHold(row);
}

export interface HoldPageQuery {
  readonly memberId: string | null;
  readonly status: HoldStatus | null;
  readonly now: Date;
  readonly limit: number;
  readonly cursorInstant: string | null;
  readonly cursorId: string | null;
}

export async function listHolds(db: Queryable, query: HoldPageQuery): Promise<HoldRecord[]> {
  const conditions: string[] = [];
  const parameters: unknown[] = [];
  if (query.memberId !== null) {
    parameters.push(query.memberId);
    conditions.push(`h.member_id = $${parameters.length}`);
  }
  if (query.status === 'ready' || query.status === 'expired') {
    parameters.push(query.now);
    const nowParameter = `$${parameters.length}`;
    conditions.push(
      query.status === 'ready'
        ? `(h.status = 'ready' and h.pickup_deadline > ${nowParameter})`
        : `(h.status = 'expired' or (h.status = 'ready' and h.pickup_deadline <= ${nowParameter}))`,
    );
  } else if (query.status !== null) {
    parameters.push(query.status);
    conditions.push(`h.status = $${parameters.length}`);
  }
  if (query.cursorInstant !== null && query.cursorId !== null) {
    parameters.push(query.cursorInstant, query.cursorId);
    conditions.push(
      `(h.created_at, h.id) < ($${parameters.length - 1}::timestamptz, $${parameters.length}::uuid)`,
    );
  }
  parameters.push(query.limit);
  const where = conditions.length === 0 ? '' : `where ${conditions.join(' and ')}`;
  const result = await db.query<HoldRow>(
    `select ${HOLD_COLUMNS} ${HOLD_FROM} ${where}
     order by h.created_at desc, h.id desc limit $${parameters.length}`,
    parameters,
  );
  return result.rows.map(toHold);
}

const LOAN_COLUMNS = `
  l.id, l.item_id, i.name as item_name, l.unit_id, u.label as unit_label, u.lane_index,
  l.member_id, p.name as member_name, l.hold_id, l.status, l.checked_out_at,
  l.due_date, l.due_at, l.renewed_at, l.returned_at, l.on_time, l.late_days,
  l.deposit_cents, l.replacement_cents,
  l.inspection_outcome, l.inspection_note, l.inspected_at,
  s.deposit_cents as s_deposit_cents, s.released_cents, s.damage_cents,
  s.damage_from_deposit_cents, s.extra_damage_cents, s.late_days as s_late_days,
  s.late_fee_cents, s.total_charged_cents, s.settled_at`;

const LOAN_FROM = `
  from loan l
  join item i on i.id = l.item_id
  join unit u on u.id = l.unit_id
  join person p on p.id = l.member_id
  left join settlement s on s.loan_id = l.id`;

interface LoanRow {
  id: string;
  item_id: string;
  item_name: string;
  unit_id: string;
  unit_label: string;
  lane_index: number;
  member_id: string;
  member_name: string;
  hold_id: string | null;
  status: string;
  checked_out_at: Date;
  due_date: LocalDate;
  due_at: Date;
  renewed_at: Date | null;
  returned_at: Date | null;
  on_time: boolean | null;
  late_days: number | null;
  deposit_cents: number;
  replacement_cents: number;
  inspection_outcome: string | null;
  inspection_note: string | null;
  inspected_at: Date | null;
  s_deposit_cents: number | null;
  released_cents: number | null;
  damage_cents: number | null;
  damage_from_deposit_cents: number | null;
  extra_damage_cents: number | null;
  s_late_days: number | null;
  late_fee_cents: number | null;
  total_charged_cents: number | null;
  settled_at: Date | null;
}

interface PhotoRow {
  id: string;
  loan_id: string;
  stage: string;
  content_type: string;
  size_bytes: number;
  extension: string;
  seq: number;
}

function toLoan(row: LoanRow, photos: readonly PhotoRecord[]): LoanRecord {
  const inspection: InspectionRecord | null =
    row.inspection_outcome === null || row.inspected_at === null
      ? null
      : {
          outcome: row.inspection_outcome as 'ok' | 'damaged',
          note: row.inspection_note ?? '',
          inspectedAt: row.inspected_at,
        };
  const settlement: SettlementRecord | null =
    row.settled_at === null
      ? null
      : {
          depositCents: row.s_deposit_cents ?? 0,
          releasedCents: row.released_cents ?? 0,
          damageCents: row.damage_cents ?? 0,
          damageFromDepositCents: row.damage_from_deposit_cents ?? 0,
          extraDamageCents: row.extra_damage_cents ?? 0,
          lateDays: row.s_late_days ?? 0,
          lateFeeCents: row.late_fee_cents ?? 0,
          totalChargedCents: row.total_charged_cents ?? 0,
          settledAt: row.settled_at,
        };
  return {
    id: row.id,
    itemId: row.item_id,
    itemName: row.item_name,
    unit: { id: row.unit_id, label: row.unit_label, laneIndex: row.lane_index },
    memberId: row.member_id,
    memberName: row.member_name,
    holdId: row.hold_id,
    storedStatus: row.status as StoredLoanStatus,
    checkedOutAt: row.checked_out_at,
    dueDate: row.due_date,
    dueAt: row.due_at,
    renewedAt: row.renewed_at,
    returnedAt: row.returned_at,
    onTime: row.on_time,
    lateDays: row.late_days,
    depositCents: row.deposit_cents,
    replacementCents: row.replacement_cents,
    inspection,
    settlement,
    photos,
  };
}

export function toPhoto(row: PhotoRow): PhotoRecord {
  return {
    id: row.id,
    loanId: row.loan_id,
    stage: row.stage as 'checkout' | 'return',
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    extension: row.extension,
    seq: row.seq,
  };
}

/** Photos come back in photo-number order: checkout first, then return, each by sequence. */
async function loadPhotos(db: Queryable, loanIds: readonly string[]): Promise<Map<string, PhotoRecord[]>> {
  const byLoan = new Map<string, PhotoRecord[]>();
  if (loanIds.length === 0) return byLoan;
  const result = await db.query<PhotoRow>(
    `select id, loan_id, stage, content_type, size_bytes, extension, seq
     from photo where loan_id = any($1::uuid[])
     order by case when stage = 'checkout' then 0 else 1 end asc, seq asc`,
    [loanIds],
  );
  for (const row of result.rows) {
    const photo = toPhoto(row);
    const list = byLoan.get(row.loan_id);
    if (list === undefined) byLoan.set(row.loan_id, [photo]);
    else list.push(photo);
  }
  return byLoan;
}

export async function findLoan(db: Queryable, loanId: string): Promise<LoanRecord | null> {
  if (!isUuid(loanId)) return null;
  const result = await db.query<LoanRow>(
    `select ${LOAN_COLUMNS} ${LOAN_FROM} where l.id = $1`,
    [loanId],
  );
  const row = result.rows[0];
  if (row === undefined) return null;
  const photos = await loadPhotos(db, [row.id]);
  return toLoan(row, photos.get(row.id) ?? []);
}

export interface LoanPageQuery {
  readonly memberId: string | null;
  readonly status: LoanStatus | null;
  readonly now: Date;
  readonly limit: number;
  readonly cursorInstant: string | null;
  readonly cursorId: string | null;
}

export async function listLoans(db: Queryable, query: LoanPageQuery): Promise<LoanRecord[]> {
  const conditions: string[] = [];
  const parameters: unknown[] = [];
  if (query.memberId !== null) {
    parameters.push(query.memberId);
    conditions.push(`l.member_id = $${parameters.length}`);
  }
  if (query.status !== null) {
    if (query.status === 'out' || query.status === 'overdue') {
      parameters.push(query.now);
      const comparison = query.status === 'overdue' ? '<' : '>=';
      conditions.push(`(l.status = 'out' and l.due_at ${comparison} $${parameters.length})`);
    } else {
      parameters.push(query.status);
      conditions.push(`l.status = $${parameters.length}`);
    }
  }
  if (query.cursorInstant !== null && query.cursorId !== null) {
    parameters.push(query.cursorInstant, query.cursorId);
    conditions.push(
      `(l.checked_out_at, l.id) < ($${parameters.length - 1}::timestamptz, $${parameters.length}::uuid)`,
    );
  }
  parameters.push(query.limit);
  const where = conditions.length === 0 ? '' : `where ${conditions.join(' and ')}`;
  const result = await db.query<LoanRow>(
    `select ${LOAN_COLUMNS} ${LOAN_FROM} ${where}
     order by l.checked_out_at desc, l.id desc limit $${parameters.length}`,
    parameters,
  );
  const photos = await loadPhotos(db, result.rows.map((row) => row.id));
  return result.rows.map((row) => toLoan(row, photos.get(row.id) ?? []));
}

export async function findPhoto(db: Queryable, photoId: string): Promise<PhotoRecord | null> {
  if (!isUuid(photoId)) return null;
  const result = await db.query<PhotoRow>(
    `select id, loan_id, stage, content_type, size_bytes, extension, seq from photo where id = $1`,
    [photoId],
  );
  const row = result.rows[0];
  return row === undefined ? null : toPhoto(row);
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}
