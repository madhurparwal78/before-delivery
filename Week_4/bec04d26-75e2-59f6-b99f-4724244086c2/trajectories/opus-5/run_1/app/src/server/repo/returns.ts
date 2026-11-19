import {
  Amendment,
  Approval,
  ApprovalAction,
  Carry,
  ExtensionRecord,
  Frequency,
  PacketState,
  Reminder,
  ReturnCounts,
  ReturnRecord,
  ReturnStatus,
  STATUS_LABELS,
} from '../../shared/types';
import { query, Tx } from '../db';
import { lastDayOfMonth, pad } from '../../shared/dates';
import { dueLine } from '../domain/duedates';
import { periodLabel } from '../domain/periods';
import { isOverdue } from '../domain/rules';
import {
  PRACTICE_ZONE,
  clockLabel,
  offsetHoursFromPractice,
  toInstantString,
  zoneLabel,
} from '../domain/zones';

export interface ReturnRow {
  id: string;
  practice_id: string;
  client_id: string;
  client_name: string;
  registration_id: string;
  state_id: string;
  state_code: string;
  state_name: string;
  state_index: string;
  zone: string;
  frequency: Frequency;
  period: string;
  status: ReturnStatus;
  version: number;
  gross_sales: string | null;
  tax_due: string | null;
  unextended_nominal_date: string;
  nominal_due_date: string;
  due_date: string;
  carried_from: string | null;
  due_at_ms: string;
  edition_effective_date: string;
  edition_due_day: number;
  edition_carry: Carry;
  edition_rate: string;
  edition_extension_days: number;
  awaiting_approval: boolean;
  filed_at_ms: string | null;
  packet_revisions: number;
  packet_target_revision: number;
  changed_by: string;
}

const SELECT_RETURN = `
  SELECT r.id, r.practice_id, r.client_id, c.name AS client_name, r.registration_id,
         r.state_id, s.code AS state_code, s.name AS state_name, s.zone,
         (SELECT count(*) FROM states s2 WHERE s2.practice_id = r.practice_id AND s2.code < s.code) AS state_index,
         r.frequency, r.period, r.status, r.version,
         r.gross_sales::text AS gross_sales, r.tax_due::text AS tax_due,
         r.unextended_nominal_date::text AS unextended_nominal_date,
         r.nominal_due_date::text AS nominal_due_date,
         r.due_date::text AS due_date, r.carried_from::text AS carried_from,
         r.due_at_ms,
         r.edition_effective_date::text AS edition_effective_date,
         r.edition_due_day, r.edition_carry, r.edition_rate::text AS edition_rate,
         r.edition_extension_days,
         r.awaiting_approval, r.filed_at_ms, r.packet_revisions, r.packet_target_revision,
         r.changed_by
    FROM returns r
    JOIN clients c ON c.id = r.client_id
    JOIN states s ON s.id = r.state_id`;

export interface ReturnFilter {
  ids?: readonly string[];
  clientId?: string | null;
  month?: string;
  year?: string;
  stateCode?: string;
  registrationId?: string;
}

export async function loadReturnRows(
  practiceId: string,
  filter: ReturnFilter,
  tx?: Tx,
): Promise<ReturnRow[]> {
  const run = tx ? tx.query.bind(tx) : query;
  const conditions = ['r.practice_id = $1'];
  const params: unknown[] = [practiceId];
  if (filter.ids) {
    params.push(filter.ids);
    conditions.push(`r.id = ANY($${params.length})`);
  }
  if (filter.clientId) {
    params.push(filter.clientId);
    conditions.push(`r.client_id = $${params.length}`);
  }
  if (filter.registrationId) {
    params.push(filter.registrationId);
    conditions.push(`r.registration_id = $${params.length}`);
  }
  if (filter.month) {
    const year = Number(filter.month.slice(0, 4));
    const month = Number(filter.month.slice(5, 7));
    params.push(`${filter.month}-01`);
    const from = params.length;
    params.push(`${filter.month}-${pad(lastDayOfMonth(year, month), 2)}`);
    conditions.push(`r.due_date BETWEEN $${from}::date AND $${params.length}::date`);
  }
  if (filter.year) {
    params.push(`${filter.year}-01-01`);
    const from = params.length;
    params.push(`${filter.year}-12-31`);
    conditions.push(`r.due_date BETWEEN $${from}::date AND $${params.length}::date`);
  }
  if (filter.stateCode) {
    params.push(filter.stateCode);
    conditions.push(`s.code = $${params.length}`);
  }
  return run<ReturnRow>(
    `${SELECT_RETURN} WHERE ${conditions.join(' AND ')}
      ORDER BY r.due_at_ms, c.name, s.code, r.id`,
    params,
  );
}

