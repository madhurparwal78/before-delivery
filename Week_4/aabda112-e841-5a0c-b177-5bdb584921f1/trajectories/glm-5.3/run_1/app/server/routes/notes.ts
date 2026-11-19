import express from 'express';
import { q, one } from '../db.js';
import { t, validationError } from '../errors.js';
import { currentUser, handler, requireRole } from '../core.js';
import * as bus from '../live.js';

export const router = express.Router();

const MAX_PARAGRAPH = 5000;

async function loadNote(appointmentId: string) {
  const note = await one(
    `select id from consult_notes where appointment_id = $1`,
    [appointmentId]
  );
  if (note) return note;
  const r = await q(
    `insert into consult_notes (appointment_id) values ($1)
     on conflict do nothing returning id`,
    [appointmentId]
  );
  if (r.rows[0]) return r.rows[0];
  return one(`select id from consult_notes where appointment_id = $1`, [appointmentId]);
}

export async function ensureParagraphs(appointmentId: string): Promise<void> {
  await loadNote(appointmentId);
  const r = await one(`select count(*)::int as c from note_paragraphs where appointment_id = $1`, [appointmentId]);
  if (r.c === 0) {
    await q(
      `insert into note_paragraphs (appointment_id, n, version, text) values ($1, 1, 1, '')
       on conflict do nothing`,
      [appointmentId]
    );
  }
}

router.get('/appointments/:id/note', handler(async (req, res) => {
  const user = await currentUser(req);
  if (!user) throw t('unauthenticated');
  const appt = await one(
    `select id, patient_id from appointments where id = $1 and clinic_id = $2`,
    [req.params.id, user.clinicId]
  );
  if (!appt) throw t('not_found');
  await ensureParagraphs(req.params.id);
  const r = await q(
    `select n, version, text, edited_by from note_paragraphs where appointment_id = $1 order by n`,
    [req.params.id]
  );
  const editorNames = await editorMap(r.rows.map((x: any) => x.edited_by));
  return {
    status: 200,
    body: {
      appointmentId: req.params.id,
      paragraphs: r.rows.map((row: any) => ({
        n: row.n,
        text: row.text,
        version: row.version,
        editedBy: row.edited_by ? editorNames.get(row.edited_by) ?? null : null,
      })),
    },
  };
}));

async function editorMap(ids: (string | null)[]): Promise<Map<string, string>> {
  const valid = ids.filter((x): x is string => !!x);
  if (valid.length === 0) return new Map();
  const r = await q(`select id, name from users where id = any($1)`, [valid]);
  return new Map(r.rows.map((row: any) => [row.id, row.name]));
}

router.put('/appointments/:id/note/paragraphs/:n', handler(async (req, res) => {
  const user = await currentUser(req);
  if (!user) throw t('unauthenticated');
  requireRole(user.role, ['vet', 'manager']);
  const appt = await one(
    `select id from appointments where id = $1 and clinic_id = $2`,
    [req.params.id, user.clinicId]
  );
  if (!appt) throw t('not_found');
  const n = Number(req.params.n);
  if (!Number.isInteger(n) || n < 1) throw t('not_found');
  const { text, version } = req.body ?? {};
  if (typeof text !== 'string') throw validationError('text');
  if (text.length > MAX_PARAGRAPH) throw t('paragraph_too_long', { field: 'text' });
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw validationError('version');
  }
  await ensureParagraphs(req.params.id);
  const row = await one(
    `select * from note_paragraphs where appointment_id = $1 and n = $2`,
    [req.params.id, n]
  );
  if (!row) throw t('not_found');
  if (row.version !== version) {
    const editors = await editorMap([row.edited_by]);
    throw t('stale_paragraph', {
      Name: row.edited_by ? editors.get(row.edited_by) ?? 'Someone' : 'Someone',
    });
  }
  const newVersion = version + 1;
  await q(
    `update note_paragraphs set version = $1, text = $2, edited_by = $3, edited_at = now()
     where appointment_id = $4 and n = $5`,
    [newVersion, text, user.userId, req.params.id, n]
  );
  await q(
    `insert into note_operations (appointment_id, n, version, text, edited_by)
     values ($1, $2, $3, $4, $5)`,
    [req.params.id, n, newVersion, text, user.userId]
  );
  bus.pushClinic(user.clinicId, 'note', { appointmentId: req.params.id });
  return {
    status: 200,
    body: { n, text, version: newVersion, editedBy: user.name },
  };
}));

router.post('/appointments/:id/note/paragraphs', handler(async (req, res) => {
  const user = await currentUser(req);
  if (!user) throw t('unauthenticated');
  requireRole(user.role, ['vet', 'manager']);
  const appt = await one(
    `select id from appointments where id = $1 and clinic_id = $2`,
    [req.params.id, user.clinicId]
  );
  if (!appt) throw t('not_found');
  const { text } = req.body ?? {};
  if (typeof text !== 'string') throw validationError('text');
  if (text.length > MAX_PARAGRAPH) throw t('paragraph_too_long', { field: 'text' });
  await ensureParagraphs(req.params.id);
  const max = await one(
    `select coalesce(max(n), 0)::int as m from note_paragraphs where appointment_id = $1`,
    [req.params.id]
  );
  const n = max.m + 1;
  await q(
    `insert into note_paragraphs (appointment_id, n, version, text, edited_by) values ($1, $2, 1, $3, $4)`,
    [req.params.id, n, text, user.userId]
  );
  await q(
    `insert into note_operations (appointment_id, n, version, text, edited_by) values ($1, $2, 1, $3, $4)`,
    [req.params.id, n, text, user.userId]
  );
  bus.pushClinic(user.clinicId, 'note', { appointmentId: req.params.id });
  return { status: 201, body: { n, text, version: 1, editedBy: user.name } };
}));

export default router;
