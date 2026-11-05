import { contractMonthOf } from '../../shared/money';
import { instrumentLabel } from '../../shared/labels';
import { addMonthsClamped, isoSeconds, storeDateOf } from '../../shared/time';
import {
  AVAILABILITY_ORDER,
  OPEN_STATUSES,
  type AvailabilityItem,
  type Contract,
  type ContractStatus,
  type ContractSummary,
  type ContractTerms,
  type EquityEntry,
  type EquityKind,
  type HistoryEntry,
  type InstrumentType,
  type Size,
} from '../../shared/types';
import { now, storeToday } from '../clock';
import { pool, tx } from '../db';
import { randomId } from '../ids';
import { contractTerms, priceListById, priceListInForce, type Db } from './pricing';

export interface ContractRow {
  id: string;
  status: ContractStatus;
  student_id: string;
  serial: string;
  waiver: boolean;
  price_list_id: string;
  bound: boolean;
  delivery_date: string | null;
  hold_expires_at: Date | null;
  signed_at: Date | null;
  activated_at: Date | null;
  closed_at: Date | null;
  billing_anchor_date: string | null;
  predecessor_id: string | null;
  successor_id: string | null;
  subscription_state: 'active' | 'cancelled' | null;
  agreement_stored: boolean;
  bill_of_sale_stored: boolean;
  kb_account_id: string | null;
  kb_subscription_id: string | null;
  created_at: Date;
  student_name: string;
  student_grade: number;
  family_id: string;
  school_id: string;
  school_name: string;
  instrument_type: InstrumentType;
  size: Size;
  model: string;
}

const ROW_COLUMNS = `c.id, c.status, c.student_id, c.serial, c.waiver, c.price_list_id, c.bound, c.delivery_date,
  c.hold_expires_at, c.signed_at, c.activated_at, c.closed_at, c.billing_anchor_date, c.predecessor_id,
  c.successor_id, c.subscription_state, c.agreement_stored, c.bill_of_sale_stored, c.kb_account_id,
  c.kb_subscription_id, c.created_at, s.name as student_name, s.grade as student_grade, s.family_id,
  s.school_id, sch.name as school_name, i.instrument_type, i.size, i.model`;

const ROW_FROM = `from contracts c
  join students s on s.id = c.student_id
  join schools sch on sch.id = s.school_id
  join instruments i on i.serial = c.serial`;

export async function loadContractRow(db: Db, id: string): Promise<ContractRow | null> {
  const { rows } = await db.query<ContractRow>(`select ${ROW_COLUMNS} ${ROW_FROM} where c.id = $1`, [id]);
  return rows[0] ?? null;
}

export async function loadContractRowsByStudents(db: Db, studentIds: string[]): Promise<ContractRow[]> {
  const { rows } = await db.query<ContractRow>(
    `select ${ROW_COLUMNS} ${ROW_FROM} where c.student_id = any($1::text[]) order by c.created_at, c.seq`,
    [studentIds],
  );
  return rows;
}

export async function loadAllContractRows(db: Db): Promise<ContractRow[]> {
  const { rows } = await db.query<ContractRow>(`select ${ROW_COLUMNS} ${ROW_FROM} order by c.created_at, c.seq`);
  return rows;
}

export async function equityOf(db: Db, contractId: string): Promise<number> {
  const { rows } = await db.query<{ total: string }>(
    'select coalesce(sum(amount_cents), 0)::text as total from equity_entries where contract_id = $1',
    [contractId],
  );
  return Number(rows[0]?.total ?? '0');
}

export async function termsOf(db: Db, row: ContractRow, today: string): Promise<ContractTerms> {
  const inForce = await priceListInForce(db, today);
  if (inForce === null) throw new Error(`no price list is in force on ${today}`);
  if (!row.bound) return contractTerms(inForce, false, row.instrument_type, inForce.tax_rate_bp);
  const bound = await priceListById(db, row.price_list_id);
  if (bound === null) throw new Error(`contract ${row.id} is bound to a missing price list`);
  return contractTerms(bound, true, row.instrument_type, inForce.tax_rate_bp);
}

export async function historyOf(db: Db, contractId: string): Promise<HistoryEntry[]> {
  const { rows } = await db.query<{
    from_status: string | null;
    to_status: string;
    at: Date;
    actor: 'owner' | 'parent' | 'system';
    actor_name: string | null;
  }>('select from_status, to_status, at, actor, actor_name from contract_history where contract_id = $1 order by at, id', [
    contractId,
  ]);
  return rows.map((entry) => ({
    from: entry.from_status,
    to: entry.to_status,
    at: isoSeconds(entry.at),
    actor: entry.actor,
    actor_name: entry.actor_name,
  }));
}

export interface SigningLinkRow {
  token: string;
  contract_id: string;
  created_at: Date;
  expires_at: Date;
  status: 'live' | 'revoked' | 'used';
}

