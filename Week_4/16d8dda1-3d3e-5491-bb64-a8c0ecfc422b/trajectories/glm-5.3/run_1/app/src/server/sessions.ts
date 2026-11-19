import { pool } from './db.js'
import { compareSeatIds, dealBreakout, pollPercent, type Layout } from '../shared/rules.js'
import * as bus from './bus.js'
import {
  breakoutExtendSeconds, breakoutLengthSeconds, breakoutWarningSeconds,
  graceSeconds, worldNow
} from './clock.js'
import { arrangedRoom } from './records.js'
import { writeAttendance } from './presence.js'
import { publishSession } from './live.js'

// Session lifecycle and every live action (DP-10 and the live rules).

export type SessionState = 'scheduled' | 'open' | 'live' | 'breakouts' | 'ended'

export const STATE_409 = (state: SessionState): string =>
  `That can't be done while the session is ${state}.`

export async function openSession(sessionId: string): Promise<void> {
  await pool.query(`UPDATE sessions SET state = 'open' WHERE id = $1`, [sessionId])
}

export async function startSession(sessionId: string): Promise<void> {
  await pool.query(`UPDATE sessions SET state = 'live' WHERE id = $1`, [sessionId])
  await bus.slide.set(sessionId, 1)
}

export async function setSlide(sessionId: string, number: number): Promise<void> {
  await pool.query(`UPDATE sessions SET current_slide = $2 WHERE id = $1`, [sessionId, number])
  await bus.slide.set(sessionId, number)
}

export async function currentSlideOf(sessionId: string): Promise<number> {
  const live = await bus.slide.get(sessionId).catch(() => null)
  if (live !== null) return live
  const answer = await pool.query<{ current_slide: number }>(
    `SELECT current_slide FROM sessions WHERE id = $1`,
    [sessionId]
  )
  return answer.rows[0]?.current_slide ?? 1
}

export async function lock(sessionId: string, locked: boolean): Promise<void> {
  await pool.query(`UPDATE sessions SET locked = $2 WHERE id = $1`, [sessionId, locked])
  await bus.flags.set(sessionId, 'locked', locked ? '1' : '0')
}

export interface BreakoutRound {
  tables: number
  deadline: Date
  startedAt: Date
  assignments: Record<string, string> // learnerId -> tableId
}

export async function startBreakouts(
  sessionId: string,
  tableCount: number,
  seatedLearners: { learnerId: string; seatId: string }[]
): Promise<BreakoutRound> {
  const now = await worldNow(await worldOf(sessionId))
  const deadline = new Date(now.getTime() + breakoutLengthSeconds() * 1000)
  const seatToTable = dealBreakout(seatedLearners.map((entry) => entry.seatId), tableCount)
  const assignments: Record<string, string> = {}
  for (const entry of seatedLearners) {
    assignments[entry.learnerId] = seatToTable.get(entry.seatId) ?? `T1`
  }
  await pool.query(
    `INSERT INTO breakout_rounds (session_id, tables, started_at, deadline, assignments, warned)
     VALUES ($1, $2, $3, $4, $5, false)`,
    [sessionId, tableCount, now, deadline, JSON.stringify(assignments)]
  )
  await pool.query(`UPDATE sessions SET state = 'breakouts', breakout_rounds = breakout_rounds + 1 WHERE id = $1`, [sessionId])
  await bus.breakout.start(
    sessionId,
    deadline.toISOString(),
    String(tableCount),
    assignments
  )
  return { tables: tableCount, deadline, startedAt: now, assignments }
}

export async function extendBreakouts(sessionId: string): Promise<Date | null> {
  const round = await currentRound(sessionId)
  if (!round) return null
  const deadline = new Date(round.deadline.getTime() + breakoutExtendSeconds() * 1000)
  await pool.query(`UPDATE breakout_rounds SET deadline = $2 WHERE id = $1`, [round.id, deadline])
  await bus.breakout.extend(sessionId, deadline.toISOString())
  return deadline
}