export async function loadReturnRowById(
  returnId: string,
  tx?: Tx,
): Promise<ReturnRow | null> {
  const run = tx ? tx.query.bind(tx) : query;
  const rows = await run<ReturnRow>(`${SELECT_RETURN} WHERE r.id = $1`, [returnId]);
  return rows.length > 0 ? rows[0] : null;
}

interface ApprovalRow {
  return_id: string;
  action: ApprovalAction;
  by_name: string;
  at_ms: string;
  reason: string | null;
}

interface ExtensionRow {
  return_id: string;
  granted_at_ms: string;
  extension_days: number;
  due_date_before: string;
  due_at_before_ms: string;
}

interface AmendmentRow {
  return_id: string;
  at_ms: string;
  by_name: string;
  note: string | null;
  original_gross_sales: string;
  original_tax_due: string;
  amended_gross_sales: string;
  amended_tax_due: string;
}

export interface ReturnHistory {
  approvals: Map<string, Approval[]>;
  extensions: Map<string, ExtensionRecord>;
  amendments: Map<string, Amendment[]>;
}

export async function loadHistory(
  returnIds: readonly string[],
  tx?: Tx,
): Promise<ReturnHistory> {
  const history: ReturnHistory = {
    approvals: new Map(),
    extensions: new Map(),
    amendments: new Map(),
  };
  if (returnIds.length === 0) return history;
  const run = tx ? tx.query.bind(tx) : query;
  const ids = [...returnIds];
  const approvals = await run<ApprovalRow>(
    `SELECT return_id, action, by_name, at_ms, reason FROM approvals
      WHERE return_id = ANY($1) ORDER BY at_ms, seq`,
    [ids],
  );
  for (const row of approvals) {
    const list = history.approvals.get(row.return_id) ?? [];
    list.push({
      action: row.action,
      by: row.by_name,
      at: toInstantString(Number(row.at_ms)),
      reason: row.reason,
    });
    history.approvals.set(row.return_id, list);
  }
  const extensions = await run<ExtensionRow>(
    `SELECT return_id, granted_at_ms, extension_days, due_date_before::text AS due_date_before,
            due_at_before_ms FROM extensions WHERE return_id = ANY($1)`,
    [ids],
  );
  for (const row of extensions) {
    history.extensions.set(row.return_id, {
      granted_at: toInstantString(Number(row.granted_at_ms)),
      extension_days: row.extension_days,
      due_date_before: row.due_date_before,
      due_at_before: toInstantString(Number(row.due_at_before_ms)),
    });
  }
  const amendments = await run<AmendmentRow>(
    `SELECT return_id, at_ms, by_name, note,
            original_gross_sales::text AS original_gross_sales,
            original_tax_due::text AS original_tax_due,
            amended_gross_sales::text AS amended_gross_sales,
            amended_tax_due::text AS amended_tax_due
       FROM amendments WHERE return_id = ANY($1) ORDER BY at_ms, seq`,
    [ids],
  );
  for (const row of amendments) {
    const list = history.amendments.get(row.return_id) ?? [];
    list.push({
      at: toInstantString(Number(row.at_ms)),
      by: row.by_name,
      note: row.note,
      original: { gross_sales: row.original_gross_sales, tax_due: row.original_tax_due },
      amended: { gross_sales: row.amended_gross_sales, tax_due: row.amended_tax_due },
    });
    history.amendments.set(row.return_id, list);
  }
  return history;
}

