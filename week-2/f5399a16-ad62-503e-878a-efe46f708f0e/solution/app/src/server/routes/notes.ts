import { COPY, fill } from '../../shared/copy';
import { one, pool, rows, transaction, type Row, type Runner } from '../db';
import { assertJobWritable, instant, isUuidList, loadJob, type CutFrame, jobOfDesk } from '../records';
import { isUuid, notFound, ok, route, type Context } from '../http';
import { checkOneOf, throwIfAny, type Fields } from '../validate';
import { attachmentAnswer } from './pages';

const NOTE_STATES = ['open', 'done', 'wontDo'] as const;

interface NewestCut {
  number: number;
  positions: Map<number, number>;
}

async function newestCut(db: Runner, jobId: string): Promise<NewestCut | null> {
  const cut = await one(db, 'SELECT number, frames FROM cuts WHERE job_id = $1 ORDER BY number DESC LIMIT 1', [jobId]);
  return cut ? { number: cut.number, positions: new Map((cut.frames as CutFrame[]).map((frame) => [frame.number, frame.position])) } : null;
}

function noteJson(note: Row, newest: NewestCut | null): Row {
  const position = newest?.positions.get(note.frame) ?? null;
  return {
    id: note.id,
    frame: note.frame,
    position,
    goneText: position === null && newest ? fill(COPY.noteGone, { number: newest.number }) : null,
    timecode: note.timecode,
    x: note.x,
    y: note.y,
    producerId: note.producer_id,
    producerName: note.producer_name,
    typedName: note.typed_name,
    state: note.state,
    text: note.text,
    suggestedSeconds: note.suggested_seconds,
    suggestedFrames: note.suggested_frames,
    attachmentUrl: note.attachment_id ? `/api/notes/${note.id}/attachment` : null,
    createdAt: instant(note.created_at),
  };
}

const NOTE_SELECT = `SELECT n.*, p.name AS producer_name FROM notes n JOIN producers p ON p.id = n.producer_id`;

route('GET', '/api/jobs/:id/notes', { load: loadJob }, async ({ found, query }) => {
  const clauses = ['n.job_id = $1'];
  const values: unknown[] = [found.id];
  const state = query.get('state');
  if (state) {
    values.push(state);
    clauses.push(`n.state = $${values.length}`);
  }
  const producer = query.get('producer');
  if (producer) {
    values.push(producer);
    clauses.push(`n.producer_id::text = $${values.length}`);
  }
  const notes = await rows(pool, `${NOTE_SELECT} WHERE ${clauses.join(' AND ')} ORDER BY n.seq`, values);
  const newest = await newestCut(pool, found.id);
  return ok({ notes: notes.map((note) => noteJson(note, newest)), total: notes.length });
});

async function loadNote(context: Context): Promise<{ note: Row; job: Row }> {
  if (!isUuid(context.params.id)) throw notFound();
  const note = await one(pool, `${NOTE_SELECT} JOIN jobs j ON j.id = n.job_id WHERE n.id = $1 AND j.desk_id = $2`, [context.params.id, context.desk.id]);
  if (!note) throw notFound();
  return { note, job: await jobOfDesk(pool, note.job_id, context.desk.id) };
}

route('PATCH', '/api/notes/:id', { load: loadNote }, async ({ found, body }) => {
  const fields: Fields = {};
  const state = checkOneOf(fields, 'state', body.state, NOTE_STATES, 'Pick a state.');
  throwIfAny(fields);
  assertJobWritable(found.job);
  await pool.query('UPDATE notes SET state = $1 WHERE id = $2', [state, found.note.id]);
  return ok(noteJson({ ...found.note, state }, await newestCut(pool, found.job.id)));
});

route('POST', '/api/jobs/:id/notes/mark', { load: loadJob }, async ({ found, body }) => {
  const fields: Fields = {};
  const state = checkOneOf(fields, 'state', body.state, NOTE_STATES, 'Pick a state.');
  if (!Array.isArray(body.noteIds) || !body.noteIds.length) fields.noteIds = 'Pick a note.';
  throwIfAny(fields);
  const ids = body.noteIds as unknown[];
  if (!isUuidList(ids)) throw notFound();
  assertJobWritable(found);
  return transaction(async (tx) => {
    const unique = [...new Set(ids)];
    const updated = await rows(tx, 'UPDATE notes SET state = $1 WHERE job_id = $2 AND id = ANY($3::uuid[]) RETURNING id', [state, found.id, unique]);
    if (updated.length !== unique.length) throw notFound();
    const notes = await rows(tx, `${NOTE_SELECT} WHERE n.id = ANY($1::uuid[]) ORDER BY n.seq`, [unique]);
    const newest = await newestCut(tx, found.id);
    return ok({ notes: notes.map((note) => noteJson(note, newest)) });
  });
});

route('GET', '/api/notes/:id/attachment', { load: loadNote }, async ({ found }) => {
  if (!found.note.attachment_id) throw notFound();
  const held = (await one(pool, 'SELECT * FROM attachments WHERE id = $1', [found.note.attachment_id])) as Row;
  return attachmentAnswer(found.job.client_id, found.job.id, held.id, held.content_type);
});
