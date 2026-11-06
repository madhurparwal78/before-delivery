import { randomUUID } from 'node:crypto';
import { COPY, fill } from '../../shared/copy';
import { foldedKey } from '../../shared/fold';
import { addHistory, assertJobWritable, moveJobState, boardFrames, instant, jobJson, JOB_SELECT, loadJob, newStamp } from '../records';
import { one, pool, rows, transaction, type Row } from '../db';
import { conflict, isUuid, notFound, ok, route, type Context } from '../http';
import { getObject, objectKeys, putObject, storeDown, StoreFailure } from '../s3';
import { checkDate, checkOneOf, checkRate, filled, throwIfAny, type Fields } from '../validate';

const TARGETS = [6, 15, 30, 60] as const;
const ASPECTS = ['16:9', '1:1', '9:16'] as const;
const PAGE_CAP = 25;

function checkAdId(fields: Fields, value: unknown): string {
  const text = typeof value === 'string' ? value : '';
  if (/^[A-Z]{4}[A-Z0-9]{7}[HD]$/.test(text)) return text;
  fields.adId = /^[A-Z]{4}[A-Z0-9]{7}.$/u.test(text) ? COPY.adIdEnd : COPY.adIdShape;
  return text;
}

function checkTitle(fields: Fields, value: unknown): string {
  if (!filled(value)) fields.title = COPY.typeTitle;
  return value as string;
}

function encodeCursor(key: string, id: string): string {
  return Buffer.from(JSON.stringify([key, id])).toString('base64url');
}

function decodeCursor(cursor: string): [string, string] | null {
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    return Array.isArray(value) && typeof value[0] === 'string' && isUuid(value[1]) ? (value as [string, string]) : null;
  } catch {
    return null;
  }
}

route('GET', '/api/jobs', {}, async ({ desk, query }) => {
  const clauses = ['j.desk_id = $1', `c.state <> 'erased'`];
  const values: unknown[] = [desk.id];
  const add = (sql: string, value: unknown) => {
    values.push(value);
    clauses.push(sql.replace('?', `$${values.length}`));
  };
  const clientId = query.get('clientId');
  if (clientId) add('j.client_id::text = ?', clientId);
  const state = query.get('state');
  if (state) add('j.state = ?', state);
  else clauses.push(`j.state <> 'archived'`);
  const frameRate = query.get('frameRate');
  if (frameRate) add('j.frame_rate = ?', frameRate);

  const total = await one(pool, `SELECT count(*)::int AS total FROM jobs j JOIN clients c ON c.id = j.client_id WHERE ${clauses.join(' AND ')}`, values);

  const column = query.get('sort') === 'title' ? 'j.title_key' : 'j.due_date';
  const cursor = decodeCursor(query.get('cursor') ?? '');
  if (cursor) {
    values.push(cursor[0], cursor[1]);
    clauses.push(`(${column} COLLATE "C", j.id) > ($${values.length - 1} COLLATE "C", $${values.length}::uuid)`);
  }
  const asked = Number(query.get('limit'));
  const limit = Number.isInteger(asked) && asked > 0 ? Math.min(asked, PAGE_CAP) : PAGE_CAP;
  const found = await rows(
    pool,
    `${JOB_SELECT} WHERE ${clauses.join(' AND ')} ORDER BY ${column} COLLATE "C", j.id LIMIT ${limit + 1}`,
    values,
  );
  const page = found.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor = found.length > limit && last ? encodeCursor(query.get('sort') === 'title' ? last.title_key : last.due_date, last.id) : null;
  return ok({ jobs: page.map(jobJson), total: total?.total ?? 0, nextCursor });
});

route('POST', '/api/jobs', {}, async ({ body, desk, now }) => {
  const fields: Fields = {};
  if (typeof body.clientId !== 'string' || !body.clientId) fields.clientId = 'Pick a client.';
  const title = checkTitle(fields, body.title);
  const adId = checkAdId(fields, body.adId);
  const dueDate = checkDate(fields, 'dueDate', body.dueDate);
  const targetSeconds = checkOneOf(fields, 'targetSeconds', body.targetSeconds, TARGETS, 'Pick a target length.');
  const frameRate = checkRate(fields, 'frameRate', body.frameRate);
  const aspect = checkOneOf(fields, 'aspect', body.aspect, ASPECTS, 'Pick an aspect.');
  if (!fields.clientId) {
    if (!isUuid(body.clientId)) throw notFound();
    const owner = await one(pool, `SELECT state, closes_at FROM clients WHERE id = $1 AND desk_id = $2 AND state <> 'erased'`, [body.clientId, desk.id]);
    if (!owner) throw notFound();
    throwIfAny(fields);
    if (owner.state !== 'active') throw conflict(COPY.clientClosing);
  }
  throwIfAny(fields);
  const job = await transaction(async (tx) => {
    const id = randomUUID();
    await tx.query(
      `INSERT INTO jobs (id, desk_id, client_id, title, title_key, ad_id, due_date, target_seconds, frame_rate, aspect, state, stamp, stamp_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'draft', $11, $12, $12)`,
      [id, desk.id, body.clientId, title, foldedKey(title), adId, dueDate, targetSeconds, frameRate, aspect, newStamp(), new Date(now)],
    );
    await addHistory(tx, id, desk.name, 'jobAdded', COPY.jobAdded, now);
    return one(tx, `${JOB_SELECT} WHERE j.id = $1`, [id]);
  });
  return ok(jobJson(job as Row), 201);
});

route('GET', '/api/jobs/:id', { load: loadJob }, async ({ found }) => ok(jobJson(found)));

