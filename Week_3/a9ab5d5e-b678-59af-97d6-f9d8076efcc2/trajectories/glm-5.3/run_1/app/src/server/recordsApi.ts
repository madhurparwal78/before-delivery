/** Year record endpoints: create, list, get, retry, cancel, download PDF. */
import { Ctx, sendJson, sendBytes } from './http';
import { problem } from './problems';
import { AppDeps, RecordRow } from './apiTypes';
import * as auth from './auth';
import { ValidationErrors, fail, hasField, isObject } from './validate';
import { appendLog, withTransaction } from '../db/db';
import { deriveYearDoc } from './planApi';
import { StorageUnavailable } from '../storage/s3';
import { canonicalJson } from '../lib/canonical';

export async function listRecords(ctx: Ctx, deps: AppDeps): Promise<void> {
  const res = await deps.pool.query(
    `SELECT * FROM records WHERE household_id=$1 ORDER BY requested_at DESC`,
    [ctx.householdId!],
  );
  sendJson(ctx, 200, { items: (res.rows as RecordRow[]).map(recordOut), next: null });
}

export function recordOut(r: RecordRow): Record<string, unknown> {
  return {
    id: r.id,
    year: r.year,
    state: r.state,
    attempts: r.attempts,
    stepsDone: r.steps_done,
    waitingOn: r.waiting_on,
    failure: r.failure,
    yearDigest: r.year_digest,
    bytes: r.pdf_bytes !== null ? Number(r.pdf_bytes) : null,
    sha256: r.pdf_sha256,
    requestedAt: isoOut(r.requested_at),
    storedAt: r.stored_at ? isoOut(r.stored_at) : null,
  };
}

function isoOut(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, '+00:00').replace('Z', '+00:00');
}

export async function createRecord(ctx: Ctx, deps: AppDeps): Promise<void> {
  const body = requireJsonBody(ctx);
  for (const k of Object.keys(body)) {
    if (k !== 'year') fail({ [k]: 'This field is not accepted.' });
  }
  if (!hasField(body, 'year')) fail({ year: 'Choose a year from 2000 to 2100.' });
  const year = typeof body.year === 'number' && Number.isInteger(body.year)
    && body.year >= 2000 && body.year <= 2100
    ? body.year : fail({ year: 'Choose a year from 2000 to 2100.' });

  // pin the derived year at this moment
  const doc = await deriveYearDoc(deps, ctx.householdId!, year);
  const yearDigest = digestOfDoc(doc);

  const existing = await deps.pool.query(
    `SELECT id FROM records WHERE household_id=$1 AND year=$2 AND state IN ('requested','rendering')`,
    [ctx.householdId, year],
  );
  if (existing.rows.length > 0) {
    throw problem(409, 'record_in_progress', { extra: { recordId: existing.rows[0].id } });
  }
  const id = auth.randomId();
  await withTransaction(deps.pool, async (client) => {
    await client.query(
      `INSERT INTO records (id, household_id, year, state, attempts, steps_done, year_digest, requested_at)
       VALUES ($1,$2,$3,'requested',0,0,$4,now())`,
      [id, ctx.householdId, year, yearDigest],
    );
    await appendLog(client, ctx.householdId!, ctx.role!, 'record.requested', id);
  });
  const r = await loadRecord(deps, ctx.householdId!, id);
  sendJson(ctx, 202, recordOut(r));
}

import { digestOf } from '../lib/canonical';

function digestOfDoc(doc: Record<string, unknown>): string {
  return digestOf(Buffer.from(canonicalJson(doc), 'utf8'));
}

export async function getRecord(ctx: Ctx, deps: AppDeps, id: string): Promise<void> {
  const r = await loadRecord(deps, ctx.householdId!, id);
  sendJson(ctx, 200, recordOut(r));
}

export async function recordAction(ctx: Ctx, deps: AppDeps, id: string, action: string): Promise<void> {
  const r = await loadRecord(deps, ctx.householdId!, id);
  if (action === 'retry') {
    if (r.state !== 'failed') throw problem(409, 'invalid_transition');
    await withTransaction(deps.pool, async (client) => {
      await client.query(
        `UPDATE records SET state='requested', attempts=0, waiting_on=NULL, failure=NULL WHERE id=$1`,
        [r.id],
      );
      await appendLog(client, ctx.householdId!, ctx.role!, 'record.retried', r.id);
    });
  } else if (action === 'cancel') {
    if (r.state !== 'requested' && r.state !== 'rendering') throw problem(409, 'invalid_transition');
    await withTransaction(deps.pool, async (client) => {
      await client.query(`UPDATE records SET state='cancelled' WHERE id=$1`, [r.id]);
      await appendLog(client, ctx.householdId!, ctx.role!, 'record.cancelled', r.id);
    });
  } else {
    throw problem(404, 'not_found');
  }
  const r2 = await loadRecord(deps, ctx.householdId!, id);
  sendJson(ctx, 200, recordOut(r2));
}

export async function downloadPdf(ctx: Ctx, deps: AppDeps, id: string): Promise<void> {
  const r = await loadRecord(deps, ctx.householdId!, id);
  if (r.state !== 'stored') throw problem(409, 'record_not_stored');
  const objectKey = `households/${ctx.householdId}/records/${r.id}.pdf`;
  let bytes: Buffer;
  try {
    bytes = await deps.s3.getObject(objectKey);
  } catch {
    const err = new Error('storage') as Error & { code?: string };
    err.code = 'storage_unavailable';
    throw err;
  }
  sendBytes(ctx, 200, 'application/pdf', bytes, { etag: `"${r.pdf_sha256}"` });
}

async function loadRecord(deps: AppDeps, hid: string, id: string): Promise<RecordRow> {
  if (!/^\d+$/.test(id)) throw problem(404, 'not_found');
  const res = await deps.pool.query(`SELECT * FROM records WHERE id=$1 AND household_id=$2`, [id, hid]);
  if (res.rows.length === 0) throw problem(404, 'not_found');
  return res.rows[0] as RecordRow;
}

function requireJsonBody(ctx: Ctx): Record<string, unknown> {
  const body = ctx.body ?? Buffer.alloc(0);
  if (body.length === 0) return {};
  const ct = ctx.header('content-type') ?? '';
  if (!ct.startsWith('application/json')) throw problem(415, 'unsupported_media_type');
  try {
    const parsed = JSON.parse(body.toString('utf8'));
    if (!isObject(parsed)) fail({ '': 'This field is not accepted.' });
    return parsed;
  } catch (e) {
    if (e instanceof ValidationErrors) throw e;
    throw problem(400, 'malformed_json');
  }
}

export { StorageUnavailable };
