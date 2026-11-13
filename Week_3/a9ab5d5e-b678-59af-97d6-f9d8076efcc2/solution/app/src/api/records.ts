import { appendLog, inHousehold, nextId, one, rows } from '../db';
import { knownIdOrNotFound } from '../db/ids';
import { makeDeriver } from '../db/repo';
import { buildYearDocument } from '../domain/documents';
import { ApiError, fail } from '../errors';
import { ApiResponse, Ctx } from '../http/context';
import { formatInstant } from '../domain/time';
import { makeCursor, notModified, readPageRequest } from '../http/protocol';
import { Json } from '../lib/json';
import { StorageUnavailable, getObject, recordKey } from '../services/storage';

const recordColumns = `id::text AS id, year, state, attempts, steps_done, waiting_on, failure, year_digest,
  bytes, sha256, requested_at, stored_at`;

function serialiseRecord(row: Record<string, unknown>): Json {
  return {
    id: row.id as string,
    year: row.year as number,
    state: row.state as string,
    attempts: row.attempts as number,
    stepsDone: row.steps_done as number,
    waitingOn: row.waiting_on as string | null,
    failure: row.failure as string | null,
    yearDigest: row.year_digest as string,
    bytes: (row.bytes as number | null) ?? null,
    sha256: (row.sha256 as string | null) ?? null,
    requestedAt: instantText(row.requested_at as Date),
    storedAt: row.stored_at ? instantText(row.stored_at as Date) : null,
  };
}

function instantText(value: Date): string {
  return formatInstant('UTC', value.getTime());
}

export async function listRecords(ctx: Ctx): Promise<ApiResponse> {
  const household = ctx.home;
  const page = readPageRequest(ctx, household.id);
  const found = await rows(
    `SELECT ${recordColumns} FROM year_records
     WHERE household_id = $1 AND ($2::bigint IS NULL OR id < $2)
     ORDER BY year_records.id DESC LIMIT $3`,
    [household.id, page.afterId, page.limit + 1],
  );
  const last = found[page.limit - 1];
  return {
    status: 200,
    json: {
      items: found.slice(0, page.limit).map(serialiseRecord),
      next: found.length > page.limit && last ? makeCursor(household.id, last.id as string) : null,
    },
  };
}

export async function getRecord(ctx: Ctx): Promise<ApiResponse> {
  const id = knownIdOrNotFound(ctx.params.id);
  const found = await one(`SELECT ${recordColumns} FROM year_records WHERE household_id = $1 AND id = $2`, [
    ctx.home.id,
    id,
  ]);
  if (!found) fail('not_found');
  return { status: 200, json: serialiseRecord(found) };
}

export async function requestRecord(ctx: Ctx): Promise<ApiResponse> {
  const household = ctx.home;
  const year = ctx.integer('year', 'Choose a year from 2000 to 2100.', { min: 2000, max: 2100 });
  return inHousehold(household.id, async (client) => {
    const inProgress = (
      await client.query(
        `SELECT id::text AS id FROM year_records
         WHERE household_id = $1 AND year = $2 AND state IN ('requested','rendering') LIMIT 1`,
        [household.id, year],
      )
    ).rows[0] as { id: string } | undefined;
    if (inProgress) throw new ApiError('record_in_progress', { recordId: inProgress.id });
    const deriver = await makeDeriver(household.id, client);
    const document = buildYearDocument(household.id, year, deriver);
    const id = await nextId(client);
    await client.query(
      `INSERT INTO year_records (id, household_id, year, state, year_digest, year_doc)
       VALUES ($1, $2, $3, 'requested', $4, $5)`,
      [id, household.id, year, document.digest, document.bytes.toString('utf8')],
    );
    await appendLog(client, household.id, ctx.user.role, 'record.requested', id);
    const created = (
      await client.query(`SELECT ${recordColumns} FROM year_records WHERE id = $1`, [id])
    ).rows[0] as Record<string, unknown>;
    return { status: 202, json: serialiseRecord(created) };
  });
}

export async function retryRecord(ctx: Ctx): Promise<ApiResponse> {
  const household = ctx.home;
  const id = knownIdOrNotFound(ctx.params.id);
  return inHousehold(household.id, async (client) => {
    const found = (
      await client.query('SELECT state FROM year_records WHERE household_id = $1 AND id = $2', [household.id, id])
    ).rows[0] as { state: string } | undefined;
    if (!found) fail('not_found');
    if (found.state !== 'failed') fail('invalid_transition');
    await client.query(
      `UPDATE year_records SET state = 'requested', attempts = 0, failure = null, waiting_on = null,
          next_attempt_at = now(), fencing_token = fencing_token + 1 WHERE id = $1`,
      [id],
    );
    await appendLog(client, household.id, ctx.user.role, 'record.retried', id);
    const updated = (
      await client.query(`SELECT ${recordColumns} FROM year_records WHERE id = $1`, [id])
    ).rows[0] as Record<string, unknown>;
    return { status: 202, json: serialiseRecord(updated) };
  });
}

export async function cancelRecord(ctx: Ctx): Promise<ApiResponse> {
  const household = ctx.home;
  const id = knownIdOrNotFound(ctx.params.id);
  return inHousehold(household.id, async (client) => {
    const found = (
      await client.query('SELECT state FROM year_records WHERE household_id = $1 AND id = $2', [household.id, id])
    ).rows[0] as { state: string } | undefined;
    if (!found) fail('not_found');
    if (found.state !== 'requested' && found.state !== 'rendering') fail('invalid_transition');
    await client.query(
      "UPDATE year_records SET state = 'cancelled', fencing_token = fencing_token + 1 WHERE id = $1",
      [id],
    );
    await appendLog(client, household.id, ctx.user.role, 'record.cancelled', id);
    const updated = (
      await client.query(`SELECT ${recordColumns} FROM year_records WHERE id = $1`, [id])
    ).rows[0] as Record<string, unknown>;
    return { status: 200, json: serialiseRecord(updated) };
  });
}

export async function downloadRecordPdf(ctx: Ctx): Promise<ApiResponse> {
  const household = ctx.home;
  const id = knownIdOrNotFound(ctx.params.id);
  const found = await one(
    'SELECT state, sha256, year FROM year_records WHERE household_id = $1 AND id = $2',
    [household.id, id],
  );
  if (!found) fail('not_found');
  if ((found.state as string) !== 'stored') fail('record_not_stored');
  const etag = `"${found.sha256 as string}"`;
  if (notModified(ctx, etag)) return { status: 304, headers: { ETag: etag } };
  let body: Buffer | null;
  try {
    body = await getObject(recordKey(household.id, id));
  } catch (error) {
    if (error instanceof StorageUnavailable) fail('storage_unavailable');
    throw error;
  }
  if (!body) fail('record_not_stored');
  return {
    status: 200,
    body,
    headers: {
      ETag: etag,
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="twohouse-year-record-${found.year as number}.pdf"`,
    },
  };
}