/** The packet state follows directly from the status and the stored revisions. */
function packetState(row: ReturnRow): PacketState {
  switch (row.status) {
    case 'not_started':
    case 'prepared':
    case 'client_approved':
      return 'none';
    case 'packeted':
      return 'ready';
    case 'filed':
    case 'amended':
      return 'pending';
  }
}

export function presentReturn(
  row: ReturnRow,
  nowMs: number,
  history: ReturnHistory,
): ReturnRecord {
  const dueAtMs = Number(row.due_at_ms);
  return {
    id: row.id,
    client: { id: row.client_id, name: row.client_name },
    registration_id: row.registration_id,
    state: row.state_code,
    state_name: row.state_name,
    state_index: Number(row.state_index),
    zone: row.zone,
    zone_label: zoneLabel(row.zone),
    frequency: row.frequency,
    period: row.period,
    period_label: periodLabel(row.period, row.frequency),
    status: row.status,
    status_label: STATUS_LABELS[row.status],
    overdue: isOverdue(row.status, dueAtMs, nowMs),
    awaiting_approval: row.awaiting_approval,
    version: row.version,
    gross_sales: row.gross_sales,
    tax_due: row.tax_due,
    nominal_due_date: row.nominal_due_date,
    due_date: row.due_date,
    carried_from: row.carried_from,
    due_at: toInstantString(dueAtMs),
    due_line: dueLine(row.due_date, row.zone),
    local_deadline_label: `${clockLabel(row.zone, dueAtMs)} ${zoneLabel(row.zone)}`,
    practice_deadline_label: `${clockLabel(PRACTICE_ZONE, dueAtMs)} Central`,
    offset_hours: offsetHoursFromPractice(row.zone, dueAtMs),
    edition: {
      effective_date: row.edition_effective_date,
      due_day: row.edition_due_day,
      carry: row.edition_carry,
      rate: row.edition_rate,
      extension_days: row.edition_extension_days,
    },
    approvals: history.approvals.get(row.id) ?? [],
    extension: history.extensions.get(row.id) ?? null,
    amendments: history.amendments.get(row.id) ?? [],
    filed_at: row.filed_at_ms === null ? null : toInstantString(Number(row.filed_at_ms)),
    packet: packetState(row),
    packet_revisions: row.packet_revisions,
    changed_by: row.changed_by,
  };
}

export async function presentReturns(
  rows: readonly ReturnRow[],
  nowMs: number,
  tx?: Tx,
): Promise<ReturnRecord[]> {
  const history = await loadHistory(
    rows.map((row) => row.id),
    tx,
  );
  return rows.map((row) => presentReturn(row, nowMs, history));
}

export function countReturns(records: readonly ReturnRecord[]): ReturnCounts {
  return {
    total: records.length,
    overdue: records.filter((record) => record.overdue).length,
    awaiting_approval: records.filter((record) => record.awaiting_approval).length,
  };
}

export async function loadReminders(returnId: string, tx?: Tx): Promise<Reminder[]> {
  const run = tx ? tx.query.bind(tx) : query;
  const rows = await run<{ lead_days: number; scheduled_for_ms: string; sent_at_ms: string | null }>(
    `SELECT lead_days, scheduled_for_ms, sent_at_ms FROM reminders
      WHERE return_id = $1 ORDER BY scheduled_for_ms`,
    [returnId],
  );
  return rows.map((row) => ({
    lead_days: row.lead_days === 7 ? 7 : 1,
    scheduled_for: toInstantString(Number(row.scheduled_for_ms)),
    sent_at: row.sent_at_ms === null ? null : toInstantString(Number(row.sent_at_ms)),
    status: row.sent_at_ms === null ? 'pending' : 'sent',
  }));
}