export async function newestSigningLink(db: Db, contractId: string): Promise<SigningLinkRow | null> {
  const { rows } = await db.query<SigningLinkRow>(
    'select token, contract_id, created_at, expires_at, status from signing_links where contract_id = $1 order by seq desc limit 1',
    [contractId],
  );
  return rows[0] ?? null;
}

export function signingLinkState(
  link: SigningLinkRow | null,
  at: Date,
): { status: 'none' | 'live' | 'revoked' | 'used' | 'expired'; expires_at: string | null } {
  if (link === null) return { status: 'none', expires_at: null };
  const expiresAt = isoSeconds(link.expires_at);
  if (link.status === 'used') return { status: 'used', expires_at: expiresAt };
  if (link.status === 'revoked') return { status: 'revoked', expires_at: expiresAt };
  if (at.getTime() >= link.expires_at.getTime()) return { status: 'expired', expires_at: expiresAt };
  return { status: 'live', expires_at: expiresAt };
}

/** Billing date k is the anchor plus k calendar months, with the day clamped to month end. */
export function billingDate(anchor: string, k: number): string {
  return addMonthsClamped(anchor, k);
}

export function nextBillingDate(anchor: string, today: string): string {
  for (let k = 1; ; k += 1) {
    const date = billingDate(anchor, k);
    if (date >= today) return date;
  }
}

export function upcomingBillingDates(anchor: string, today: string, count: number): string[] {
  const dates: string[] = [];
  for (let k = 1; dates.length < count; k += 1) {
    const date = billingDate(anchor, k);
    if (date >= today) dates.push(date);
  }
  return dates;
}

export async function buildContract(db: Db, row: ContractRow, today = storeToday()): Promise<Contract> {
  const [equity, terms, history, link] = await Promise.all([
    equityOf(db, row.id),
    termsOf(db, row, today),
    historyOf(db, row.id),
    newestSigningLink(db, row.id),
  ]);
  return {
    id: row.id,
    status: row.status,
    student: { id: row.student_id, name: row.student_name, grade: row.student_grade },
    school: { id: row.school_id, name: row.school_name },
    family_id: row.family_id,
    instrument: {
      serial: row.serial,
      instrument_type: row.instrument_type,
      size: row.size,
      model: row.model,
      label: instrumentLabel(row.instrument_type, row.size),
    },
    waiver: row.waiver,
    terms,
    equity_cents: equity,
    contract_month: contractMonthOf(equity, terms.base_rent_cents),
    delivery_date: row.delivery_date,
    hold_expires_at: row.hold_expires_at === null ? null : isoSeconds(row.hold_expires_at),
    signing_link: signingLinkState(link, now()),
    agreement_stored: row.agreement_stored,
    bill_of_sale_stored: row.bill_of_sale_stored,
    subscription_state: row.subscription_state,
    signed_at: row.signed_at === null ? null : isoSeconds(row.signed_at),
    activated_at: row.activated_at === null ? null : isoSeconds(row.activated_at),
    closed_at: row.closed_at === null ? null : isoSeconds(row.closed_at),
    billing_anchor_date: row.billing_anchor_date,
    next_billing_date:
      row.status === 'active' && row.billing_anchor_date !== null
        ? nextBillingDate(row.billing_anchor_date, today)
        : null,
    predecessor_id: row.predecessor_id,
    successor_id: row.successor_id,
    history,
  };
}

export async function contractSummary(db: Db, row: ContractRow): Promise<ContractSummary> {
  return {
    id: row.id,
    status: row.status,
    student_name: row.student_name,
    instrument_label: instrumentLabel(row.instrument_type, row.size),
    serial: row.serial,
    equity_cents: await equityOf(db, row.id),
    delivery_date: row.delivery_date,
  };
}

const INSTRUMENT_STATUS_AFTER: Partial<Record<ContractStatus, 'available' | 'on_contract' | 'sold' | 'retired'>> = {
  reserved: 'on_contract',
  agreement_sent: 'on_contract',
  signed: 'on_contract',
  active: 'on_contract',
  expired: 'available',
  exchanged: 'available',
  returned: 'available',
  paid_off: 'sold',
  written_off: 'retired',
};

export interface MoveOptions {
  at: Date;
  actor: 'owner' | 'parent' | 'system';
  actorName: string | null;
  closedAt?: Date | null;
  extra?: Record<string, unknown>;
}

/** Moves a contract along the published states, appending exactly one history entry. */
export async function moveContract(
  sql: Db,
  row: Pick<ContractRow, 'id' | 'status' | 'serial'>,
  to: ContractStatus,
  options: MoveOptions,
): Promise<void> {
  const assignments: string[] = ['status = $2'];
  const values: unknown[] = [row.id, to];
  if (options.closedAt !== undefined) {
    values.push(options.closedAt);
    assignments.push(`closed_at = $${values.length}`);
  }
  for (const [column, value] of Object.entries(options.extra ?? {})) {
    values.push(value);
    assignments.push(`${column} = $${values.length}`);
  }
  await sql.query(`update contracts set ${assignments.join(', ')} where id = $1`, values);
  await sql.query(
    'insert into contract_history (contract_id, from_status, to_status, at, actor, actor_name) values ($1,$2,$3,$4,$5,$6)',
    [row.id, row.status, to, options.at, options.actor, options.actorName],
  );
  const instrumentStatus = INSTRUMENT_STATUS_AFTER[to];
  if (instrumentStatus !== undefined) {
    await sql.query('update instruments set status = $2 where serial = $1', [row.serial, instrumentStatus]);
  }
}

