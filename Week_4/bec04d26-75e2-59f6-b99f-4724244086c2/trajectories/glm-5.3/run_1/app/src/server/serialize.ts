import { DateTime } from 'luxon';
import { PRACTICE_ZONE, zoneLabel, periodLabel } from '../shared/periods.js';
import { isOverdue } from '../shared/deadlines.js';
import { statusLabel } from './domain/labels.js';
import { dateLine } from './domain/labels.js';
import type { ReturnJson, ApprovalJson, AmendmentJson } from '../shared/types.js';
import { pool } from './db.js';
import type { ReturnRow } from './returns.js';
import type { Frequency } from '../shared/periods.js';

export async function serializeReturn(row: ReturnRow, now: Date): Promise<ReturnJson> {
  const [approvals, amendments] = await Promise.all([
    pool.query(
      'select action, by_name as by, reason, at from approvals where return_id = $1 order by at, id',
      [row.id],
    ),
    pool.query(
      'select at, by_name as by, note, original_gross, original_tax, amended_gross, amended_tax from amendments where return_id = $1 order by sequence',
      [row.id],
    ),
  ]);

  const approvalList: ApprovalJson[] = approvals.rows.map((a) => ({
    action: a.action as 'approved' | 'sent_back',
    by: a.by as string,
    at: (a.at as Date).toISOString(),
    reason: a.reason === null ? null : String(a.reason),
  }));

  const amendmentList: AmendmentJson[] = amendments.rows.map((m) => ({
    at: (m.at as Date).toISOString(),
    by: m.by as string,
    note: m.note === null ? null : String(m.note),
    original: { gross_sales: String(m.original_gross), tax_due: String(m.original_tax) },
    amended: { gross_sales: String(m.amended_gross), tax_due: String(m.amended_tax) },
  }));

  const centralDt = DateTime.fromJSDate(row.due_at, { zone: PRACTICE_ZONE });
  const stateOffsetMinutes = DateTime.fromJSDate(row.due_at, { zone: row.zone }).offset;
  const offsetHours = Math.round((stateOffsetMinutes - centralDt.offset) / 60);

  return {
    id: row.id,
    client: { id: row.client_id, name: row.client_name },
    registration_id: row.registration_id,
    state: row.state_code,
    state_name: row.state_name,
    zone: row.zone,
    zone_label: zoneLabel(row.zone),
    frequency: row.frequency as Frequency,
    period: row.period,
    period_label: periodLabel(row.period),
    status: row.status,
    status_label: statusLabel(row.status),
    overdue: isOverdue(row.status, row.due_at, now),
    awaiting_approval: row.awaiting_approval && row.status === 'prepared',
    version: row.version,
    gross_sales: row.gross_sales,
    tax_due: row.tax_due,
    nominal_due_date: row.nominal_due_date,
    due_date: row.due_date,
    carried_from: carriedFromOf(row),
    due_at: row.due_at.toISOString(),
    due_line: `Due ${dateLine(row.due_date)}, 11:59 pm ${zoneLabel(row.zone)}`,
    local_deadline_label: `11:59 pm ${zoneLabel(row.zone)}`,
    practice_deadline_label: `${centralTime(centralDt)} Central`,
    offset_hours: offsetHours,
    edition: {
      effective_date: row.edition_effective_date,
      due_day: row.due_day,
      carry: row.carry,
      rate: row.rate,
      extension_days: row.extension_days,
    },
    approvals: approvalList,
    extension:
      row.extension_granted_at === null
        ? null
        : {
            granted_at: row.extension_granted_at.toISOString(),
            extension_days: row.extension_days_used ?? 0,
            due_date_before: row.extension_due_date_before ?? '',
            due_at_before: (row.extension_due_at_before ?? row.due_at).toISOString(),
          },
    amendments: amendmentList,
    filed_at: row.filed_at === null ? null : row.filed_at.toISOString(),
    packet: row.packet_state,
    packet_revisions: row.packet_revisions,
    changed_by: row.changed_by,
  };
}

function centralTime(dt: DateTime): string {
  const hour = dt.hour === 0 ? 12 : dt.hour > 12 ? dt.hour - 12 : dt.hour;
  const ampm = dt.hour < 12 ? 'am' : 'pm';
  return `${hour}:${String(dt.minute).padStart(2, '0')} ${ampm}`;
}

/** The date before carrying, only when carrying moved it. */
function carriedFromOf(row: ReturnRow): string | null {
  return row.due_date === row.nominal_due_date ? null : row.nominal_due_date;
}
