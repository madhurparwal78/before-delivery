import { requireUser, schoolOf } from '../auth.js';
import { one, query } from '../db.js';
import { notFound, ok, type Router } from '../http.js';
import { PASS_MARK } from '../sim/model.js';

interface AttemptRow {
  session_id: string;
  scenario_name: string;
  finished_on: string;
  position: string;
  score: number;
  assignment_id: string | null;
  due_on: string | null;
}

export function registerRecordRoutes(router: Router): void {
  router.add('GET', '/api/records/:id', async (ctx) => {
    const viewer = await requireUser(ctx);
    const studentId = ctx.params.id!;
    const student = await one<{ id: string; name: string }>('SELECT id, name FROM users WHERE id = $1', [studentId]);
    if (!student) throw notFound();
    let schoolFilter: string | null = null;
    if (viewer.id !== studentId) {
      const school = await schoolOf(viewer.id);
      const member =
        school &&
        (await one(
          'SELECT 1 FROM class_students cs JOIN classes c ON c.id = cs.class_id WHERE cs.user_id = $1 AND c.school_id = $2',
          [studentId, school.id],
        ));
      if (!school || !member) throw notFound();
      schoolFilter = school.id;
    }
    const assignments = await query<{ id: string; scenario_name: string; due_on: string; class_name: string }>(
      `SELECT a.id, s.data->>'name' AS scenario_name, a.due_on, c.name AS class_name
       FROM class_students cs JOIN classes c ON c.id = cs.class_id
       JOIN assignments a ON a.class_id = c.id JOIN scenarios s ON s.id = a.scenario_id
       WHERE cs.user_id = $1 AND ($2::text IS NULL OR c.school_id = $2) ORDER BY c.seq, a.seq`,
      [studentId, schoolFilter],
    );
    const attempts = await query<AttemptRow>(
      `SELECT ss.id AS session_id, ss.scenario->>'name' AS scenario_name, ss.finished_on, p.position,
        (ss.debrief->>'score')::int AS score, ss.assignment_id, a.due_on
       FROM session_participants p JOIN sim_sessions ss ON ss.id = p.session_id
       LEFT JOIN assignments a ON a.id = ss.assignment_id
       WHERE p.user_id = $1 AND ss.status = 'ended' AND ($2::text IS NULL OR ss.school_id = $2)
       ORDER BY ss.finished_on, ss.seq`,
      [studentId, schoolFilter],
    );
    const late = (row: AttemptRow) => row.due_on !== null && row.finished_on > row.due_on;
    return ok({
      id: student.id,
      name: student.name,
      assignments: assignments.map((assignment) => {
        const mine = attempts.filter((row) => row.assignment_id === assignment.id);
        const onTime = mine.filter((row) => !late(row));
        const best = onTime.length > 0 ? Math.max(...onTime.map((row) => row.score)) : null;
        return {
          id: assignment.id,
          scenario: assignment.scenario_name,
          className: assignment.class_name,
          dueOn: assignment.due_on,
          attempts: mine.length,
          bestScore: best,
          status: best === null ? 'Not attempted' : best >= PASS_MARK ? 'Passed' : 'Not passed',
        };
      }),
      attempts: attempts.map((row) => ({
        sessionId: row.session_id,
        scenario: row.scenario_name,
        finished: row.finished_on,
        position: row.position,
        score: row.score,
        result: row.score >= PASS_MARK ? 'Passed' : 'Not passed',
        timing: late(row) ? 'Late' : 'On time',
      })),
    });
  });
}
