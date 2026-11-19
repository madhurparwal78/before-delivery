import { now } from './clock.js';
import { type Db, one, pool, rows, transaction } from './db.js';
import { AppError, invalid } from './errors.js';
import { route } from './http.js';
import { publish } from './live.js';
import { loadAppointment, serializeAppointment } from './appointments.js';
import { type Body } from './support.js';

const MAX_PARAGRAPH = 5000;

interface ParagraphRow {
  n: number;
  version: number;
  text: string;
  editor: string | null;
}

/** The current state of every paragraph: the latest accepted operation of each. Empty until first touched. */
async function paragraphs(db: Db, appointmentId: string): Promise<ParagraphRow[]> {
  return rows<ParagraphRow>(
    db,
    `SELECT DISTINCT ON (o.n) o.n, o.version, o.text, u.name AS editor
       FROM note_ops o LEFT JOIN users u ON u.id = o.edited_by
      WHERE o.appointment_id = $1 ORDER BY o.n, o.version DESC`,
    [appointmentId],
  );
}

const shape = (p: ParagraphRow) => ({ n: p.n, text: p.text, version: p.version, editedBy: p.editor });

/** A note that does not exist yet starts with one empty paragraph at version 1; it is stored on first touch. */
async function ensureNote(db: Db, appointmentId: string): Promise<ParagraphRow[]> {
  const current = await paragraphs(db, appointmentId);
  if (current.length > 0) return current;
  await db.query(`INSERT INTO note_ops (appointment_id, n, version, text, edited_by, at) VALUES ($1, 1, 1, '', NULL, $2)`, [appointmentId, now()]);
  return paragraphs(db, appointmentId);
}

function paragraphText(body: Body): string {
  const value = body.text;
  if (value === undefined || value === null) throw invalid('text', 'text', true);
  if (typeof value !== 'string') throw invalid('text', 'text');
  if ([...value].length > MAX_PARAGRAPH) throw new AppError('paragraph_too_long', undefined, 'text');
  return value;
}

export function registerConsultRoutes(): void {
  route('GET', '/api/appointments/:id/note', async (ctx) => {
    const user = await ctx.user();
    const appointment = await loadAppointment(pool, user.clinicId, ctx.params.id);
    const current = await paragraphs(pool, appointment.id);
    ctx.send(200, {
      appointmentId: appointment.id,
      appointment: serializeAppointment(appointment, now()),
      paragraphs: current.length > 0 ? current.map(shape) : [{ n: 1, text: '', version: 1, editedBy: null }],
    });
  });

  route('PUT', '/api/appointments/:id/note/paragraphs/:n', async (ctx) => {
    const user = await ctx.user();
    const appointment = await loadAppointment(pool, user.clinicId, ctx.params.id);
    const n = Number(ctx.params.n);
    if (!Number.isInteger(n) || n < 1) throw new AppError('not_found');
    ctx.allow(user, 'consult.run');
    const body = await ctx.json();
    const saved = await transaction(user.clinicId, async (db) => {
      const current = (await ensureNote(db, appointment.id)).find((p) => p.n === n);
      if (!current) throw new AppError('not_found');
      const version = Number(body.version);
      if (!Number.isInteger(version)) throw invalid('version', 'version', body.version === undefined);
      if (version !== current.version) {
        throw new AppError('stale_paragraph', `${current.editor ?? 'Someone'} changed this paragraph first. Your text is kept below as a draft.`);
      }
      const value = paragraphText(body);
      await db.query('INSERT INTO note_ops (appointment_id, n, version, text, edited_by, at) VALUES ($1, $2, $3, $4, $5, $6)', [
        appointment.id,
        n,
        current.version + 1,
        value,
        user.id,
        now(),
      ]);
      await publish(db, user.clinicId, { t: 'note', appointmentId: appointment.id });
      return { n, text: value, version: current.version + 1, editedBy: user.name };
    });
    ctx.send(200, saved);
  });

  route('POST', '/api/appointments/:id/note/paragraphs', async (ctx) => {
    const user = await ctx.user();
    const appointment = await loadAppointment(pool, user.clinicId, ctx.params.id);
    ctx.allow(user, 'consult.run');
    const body = await ctx.json();
    const value = body.text === undefined ? '' : paragraphText(body);
    const added = await transaction(user.clinicId, async (db) => {
      const current = await ensureNote(db, appointment.id);
      const n = Math.max(...current.map((p) => p.n)) + 1;
      await db.query('INSERT INTO note_ops (appointment_id, n, version, text, edited_by, at) VALUES ($1, $2, 1, $3, $4, $5)', [
        appointment.id,
        n,
        value,
        user.id,
        now(),
      ]);
      await publish(db, user.clinicId, { t: 'note', appointmentId: appointment.id });
      return { n, text: value, version: 1, editedBy: user.name };
    });
    ctx.send(201, added);
  });
}

/** First lines of the latest completed consult's note, for the history list. */
export async function notePreview(db: Db, appointmentId: string): Promise<string> {
  const row = await one<{ text: string }>(
    db,
    `SELECT string_agg(text, E'\n' ORDER BY n) AS text FROM (
       SELECT DISTINCT ON (n) n, text FROM note_ops WHERE appointment_id = $1 ORDER BY n, version DESC) latest WHERE text <> ''`,
    [appointmentId],
  );
  return (row?.text ?? '').slice(0, 240);
}

