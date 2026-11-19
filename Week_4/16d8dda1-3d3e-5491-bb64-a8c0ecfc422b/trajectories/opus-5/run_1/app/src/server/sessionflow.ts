import type { AttendanceRow, PollResultJson, SummaryJson } from '../shared/types.js';
import type { SessionRecord } from './access.js';
import { sessionById } from './access.js';
import { config } from './config.js';
import { query } from './db.js';
import { realTimeWorlds, worldNow } from './clock.js';
import { markAttendance, type PresenceInterval } from './domain/attendance.js';
import { tally } from './domain/polls.js';
import {
  clearBreakoutKeys,
  dropSessionKeys,
  leaveSeat,
  readPollCounts,
  setHand,
  setSpotlight,
  markOnline
} from './livestate.js';
import { announceChange } from './hub.js';
import { bus } from './valkey.js';

interface RoundRow {
  id: string;
  session_id: string;
  tables: number;
  deadline: Date;
  warning_seconds: number;
  warned: boolean;
}

async function runningRoundRow(sessionId: string): Promise<RoundRow | null> {
  const rows = await query<RoundRow>(
    `SELECT id, session_id, tables, deadline, warning_seconds, warned FROM breakout_rounds
      WHERE session_id = $1 AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1`,
    [sessionId]
  );
  return rows[0] ?? null;
}

/** DP-23: the return happens at the server's deadline, once. */
export async function endBreakoutRound(sessionId: string, now: Date, announce: boolean): Promise<boolean> {
  const round = await runningRoundRow(sessionId);
  if (round === null) return false;
  const claimed = await query<{ id: string }>(
    'UPDATE breakout_rounds SET ended_at = $2 WHERE id = $1 AND ended_at IS NULL RETURNING id',
    [round.id, now]
  );
  if (claimed.length === 0) return false;
  await query("UPDATE sessions SET state = 'live' WHERE id = $1 AND state = 'breakouts'", [sessionId]);
  if (bus.available()) {
    await clearBreakoutKeys(sessionId).catch(() => undefined);
  }
  if (announce) await announceChange(sessionId, 'breakouts-ended');
  return true;
}

async function runBreakoutDue(session: SessionRecord, now: Date): Promise<void> {
  const round = await runningRoundRow(session.id);
  if (round === null) return;
  if (now.getTime() >= round.deadline.getTime()) {
    await endBreakoutRound(session.id, now, true);
    return;
  }
  const warningEdge = round.deadline.getTime() - round.warning_seconds * 1_000;
  if (now.getTime() >= warningEdge && !round.warned) {
    const claimed = await query<{ id: string }>(
      'UPDATE breakout_rounds SET warned = true WHERE id = $1 AND warned = false RETURNING id',
      [round.id]
    );
    if (claimed.length > 0) await announceChange(session.id, 'breakout-warning');
  }
}

/** DP-27: a leave becomes final once the reconnect grace passes without a reconnect. */
async function runPresenceDue(session: SessionRecord, now: Date): Promise<void> {
  const left = await query<{ learner_id: string }>(
    `SELECT p.learner_id FROM presence p
      WHERE p.session_id = $1
        AND p.learner_id NOT IN (SELECT learner_id FROM connections WHERE session_id = $1 AND closed_at IS NULL)
      GROUP BY p.learner_id
      HAVING COUNT(*) FILTER (WHERE p.left_at IS NULL) = 0
         AND MAX(p.left_at) <= $2::timestamptz - make_interval(secs => COALESCE((
               SELECT c.grace_seconds FROM connections c
                WHERE c.session_id = $1 AND c.learner_id = p.learner_id
                ORDER BY c.opened_at DESC LIMIT 1), $3::int))`,
    [session.id, now, config.reconnectGraceSeconds]
  );
  if (left.length === 0) return;
  const gone = left.map((row) => row.learner_id);
  const holding = await query<{ learner_id: string }>(
    `SELECT learner_id FROM session_seats WHERE session_id = $1 AND learner_id = ANY($2)
      UNION
     SELECT learner_id FROM session_hands WHERE session_id = $1 AND learner_id = ANY($2)`,
    [session.id, gone]
  );
  const spotlit = session.spotlight !== null && gone.includes(session.spotlight);
  if (holding.length === 0 && !spotlit) {
    for (const learnerId of gone) await markOnline(session.id, learnerId, false);
    return;
  }
  for (const learnerId of gone) {
    await setHand(session, learnerId, false);
    await leaveSeat(session, learnerId);
    await markOnline(session.id, learnerId, false);
  }
  if (spotlit) await setSpotlight(session, null);
  await announceChange(session.id, 'presence');
}

