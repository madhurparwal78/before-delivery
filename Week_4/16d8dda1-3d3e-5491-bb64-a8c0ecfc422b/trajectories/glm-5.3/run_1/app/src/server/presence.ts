import { pool } from './db.js'
import { graceSeconds, lateAfterSeconds, leftEarlyBeforeSeconds } from './clock.js'
import { utcToWallString } from './walltime.js'
import type { AttendanceRow } from '../shared/protocol.js'

// Presence and attendance (DP-27), decided in one place.

export interface Interval {
  joinedAt: Date
  leftAt: Date | null
}

export async function intervalsFor(sessionId: string, learnerId: string): Promise<Interval[]> {
  const answer = await pool.query<{ joined_at: Date; left_at: Date | null }>(
    `SELECT joined_at, left_at FROM presence_intervals
     WHERE session_id = $1 AND learner_id = $2 ORDER BY joined_at ASC`,
    [sessionId, learnerId]
  )
  return answer.rows.map((row) => ({ joinedAt: row.joined_at, leftAt: row.left_at }))
}

export interface Visit {
  firstJoined: Date
  lastLeft: Date | null
}

/** Joins intervals whose gap is shorter than the grace into visits. */
export function visitsFrom(intervals: Interval[]): Visit[] {
  const visits: Visit[] = []
  for (const interval of intervals) {
    const last = visits[visits.length - 1]
    if (last && last.lastLeft !== null &&
      interval.joinedAt.getTime() - last.lastLeft.getTime() < graceSeconds() * 1000) {
      last.lastLeft = interval.leftAt
      continue
    }
    visits.push({ firstJoined: interval.joinedAt, lastLeft: interval.leftAt })
  }
  return visits
}

export type AttendanceStatus = 'present' | 'late' | 'left_early' | 'late_left_early' | 'absent'

export function attendanceStatus(
  visits: Visit[],
  startsAt: Date,
  endsAt: Date
): { status: AttendanceStatus; firstJoined: Date | null; lastLeft: Date | null } {
  if (visits.length === 0) {
    return { status: 'absent', firstJoined: null, lastLeft: null }
  }
  const firstJoined = visits[0].firstJoined
  const lastLeft = visits[visits.length - 1].lastLeft
  const onTime = firstJoined.getTime() <= startsAt.getTime() + lateAfterSeconds() * 1000
  const leftEarly =
    lastLeft !== null && lastLeft.getTime() < endsAt.getTime() - leftEarlyBeforeSeconds() * 1000
  let status: AttendanceStatus
  if (onTime && !leftEarly) status = 'present'
  else if (!onTime && !leftEarly) status = 'late'
  else if (onTime && leftEarly) status = 'left_early'
  else status = 'late_left_early'
  return { status, firstJoined, lastLeft }
}

export async function writeAttendance(
  sessionId: string,
  startsAt: Date,
  endsAt: Date
): Promise<void> {
  const roster = await pool.query<{ learner_id: string }>(
    `SELECT DISTINCT learner_id FROM (
       SELECT learner_id FROM session_learners WHERE session_id = $1
       UNION
       SELECT learner_id FROM presence_intervals WHERE session_id = $1
     ) roster`,
    [sessionId]
  )
  for (const row of roster.rows) {
    const intervals = await intervalsFor(sessionId, row.learner_id)
    const visits = visitsFrom(intervals)
    const { status, firstJoined, lastLeft } = attendanceStatus(visits, startsAt, endsAt)
    await pool.query(
      `INSERT INTO attendance_rows (session_id, learner_id, status, first_joined, last_left, visits)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (session_id, learner_id) DO UPDATE SET
         status = $3, first_joined = $4, last_left = $5, visits = $6`,
      [sessionId, row.learner_id, status, firstJoined, lastLeft, visits.length]
    )
  }
}

export async function attendanceRows(sessionId: string, zone: string): Promise<AttendanceRow[]> {
  const answer = await pool.query<{
    learner_id: string; display_name: string; status: AttendanceStatus
    first_joined: Date | null; last_left: Date | null; visits: number
  }>(
    `SELECT a.learner_id, l.display_name, a.status, a.first_joined, a.last_left, a.visits
     FROM attendance_rows a JOIN learners l ON l.id = a.learner_id
     WHERE a.session_id = $1 ORDER BY l.display_name`,
    [sessionId]
  )
  return answer.rows.map((row) => ({
    learnerId: row.learner_id,
    displayName: row.display_name,
    status: row.status,
    firstJoined: row.first_joined ? utcToWallString(zone, row.first_joined) : null,
    lastLeft: row.last_left ? utcToWallString(zone, row.last_left) : null,
    visits: row.visits
  }))
}
