import {
  businessMonth,
  isBusinessMonth,
  nextBusinessMonth,
  startOfBusinessMonth,
  toInstant,
} from '../../shared/businesstime';
import { FIELD_COPY } from '../../shared/copy';
import { centsToPlainDecimal } from '../../shared/decimal';
import { config } from '../config';
import { query } from '../db/pool';
import { writeCsv } from '../domain/csv';
import { maskIdentityNumber, maskPersonName } from '../domain/masking';
import { failure, rateLimited } from '../http/errors';
import { define, Registered, Role, WorkspaceRecord } from '../http/runtime';
import { CaseRow } from '../store/cases';
import { lapseAnswers } from '../store/caseengine';
import { monthsFromStart } from './months';

const FILE_READERS: readonly Role[] = ['compliance_officer', 'compliance_analyst', 'support_agent'];
const DOWNLOAD_ALLOWANCE = 5;

export const REGULATOR_HEADER: readonly string[] = [
  'Reference',
  'Created at',
  'Asset',
  'Amount',
  'Fiat value',
  'Currency',
  'Threshold',
  'Rule in force since',
  'Rate',
  'Counterparty name',
  'Counterparty LEI',
  'Counterparty jurisdiction',
  'Counterparty rule',
  'Path',
  'Status',
  'Data sent via',
  'Data sent at',
  'Answer',
  'Answer late',
  'Answered at',
  'Originator name',
  'Originator identity number',
  'Originator date of birth',
  'Beneficiary name',
  'Closed at',
  'Outcome',
];

interface RegulatorCaseRow extends CaseRow {
  counterparty_lei: string | null;
  counterparty_jurisdiction: string | null;
}

function text(value: string | null): string {
  return value ?? '';
}

function instant(value: Date | null): string {
  return value === null ? '' : toInstant(value);
}

/** One row per case of the month, in the published column order. */
function regulatorRow(row: RegulatorCaseRow, role: Role): string[] {
  const erased = row.erasure_status === 'erased';
  const mask = role === 'support_agent';
  const originatorName = erased || row.originator_name === null
    ? ''
    : mask
      ? maskPersonName(row.originator_name)
      : row.originator_name;
  const identityNumber = erased || row.originator_identity_number === null
    ? ''
    : mask
      ? maskIdentityNumber(row.originator_identity_number)
      : row.originator_identity_number;
  const beneficiaryName = erased || row.beneficiary_name === null
    ? ''
    : mask
      ? maskPersonName(row.beneficiary_name)
      : row.beneficiary_name;
  return [
    row.reference,
    instant(row.created_at),
    row.asset,
    row.amount,
    centsToPlainDecimal(BigInt(row.fiat_value_cents)),
    row.currency,
    centsToPlainDecimal(BigInt(row.du_threshold_cents)),
    text(row.du_rule_in_force_since),
    centsToPlainDecimal(BigInt(row.du_rate_cents)),
    text(row.du_counterparty_name),
    text(row.counterparty_lei),
    text(row.counterparty_jurisdiction),
    text(row.du_counterparty_rule),
    row.path,
    row.status,
    text(row.data_sent_channel),
    instant(row.data_sent_at),
    text(row.answer_decision),
    row.answer_at === null ? '' : row.answer_late ? 'true' : 'false',
    instant(row.answer_at),
    originatorName,
    identityNumber,
    erased || mask ? '' : text(row.originator_date_of_birth),
    beneficiaryName,
    instant(row.closed_at),
    text(row.outcome),
  ];
}

async function casesOfMonth(
  workspace: WorkspaceRecord,
  month: string,
): Promise<RegulatorCaseRow[]> {
  const startsAt = startOfBusinessMonth(month, workspace.timeZone);
  const endsAt = startOfBusinessMonth(nextBusinessMonth(month), workspace.timeZone);
  return query<RegulatorCaseRow>(
    `SELECT c.*, p.lei AS counterparty_lei, p.jurisdiction_code AS counterparty_jurisdiction
     FROM cases c LEFT JOIN counterparties p ON p.id = c.counterparty_id
     WHERE c.workspace_slug = $1 AND c.created_at >= $2 AND c.created_at < $3
     ORDER BY c.created_at, c.reference`,
    [workspace.slug, startsAt, endsAt],
  );
}

export const fileRoutes: readonly Registered[] = [
  define({
    kind: 'staff',
    method: 'GET',
    path: '/api/w/:slug/files',
    roles: FILE_READERS,
    handler: async (context) => {
      const months = await monthsFromStart(context.workspace, context.now);
      const counts = await query<{ month: string; count: string }>(
        `SELECT business_month AS month, count(*) AS count FROM (
           SELECT to_char(timezone($2, created_at), 'YYYY-MM') AS business_month FROM cases
           WHERE workspace_slug = $1
         ) AS grouped GROUP BY business_month`,
        [context.workspace.slug, context.workspace.timeZone],
      );
      const byMonth = new Map(counts.map((row) => [row.month, Number.parseInt(row.count, 10)]));
      return {
        status: 200,
        json: {
          months: months.map((month) => ({ month, cases: byMonth.get(month) ?? 0 })),
        },
      };
    },
  }),
  define({
    kind: 'staff',
    method: 'GET',
    path: '/api/w/:slug/files/regulator',
    roles: FILE_READERS,
    rateLimit: async (context, memberId) => {
      const windowSeconds = config().timers.regulatorFileRateWindowSeconds;
      const since = new Date(context.now.getTime() - windowSeconds * 1000);
      const rows = await query<{ at: Date }>(
        'SELECT at FROM file_downloads WHERE member_id = $1 AND at > $2 ORDER BY at',
        [memberId, since],
      );
      if (rows.length < DOWNLOAD_ALLOWANCE) return;
      const oldest = rows[0].at.getTime() + windowSeconds * 1000;
      throw rateLimited(Math.max(1, Math.ceil((oldest - context.now.getTime()) / 1000)));
    },
    handler: async (context) => {
      const month = context.url.searchParams.get('month') ?? '';
      const current = businessMonth(context.now, context.workspace.timeZone);
      if (!isBusinessMonth(month) || month > current) {
        throw failure('invalid', { month: FIELD_COPY.month });
      }
      await lapseAnswers(context.workspace.slug, context.now);
      const rows = await casesOfMonth(context.workspace, month);
      const csv = writeCsv([
        REGULATOR_HEADER,
        ...rows.map((row) => regulatorRow(row, context.member.role)),
      ]);
      await query('INSERT INTO file_downloads (member_id, at) VALUES ($1,$2)', [
        context.member.id,
        context.now,
      ]);
      return {
        status: 200,
        bytes: Buffer.from(csv, 'utf8'),
        contentType: 'text/csv; charset=utf-8',
        headers: {
          'Content-Disposition': `attachment; filename="${context.workspace.slug}-regulator-${month}.csv"`,
        },
      };
    },
  }),
];