export async function addEquityEntry(
  sql: Db,
  contractId: string,
  kind: EquityKind,
  amountCents: number,
  at: Date,
  links: { transferId?: string | null; paymentId?: string | null } = {},
): Promise<string> {
  const id = randomId('EQ');
  await sql.query(
    'insert into equity_entries (id, contract_id, kind, amount_cents, transfer_id, payment_id, created_at) values ($1,$2,$3,$4,$5,$6,$7)',
    [id, contractId, kind, amountCents, links.transferId ?? null, links.paymentId ?? null, at],
  );
  return id;
}

export async function equityEntries(db: Db, contractId: string): Promise<EquityEntry[]> {
  const { rows } = await db.query<{
    id: string;
    kind: EquityKind;
    amount_cents: string;
    transfer_id: string | null;
    payment_id: string | null;
    created_at: Date;
    reversed: boolean | null;
  }>(
    `select e.id, e.kind, e.amount_cents::text, e.transfer_id, e.payment_id, e.created_at,
            case when e.kind = 'payment' then coalesce(p.reversed, false) else null end as reversed
       from equity_entries e
       left join payments p on p.id = e.payment_id
      where e.contract_id = $1
      order by e.created_at, e.seq`,
    [contractId],
  );
  return rows.map((entry) => ({
    id: entry.id,
    kind: entry.kind,
    amount_cents: Number(entry.amount_cents),
    transfer_id: entry.transfer_id,
    payment_id: entry.payment_id,
    reversed: entry.reversed,
    created_at: isoSeconds(entry.created_at),
  }));
}

/**
 * Records, once and for all, every hold that has reached its deadline. Runs before each request so
 * every surface sees a lapsed hold as expired without a request having triggered it.
 */
export async function materializeExpiries(): Promise<void> {
  const at = now();
  const { rows } = await pool.query<{ id: string }>(
    `select id from contracts where status in ('reserved','agreement_sent') and hold_expires_at <= $1 limit 50`,
    [at],
  );
  if (rows.length === 0) return;
  await tx(async (sql) => {
    const locked = await sql.query<{ id: string; status: ContractStatus; serial: string; hold_expires_at: Date }>(
      `select id, status, serial, hold_expires_at from contracts
        where id = any($1::text[]) and status in ('reserved','agreement_sent') and hold_expires_at <= $2
        order by id for update`,
      [rows.map((row) => row.id), at],
    );
    for (const contract of locked.rows) {
      await moveContract(sql, contract, 'expired', {
        at: contract.hold_expires_at,
        actor: 'system',
        actorName: null,
        closedAt: contract.hold_expires_at,
      });
    }
  });
}

export async function availability(db: Db): Promise<AvailabilityItem[]> {
  const { rows } = await db.query<{ instrument_type: InstrumentType; size: Size; count: string }>(
    "select instrument_type, size, count(*)::text as count from instruments where status = 'available' group by instrument_type, size",
  );
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(`${row.instrument_type}|${row.size}`, Number(row.count));
  return AVAILABILITY_ORDER.map((entry) => ({
    instrument_type: entry.instrument_type,
    size: entry.size,
    available: counts.get(`${entry.instrument_type}|${entry.size}`) ?? 0,
  }));
}

export async function alternativesFor(db: Db, type: InstrumentType): Promise<AvailabilityItem[]> {
  const all = await availability(db);
  return all.filter((item) => item.instrument_type === type && item.available > 0);
}

/** Takes the available instrument of a type and size whose serial sorts first, locking it for this action. */
export async function claimInstrument(sql: Db, type: InstrumentType, size: Size): Promise<string | null> {
  const { rows } = await sql.query<{ serial: string }>(
    `select serial from instruments
      where instrument_type = $1 and size = $2 and status = 'available'
      order by serial limit 1 for update`,
    [type, size],
  );
  const serial = rows[0]?.serial;
  if (serial === undefined) return null;
  await sql.query("update instruments set status = 'on_contract' where serial = $1", [serial]);
  return serial;
}

export async function nextContractId(sql: Db): Promise<string> {
  const { rows } = await sql.query<{ value: string }>("select nextval('contract_id_seq')::text as value");
  return `C-${rows[0]?.value ?? ''}`;
}

export async function studentHasOpenContract(db: Db, studentId: string): Promise<boolean> {
  const { rows } = await db.query<{ count: string }>(
    'select count(*)::text as count from contracts where student_id = $1 and status = any($2::text[])',
    [studentId, OPEN_STATUSES],
  );
  return Number(rows[0]?.count ?? '0') > 0;
}

export function storeDateOfInstant(instant: Date): string {
  return storeDateOf(instant);
}
