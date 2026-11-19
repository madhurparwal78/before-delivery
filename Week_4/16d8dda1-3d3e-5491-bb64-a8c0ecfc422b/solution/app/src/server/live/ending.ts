// Ending a session: the one function that writes its final record to Postgres.
import type { PoolClient } from 'pg';
import type { PollResult } from '../../shared/wire';
import { config } from '../config';
import { count, one, pool, rows, run, tx } from '../db';
import { attendanceOf } from '../domain/attendance';
import { answersFrom, countsFrom, tally } from '../domain/poll';
import { loadSession } from '../records';
import { moveSession } from './moves';
import { announce, deleteSessionKeys, readLive, requireBus } from './valkey';

interface FinalLive {
  seats: Record<string, string>;
  slide: number | null;
  /** Live count of each option of the open poll, in option order. */
  pollCounts: number[];
  answers: Record<string, number>;
}

/** Writes a poll's final tally once; null when it was already closed. */
export async function closePoll(
  client: PoolClient,
  poll: { id: string; options: string[] },
  counts: number[],
  answers: Record<string, number>,
): Promise<{ total: number; results: PollResult[] } | null> {
  const { total, results } = tally(poll.options, counts);
  const closed = await run(
    client,
    "UPDATE polls SET state = 'closed', counts = $2, results = $3, total = $4 WHERE id = $1 AND state = 'open'",
    [poll.id, JSON.stringify(counts), JSON.stringify(results), total],
  );
  if (closed === 0) return null;
  for (const [learnerId, option] of Object.entries(answers)) {
    await run(client, 'INSERT INTO poll_answers (poll_id, learner_id, option) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [poll.id, learnerId, option]);
  }
  return { total, results };
}

const rules = {
  graceMs: config.reconnectGraceSeconds * 1000,
  lateAfterMs: config.lateAfterMinutes * 60_000,
  leftEarlyMs: config.leftEarlyMinutes * 60_000,
};

/** Steps of ending, in order: the open poll, the breakout round, open presence, attendance and the summary. */
export async function finalizeSession(client: PoolClient, sessionId: string, final: FinalLive): Promise<void> {
  const session = await loadSession(sessionId, client);
  const open = await one<{ id: string; options: string[] }>(client, "SELECT id, options FROM polls WHERE session_id = $1 AND state = 'open'", [sessionId]);
  if (open) await closePoll(client, open, final.pollCounts, final.answers);
  await run(client, 'UPDATE breakout_rounds SET ended_ms = $2 WHERE session_id = $1 AND ended_ms IS NULL', [sessionId, session.ends_ms]);
  await run(client, 'UPDATE presence_intervals SET left_ms = $2 WHERE session_id = $1 AND left_ms IS NULL', [sessionId, session.ends_ms]);
  await run(client, 'UPDATE presence_intervals SET settled = true WHERE session_id = $1', [sessionId]);

  const roster = await rows<{ learner_id: string }>(client, 'SELECT learner_id FROM session_learners WHERE session_id = $1', [sessionId]);
  const intervals = await rows<{ learner_id: string; joined_ms: number; left_ms: number | null }>(
    client,
    'SELECT learner_id, joined_ms, left_ms FROM presence_intervals WHERE session_id = $1',
    [sessionId],
  );
  const counts = { present: 0, late: 0, left_early: 0, late_left_early: 0, absent: 0 };
  for (const { learner_id: learnerId } of roster) {
    const mine = intervals.filter((row) => row.learner_id === learnerId).map((row) => ({ joinedMs: row.joined_ms, leftMs: row.left_ms }));
    const mark = attendanceOf(mine, session.starts_ms, session.ends_ms, rules);
    counts[mark.status] += 1;
    await run(
      client,
      `INSERT INTO session_attendance (session_id, learner_id, status, first_joined_ms, last_left_ms, visits)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
      [sessionId, learnerId, mark.status, mark.firstJoinedMs, mark.lastLeftMs, mark.visits],
    );
  }
  const taken = await count(client, 'SELECT count(*) AS n FROM hand_takes WHERE session_id = $1', [sessionId]);
  const rounds = await count(client, 'SELECT count(*) AS n FROM breakout_rounds WHERE session_id = $1', [sessionId]);
  await run(
    client,
    `INSERT INTO session_summaries (session_id, present, late, left_early, late_left_early, absent, hands_taken, breakout_rounds)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT DO NOTHING`,
    [sessionId, counts.present, counts.late, counts.left_early, counts.late_left_early, counts.absent, taken, rounds],
  );
  await run(client, 'UPDATE sessions SET final_seats = $2, locked = false, current_slide = $3 WHERE id = $1', [
    sessionId,
    JSON.stringify(final.seats),
    final.slide ?? session.current_slide,
  ]);
}

/** The teacher ends a running session: Postgres first, then everyone is told, then the live keys go. */
export async function endRunningSession(sessionId: string): Promise<void> {
  requireBus();
  const open = await one<{ id: string; options: string[] }>(pool, "SELECT id, options FROM polls WHERE session_id = $1 AND state = 'open'", [sessionId]);
  const live = await readLive(sessionId, open?.id ?? null);
  const final: FinalLive = {
    seats: live.seats,
    slide: live.slide,
    pollCounts: countsFrom(open?.options.length ?? 0, live.pollCounts),
    answers: answersFrom(live.answers),
  };
  await tx(async (client) => {
    await moveSession(client, sessionId, 'end');
    await finalizeSession(client, sessionId, final);
  });
  await announce(sessionId, 'state');
  await deleteSessionKeys(sessionId);
}
