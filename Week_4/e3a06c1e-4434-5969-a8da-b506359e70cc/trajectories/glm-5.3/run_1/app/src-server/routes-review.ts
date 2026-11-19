// Corrections: create, edit, submit, decide, reopen, and the Review tab's queue.

import { randomUUID } from 'node:crypto';
import { errors } from './errors';
import { json, route, type Ctx, type Route } from './router';
import { readJson } from './body';
import { requireAction, requireProjectVisible } from './access';
import { checkText } from '../src-shared/text';
import { REVIEW_STATUS } from '../src-shared/copy';
import {
  correctionObject, segmentObject, sessionWer, requireSessionVisible, loadSegmentRow,
} from './api';
import { splitWords } from '../src-shared/text';
import type { CorrectionRow } from './api';

const OPEN_STATES = "('draft','submitted','returned')";

export function reviewRoutes(): Route[] {
  return [
    route('POST', '/api/sessions/:session_id/segments/:segment_id/corrections', async (ctx: Ctx) => {
      const member = ctx.member;
      if (!member) throw errors.unauthenticated();
      requireAction(member, 'editCorrections');
      const parts = ctx.url.pathname.split('/');
      await requireSessionVisible(ctx, parts[3]);
      const seg = await loadSegmentRow(ctx.db, parts[3], parts[5]);
      if (!seg) throw errors.notFound();
      // Corrections may only be made on final segments of ended sessions.
      const { rows: sessionRows } = await ctx.db.query(`SELECT ended_at FROM sessions WHERE id=$1`, [parts[3]]);
      if (!sessionRows[0].ended_at) throw errors.conflict('session_open', 'This session is still open.');
      const body = await readJson(ctx.req);
      const text = typeof body.text === 'string' ? body.text : '';
      const textCheck = checkText(text, 1, 500);
      if (!textCheck.ok) throw errors.validation({ text: REVIEW_STATUS.correctedTextError });

      // At most one open correction; concurrent creates: exactly one wins.
      const id = randomUUID();
      const inserted = await ctx.db.query(
        `INSERT INTO corrections (id, segment_id, session_id, author_id, state, text)
         SELECT $1, $2, $3, $4, 'draft', $5
          WHERE NOT EXISTS (SELECT 1 FROM corrections WHERE segment_id=$2 AND state IN ${OPEN_STATES})
         RETURNING id`,
        [id, seg.id, parts[3], member.id, textCheck.value],
      );
      if (inserted.rows.length === 0) throw errors.conflict('correction_open', REVIEW_STATUS.openConflict);
      const row = await loadCorrection(ctx.db, id);
      json(ctx, 201, { correction: correctionObject(row) });
    }),

    route('GET', '/api/corrections/:correction_id', async (ctx: Ctx) => {
      if (!ctx.member) throw errors.unauthenticated();
      const id = ctx.url.pathname.split('/')[3];
      const row = await visibleCorrection(ctx, id);
      json(ctx, 200, { correction: correctionObject(row) });
    }),

    route('PATCH', '/api/corrections/:correction_id', async (ctx: Ctx) => {
      const member = ctx.member;
      if (!member) throw errors.unauthenticated();
      requireAction(member, 'editCorrections');
      const id = ctx.url.pathname.split('/')[3];
      const row = await visibleCorrection(ctx, id);
      if (row.author_id !== member.id) throw errors.forbidden();
      if (row.state !== 'draft') throw errors.conflict('invalid_transition', 'Only drafts can be edited.');
      const body = await readJson(ctx.req);
      const text = typeof body.text === 'string' ? body.text : '';
      const textCheck = checkText(text, 1, 500);
      if (!textCheck.ok) throw errors.validation({ text: REVIEW_STATUS.correctedTextError });
      await ctx.db.query(`UPDATE corrections SET text=$2 WHERE id=$1`, [id, textCheck.value]);
      json(ctx, 200, { correction: correctionObject(await loadCorrection(ctx.db, id)) });
    }),

    route('POST', '/api/corrections/:correction_id/submit', async (ctx: Ctx) => {
      const member = ctx.member;
      if (!member) throw errors.unauthenticated();
      requireAction(member, 'editCorrections');
      const id = ctx.url.pathname.split('/')[3];
      const row = await visibleCorrection(ctx, id);
      if (row.author_id !== member.id) throw errors.forbidden();
      if (row.state !== 'draft') throw errors.conflict('invalid_transition', 'Only drafts can be submitted.');
      await ctx.db.query(`UPDATE corrections SET state='submitted', submitted_at=now() WHERE id=$1 AND state='draft'`, [id]);
      json(ctx, 200, { correction: correctionObject(await loadCorrection(ctx.db, id)) });
    }),

    route('POST', '/api/corrections/:correction_id/approve', async (ctx: Ctx) => {
      const member = ctx.member;
      if (!member) throw errors.unauthenticated();
      requireAction(member, 'decideCorrections');
      const id = ctx.url.pathname.split('/')[3];
      const row = await visibleCorrection(ctx, id);
      if (row.author_id === member.id) throw errors.forbidden();
      if (row.state !== 'submitted') throw errors.conflict('invalid_transition', REVIEW_STATUS.alreadyDecided);
      // Exactly one of two simultaneous decisions wins.
      const decided = await ctx.db.query(
        `UPDATE corrections SET state='approved', decided_at=now(), decided_by=$2 WHERE id=$1 AND state='submitted' RETURNING id`,
        [id, member.id],
      );
      if (decided.rows.length === 0) throw errors.conflict('invalid_transition', REVIEW_STATUS.alreadyDecided);
      const fresh = await loadCorrection(ctx.db, id);
      const seg = await loadSegmentRowById(ctx.db, fresh.segment_id);
      const segment = await segmentObject(ctx.db, seg);
      const wer = await sessionWer(ctx.db, fresh.session_id);
      // Every open view receives the correction event within 2s (the hub broadcast is immediate).
      await ctx.db.query(`UPDATE sessions SET wer=$2 WHERE id=$1`, [fresh.session_id, wer]);
      ctx.hub.broadcastCorrection(fresh.session_id, segment, wer ?? 0);
      json(ctx, 200, { correction: correctionObject(fresh), segment, wer });
    }),

    route('POST', '/api/corrections/:correction_id/return', async (ctx: Ctx) => {
      const member = ctx.member;
      if (!member) throw errors.unauthenticated();
      requireAction(member, 'decideCorrections');
      const id = ctx.url.pathname.split('/')[3];
      const row = await visibleCorrection(ctx, id);
      if (row.author_id === member.id) throw errors.forbidden();
      if (row.state !== 'submitted') throw errors.conflict('invalid_transition', REVIEW_STATUS.alreadyDecided);
      const body = await readJson(ctx.req);
      const note = typeof body.note === 'string' ? body.note : '';
      const noteCheck = checkText(note, 1, 500);
      if (!noteCheck.ok) throw errors.validation({ note: REVIEW_STATUS.returnNoteError });
      const decided = await ctx.db.query(
        `UPDATE corrections SET state='returned', decided_at=now(), decided_by=$2, note=$3 WHERE id=$1 AND state='submitted' RETURNING id`,
        [id, member.id, noteCheck.value],
      );
      if (decided.rows.length === 0) throw errors.conflict('invalid_transition', REVIEW_STATUS.alreadyDecided);
      const fresh = await loadCorrection(ctx.db, id);
      const seg = await loadSegmentRowById(ctx.db, fresh.segment_id);
      const segment = await segmentObject(ctx.db, seg);
      const wer = await sessionWer(ctx.db, fresh.session_id);
      await ctx.db.query(`UPDATE sessions SET wer=$2 WHERE id=$1`, [fresh.session_id, wer]);
      json(ctx, 200, { correction: correctionObject(fresh), segment, wer });
    }),

    route('POST', '/api/corrections/:correction_id/reopen', async (ctx: Ctx) => {
      const member = ctx.member;
      if (!member) throw errors.unauthenticated();
      requireAction(member, 'editCorrections');
      const id = ctx.url.pathname.split('/')[3];
      const row = await visibleCorrection(ctx, id);
      if (row.author_id !== member.id) throw errors.forbidden();
      if (row.state !== 'returned') throw errors.conflict('invalid_transition', 'Only returned corrections can be reopened.');
      await ctx.db.query(`UPDATE corrections SET state='draft', decided_at=NULL, decided_by=NULL WHERE id=$1 AND state='returned'`, [id]);
      json(ctx, 200, { correction: correctionObject(await loadCorrection(ctx.db, id)) });
    }),

    route('GET', '/api/projects/:project_id/corrections', async (ctx: Ctx) => {
      const member = ctx.member;
      if (!member) throw errors.unauthenticated();
      requireAction(member, 'listCorrections');
      const projectId = ctx.url.pathname.split('/')[3];
      await requireProjectVisible(ctx.db, member, projectId);
      const stateFilter = ctx.url.searchParams.get('state');
      const { rows } = await ctx.db.query(
        `SELECT c.id, c.session_id, c.segment_id, c.state, c.text, c.note, c.created_at, c.submitted_at, c.decided_at, c.decided_by,
                m.id AS author_id, m.name AS author_name
           FROM corrections c
           JOIN segments sg ON sg.id = c.segment_id
           JOIN sessions s ON s.id = c.session_id
           JOIN members m ON m.id = c.author_id
          WHERE s.project_id = $1 ${stateFilter ? 'AND c.state=$2' : ''}
          ORDER BY c.created_at DESC`,
        stateFilter ? [projectId, stateFilter] : [projectId],
      );
      json(ctx, 200, { corrections: rows.map((r) => correctionObject(r as unknown as CorrectionRow)) });
    }),
  ];
}

