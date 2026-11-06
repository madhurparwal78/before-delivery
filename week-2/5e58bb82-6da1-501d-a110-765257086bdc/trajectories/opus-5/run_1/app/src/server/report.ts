import { createHash } from 'node:crypto';
import { canonicalNumber, roundHalfUp } from '../shared/numbers.js';
import { config } from './config.js';
import { pool, withTransaction, type Db } from './db.js';
import { queueEmail } from './outbox.js';
import { listHolidays, listLines, reviewersOfOrg, type MissionRow } from './repo.js';
import { loadMissionState } from './state.js';
import { putObject, reportKey, StorageUnreachable } from './storage.js';

/** JSON string escaping for the report's canonical bytes. */
function quote(value: string): string {
  let out = '"';
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if (character === '"') out += '\\"';
    else if (character === '\\') out += '\\\\';
    else if (code === 0x08) out += '\\b';
    else if (code === 0x0c) out += '\\f';
    else if (code === 0x0a) out += '\\n';
    else if (code === 0x0d) out += '\\r';
    else if (code === 0x09) out += '\\t';
    else if (code < 0x20) out += `\\u${code.toString(16).padStart(4, '0')}`;
    else out += character;
  }
  return `${out}"`;
}

type CanonicalValue = string | number | boolean | null | CanonicalValue[] | [string, CanonicalValue][];

function isEntries(value: CanonicalValue): value is [string, CanonicalValue][] {
  return (
    Array.isArray(value) &&
    value.every((item) => Array.isArray(item) && item.length === 2 && typeof item[0] === 'string')
  );
}

/** Writes JSON with no insignificant whitespace and every number in shortest form. */
function canonicalJson(value: CanonicalValue): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return quote(value);
  if (typeof value === 'number') return canonicalNumber(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (isEntries(value)) {
    return `{${value.map(([key, item]) => `${quote(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
}

/** The wall-clock fields and UTC offset of an instant in an IANA time zone. */
export function localParts(instant: Date, timeZone: string): {
  date: string;
  time: string;
  offset: string;
} {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = new Map(formatter.formatToParts(instant).map((part) => [part.type, part.value]));
  const year = parts.get('year')!;
  const month = parts.get('month')!;
  const day = parts.get('day')!;
  const hour = parts.get('hour') === '24' ? '00' : parts.get('hour')!;
  const minute = parts.get('minute')!;
  const second = parts.get('second')!;
  const asUtc = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );
  const offsetMinutes = Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60000);
  const sign = offsetMinutes < 0 ? '-' : '+';
  const absolute = Math.abs(offsetMinutes);
  const offset = `${sign}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}`;
  return { date: `${year}-${month}-${day}`, time: `${hour}:${minute}:${second}`, offset };
}

function wholeSecondsIso(instant: Date): string {
  return `${new Date(Math.floor(instant.getTime() / 1000) * 1000).toISOString().slice(0, 19)}Z`;
}

export interface ReportBytes {
  bytes: Buffer;
  sha256: string;
  generatedAt: Date;
  coveragePct: number;
  openHolidays: number;
  comparedText: string | null;
  agreementPctText: string | null;
}

/** Builds the report's canonical bytes. A retried write produces identical bytes. */
export async function buildReport(db: Db, mission: MissionRow): Promise<ReportBytes | null> {
  const generatedAt = mission.report_generated_at
    ? new Date(mission.report_generated_at)
    : new Date();
  const state = await loadMissionState(db, mission.id, generatedAt);
  if (!state) return null;
  const lines = await listLines(db, mission.id);
  const holidays = await listHolidays(db, mission.id);

  const deliveredLines: CanonicalValue = lines
    .filter(
      (line) =>
        line.status === 'Delivered' || (line.status === 'Superseded' && line.file_state === 'Stored'),
    )
    .map((line) => [
      ['label', line.label],
      ['kind', line.kind],
      ['file_name', line.file_name ?? ''],
      ['size_bytes', line.file_size ?? 0],
      ['sha256', line.file_sha256 ?? ''],
      ['key', `lines/${mission.id}/${line.id}/${line.file_name ?? ''}`],
    ] as [string, CanonicalValue][]);

  const totals = new Map<string, { lines: number; length: number; covered: number }>();
  for (const line of lines) {
    if (line.status !== 'Surveyed' && line.status !== 'Delivered') continue;
    if (line.vessel_id === null) continue;
    const name = state.vesselNames.get(line.vessel_id);
    if (name === undefined) continue;
    const entry = totals.get(name) ?? { lines: 0, length: 0, covered: 0 };
    entry.lines += 1;
    entry.length += line.length_m;
    entry.covered += state.coverage.coveredByLine.get(line.id) ?? 0;
    totals.set(name, entry);
  }
  const vesselTotals: CanonicalValue = [...totals.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], 'en'))
    .map(([name, entry]) => [
      ['vessel', name],
      ['lines', entry.lines],
      ['length_m', roundHalfUp(entry.length, 1)],
      ['covered_m', roundHalfUp(entry.covered, 1)],
    ] as [string, CanonicalValue][]);

  const reportHolidays: CanonicalValue = holidays
    .filter((holiday) => holiday.status === 'Open' || holiday.status === 'Queued')
    .sort((a, b) => a.label_num - b.label_num)
    .map((holiday) => [
      ['label', holiday.label],
      ['area_m2', holiday.cells.length * 25],
      ['cell_count', holiday.cells.length],
    ] as [string, CanonicalValue][]);

  const agreement = state.agreement;
  const local = localParts(generatedAt, state.org.time_zone);

  const document: [string, CanonicalValue][] = [
    ['mission_id', mission.id],
    ['mission_name', mission.name],
    ['client_name', state.org.name],
    ['completed_at', mission.completed_at ? new Date(mission.completed_at).toISOString() : null],
    ['generated_at', wholeSecondsIso(generatedAt)],
    ['generated_at_local', `${local.date}T${local.time}${local.offset}`],
    ['coverage_pct', state.counters.coverage_pct],
    ['open_holidays', state.counters.open_holidays],
    ['crossline_count', mission.crossline_count],
    [
      'crossline_agreement',
      [
        ['compared', agreement.compared],
        ['within', agreement.within],
        ['pct', agreement.pct],
        ['meets_order', agreement.meets_order],
      ],
    ],
    ['delivered_lines', deliveredLines],
    ['vessel_totals', vesselTotals],
    ['holidays', reportHolidays],
  ];

  const bytes = Buffer.from(canonicalJson(document), 'utf8');
  return {
    bytes,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    generatedAt,
    coveragePct: state.counters.coverage_pct,
    openHolidays: state.counters.open_holidays,
    comparedText: agreement.compared === 0 ? null : canonicalNumber(agreement.compared),
    agreementPctText: agreement.pct === null ? null : canonicalNumber(agreement.pct),
  };
}