interface RoundRow {
  id: string
  tables: number
  started_at: Date
  deadline: Date
  ended_at: Date | null
  assignments: Record<string, string>
  warned: boolean
}

export async function currentRound(sessionId: string): Promise<RoundRow | null> {
  const answer = await pool.query<RoundRow>(
    `SELECT id, tables, started_at, deadline, ended_at, assignments, warned
     FROM breakout_rounds WHERE session_id = $1 AND ended_at IS NULL
     ORDER BY started_at DESC LIMIT 1`,
    [sessionId]
  )
  return answer.rows[0] ?? null
}

export async function roundMembers(sessionId: string): Promise<Record<string, string>> {
  const round = await currentRound(sessionId)
  return round ? round.assignments : {}
}

async function worldOf(sessionId: string): Promise<string> {
  const answer = await pool.query<{ world_id: string }>(
    `SELECT world_id FROM sessions WHERE id = $1`,
    [sessionId]
  )
  return answer.rows[0]?.world_id ?? 'default'
}

/** Runs due work for a session on the world clock: warnings and returns. */
export async function runDue(sessionId: string): Promise<string[]> {
  const answer = await pool.query<{ id: string; state: SessionState; world_id: string }>(
    `SELECT id, state, world_id FROM sessions WHERE id = $1`,
    [sessionId]
  )
  const session = answer.rows[0]
  if (!session || session.state !== 'breakouts') return []
  const round = await currentRound(sessionId)
  if (!round) return []
  const now = await worldNow(session.world_id)
  const announcements: string[] = []
  const remainingMs = round.deadline.getTime() - now.getTime()

  if (remainingMs <= 0) {
    await endBreakoutRound(sessionId, round.id)
    announcements.push('Breakouts are over. Everyone is back in their seat.')
    await publishSession(sessionId, 'breakout-return')
    return announcements
  }

  const warningEdgeMs = breakoutWarningSeconds() * 1000
  if (!round.warned && remainingMs <= warningEdgeMs) {
    await pool.query(`UPDATE breakout_rounds SET warned = true WHERE id = $1`, [round.id])
    announcements.push(`Breakouts end in ${Math.round(remainingMs / 1000)} seconds.`)
    await publishSession(sessionId, 'breakout-warning')
  }
  return announcements
}

export async function endBreakoutRound(sessionId: string, roundId: string): Promise<void> {
  const now = await worldNow(await worldOf(sessionId))
  await pool.query(`UPDATE breakout_rounds SET ended_at = $2 WHERE id = $1`, [roundId, now])
  await pool.query(`UPDATE sessions SET state = 'live' WHERE id = $1 AND state = 'breakouts'`, [sessionId])
  await bus.breakout.end(sessionId)
}

/** Ends a session once, in the published order (DP-10). */
export async function endSession(sessionId: string): Promise<void> {
  const session = await pool.query<{ world_id: string; starts_at: Date; ends_at: Date; state: SessionState }>(
    `SELECT world_id, starts_at, ends_at, state FROM sessions WHERE id = $1`,
    [sessionId]
  )
  const row = session.rows[0]
  if (!row || row.state === 'ended') return
  const now = await worldNow(row.world_id)

  // 1. Close any open poll and write its final tally.
  const openPolls = await pool.query<{ id: string; options: string[] }>(
    `SELECT id, options FROM polls WHERE session_id = $1 AND state = 'open'`,
    [sessionId]
  )
  for (const poll of openPolls.rows) {
    await closePoll(sessionId, poll.id)
  }

  // 2. End any breakout round; everyone is shown in their home seat.
  const round = await currentRound(sessionId)
  if (round) await endBreakoutRound(sessionId, round.id)

  // 3. Close every open presence interval at the end time.
  await pool.query(
    `UPDATE presence_intervals SET left_at = $2 WHERE session_id = $1 AND left_at IS NULL`,
    [sessionId, now]
  )
  // Also settle any leave whose grace has passed.
  await settleDepartures(sessionId, row.world_id)

  // 4. Write the attendance intervals and the summary to Postgres.
  await writeAttendance(sessionId, row.starts_at, row.ends_at)

  await pool.query(
    `UPDATE sessions SET state = 'ended', ended_at = $2, locked = false WHERE id = $1`,
    [sessionId, now]
  )
  await bus.flags.set(sessionId, 'locked', '0')
  await bus.flags.set(sessionId, 'spotlight', '')
  setTimeout(() => {
    void bus.removeSessionKeys(sessionId).catch(() => undefined)
  }, 4000)
}