/**
 * Due work is claimed once across the instances. An instance that cannot reach
 * the live bus leaves it alone, so the warning and the return are never taken
 * by a page nobody can be told about.
 */
export async function runDue(worldId: string): Promise<void> {
  if (!bus.available()) return;
  const now = await worldNow(worldId);
  const sessions = await query<SessionRecord>(
    "SELECT * FROM sessions WHERE world_id = $1 AND state IN ('open', 'live', 'breakouts')",
    [worldId]
  );
  for (const session of sessions) {
    if (session.state === 'breakouts') await runBreakoutDue(session, now);
    await runPresenceDue(session, now);
  }
}

export async function closePoll(
  session: SessionRecord,
  poll: { id: string; options: string[] },
  now: Date
): Promise<{ total: number; results: PollResultJson[] }> {
  const counts = bus.available()
    ? await readPollCounts(session, poll.id, poll.options.length)
    : await countsFromRecord(poll.id, poll.options.length);
  const final = tally(poll.options, counts);
  await query(
    `UPDATE polls SET state = 'closed', closed_at = $2, total = $3, results = $4
      WHERE id = $1 AND state = 'open'`,
    [poll.id, now, final.total, JSON.stringify(final.results)]
  );
  return final;
}

async function countsFromRecord(pollId: string, options: number): Promise<number[]> {
  const rows = await query<{ option: number; count: number }>(
    'SELECT option, COUNT(*)::int AS count FROM poll_answers WHERE poll_id = $1 GROUP BY option',
    [pollId]
  );
  const counts = new Array<number>(options).fill(0);
  for (const row of rows) counts[row.option - 1] = row.count;
  return counts;
}

export async function attendanceRowsFor(session: SessionRecord): Promise<AttendanceRow[]> {
  const roster = await query<{ learner_id: string; display_name: string }>(
    `SELECT sl.learner_id, l.display_name FROM session_learners sl
       JOIN learners l ON l.id = sl.learner_id
      WHERE sl.session_id = $1
      ORDER BY l.created_at ASC`,
    [session.id]
  );
  const intervals = await query<{ learner_id: string; joined_at: Date; left_at: Date | null }>(
    'SELECT learner_id, joined_at, left_at FROM presence WHERE session_id = $1 ORDER BY joined_at ASC',
    [session.id]
  );
  const graces = await query<{ learner_id: string; grace_seconds: number }>(
    `SELECT DISTINCT ON (learner_id) learner_id, grace_seconds FROM connections
      WHERE session_id = $1 ORDER BY learner_id, opened_at DESC`,
    [session.id]
  );
  const graceFor = new Map(graces.map((row) => [row.learner_id, row.grace_seconds]));
  const byLearner = new Map<string, PresenceInterval[]>();
  for (const row of intervals) {
    const list = byLearner.get(row.learner_id) ?? [];
    list.push({ joinedAt: row.joined_at, leftAt: row.left_at });
    byLearner.set(row.learner_id, list);
  }
  return roster.map((learner) => {
    const mark = markAttendance(
      byLearner.get(learner.learner_id) ?? [],
      { startsAt: session.starts_at, endsAt: session.ends_at },
      graceFor.get(learner.learner_id)
    );
    return {
      learnerId: learner.learner_id,
      displayName: learner.display_name,
      status: mark.status,
      firstJoined: mark.firstJoined === null ? null : mark.firstJoined.toISOString(),
      lastLeft: mark.lastLeft === null ? null : mark.lastLeft.toISOString(),
      visits: mark.visits
    };
  });
}

