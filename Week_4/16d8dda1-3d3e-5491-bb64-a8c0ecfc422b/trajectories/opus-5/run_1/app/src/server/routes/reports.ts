import type { ReviewJson } from '../../shared/types.js';
import { ApiError, errors, sendJson } from '../http.js';
import { query, queryOne } from '../db.js';
import { formatWall } from '../timezone.js';
import { openSession, requireTeaching, requireViewer } from '../access.js';
import { attendanceRowsFor, summaryFor } from '../sessionflow.js';
import type { Router } from '../router.js';

export function reportRoutes(router: Router): void {
  router.add('GET', '/api/sessions/:sessionId/attendance', async ({ res, viewer, params }) => {
    const signedIn = requireViewer(viewer);
    const { session, cls, role } = await openSession(signedIn, params.sessionId as string);
    requireTeaching(role);
    if (session.state !== 'ended') throw new ApiError(409, 'Attendance is ready when the session ends.');
    const rows = await attendanceRowsFor(session);
    sendJson(res, 200, {
      rows: rows.map((row) => ({
        ...row,
        firstJoined: row.firstJoined === null ? null : formatWall(cls.time_zone, new Date(row.firstJoined)),
        lastLeft: row.lastLeft === null ? null : formatWall(cls.time_zone, new Date(row.lastLeft))
      }))
    });
  });

  router.add('GET', '/api/sessions/:sessionId/summary', async ({ res, viewer, params }) => {
    const signedIn = requireViewer(viewer);
    const { session, role } = await openSession(signedIn, params.sessionId as string);
    requireTeaching(role);
    if (session.state !== 'ended') throw new ApiError(409, 'Attendance is ready when the session ends.');
    const stored = await queryOne<{ body: unknown }>('SELECT body FROM summaries WHERE session_id = $1', [session.id]);
    sendJson(res, 200, stored === null ? await summaryFor(session) : stored.body);
  });

  router.add('GET', '/api/sessions/:sessionId/review', async ({ res, viewer, params }) => {
    const signedIn = requireViewer(viewer);
    const { session, role } = await openSession(signedIn, params.sessionId as string);
    if (role === 'learner') {
      const attended = await queryOne<{ id: number }>(
        'SELECT id FROM presence WHERE session_id = $1 AND learner_id = $2 LIMIT 1',
        [session.id, signedIn.id]
      );
      if (attended === null) throw errors.notFound();
    }
    if (session.state !== 'ended') throw new ApiError(409, 'Review opens when the class ends.');
    const lesson = await queryOne<{ title: string }>('SELECT title FROM lessons WHERE id = $1', [session.lesson_id]);
    const files = await query<{ id: string; kind: string }>(
      `SELECT id, kind FROM lesson_files WHERE lesson_id = $1 AND status = 'confirmed'
        ORDER BY position ASC, created_at ASC`,
      [session.lesson_id]
    );
    const review: ReviewJson = {
      lessonTitle: lesson?.title ?? '',
      slides: files
        .filter((file) => file.kind === 'slide')
        .map((file, index) => ({ fileId: file.id, number: index + 1, url: `/api/files/${file.id}` })),
      models: files
        .filter((file) => file.kind === 'model')
        .map((file, index) => ({ fileId: file.id, number: index + 1, url: `/api/files/${file.id}` }))
    };
    sendJson(res, 200, review);
  });
}