/** Closes a poll and writes its final tally once (DP-20). */
export async function closePoll(sessionId: string, pollId: string): Promise<{
  total: number
  results: { option: string; count: number; percent: number }[]
}> {
  const poll = await pool.query<{ options: string[] }>(
    `SELECT options FROM polls WHERE id = $1`,
    [pollId]
  )
  const options = poll.rows[0]?.options ?? []
  const counts = await bus.pollCounts.get(sessionId, pollId).catch(() => ({}) as Record<string, string>)
  const numeric = options.map((_, index) => Number(counts[String(index + 1)] ?? 0))
  const total = numeric.reduce((sum, count) => sum + count, 0)
  const results = options.map((option, index) => ({
    option,
    count: numeric[index],
    percent: pollPercent(numeric[index], total)
  }))
  await pool.query(
    `UPDATE polls SET state = 'closed', total = $2, results = $3::jsonb WHERE id = $1`,
    [pollId, total, JSON.stringify(results)]
  )
  return { total, results }
}

/**
 * Marks learners whose reconnect grace has passed after leaving, so their
 * seat, hand and spotlight can be cleared. Returns the learner ids that are
 * now finally gone.
 */
export async function settleDepartures(sessionId: string, worldId: string): Promise<string[]> {
  const now = await worldNow(worldId)
  const grace = graceSeconds()
  const cutoff = new Date(now.getTime() - grace * 1000)
  const answer = await pool.query<{ learner_id: string }>(
    `SELECT DISTINCT pi.learner_id FROM presence_intervals pi
     WHERE pi.session_id = $1
       AND pi.left_at IS NOT NULL
       AND pi.left_at <= $2
       AND NOT EXISTS (
         SELECT 1 FROM presence_intervals later
         WHERE later.session_id = $1 AND later.learner_id = pi.learner_id
           AND later.joined_at > pi.left_at
           AND later.joined_at <= $3
       )`,
    [sessionId, cutoff, new Date(now.getTime() + grace * 1000)]
  )
  const gone: string[] = []
  for (const row of answer.rows) {
    const online = await bus.online.all(sessionId).catch(() => [] as string[])
    if (online.includes(row.learner_id)) continue
    const open = await pool.query(
      `SELECT 1 FROM presence_intervals
       WHERE session_id = $1 AND learner_id = $2 AND left_at IS NULL`,
      [sessionId, row.learner_id]
    )
    if (open.rows.length > 0) continue
    gone.push(row.learner_id)
  }
  return gone
}

export async function openPresence(sessionId: string, worldId: string, learnerId: string): Promise<void> {
  const now = await worldNow(worldId)
  await pool.query(
    `INSERT INTO presence_intervals (session_id, learner_id, joined_at, left_at)
     VALUES ($1, $2, $3, NULL)`,
    [sessionId, learnerId, now]
  )
  await bus.online.add(sessionId, learnerId)
}

export async function closePresence(sessionId: string, worldId: string, learnerId: string): Promise<void> {
  const now = await worldNow(worldId)
  await pool.query(
    `UPDATE presence_intervals SET left_at = $3
     WHERE session_id = $1 AND learner_id = $2 AND left_at IS NULL`,
    [sessionId, learnerId, now]
  )
  await bus.online.remove(sessionId, learnerId)
}

export function seatOrder(seatIds: string[]): string[] {
  return [...seatIds].sort(compareSeatIds)
}

export function roomSeats(layout: Layout): { seatId: string; table: string | null; row: number; column: number }[] {
  return arrangedRoom(layout).seats
}
