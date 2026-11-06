// Daily notes on the home clock, phone capture and the timeline.
import { randomUUID } from 'node:crypto';
import { db, one, transaction, type Tx } from '../db.ts';
import { FieldErrors, notFound, validation } from '../errors.ts';
import { emit } from '../events.ts';
import { objectBody, ok, route, type Request, type Route } from '../http.ts';
import { blockJson, fullObject } from '../model.ts';
import { homeToday } from '../workspace.ts';
import { blockOr404, insertTextBlock, storedBody } from './blocks.ts';
import { DAILY_RANK } from './objects.ts';
import { addDays, isRealDate } from '../../shared/time.ts';

const RECENT = 7;
const EXCERPT_CHARS = 30;

/** Finds or creates the daily note of a date; `created` is true when it was made now. */
async function dailyNote(tx: Tx, date: string): Promise<{ id: string; created: boolean }> {
  const [type] = await tx.query<{ id: string }>('SELECT id FROM object_types WHERE builtin_rank = $1', [DAILY_RANK]);
  const inserted = await tx.query<{ id: string }>(
    `INSERT INTO objects (id, type_id, title, daily_date, properties, share_visibility, created_at, updated_at)
     VALUES ($1, $2, $3, $4::date, '{}', 'follow', now(), now()) ON CONFLICT (daily_date) DO NOTHING RETURNING id`,
    [randomUUID(), type.id, date, date]);
  if (inserted.length) {
    await emit(tx, 'object.saved', { object_id: inserted[0].id });
    return { id: inserted[0].id, created: true };
  }
  const [row] = await tx.query<{ id: string }>('SELECT id FROM objects WHERE daily_date = $1', [date]);
  return { id: row.id, created: false };
}

async function today() {
  const result = await transaction(async (tx) => {
    const { date } = await homeToday(tx);
    return { date, ...(await dailyNote(tx, date)) };
  });
  return ok({ date: result.date, object: (await fullObject(db, result.id)) ?? null }, result.created ? 201 : 200);
}

async function capture(req: Request) {
  const body = objectBody(req);
  const errors = new FieldErrors();
  const stored = storedBody(body.body, errors);
  errors.throwIfAny();
  const result = await transaction(async (tx) => {
    const { date } = await homeToday(tx);
    const note = await dailyNote(tx, date);
    // A block that is not in the note the capture lands on (yesterday's, after the day turned) puts it at the end.
    const after = typeof body.after_block_id === 'string'
      ? await one<{ id: string }>(tx, 'SELECT id FROM blocks WHERE id::text = $1 AND object_id = $2', [body.after_block_id, note.id])
      : undefined;
    const id = await insertTextBlock(tx, note.id, stored, after?.id ?? null, req.session.label);
    return { date, objectId: note.id, id };
  });
  return ok({ date: result.date, object_id: result.objectId, block: blockJson(await blockOr404(db, result.id)) }, 201);
}

async function byDate(req: Request) {
  const date = req.query.get('date');
  if (!isRealDate(date)) throw validation({ date: 'Use YYYY-MM-DD.' });
  const row = await one<{ id: string }>(db, 'SELECT id FROM objects WHERE daily_date = $1', [date]);
  if (!row) throw notFound();
  return ok((await fullObject(db, row.id)) ?? null);
}

async function recent() {
  const rows = await db.query<{ daily_date: string; id: string }>(
    'SELECT daily_date, id FROM objects WHERE daily_date IS NOT NULL ORDER BY daily_date DESC LIMIT $1', [RECENT]);
  return ok({ notes: rows.map((r) => ({ date: r.daily_date, object_id: r.id })) });
}

async function timeline() {
  const { date: todayDate } = await homeToday(db);
  const notes = await db.query<{ id: string; daily_date: string }>('SELECT id, daily_date FROM objects WHERE daily_date IS NOT NULL ORDER BY daily_date');
  const blocks = await db.query<{ id: string; object_id: string; kind: string; plain: string | null; origin_plain: string | null; filename: string | null }>(
    `SELECT b.id, b.object_id, b.kind, b.plain, ob.plain AS origin_plain, a.filename
       FROM blocks b JOIN objects o ON o.id = b.object_id
       LEFT JOIN blocks ob ON ob.id = b.origin_block_id LEFT JOIN attachments a ON a.id = b.attachment_id
      WHERE o.daily_date IS NOT NULL ORDER BY b.position`);
  const byNote = new Map(notes.map((n) => [n.daily_date, n.id]));
  const first = notes.length && notes[0].daily_date < todayDate ? notes[0].daily_date : todayDate;
  const days = [];
  for (let d = first; d <= todayDate; d = addDays(d, 1)) {
    const objectId = byNote.get(d) ?? null;
    const own = objectId ? blocks.filter((b) => b.object_id === objectId) : [];
    days.push({
      date: d, object_id: objectId, block_count: own.length,
      blocks: own.map((b) => ({
        id: b.id, kind: b.kind, movable: b.kind !== 'attachment',
        excerpt: [...((b.kind === 'quote' ? b.origin_plain : b.kind === 'attachment' ? b.filename : b.plain) ?? '')].slice(0, EXCERPT_CHARS).join(''),
      })),
    });
  }
  return ok({ today: todayDate, days });
}

export const dailyRoutes: Route[] = [
  route('POST', '/api/daily/today', 'none', today),
  route('POST', '/api/daily/today/blocks', 'json', capture, { idempotent: true }),
  route('GET', '/api/daily', 'none', byDate),
  route('GET', '/api/daily/recent', 'none', recent),
  route('GET', '/api/timeline', 'none', timeline),
];
