import { timers } from "./config.ts";
import { pool, query } from "./db.ts";
import { debrief } from "./domain/scoring.ts";
import { isPassed } from "./domain/rules.ts";
import { notFound } from "./errors.ts";
import { route } from "./http.ts";
import { requireUser } from "./auth.ts";
import { logOf } from "./exercise.ts";
import { loadSession } from "./sessions.ts";

interface AssignmentRow {
  id: string;
  scenario: string;
  due_on: string;
}

interface AttemptRow {
  session_id: string;
  assignment_id: string | null;
  position: string;
  ended_on: string;
}

type Standing = "Passed" | "Not passed" | "Not attempted";

export function registerRecordRoutes(): void {
  route("GET", "/api/records/:id", async (ctx) => {
    const user = await requireUser(ctx);
    const studentId = ctx.params[0] ?? "";
    const student = (
      await query<{ name: string; instructed: boolean }>(
        pool,
        `SELECT u.name,
                EXISTS (SELECT 1 FROM class_members m JOIN classes c ON c.id = m.class_id JOIN schools s ON s.id = c.school_id
                         WHERE m.user_id = u.id AND s.instructor_id = $2) AS instructed
           FROM users u WHERE u.id = $1 AND EXISTS (SELECT 1 FROM class_members m WHERE m.user_id = u.id)`,
        [studentId, user.id],
      )
    )[0];
    if (!student || (studentId !== user.id && !student.instructed)) throw notFound();

    const assignments = await query<AssignmentRow>(
      pool,
      `SELECT a.id, s.name AS scenario, a.due_on FROM assignments a
         JOIN scenarios s ON s.id = a.scenario_id
         JOIN class_members m ON m.class_id = a.class_id
        WHERE m.user_id = $1 ORDER BY a.created_at, a.id`,
      [studentId],
    );
    const attempts = await query<AttemptRow>(
      pool,
      `SELECT x.id AS session_id, x.assignment_id, t.position, x.ended_on FROM sessions x
         JOIN seats t ON t.session_id = x.id WHERE t.user_id = $1 AND x.status = 'ended' ORDER BY x.created_at, x.id`,
      [studentId],
    );
    const dueOn = new Map(assignments.map((a) => [a.id, a.due_on]));
    const scenarios = new Map(assignments.map((a) => [a.id, a.scenario]));
    const scored = await Promise.all(
      attempts.map(async (attempt) => {
        const row = await loadSession(pool, attempt.session_id);
        if (!row) throw notFound();
        const result = debrief(row.setup, row.state, timers, await logOf(row.id));
        const due = attempt.assignment_id ? dueOn.get(attempt.assignment_id) : undefined;
        return {
          sessionId: attempt.session_id,
          assignmentId: attempt.assignment_id,
          scenario: (attempt.assignment_id ? scenarios.get(attempt.assignment_id) : undefined) ?? row.setup.scenarioName,
          finished: attempt.ended_on,
          position: attempt.position,
          score: result.score,
          result: result.passed ? "Passed" : "Not passed",
          timing: due !== undefined && attempt.ended_on > due ? "Late" : "On time",
        };
      }),
    );
    return {
      name: student.name,
      assignments: assignments.map((assignment) => {
        const own = scored.filter((a) => a.assignmentId === assignment.id);
        const onTime = own.filter((a) => a.timing === "On time");
        const best = onTime.length > 0 ? Math.max(...onTime.map((a) => a.score)) : null;
        const standing: Standing = best === null ? "Not attempted" : isPassed(best) ? "Passed" : "Not passed";
        return { id: assignment.id, scenario: assignment.scenario, dueOn: assignment.due_on, attempts: own.length, bestScore: best, status: standing };
      }),
      attempts: scored,
    };
  });
}