/** The report-ready body is exactly six lines, each ending with CR LF. */
function reportReadyBody(
  mission: MissionRow,
  report: ReportBytes,
  timeZone: string,
): string {
  const local = localParts(report.generatedAt, timeZone);
  const utc = wholeSecondsIso(report.generatedAt);
  const agreement =
    report.comparedText === null
      ? 'Crossline agreement —'
      : `Crossline agreement ${report.agreementPctText}% of ${report.comparedText}`;
  const lines = [
    `Coverage report ready for ${mission.name}.`,
    `Completed ${local.date} ${local.time.slice(0, 5)} (${local.offset})`,
    `Completed UTC ${utc.slice(0, 10)} ${utc.slice(11, 16)}`,
    `Report SHA-256 ${report.sha256}`,
    `Coverage ${canonicalNumber(report.coveragePct)}% · Open holidays ${canonicalNumber(report.openHolidays)} · ${agreement}`,
    `Open the survey: ${config.publicUrl}/surveys/${mission.id}`,
  ];
  return `${lines.join('\r\n')}\r\n`;
}

/**
 * Writes any Pending report once, then queues each reviewer's single
 * report-ready email only after the report is Ready.
 */
export async function writePendingReports(): Promise<void> {
  const pending = await pool.query<MissionRow>(
    `SELECT m.*, to_char(m.survey_date, 'YYYY-MM-DD') AS survey_date FROM missions m
     WHERE m.report_state = 'Pending'`,
  );
  for (const mission of pending.rows) {
    const report = await buildReport(pool, mission);
    if (!report) continue;
    try {
      await putObject(reportKey(mission.id), report.bytes, 'application/json', report.sha256);
    } catch (error) {
      if (error instanceof StorageUnreachable) continue;
      throw error;
    }
    await withTransaction(async (client) => {
      const claimed = await client.query<MissionRow>(
        `UPDATE missions SET report_state = 'Ready', report_sha256 = $2, report_size_bytes = $3,
           report_stored_at = now()
         WHERE id = $1 AND report_state = 'Pending' RETURNING *`,
        [mission.id, report.sha256, report.bytes.byteLength],
      );
      if (claimed.rowCount === 0) return;
      const org = await client.query<{ time_zone: string }>(
        'SELECT time_zone FROM client_orgs WHERE id = $1',
        [mission.client_org_id],
      );
      const timeZone = org.rows[0]?.time_zone ?? 'UTC';
      const body = reportReadyBody(mission, report, timeZone);
      for (const reviewer of await reviewersOfOrg(client, mission.client_org_id)) {
        await queueEmail(client, {
          dedupeKey: `report:${mission.id}:${reviewer.email}`,
          to: reviewer.email,
          subject: `Coverage report ready — ${mission.name}`,
          body,
          purpose: 'report',
        });
      }
    });
  }
}
