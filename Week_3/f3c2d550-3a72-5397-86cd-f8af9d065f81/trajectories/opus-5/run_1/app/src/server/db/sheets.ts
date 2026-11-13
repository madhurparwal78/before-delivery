import type { Paper, SheetJson, SheetState, SheetStopJson, Unit } from '../../shared/types.js';
import { nowIso, realNowIso } from '../domain/clock.js';
import { ApiError } from '../domain/errors.js';
import { assertSheetRetryable } from '../domain/states.js';
import { sizeLine } from '../domain/sizes.js';
import { newId, pool, withTransaction } from './pool.js';

export interface SheetRow {
  id: string;
  reel_id: string;
  reel_name: string;
  state: SheetState;
  paper: Paper;
  unit: Unit;
  requested_at: string;
  ready_at: string | null;
  pdf_bytes: number | null;
  pdf_sha256: string | null;
  failure_count: number;
  snapshot: SheetStopJson[];
}

const UTC_ISO = `'YYYY-MM-DD"T"HH24:MI:SS"Z"'`;

const SHEET_COLUMNS = `
  id, reel_id, reel_name, state, paper, unit,
  to_char(requested_at at time zone 'UTC', ${UTC_ISO}) as requested_at,
  to_char(ready_at at time zone 'UTC', ${UTC_ISO}) as ready_at,
  pdf_bytes, pdf_sha256, failure_count, snapshot
`;

export function toSheetJson(row: SheetRow): SheetJson {
  return {
    id: row.id,
    reel_id: row.reel_id,
    state: row.state,
    paper: row.paper,
    unit: row.unit,
    requested_at: row.requested_at,
    ready_at: row.ready_at,
    pdf_url: row.state === 'ready' ? `/api/sheets/${row.id}/pdf` : null,
    pdf_bytes: row.pdf_bytes === null ? null : Number(row.pdf_bytes),
    pdf_sha256: row.pdf_sha256,
    stops: row.snapshot,
  };
}

/** Snapshots the reel's playable stops in order, as they are at request time. */
export async function requestSheet(
  reelId: string,
  paper: Paper,
  unit: Unit,
): Promise<SheetRow | null> {
  return withTransaction(async (client) => {
    const reel = await client.query<{ name: string }>(
      'select name from reel where id = $1 for share',
      [reelId],
    );
    const reelName = reel.rows[0]?.name;
    if (reelName === undefined) return null;

    const stops = await client.query<{
      reference_id: string;
      title: string;
      maker: string | null;
      year: number | null;
      width_tenths: number;
      height_tenths: number;
      depth_tenths: number;
      swatch: string;
    }>(
      `select r.id as reference_id, r.title, r.maker, r.year,
              r.width_tenths, r.height_tenths, r.depth_tenths, r.swatch
       from reel_stop s join reference r on r.id = s.reference_id
       where s.reel_id = $1 and r.state = 'stored'
       order by s.position`,
      [reelId],
    );
    if (stops.rows.length === 0) throw new ApiError('reel_empty');

    const snapshot: SheetStopJson[] = stops.rows.map((row, index) => ({
      position: index + 1,
      reference_id: row.reference_id,
      title: row.title,
      maker: row.maker,
      year: row.year,
      size_text: sizeLine(
        { width: row.width_tenths, height: row.height_tenths, depth: row.depth_tenths },
        unit,
      ),
      swatch: row.swatch,
    }));

    const id = newId('sheet');
    const requestedAt = nowIso();
    const inserted = await client.query<SheetRow>(
      `insert into sheet (id, reel_id, reel_name, state, paper, unit, requested_at,
                          failure_count, next_attempt_at, snapshot)
       values ($1, $2, $3, 'queued', $4, $5, $6::timestamptz, 0, $7::timestamptz, $8::jsonb)
       returning ${SHEET_COLUMNS}`,
      [id, reelId, reelName, paper, unit, requestedAt, realNowIso(), JSON.stringify(snapshot)],
    );
    return inserted.rows[0]!;
  });
}

export async function listSheets(reelId: string): Promise<SheetRow[]> {
  const result = await pool.query<SheetRow>(
    `select ${SHEET_COLUMNS} from sheet where reel_id = $1 order by requested_at desc, id desc`,
    [reelId],
  );
  return result.rows;
}

export async function loadSheet(id: string): Promise<SheetRow | null> {
  const result = await pool.query<SheetRow>(
    `select ${SHEET_COLUMNS} from sheet where id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

/** Of simultaneous retries of one failed sheet, exactly one wins. */
export async function retrySheet(id: string): Promise<SheetRow | null> {
  const existing = await loadSheet(id);
  if (!existing) return null;
  assertSheetRetryable(existing.state);
  const claimed = await pool.query<SheetRow>(
    `update sheet set state = 'queued', failure_count = 0, ready_at = null,
            pdf_bytes = null, pdf_sha256 = null, next_attempt_at = $2::timestamptz
     where id = $1 and state = 'failed'
     returning ${SHEET_COLUMNS}`,
    [id, realNowIso()],
  );
  const row = claimed.rows[0];
  // Of simultaneous retries, the conditional update lets exactly one through.
  if (!row) throw new ApiError('sheet_not_failed');
  return row;
}

/** Takes one queued sheet for this app copy, so each sheet renders once at a time. */
export async function claimQueuedSheet(): Promise<SheetRow | null> {
  const result = await pool.query<SheetRow>(
    `update sheet set state = 'rendering', claimed_at = $1::timestamptz
     where id = (
       select id from sheet
       where state = 'queued' and next_attempt_at <= $1::timestamptz
       order by requested_at limit 1 for update skip locked
     )
     returning ${SHEET_COLUMNS}`,
    [realNowIso()],
  );
  return result.rows[0] ?? null;
}

export async function markSheetReady(
  id: string,
  bytes: number,
  sha256: string,
): Promise<void> {
  await pool.query(
    `update sheet set state = 'ready', ready_at = $2::timestamptz, pdf_bytes = $3,
            pdf_sha256 = $4, failure_count = 0
     where id = $1`,
    [id, nowIso(), bytes, sha256],
  );
}

const RETRY_DELAY_MS = 4_000;

/** Unreachability never fails a sheet: it goes back to the queue to be tried again. */
export async function requeueSheet(id: string, countFailure: boolean): Promise<void> {
  await pool.query(
    `update sheet set state = 'queued',
            failure_count = failure_count + $2,
            next_attempt_at = $3::timestamptz
     where id = $1`,
    [id, countFailure ? 1 : 0, realNowIso(RETRY_DELAY_MS)],
  );
}

export async function markSheetFailed(id: string): Promise<void> {
  await pool.query(
    `update sheet set state = 'failed', failure_count = failure_count + 1 where id = $1`,
    [id],
  );
}

/** A sheet left rendering by a copy that stopped goes back to the queue. */
export async function releaseStaleRenders(): Promise<void> {
  await pool.query(
    `update sheet set state = 'queued', next_attempt_at = $1::timestamptz
     where state = 'rendering' and claimed_at < $1::timestamptz - interval '60 seconds'`,
    [realNowIso()],
  );
}
