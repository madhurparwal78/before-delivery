import type {
  FeeRules,
  Grade,
  Loan,
  LoanItem,
  LoanStatus,
  Part,
  PartShape,
  PartState,
  Photo,
  PhotoEvent,
} from '../../shared/types';
import type { OpeningCalendar } from '../domain/calendar';
import { lateFeeSoFarCents, type FeeItem } from '../domain/fees';
import { formatInstant, type LibraryDate } from '../../shared/time';
import type { Db } from './calendar';

export interface LoanRow {
  id: number;
  ref: string;
  member_id: number;
  member_name: string;
  status: LoanStatus;
  checked_out_at: Date | null;
  due_date: LibraryDate | null;
  fee_rules: FeeRules | null;
  returned_at: Date | null;
  recorded_open_days_late: number | null;
  recorded_late_fee_cents: number | null;
}

const LOAN_SELECT = `
  select l.id, l.ref, l.member_id, u.name as member_name, l.status, l.checked_out_at,
    l.due_date, l.fee_rules, l.returned_at, l.recorded_open_days_late, l.recorded_late_fee_cents
  from loans l join users u on u.id = l.member_id`;

export async function readLoanRow(db: Db, id: number): Promise<LoanRow | null> {
  const rows = await db.query<LoanRow>(`${LOAN_SELECT} where l.id = $1`, [id]);
  return rows.rows[0] ?? null;
}

/** Takes the loan's row lock, so one transition wins across every app process. */
export async function lockLoanRow(db: Db, id: number): Promise<LoanRow | null> {
  const locked = await db.query<{ id: number }>('select id from loans where id = $1 for update', [
    id,
  ]);
  if (locked.rows.length === 0) return null;
  return readLoanRow(db, id);
}

export async function readLoanItems(db: Db, loanId: number): Promise<LoanItem[]> {
  const rows = await db.query<LoanItem>(
    `select i.id, i.tag, i.name, li.grade from loan_items li join items i on i.id = li.item_id
     where li.loan_id = $1 order by li.listed_at`,
    [loanId],
  );
  return rows.rows;
}

interface LoanPartRow {
  id: number;
  item_id: number;
  name: string;
  shape: PartShape;
  grid_col: number;
  grid_row: number;
  width: number;
  height: number;
  state: PartState;
}

export async function readLoanParts(db: Db, loanId: number): Promise<Part[]> {
  const rows = await db.query<LoanPartRow>(
    `select p.id, p.item_id, p.name, p.shape, p.grid_col, p.grid_row, p.width, p.height, p.state
     from parts p join loan_items li on li.item_id = p.item_id
     where li.loan_id = $1 order by p.grid_row, p.grid_col`,
    [loanId],
  );
  return rows.rows.map((row) => ({
    id: row.id,
    item_id: row.item_id,
    name: row.name,
    shape: row.shape,
    col: row.grid_col,
    row: row.grid_row,
    width: row.width,
    height: row.height,
    state: row.state,
  }));
}

export interface PhotoRow {
  id: number;
  loan_id: number;
  event: PhotoEvent;
  content_type: string;
  byte_size: number;
  sha256: string;
  captured_at: Date;
  received_at: Date;
  storage_key: string;
}

export async function readLoanPhotos(db: Db, loanId: number): Promise<PhotoRow[]> {
  const rows = await db.query<PhotoRow>(
    `select id, loan_id, event, content_type, byte_size, sha256, captured_at, received_at,
     storage_key from photos where loan_id = $1 order by case event when 'checkout' then 0 else 1 end`,
    [loanId],
  );
  return rows.rows;
}

export function photoView(row: PhotoRow, zone: string): Photo {
  return {
    id: row.id,
    event: row.event,
    content_type: row.content_type,
    byte_size: row.byte_size,
    sha256: row.sha256,
    captured_at: formatInstant(row.captured_at, zone),
    received_at: formatInstant(row.received_at, zone),
    url: `/api/photos/${row.id}`,
  };
}

export async function readPhotoRow(db: Db, id: number): Promise<PhotoRow | null> {
  const rows = await db.query<PhotoRow>(
    `select id, loan_id, event, content_type, byte_size, sha256, captured_at, received_at,
     storage_key from photos where id = $1`,
    [id],
  );
  return rows.rows[0] ?? null;
}

export interface OverdueFigures {
  openDaysLate: number | null;
  lateFeeSoFarCents: number | null;
}

/**
 * The one place that decides a loan's open days late and late fee so far. An out
 * loan is worked out afresh from the server's clock; a waiting or returned loan
 * reports the figures recorded at its check-in.
 */
export function overdueFiguresFor(
  row: LoanRow,
  items: readonly FeeItem[],
  calendar: OpeningCalendar,
  now: Date,
): OverdueFigures {
  if (row.status === 'reserved' || row.due_date === null || row.fee_rules === null) {
    return { openDaysLate: null, lateFeeSoFarCents: null };
  }
  if (row.status === 'out') {
    const openDaysLate = calendar.openDaysLate(row.due_date, now);
    return {
      openDaysLate,
      lateFeeSoFarCents: lateFeeSoFarCents(items, openDaysLate, row.fee_rules),
    };
  }
  return {
    openDaysLate: row.recorded_open_days_late ?? 0,
    lateFeeSoFarCents: row.recorded_late_fee_cents ?? 0,
  };
}

