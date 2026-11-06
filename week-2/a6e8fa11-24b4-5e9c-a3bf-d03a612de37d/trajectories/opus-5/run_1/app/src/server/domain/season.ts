import { PoolClient } from 'pg';
import { formatStationStamp, parseLocalIso, zonedToUtcCandidates } from '../../shared/zone';
import { apiErrors } from '../http/errors';
import { queueMail } from '../services/mail';
import { WorkbookRow } from './workbooks';

export interface ResolvedCutoff {
  local: string;
  utc: Date;
}

/** A cutoff is a wall-clock time in the station's zone, and must be in the future. */
export function resolveCutoff(text: unknown, timeZone: string, field = 'closesAt'): ResolvedCutoff | null {
  if (text === null) return null;
  if (typeof text !== 'string') throw apiErrors.validation({ [field]: 'Enter a local date and time.' });
  const local = parseLocalIso(text);
  if (!local) throw apiErrors.validation({ [field]: 'Enter a local date and time.' });
  const candidates = zonedToUtcCandidates(local, timeZone);
  if (candidates.length === 0) {
    throw apiErrors.validation({ [field]: `That time is skipped by a clock change in ${timeZone}.` });
  }
  const utc = new Date(candidates[0]);
  if (utc.getTime() <= Date.now()) {
    throw apiErrors.validation({ [field]: `Pick a time after now in ${timeZone}.` });
  }
  return { local: text, utc };
}

/** Recomputes stored cutoff instants after a station zone change. */
export async function recomputeCutoffs(client: PoolClient, stationId: string, timeZone: string): Promise<void> {
  const rows = (
    await client.query('select id, closes_at_local from workbooks where station_id = $1 and closes_at_local is not null', [
      stationId,
    ])
  ).rows as { id: string; closes_at_local: string }[];
  for (const row of rows) {
    const local = parseLocalIso(row.closes_at_local);
    const candidates = local ? zonedToUtcCandidates(local, timeZone) : [];
    const utc = candidates.length > 0 ? new Date(candidates[0]) : null;
    await client.query('update workbooks set closes_at_utc = $2 where id = $1', [row.id, utc]);
  }
}

/** One place for locking a workbook: by hand or by the cutoff passing. */
export async function lockWorkbook(
  client: PoolClient,
  row: { id: string; name: string; station_id: string },
  closedAtMs: number,
  timeZone: string,
): Promise<void> {
  await client.query("update workbooks set state = 'locked', updated_at = now() where id = $1", [row.id]);
  const leads = (
    await client.query("select email from members where station_id = $1 and role = 'lead'", [row.station_id])
  ).rows as { email: string }[];
  const stamp = formatStationStamp(closedAtMs, timeZone);
  for (const lead of leads) {
    await queueMail(client, {
      to: lead.email,
      subject: `Season closed: ${row.name}`,
      body:
        `${row.name} closed at ${stamp}. Edits are no longer accepted. ` +
        'A trial lead can reopen it before it is archived.',
    });
  }
}

export function requireEditableSeason(row: WorkbookRow): void {
  if (row.state === 'archived') throw apiErrors.seasonArchived();
  if (row.state === 'locked') throw apiErrors.seasonLocked();
}
