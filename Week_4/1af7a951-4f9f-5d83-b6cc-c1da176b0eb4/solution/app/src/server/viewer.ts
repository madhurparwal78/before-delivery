import type { IncomingMessage } from "node:http";
import { digest } from "./codes.js";
import { pool } from "./db.js";
import { cookieValue } from "./http.js";

export const SESSION_COOKIE = "lf_session";

export interface CoachViewer {
  role: "coach";
  tokenHash: string;
  id: string;
  name: string;
  email: string;
}

export interface DreamerViewer {
  role: "dreamer";
  tokenHash: string;
  enrollmentId: string;
  name: string;
  homeTz: string;
  bedtime: string;
  firstNight: string;
  cohortId: string;
  cohortPublished: boolean;
  cohortClosed: boolean;
  cohortStartsOn: string;
  coachTz: string;
  /** The night key of the dreamer's latest stored entry: the published night key never moves before it. */
  latestEntryKey: string | null;
}

export type Viewer = CoachViewer | DreamerViewer;

/** The signed-in coach or active dreamer behind the request's session cookie, or null. */
export async function viewerOf(req: IncomingMessage): Promise<Viewer | null> {
  const token = cookieValue(req, SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = digest(token);
  const coach = await pool.query<{ id: string; name: string; email: string }>(
    "SELECT co.id, co.name, co.email FROM sessions s JOIN coaches co ON co.id = s.coach_id WHERE s.token_hash = $1",
    [tokenHash],
  );
  const coachRow = coach.rows[0];
  if (coachRow) return { role: "coach", tokenHash, ...coachRow };
  const dreamer = await pool.query<Omit<DreamerViewer, "role" | "tokenHash">>(
    `SELECT e.id AS "enrollmentId", e.name, e.home_tz AS "homeTz", e.bedtime, e.first_night AS "firstNight",
            c.id AS "cohortId", c.published AS "cohortPublished", c.closed AS "cohortClosed",
            c.starts_on AS "cohortStartsOn", co.time_zone AS "coachTz",
            (SELECT max(n.night_key) FROM entries n WHERE n.enrollment_id = e.id) AS "latestEntryKey"
       FROM sessions s
       JOIN enrollments e ON e.id = s.enrollment_id AND e.status = 'active'
       JOIN cohorts c ON c.id = e.cohort_id
       JOIN coaches co ON co.id = c.coach_id
      WHERE s.token_hash = $1`,
    [tokenHash],
  );
  const dreamerRow = dreamer.rows[0];
  return dreamerRow ? { role: "dreamer", tokenHash, ...dreamerRow } : null;
}