export async function loanView(
  db: Db,
  row: LoanRow,
  calendar: OpeningCalendar,
  now: Date,
): Promise<Loan> {
  const items = await readLoanItems(db, row.id);
  const parts = await readLoanParts(db, row.id);
  const photos = await readLoanPhotos(db, row.id);
  const fee = await db.query<{ id: number }>('select id from fees where loan_id = $1', [row.id]);
  const overdue = overdueFiguresFor(row, items, calendar, now);
  return {
    id: row.id,
    ref: row.ref,
    member_id: row.member_id,
    member_name: row.member_name,
    status: row.status,
    checked_out_at: row.checked_out_at ? formatInstant(row.checked_out_at, calendar.timeZone) : null,
    due_date: row.due_date,
    due_by: row.due_date === null ? null : calendar.closingTimeFor(row.due_date),
    fee_rules: row.fee_rules,
    open_days_late: overdue.openDaysLate,
    late_fee_so_far_cents: overdue.lateFeeSoFarCents,
    returned_at: row.returned_at ? formatInstant(row.returned_at, calendar.timeZone) : null,
    items,
    parts,
    missing_parts: parts.filter((part) => part.state === 'missing').map((part) => part.name),
    photos: photos.map((photo) => photoView(photo, calendar.timeZone)),
    fee_id: fee.rows[0]?.id ?? null,
  };
}

export async function listLoanRows(
  db: Db,
  filter: { memberId?: number; status?: LoanStatus },
): Promise<LoanRow[]> {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter.memberId !== undefined) {
    params.push(filter.memberId);
    clauses.push(`l.member_id = $${params.length}`);
  }
  if (filter.status !== undefined) {
    params.push(filter.status);
    clauses.push(`l.status = $${params.length}`);
  }
  const where = clauses.length > 0 ? ` where ${clauses.join(' and ')}` : '';
  const rows = await db.query<LoanRow>(`${LOAN_SELECT}${where} order by l.id`, params);
  return rows.rows;
}

export async function insertReservedLoan(
  db: Db,
  memberId: number,
  itemIds: readonly number[],
): Promise<LoanRow> {
  const inserted = await db.query<{ id: number }>(
    `insert into loans (ref, member_id, status)
     values ('L-' || lpad(nextval('loan_ref_seq')::text, 4, '0'), $1, 'reserved') returning id`,
    [memberId],
  );
  const loanId = inserted.rows[0]?.id as number;
  let listedAt = 0;
  for (const itemId of itemIds) {
    await db.query(
      'insert into loan_items (loan_id, item_id, listed_at) values ($1, $2, $3)',
      [loanId, itemId, listedAt],
    );
    listedAt += 1;
  }
  const row = await readLoanRow(db, loanId);
  if (!row) throw new Error('The reserved loan vanished');
  return row;
}

export async function deleteLoan(db: Db, id: number): Promise<void> {
  await db.query('delete from loans where id = $1', [id]);
}

export async function recordCheckout(
  db: Db,
  id: number,
  checkedOutAt: Date,
  dueDate: LibraryDate,
  feeRules: FeeRules,
): Promise<void> {
  await db.query(
    `update loans set status = 'out', checked_out_at = $2, due_date = $3, fee_rules = $4
     where id = $1`,
    [id, checkedOutAt.toISOString(), dueDate, feeRules],
  );
}

export async function setLoanStatus(db: Db, id: number, status: LoanStatus): Promise<void> {
  await db.query('update loans set status = $2 where id = $1', [id, status]);
}

export async function recordCheckinOutcome(
  db: Db,
  id: number,
  status: LoanStatus,
  returnedAt: Date,
  openDaysLate: number,
  lateFeeCents: number,
): Promise<void> {
  await db.query(
    `update loans set status = $2, returned_at = $3, recorded_open_days_late = $4,
     recorded_late_fee_cents = $5 where id = $1`,
    [id, status, returnedAt.toISOString(), openDaysLate, lateFeeCents],
  );
}

export async function setGrades(
  db: Db,
  loanId: number,
  grades: ReadonlyMap<number, Grade>,
): Promise<void> {
  for (const [itemId, grade] of grades) {
    await db.query('update loan_items set grade = $3 where loan_id = $1 and item_id = $2', [
      loanId,
      itemId,
      grade,
    ]);
  }
}

export async function insertPhotoRecord(
  db: Db,
  loanId: number,
  event: PhotoEvent,
  details: {
    contentType: string;
    byteSize: number;
    sha256: string;
    capturedAt: Date;
    storageKeyFor: (photoId: number) => string;
  },
): Promise<PhotoRow> {
  const inserted = await db.query<{ id: number }>(
    `insert into photos (loan_id, event, content_type, byte_size, sha256, captured_at, storage_key)
     values ($1, $2, $3, $4, $5, $6, '') returning id`,
    [
      loanId,
      event,
      details.contentType,
      details.byteSize,
      details.sha256,
      details.capturedAt.toISOString(),
    ],
  );
  const photoId = inserted.rows[0]?.id as number;
  const rows = await db.query<PhotoRow>(
    `update photos set storage_key = $2 where id = $1
     returning id, loan_id, event, content_type, byte_size, sha256, captured_at, received_at,
     storage_key`,
    [photoId, details.storageKeyFor(photoId)],
  );
  return rows.rows[0] as PhotoRow;
}

export async function deletePhotoRecord(db: Db, photoId: number): Promise<void> {
  await db.query('delete from photos where id = $1', [photoId]);
}