route('PATCH', '/api/jobs/:id', { load: loadJob }, async ({ found, body, desk, now }) => {
  const fields: Fields = {};
  const title = 'title' in body ? checkTitle(fields, body.title) : (found.title as string);
  const adId = 'adId' in body ? checkAdId(fields, body.adId) : found.ad_id;
  const dueDate = 'dueDate' in body ? checkDate(fields, 'dueDate', body.dueDate) : found.due_date;
  const targetSeconds = 'targetSeconds' in body ? checkOneOf(fields, 'targetSeconds', body.targetSeconds, TARGETS, 'Pick a target length.') : found.target_seconds;
  throwIfAny(fields);
  assertJobWritable(found);
  const job = await transaction(async (tx) => {
    await tx.query('UPDATE jobs SET title = $1, title_key = $2, ad_id = $3, due_date = $4, target_seconds = $5 WHERE id = $6', [
      title, foldedKey(title), adId, dueDate, targetSeconds, found.id,
    ]);
    await addHistory(tx, found.id, desk.name, 'jobSaved', COPY.jobSaved, now);
    return one(tx, `${JOB_SELECT} WHERE j.id = $1`, [found.id]);
  });
  return ok(jobJson(job as Row));
});

/** Uploaded drawings live under the job's own prefix, so a copied job copies their objects. */
async function copyDrawings(clientId: string, fromJob: string, toJob: string, frames: Row[]): Promise<void> {
  const from = objectKeys(clientId, fromJob);
  const to = objectKeys(clientId, toJob);
  const uploaded = new Set(frames.filter((frame) => frame.sha256 && frame.drawing_seed === null).map((frame) => frame.sha256 as string));
  try {
    for (const sha256 of uploaded) await putObject(to.frame(sha256), await getObject(from.frame(sha256)), 'application/octet-stream');
  } catch (error) {
    if (error instanceof StoreFailure) throw storeDown();
    throw error;
  }
}

route('POST', '/api/jobs/:id/duplicate', { load: loadJob, body: 'none' }, async ({ found, desk, now }) => {
  assertJobWritable(found);
  const frames = await boardFrames(pool, found.id);
  const id = randomUUID();
  await copyDrawings(found.client_id, found.id, id, frames);
  const title = `${found.title} copy`;
  const job = await transaction(async (tx) => {
    await tx.query(
      `INSERT INTO jobs (id, desk_id, client_id, title, title_key, ad_id, due_date, target_seconds, frame_rate, aspect, state, stamp, stamp_at, next_frame, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'draft', $11, $12, $13, $12)`,
      [id, desk.id, found.client_id, title, foldedKey(title), found.ad_id, found.due_date, found.target_seconds, found.frame_rate, found.aspect, newStamp(), new Date(now), found.next_frame],
    );
    for (const frame of frames) {
      await tx.query(
        `INSERT INTO frames (job_id, number, position, duration_frames, action_note, audio_note, shot, visual, file_name, width, height, sha256, drawing_seed)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [id, frame.number, frame.position, frame.duration_frames, frame.action_note, frame.audio_note, frame.shot, frame.visual, frame.file_name, frame.width, frame.height, frame.sha256, frame.drawing_seed],
      );
    }
    await addHistory(tx, id, desk.name, 'jobDuplicated', COPY.jobDuplicated, now);
    return one(tx, `${JOB_SELECT} WHERE j.id = $1`, [id]);
  });
  return ok(jobJson(job as Row), 201);
});

route('POST', '/api/jobs/:id/archive', { load: loadJob, body: 'none' }, async ({ found, desk, now }) => {
  if (found.client_state !== 'active') throw conflict(COPY.clientClosing);
  const job = await transaction(async (tx) => {
    await moveJobState(tx, found.id, 'archived');
    await addHistory(tx, found.id, desk.name, 'jobArchived', fill(COPY.jobArchived, { title: found.title }), now);
    return one(tx, `${JOB_SELECT} WHERE j.id = $1`, [found.id]);
  });
  return ok(jobJson(job as Row));
});

route('GET', '/api/search', {}, async ({ desk, query }) => {
  const words = foldedKey((query.get('q') ?? '').trim());
  if (!words) return ok({ jobs: [], clients: [], producers: [], total: 0 });
  const like = `%${words.replace(/[\\%_]/g, '\\$&')}%`;
  const jobs = await rows(
    pool,
    `SELECT j.id, j.title FROM jobs j JOIN clients c ON c.id = j.client_id
     WHERE j.desk_id = $1 AND c.state <> 'erased' AND j.state <> 'archived' AND j.title_key LIKE $2 ORDER BY j.title_key COLLATE "C", j.id`,
    [desk.id, like],
  );
  const clients = await rows(pool, `SELECT id, name FROM clients WHERE desk_id = $1 AND state <> 'erased' AND name_key LIKE $2 ORDER BY name_key COLLATE "C", id`, [desk.id, like]);
  const producers = await rows(
    pool,
    `SELECT p.id, p.name, p.client_id FROM producers p JOIN clients c ON c.id = p.client_id
     WHERE c.desk_id = $1 AND c.state <> 'erased' AND p.name_key LIKE $2 ORDER BY p.name_key COLLATE "C", p.id`,
    [desk.id, like],
  );
  return ok({
    jobs: jobs.map((job) => ({ id: job.id, title: job.title })),
    clients: clients.map((client) => ({ id: client.id, name: client.name })),
    producers: producers.map((producer) => ({ id: producer.id, name: producer.name, clientId: producer.client_id })),
    total: jobs.length + clients.length + producers.length,
  });
});

route('GET', '/api/jobs/:id/history', { load: loadJob }, async ({ found }: Context) => {
  const events = await rows(pool, 'SELECT at, actor, action, text FROM history WHERE job_id = $1 ORDER BY seq', [found.id]);
  return ok({ events: events.map((event) => ({ at: instant(event.at), actor: event.actor, action: event.action, text: event.text })) });
});

