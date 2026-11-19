// Breakout rounds: starting, extending, and the server-decided warning and return.
import { config } from '../config';
import { one, pool, rows, run, tx } from '../db';
import { dealToTables, isOver, isWarning } from '../domain/breakout';
import { tableIdOf } from '../domain/layout';
import { BREAKOUTS_OVER, Refusal } from '../errors';
import { newId } from '../ids';
import type { SessionRow } from '../records';
import { worldNow } from '../world';
import { moveSession } from './moves';
import { announce, clearBreakout, startBreakout, updateBreakout } from './valkey';

export interface RoundRow {
  id: string;
  session_id: string;
  tables: number;
  started_ms: number;
  deadline_ms: number;
  length_seconds: number;
  warning_seconds: number;
  warned: boolean;
  ended_ms: number | null;
}

const ROUND_COLUMNS = 'id, session_id, tables, started_ms, deadline_ms, length_seconds, warning_seconds, warned, ended_ms';

export async function activeRound(sessionId: string): Promise<RoundRow | null> {
  return one<RoundRow>(pool, `SELECT ${ROUND_COLUMNS} FROM breakout_rounds WHERE session_id = $1 AND ended_ms IS NULL`, [sessionId]);
}

export async function latestRound(sessionId: string): Promise<RoundRow | null> {
  return one<RoundRow>(pool, `SELECT ${ROUND_COLUMNS} FROM breakout_rounds WHERE session_id = $1 ORDER BY created_seq DESC LIMIT 1`, [sessionId]);
}

/** Starts a round for a live session: the learners, already in seat-id order, are dealt to the tables. */
export async function beginBreakouts(session: SessionRow, tables: number, learnerIds: string[]): Promise<void> {
  const nowMs = await worldNow(session.world_id);
  const dealt = dealToTables(learnerIds, tables);
  const roundId = newId('rnd');
  const lengthSeconds = config.breakoutSeconds;
  const deadlineMs = nowMs + lengthSeconds * 1000;
  const members: Record<string, string> = {};
  dealt.forEach((group, index) => group.forEach((learnerId) => (members[learnerId] = tableIdOf(index))));
  await tx(async (client) => {
    await moveSession(client, session.id, 'breakouts');
    await run(
      client,
      'INSERT INTO breakout_rounds (id, session_id, tables, started_ms, deadline_ms, length_seconds, warning_seconds) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [roundId, session.id, tables, nowMs, deadlineMs, lengthSeconds, config.breakoutWarningSeconds],
    );
    for (const [learnerId, tableId] of Object.entries(members)) {
      await run(client, 'INSERT INTO breakout_assignments (round_id, learner_id, table_id) VALUES ($1, $2, $3)', [roundId, learnerId, tableId]);
    }
  });
  await startBreakout(session.id, { roundId, deadlineMs, tables, lengthSeconds, members });
  await announce(session.id, 'breakouts-started');
}

/** Add 2 minutes: the deadline moves later by exactly the configured extension. */
export async function extendBreakouts(session: SessionRow): Promise<void> {
  const outcome = await tx<{ roundId: string } | { deadlineMs: number; lengthSeconds: number; warned: boolean } | null>(async (client) => {
    const round = await one<RoundRow>(client, `SELECT ${ROUND_COLUMNS} FROM breakout_rounds WHERE session_id = $1 AND ended_ms IS NULL FOR UPDATE`, [session.id]);
    if (!round) return null;
    const nowMs = await worldNow(session.world_id, client);
    if (isOver(round.deadline_ms, nowMs)) return { roundId: round.id };
    const deadlineMs = round.deadline_ms + config.breakoutExtendSeconds * 1000;
    const lengthSeconds = round.length_seconds + config.breakoutExtendSeconds;
    const warned = round.warned && isWarning(deadlineMs, nowMs, round.warning_seconds);
    await run(client, 'UPDATE breakout_rounds SET deadline_ms = $2, length_seconds = $3, warned = $4 WHERE id = $1', [round.id, deadlineMs, lengthSeconds, warned]);
    return { deadlineMs, lengthSeconds, warned };
  });
  if (outcome === null) throw new Refusal(409, BREAKOUTS_OVER);
  if ('roundId' in outcome) {
    await settleRound(outcome.roundId);
    throw new Refusal(409, BREAKOUTS_OVER);
  }
  await updateBreakout(session.id, { deadlineMs: outcome.deadlineMs, lengthSeconds: outcome.lengthSeconds, warning: outcome.warned });
  await announce(session.id, 'breakouts-extended');
}

/** Decides a round's due edge: the return at the deadline, else the warning once. */
export async function settleRound(roundId: string): Promise<void> {
  const outcome = await tx(async (client) => {
    const round = await one<RoundRow & { world_id: string }>(
      client,
      `SELECT r.id, r.session_id, r.tables, r.started_ms, r.deadline_ms, r.length_seconds, r.warning_seconds, r.warned, r.ended_ms, c.world_id
         FROM breakout_rounds r JOIN sessions s ON s.id = r.session_id JOIN classes c ON c.id = s.class_id
        WHERE r.id = $1 AND r.ended_ms IS NULL FOR UPDATE OF r`,
      [roundId],
    );
    if (!round) return null;
    const nowMs = await worldNow(round.world_id, client);
    if (isOver(round.deadline_ms, nowMs)) {
      await moveSession(client, round.session_id, 'return');
      await run(client, 'UPDATE breakout_rounds SET ended_ms = $2 WHERE id = $1', [round.id, nowMs]);
      return { sessionId: round.session_id, event: 'breakout-over' as const };
    }
    if (!round.warned && isWarning(round.deadline_ms, nowMs, round.warning_seconds)) {
      await run(client, 'UPDATE breakout_rounds SET warned = true WHERE id = $1', [round.id]);
      return { sessionId: round.session_id, event: 'breakout-warning' as const };
    }
    return null;
  });
  if (!outcome) return;
  if (outcome.event === 'breakout-over') await clearBreakout(outcome.sessionId);
  else await updateBreakout(outcome.sessionId, { warning: true });
  await announce(outcome.sessionId, outcome.event);
}

/** The running round, or the answer that breakouts are over (settling the return first when it is due). */
export async function runningRound(session: SessionRow): Promise<RoundRow> {
  const round = await activeRound(session.id);
  if (round && !isOver(round.deadline_ms, await worldNow(session.world_id))) return round;
  if (round) await settleRound(round.id);
  throw new Refusal(409, BREAKOUTS_OVER);
}

export async function dueRounds(worldId: string | undefined): Promise<string[]> {
  const found = await rows<{ id: string }>(
    pool,
    `SELECT r.id FROM breakout_rounds r JOIN sessions s ON s.id = r.session_id JOIN classes c ON c.id = s.class_id
      WHERE r.ended_ms IS NULL AND s.state = 'breakouts' AND ($1::text IS NULL OR c.world_id = $1)`,
    [worldId ?? null],
  );
  return found.map((row) => row.id);
}
