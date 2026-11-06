import { randomUUID } from 'node:crypto';
import type { ProtestDto } from '../../shared/api';
import { query, queryOne } from '../db/pool';
import { isoUtc } from '../domain/clubTime';
import { areResultsLocked, isProtestWindowOpen } from '../domain/eventState';
import { apiError } from '../http/errors';
import { json, memberRoute, type Route } from '../http/router';
import { clubOf, isUuid, loadEvent, loadEventById, requireRole, statusOf } from './support';

interface ProtestRow {
  id: string;
  filed_by: string;
  filed_by_name: string;
  subject_registration_id: string;
  subject_car_number: number;
  subject_class_code: string;
  subject_driver_name: string;
  details: string;
  filed_at: Date;
  status: 'pending' | 'upheld' | 'denied';
  decision_note: string | null;
  decided_by: string | null;
  decided_by_name: string | null;
  decided_at: Date | null;
}

const PROTEST_COLUMNS = `p.id, p.filed_by, f.name AS filed_by_name, p.subject_registration_id,
  r.car_number AS subject_car_number, r.class_code AS subject_class_code,
  d.name AS subject_driver_name, p.details, p.filed_at, p.status, p.decision_note,
  p.decided_by, g.name AS decided_by_name, p.decided_at`;

const PROTEST_JOINS = `FROM protests p
  JOIN users f ON f.id = p.filed_by
  JOIN registrations r ON r.id = p.subject_registration_id
  JOIN users d ON d.id = r.driver_id
  LEFT JOIN users g ON g.id = p.decided_by`;

function protestDto(row: ProtestRow): ProtestDto {
  return {
    id: row.id,
    filedBy: { id: row.filed_by, name: row.filed_by_name },
    subject: {
      registrationId: row.subject_registration_id,
      carNumber: row.subject_car_number,
      classCode: row.subject_class_code,
      driverName: row.subject_driver_name,
    },
    text: row.details,
    filedAt: isoUtc(row.filed_at),
    status: row.status,
    decisionNote: row.decision_note,
    decidedBy:
      row.decided_by && row.decided_by_name
        ? { id: row.decided_by, name: row.decided_by_name }
        : null,
    decidedAt: row.decided_at ? isoUtc(row.decided_at) : null,
  };
}

export const protestRoutes: Route[] = [
  memberRoute('GET', '/api/events/:id/protests', async (ctx) => {
    clubOf(ctx.actor);
    const event = await loadEvent(ctx);
    const rows = await query<ProtestRow>(
      `SELECT ${PROTEST_COLUMNS} ${PROTEST_JOINS}
        WHERE p.event_id = $1 ORDER BY p.filed_at`,
      [event.id],
    );
    return json(200, { protests: rows.map(protestDto) });
  }),

  memberRoute('POST', '/api/events/:id/protests', async (ctx) => {
    clubOf(ctx.actor);
    const event = await loadEvent(ctx);
    const filer = await queryOne<{ id: string }>(
      'SELECT id FROM registrations WHERE event_id = $1 AND driver_id = $2',
      [event.id, ctx.actor.id],
    );
    if (!filer) {
      throw apiError.conflict('not_registered', 'Only drivers in this event may file a protest.');
    }
    if (!isProtestWindowOpen(event.protest_window_closes_at, ctx.now)) {
      throw apiError.conflict('protest_window_closed', 'The protest window has closed.');
    }
    const subjectId =
      typeof ctx.body.registrationId === 'string' ? ctx.body.registrationId : '';
    const text = typeof ctx.body.text === 'string' ? ctx.body.text.trim() : '';
    const fields: Record<string, string> = {};
    if (!isUuid(subjectId)) fields.registrationId = 'Pick the car you are protesting.';
    if (text.length < 10 || text.length > 1000) {
      fields.text = 'Protest details must be 10 to 1000 characters.';
    }
    if (Object.keys(fields).length > 0) throw apiError.validation(fields);
    const subject = await queryOne<{ id: string }>(
      'SELECT id FROM registrations WHERE id = $1 AND event_id = $2',
      [subjectId, event.id],
    );
    if (!subject) {
      throw apiError.validation({ registrationId: 'Pick a car running at this event.' });
    }

    const id = randomUUID();
    await query(
      `INSERT INTO protests (id, event_id, filed_by, subject_registration_id, details, filed_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, event.id, ctx.actor.id, subjectId, text, ctx.now],
    );
    const created = await queryOne<ProtestRow>(
      `SELECT ${PROTEST_COLUMNS} ${PROTEST_JOINS} WHERE p.id = $1`,
      [id],
    );
    if (!created) throw apiError.notFound();
    return json(201, { protest: protestDto(created) });
  }),

  memberRoute('POST', '/api/protests/:id/decision', async (ctx) => {
    const club = clubOf(ctx.actor);
    const id = ctx.params.id ?? '';
    if (!isUuid(id)) throw apiError.notFound();
    const protest = await queryOne<{ id: string; event_id: string; status: string }>(
      `SELECT p.id, p.event_id, p.status FROM protests p
         JOIN events e ON e.id = p.event_id
        WHERE p.id = $1 AND e.club_id = $2`,
      [id, club.id],
    );
    if (!protest) throw apiError.notFound();
    requireRole(ctx.actor, 'chair');
    const event = await loadEventById(club.id, protest.event_id);
    if (!event) throw apiError.notFound();
    const status = statusOf(event, ctx.now);
    if (areResultsLocked(status) || status !== 'provisional') {
      throw apiError.conflict('results_locked', 'Protests are decided while results are provisional.');
    }
    if (protest.status !== 'pending') {
      throw apiError.conflict('protest_decided', 'That protest is already decided.');
    }
    const decision = ctx.body.decision;
    const note = typeof ctx.body.note === 'string' ? ctx.body.note.trim() : '';
    const fields: Record<string, string> = {};
    if (decision !== 'upheld' && decision !== 'denied') {
      fields.decision = 'Decision must be upheld or denied.';
    }
    if (note.length < 5 || note.length > 1000) {
      fields.note = 'Give a decision note of at least 5 characters.';
    }
    if (Object.keys(fields).length > 0) throw apiError.validation(fields);

    await query(
      `UPDATE protests SET status = $2, decision_note = $3, decided_by = $4, decided_at = $5
        WHERE id = $1`,
      [protest.id, decision, note, ctx.actor.id, ctx.now],
    );
    const updated = await queryOne<ProtestRow>(
      `SELECT ${PROTEST_COLUMNS} ${PROTEST_JOINS} WHERE p.id = $1`,
      [protest.id],
    );
    if (!updated) throw apiError.notFound();
    return json(200, { protest: protestDto(updated) });
  }),
];
