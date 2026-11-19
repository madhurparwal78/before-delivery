import type { Fee, FeeLine, FeeStatus, Waiver } from '../../shared/types';
import { formatInstant } from '../../shared/time';
import type { Db } from './calendar';

export interface FeeRow {
  id: number;
  loan_id: number;
  loan_ref: string;
  member_id: number;
  status: FeeStatus;
  total_cents: number;
  killbill_invoice_id: string | null;
  waiver_status: Waiver['status'] | null;
  waiver_reason: string | null;
  waiver_requested_at: Date | null;
  waiver_decided_at: Date | null;
}

const FEE_SELECT = `
  select f.id, f.loan_id, l.ref as loan_ref, f.member_id, f.status, f.total_cents,
    f.killbill_invoice_id, f.waiver_status, f.waiver_reason, f.waiver_requested_at,
    f.waiver_decided_at
  from fees f join loans l on l.id = f.loan_id`;

export async function readFeeRow(db: Db, id: number): Promise<FeeRow | null> {
  const rows = await db.query<FeeRow>(`${FEE_SELECT} where f.id = $1`, [id]);
  return rows.rows[0] ?? null;
}

export async function lockFeeRow(db: Db, id: number): Promise<FeeRow | null> {
  const locked = await db.query<{ id: number }>('select id from fees where id = $1 for update', [
    id,
  ]);
  if (locked.rows.length === 0) return null;
  return readFeeRow(db, id);
}

export async function readFeeLines(db: Db, feeId: number): Promise<FeeLine[]> {
  const rows = await db.query<FeeLine>(
    `select item_id, kind, open_days, amount_cents, description from fee_lines
     where fee_id = $1 order by listed_at`,
    [feeId],
  );
  return rows.rows;
}

export async function feeView(db: Db, row: FeeRow, zone: string): Promise<Fee> {
  return {
    id: row.id,
    loan_id: row.loan_id,
    loan_ref: row.loan_ref,
    member_id: row.member_id,
    status: row.status,
    total_cents: row.total_cents,
    lines: await readFeeLines(db, row.id),
    killbill_invoice_id: row.killbill_invoice_id,
    waiver:
      row.waiver_status === null || row.waiver_requested_at === null
        ? null
        : {
            status: row.waiver_status,
            reason: row.waiver_reason ?? '',
            requested_at: formatInstant(row.waiver_requested_at, zone),
            decided_at: row.waiver_decided_at
              ? formatInstant(row.waiver_decided_at, zone)
              : null,
          },
  };
}

export async function listFeeRows(
  db: Db,
  filter: { memberId?: number; status?: FeeStatus },
): Promise<FeeRow[]> {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter.memberId !== undefined) {
    params.push(filter.memberId);
    clauses.push(`f.member_id = $${params.length}`);
  }
  if (filter.status !== undefined) {
    params.push(filter.status);
    clauses.push(`f.status = $${params.length}`);
  }
  const where = clauses.length > 0 ? ` where ${clauses.join(' and ')}` : '';
  const rows = await db.query<FeeRow>(`${FEE_SELECT}${where} order by f.id`, params);
  return rows.rows;
}

export async function insertFee(
  db: Db,
  loanId: number,
  memberId: number,
  lines: readonly FeeLine[],
  totalCents: number,
  invoiceId: string,
): Promise<number> {
  const inserted = await db.query<{ id: number }>(
    `insert into fees (loan_id, member_id, status, total_cents, killbill_invoice_id)
     values ($1, $2, 'raised', $3, $4) returning id`,
    [loanId, memberId, totalCents, invoiceId],
  );
  const feeId = inserted.rows[0]?.id as number;
  let listedAt = 0;
  for (const line of lines) {
    await db.query(
      `insert into fee_lines (fee_id, listed_at, item_id, kind, open_days, amount_cents, description)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        feeId,
        listedAt,
        line.item_id,
        line.kind,
        line.open_days,
        line.amount_cents,
        line.description,
      ],
    );
    listedAt += 1;
  }
  return feeId;
}

export async function setFeeStatus(db: Db, id: number, status: FeeStatus): Promise<void> {
  await db.query('update fees set status = $2 where id = $1', [id, status]);
}

export async function recordWaiverRequest(db: Db, id: number, reason: string): Promise<void> {
  await db.query(
    `update fees set waiver_status = 'requested', waiver_reason = $2,
     waiver_requested_at = now(), waiver_decided_at = null where id = $1`,
    [id, reason],
  );
}

export async function recordWaiverDecision(
  db: Db,
  id: number,
  decision: 'approved' | 'declined',
): Promise<void> {
  await db.query(
    'update fees set waiver_status = $2, waiver_decided_at = now() where id = $1',
    [id, decision],
  );
}