export async function summaryFor(session: SessionRecord): Promise<SummaryJson> {
  const rows = await attendanceRowsFor(session);
  const counts = { present: 0, late: 0, leftEarly: 0, lateLeftEarly: 0, absent: 0 };
  for (const row of rows) {
    if (row.status === 'present') counts.present += 1;
    else if (row.status === 'late') counts.late += 1;
    else if (row.status === 'left_early') counts.leftEarly += 1;
    else if (row.status === 'late_left_early') counts.lateLeftEarly += 1;
    else counts.absent += 1;
  }
  const polls = await query<{
    id: string;
    question: string;
    options: string[];
    total: number | null;
    results: PollResultJson[] | null;
  }>(
    `SELECT id, question, options, total, results FROM polls
      WHERE session_id = $1 ORDER BY position ASC`,
    [session.id]
  );
  const current = await sessionById(session.id);
  return {
    attendance: counts,
    polls: polls.map((poll) => ({
      pollId: poll.id,
      question: poll.question,
      total: poll.total ?? 0,
      results: poll.results ?? tally(poll.options, poll.options.map(() => 0)).results
    })),
    handsTaken: current?.hands_taken ?? session.hands_taken,
    breakoutRounds: current?.breakout_rounds ?? session.breakout_rounds
  };
}

/**
 * DP-10: ending a session closes the open poll, ends any breakout round,
 * closes presence and writes attendance and the summary, in that order.
 */
export async function endSession(session: SessionRecord, now: Date): Promise<SessionRecord> {
  const open = await query<{ id: string; options: string[] }>(
    "SELECT id, options FROM polls WHERE session_id = $1 AND state = 'open'",
    [session.id]
  );
  for (const poll of open) await closePoll(session, poll, now);

  await endBreakoutRound(session.id, now, false);

  await query('UPDATE presence SET left_at = $2 WHERE session_id = $1 AND left_at IS NULL', [session.id, now]);
  await query('UPDATE connections SET closed_at = $2 WHERE session_id = $1 AND closed_at IS NULL', [session.id, now]);

  await query(
    `UPDATE sessions SET state = 'ended', ended_at = $2, locked = false, spotlight = NULL WHERE id = $1`,
    [session.id, now]
  );
  const ended = await sessionById(session.id);
  const settled = ended ?? { ...session, state: 'ended' as const, ended_at: now };

  const rows = await attendanceRowsFor(settled);
  for (const row of rows) {
    await query(
      `INSERT INTO attendance (session_id, learner_id, status, first_joined, last_left, visits)
         VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (session_id, learner_id) DO UPDATE
         SET status = $3, first_joined = $4, last_left = $5, visits = $6`,
      [settled.id, row.learnerId, row.status, row.firstJoined, row.lastLeft, row.visits]
    );
  }
  const summary = await summaryFor(settled);
  await query(
    `INSERT INTO summaries (session_id, body, written_at) VALUES ($1, $2, $3)
       ON CONFLICT (session_id) DO UPDATE SET body = $2, written_at = $3`,
    [settled.id, JSON.stringify(summary), now]
  );
  setTimeout(() => void dropSessionKeys(settled.id), 1_000).unref();
  return settled;
}

/** DP-39: a change of the world clock reaches every connected page of that world. */
export async function pushWorldClock(worldId: string): Promise<void> {
  if (!bus.available()) return;
  const sessions = await query<{ id: string }>(
    "SELECT id FROM sessions WHERE world_id = $1 AND state IN ('open', 'live', 'breakouts')",
    [worldId]
  );
  for (const session of sessions) await announceChange(session.id, 'clock');
}

export function startDueTicker(): void {
  let running = false;
  setInterval(() => {
    if (running) return;
    running = true;
    void (async () => {
      try {
        for (const worldId of await realTimeWorlds()) await runDue(worldId);
      } catch {
        /* a transient database hiccup is retried on the next tick */
      } finally {
        running = false;
      }
    })();
  }, 500).unref();
}
