import type { AttendanceRow, ReviewBody, SummaryBody } from '../../shared/wire';
import { requireTeaching, type OpenedSession } from '../access';
import { pool, rows, sole } from '../db';
import { instantToWall } from '../domain/time';
import { Refusal } from '../errors';
import { reply, type Ctx, type Route } from '../http';
import { lessonFiles, loadLesson, numbered, type FileRow } from '../records';
import { sessionOf } from './common';

interface SummaryCounts {
  present: number;
  late: number;
  left_early: number;
  late_left_early: number;
  absent: number;
  hands_taken: number;
  breakout_rounds: number;
}

async function endedForTeaching(ctx: Ctx): Promise<OpenedSession> {
  const opened = await sessionOf(ctx);
  requireTeaching(opened.role);
  if (opened.session.state !== 'ended') throw new Refusal(409, 'Attendance is ready when the session ends.');
  return opened;
}

export const afterRoutes: Route[] = [
  {
    method: 'GET',
    path: '/api/sessions/:id/attendance',
    handler: async (ctx) => {
      const { session } = await endedForTeaching(ctx);
      const found = await rows<{ learner_id: string; display_name: string; status: AttendanceRow['status']; first_joined_ms: number | null; last_left_ms: number | null; visits: number }>(
        pool,
        `SELECT a.learner_id, l.display_name, a.status, a.first_joined_ms, a.last_left_ms, a.visits
           FROM session_attendance a JOIN learners l ON l.id = a.learner_id WHERE a.session_id = $1 ORDER BY l.display_name, l.id`,
        [session.id],
      );
      const wall = (ms: number | null): string | null => (ms === null ? null : instantToWall(ms, session.time_zone));
      const attendance: AttendanceRow[] = found.map((row) => ({
        learnerId: row.learner_id,
        displayName: row.display_name,
        status: row.status,
        firstJoined: wall(row.first_joined_ms),
        lastLeft: wall(row.last_left_ms),
        visits: row.visits,
      }));
      return reply(200, { rows: attendance });
    },
  },
  {
    method: 'GET',
    path: '/api/sessions/:id/summary',
    handler: async (ctx) => {
      const { session } = await endedForTeaching(ctx);
      const counts = await sole<SummaryCounts>(
        pool,
        'SELECT present, late, left_early, late_left_early, absent, hands_taken, breakout_rounds FROM session_summaries WHERE session_id = $1',
        [session.id],
      );
      const polls = await rows<{ id: string; question: string; total: number; results: SummaryBody['polls'][number]['results'] }>(
        pool,
        "SELECT id, question, total, results FROM polls WHERE session_id = $1 AND state = 'closed' ORDER BY created_seq",
        [session.id],
      );
      const summary: SummaryBody = {
        attendance: {
          present: counts.present,
          late: counts.late,
          leftEarly: counts.left_early,
          lateLeftEarly: counts.late_left_early,
          absent: counts.absent,
        },
        polls: polls.map((poll) => ({ pollId: poll.id, question: poll.question, total: poll.total, results: poll.results })),
        handsTaken: counts.hands_taken,
        breakoutRounds: counts.breakout_rounds,
      };
      return reply(200, summary);
    },
  },
  {
    method: 'GET',
    path: '/api/sessions/:id/review',
    handler: async (ctx) => {
      // A learner who cannot review the session was already refused 404 by sessionOf (learnerCanOpen).
      const { session } = await sessionOf(ctx);
      if (session.state !== 'ended') throw new Refusal(409, 'Review opens when the class ends.');
      const lesson = await loadLesson(session.lesson_id);
      const files = (await lessonFiles(session.lesson_id)).filter((file) => file.status === 'confirmed');
      const describe = (kind: FileRow['kind']) =>
        numbered(files, kind).map(({ file, number }) => ({ fileId: file.id, number, url: `/api/files/${file.id}` }));
      const review: ReviewBody = { lessonTitle: lesson.title, slides: describe('slide'), models: describe('model') };
      return reply(200, review);
    },
  },
];
