import type { PoolClient } from 'pg';
import { copy, figures, mmss, mss } from '../../shared/copy.js';
import type { ChainFigures, Outcome, SessionState } from '../../shared/types.js';
import { query, rows, tx } from '../services/db.js';
import { publish, roomChannel, sessionChannel } from '../services/live.js';
import { sendMail } from '../services/mail.js';
import {
  buildDebrief,
  cooldownSeconds,
  lastHintAt,
  markEnded,
  remainingSeconds,
  serialiseSession,
  sessionColumns,
} from './playtest.js';
import type { LoggedSolve, SessionRow } from './playtest.js';

export async function testerSessionView(
  client: PoolClient,
  row: SessionRow,
): Promise<{
  state: SessionState;
  startsAt: string;
  remainingSeconds: number;
  hintCooldownSeconds: number;
  durationSeconds: number;
  serverTime: string;
  outcome: Outcome | null;
}> {
  const now = Date.now();
  return {
    state: row.state,
    startsAt: row.starts_at.toISOString(),
    remainingSeconds: remainingSeconds(row, now),
    hintCooldownSeconds: cooldownSeconds(await lastHintAt(client, row.id), now),
    durationSeconds: row.duration_seconds,
    serverTime: new Date(now).toISOString(),
    outcome: row.outcome,
  };
}

export async function broadcastSession(client: PoolClient, row: SessionRow): Promise<void> {
  const full = await serialiseSession(client, row);
  publish(roomChannel(row.room_id), { event: 'session', data: { session: full } });
  publish(sessionChannel(row.id), {
    event: 'session',
    data: { session: await testerSessionView(client, row) },
  });
}

export function broadcastSolves(
  row: SessionRow,
  logged: LoggedSolve[],
  stats: ChainFigures,
): void {
  for (const entry of logged) {
    const data = {
      sessionId: row.id,
      nodeId: entry.nodeId,
      title: entry.title,
      elapsedSeconds: entry.elapsedSeconds,
      solvedBy: entry.solvedBy,
      stats,
    };
    publish(roomChannel(row.room_id), { event: 'solve', data });
    publish(sessionChannel(row.id), { event: 'solve', data });
  }
}

async function debriefRecipients(sessionId: string, hostUserId: string): Promise<string[]> {
  const invited = await query<{ email: string }>(
    `select email from invites where session_id = $1 and revoked = false`,
    [sessionId],
  );
  const people = await query<{ email: string }>(
    `select u.email from users u where u.id = $1
       union
     select owner.email from users host
       join users owner on owner.workspace_id = host.workspace_id and owner.role = 'owner'
       where host.id = $1`,
    [hostUserId],
  );
  const all = [...invited.map((row) => row.email), ...people.map((row) => row.email)];
  return [...new Set(all.map((email) => email.trim()))];
}

function outcomeLine(outcome: Outcome | null, elapsedSeconds: number): string {
  if (outcome === 'escaped') return copy.outcomeEscaped(elapsedSeconds);
  if (outcome === 'timed_out') return copy.outcomeTimedOut;
  return copy.outcomeStopped(elapsedSeconds);
}

export function debriefBody(
  outcome: Outcome | null,
  elapsedSeconds: number,
  stats: ChainFigures,
  puzzles: { title: string; solvedAtSeconds: number | null }[],
  hints: number,
  chokePoint: { title: string; waitSeconds: number } | null,
): string {
  const lines = [
    outcomeLine(outcome, elapsedSeconds),
    figures.solved(stats),
    figures.run(stats),
    figures.props(stats),
    ...puzzles.map((puzzle) =>
      puzzle.solvedAtSeconds === null
        ? `${puzzle.title} — not solved`
        : `${puzzle.title} — ${mmss(puzzle.solvedAtSeconds)}`,
    ),
    `Hints used: ${hints}`,
    chokePoint === null
      ? 'Choke point: none'
      : `Choke point: ${chokePoint.title} (${mss(chokePoint.waitSeconds)} waiting)`,
  ];
  return `${lines.join('\n')}\n`;
}

async function sendDebrief(row: SessionRow): Promise<void> {
  const already = await query<{ id: string }>(
    `select id from mail_messages where session_id = $1 and kind = 'debrief' limit 1`,
    [row.id],
  );
  if (already.length > 0) return;
  const debrief = await tx((client) => buildDebrief(client, row, 'queued'));
  const roomName = await query<{ name: string }>(`select name from rooms where id = $1`, [
    row.room_id,
  ]);
  const subject = `Playtest debrief: ${roomName[0] ? roomName[0].name : ''}`;
  const body = debriefBody(
    debrief.outcome,
    debrief.elapsedSeconds,
    debrief.stats,
    debrief.puzzles,
    debrief.hintsUsed,
    debrief.chokePoint,
  );
  const recipients = await debriefRecipients(row.id, row.host_user_id);
  for (const recipient of recipients) {
    await sendMail({ kind: 'debrief', recipient, subject, body, sessionId: row.id });
  }
  await tx((client) => broadcastSession(client, row));
}

/** Ends a running session, broadcasts it and starts its debrief emails. */
export async function endSession(sessionId: string, outcome: Outcome): Promise<SessionRow | null> {
  const ended = await tx(async (client) => {
    const row = await markEnded(client, sessionId, outcome, new Date());
    if (!row) return null;
    await broadcastSession(client, row);
    return row;
  });
  if (ended) void sendDebrief(ended).catch(() => undefined);
  return ended;
}

async function dueSessions(roomId: string | null): Promise<SessionRow[]> {
  return tx((client) =>
    rows<SessionRow>(
      client,
      `select ${sessionColumns} from playtests
         where state = 'running' and started_at is not null
           and now() >= started_at + (duration_seconds * interval '1 second')
           ${roomId === null ? '' : 'and room_id = $1'}`,
      roomId === null ? [] : [roomId],
    ),
  );
}

/** At the deadline the server ends the session with outcome `timed_out`. */
export async function endDueSession(roomId: string): Promise<void> {
  for (const row of await dueSessions(roomId)) {
    await endSession(row.id, 'timed_out');
  }
}

export async function endAllDue(): Promise<void> {
  for (const row of await dueSessions(null)) {
    await endSession(row.id, 'timed_out');
  }
}