async function loadCorrection(db: import('./db').Db, id: string): Promise<CorrectionRow> {
  const { rows } = await db.query(
    `SELECT c.id, c.session_id, c.segment_id, c.state, c.text, c.note, c.created_at, c.submitted_at, c.decided_at, c.decided_by,
            m.id AS author_id, m.name AS author_name
       FROM corrections c JOIN members m ON m.id = c.author_id WHERE c.id=$1`,
    [id],
  );
  if (rows.length === 0) throw errors.notFound();
  return rows[0] as unknown as CorrectionRow;
}

async function visibleCorrection(ctx: Ctx, id: string): Promise<CorrectionRow> {
  const { rows } = await ctx.db.query(
    `SELECT c.id, c.session_id, c.segment_id, c.state, c.text, c.note, c.created_at, c.submitted_at, c.decided_at, c.decided_by,
            m.id AS author_id, m.name AS author_name, s.project_id
       FROM corrections c
       JOIN members m ON m.id = c.author_id
       JOIN sessions s ON s.id = c.session_id
      WHERE c.id=$1`,
    [id],
  );
  if (rows.length === 0) throw errors.notFound();
  const r = rows[0];
  const { visibleProjectIds } = await import('./access');
  const visible = await visibleProjectIds(ctx.db, ctx.member!);
  if (!visible.includes(String(r.project_id))) throw errors.notFound();
  return r as unknown as CorrectionRow;
}

async function loadSegmentRowById(db: import('./db').Db, segmentId: string) {
  const { rows } = await db.query(
    `SELECT id, index_in_session, start_ms, end_ms, machine_words FROM segments WHERE id=$1`,
    [segmentId],
  );
  return rows[0];
}
