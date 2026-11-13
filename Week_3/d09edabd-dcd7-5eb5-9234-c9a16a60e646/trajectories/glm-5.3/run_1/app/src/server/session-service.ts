import { pool } from './db.js';
import { config } from './config.js';
import type { ChainFigures, Session } from '../shared/types.js';
import { asNodeLike } from './room-service.js';
import { fireable, chainOrder } from '../shared/chain.js';
import { sendDebrief } from './debrief.js';
import { publish, roomChannel, sessionChannel } from './valkey.js';

export interface SessionRow {
  id: string;
  room_id: string;
  kind: 'remote' | 'walk_in';
  state: 'scheduled' | 'lobby' | 'running' | 'ended' | 'cancelled';
  host_user_id: string;
  starts_at: Date;
  started_at: Date | null;
  ended_at: Date | null;
  outcome: 'escaped' | 'timed_out' | 'stopped' | null;
  duration_seconds: number;
  last_hint_at: Date | null;
}

/** The one server-owned clock. */
export function sessionJson(
  row: SessionRow,
  solves: Session['solves'],
  stats: ChainFigures,
  testers: Session['testers'],
  hintsUsed = 0
): Session {
  const now = Date.now();
  const duration = row.duration_seconds;
  let remaining = duration;
  if (row.state === 'running' && row.started_at) {
    remaining = Math.max(0, duration - Math.floor((now - new Date(row.started_at).getTime()) / 1000));
  } else if (row.state === 'ended' && row.started_at) {
    const end = row.ended_at ? new Date(row.ended_at).getTime() : now;
    remaining = Math.max(0, duration - Math.floor((end - new Date(row.started_at).getTime()) / 1000));
  }
  let cooldown = config.hintCooldown;
  if (row.last_hint_at && row.state === 'running') {
    cooldown = Math.max(0, config.hintCooldown - Math.floor((now - new Date(row.last_hint_at).getTime()) / 1000));
  }
  return {
    id: row.id,
    roomId: row.room_id,
    roomName: '',
    kind: row.kind,
    state: row.state,
    hostUserId: row.host_user_id,
    startsAt: new Date(row.starts_at).toISOString(),
    startedAt: row.started_at ? new Date(row.started_at).toISOString() : null,
    endedAt: row.ended_at ? new Date(row.ended_at).toISOString() : null,
    outcome: row.outcome,
    durationSeconds: duration,
    remainingSeconds: remaining,
    hintCooldownSeconds: cooldown,
    hintsUsed: hintsUsed,
    serverTime: new Date(now).toISOString(),
    solves,
    stats,
    testers,
  };
}

export async function loadSession(sessionId: string): Promise<{ row: SessionRow; roomName: string } | null> {
  const r = await pool.query(
    `SELECT s.*, r.name AS room_name, r.workspace_id FROM sessions s JOIN rooms r ON r.id = s.room_id WHERE s.id = $1`,
    [sessionId]
  );
  if (!r.rows.length) return null;
  return { row: r.rows[0] as unknown as SessionRow, roomName: r.rows[0].room_name as string };
}

export async function sessionTesters(sessionId: string): Promise<Session['testers']> {
  const r = await pool.query(
    `SELECT i.id, i.email, i.display_name, i.joined, i.email_status
     FROM invites i
     WHERE i.session_id = $1 AND i.revoked = false ORDER BY i.created_at`,
    [sessionId]
  );
  return r.rows.map((row) => ({
    inviteId: row.id,
    email: row.email,
    displayName: row.display_name ?? '',
    joined: !!row.joined,
    emailStatus: row.email_status as 'sent' | 'queued' | 'failed',
  }));
}

export async function sessionSolves(sessionId: string): Promise<Session['solves']> {
  const r = await pool.query(
    `SELECT node_id, title, elapsed_seconds, solved_by FROM session_solves WHERE session_id = $1 ORDER BY id`,
    [sessionId]
  );
  return r.rows.map((row) => ({
    nodeId: row.node_id,
    title: row.title,
    elapsedSeconds: Number(row.elapsed_seconds),
    solvedBy: row.solved_by ?? null,
  }));
}

export async function fullSession(sessionId: string): Promise<{ session: Session; row: SessionRow } | null> {
  const loaded = await loadSession(sessionId);
  if (!loaded) return null;
  const [stats, solves, testers, hints] = await Promise.all([
    import('./room-service.js').then((m) => m.roomStats(loaded.row.room_id)),
    sessionSolves(sessionId),
    sessionTesters(sessionId),
    pool.query(`SELECT count(*) AS n FROM hints WHERE session_id = $1`, [sessionId]),
  ]);
  const session = sessionJson(loaded.row, solves, stats, testers, Number(hints.rows[0].n));
  session.roomName = loaded.roomName;
  return { session, row: loaded.row };
}

/** Ends the session at the deadline. Any read at or after the deadline shows ended. */
export async function settleSession(sessionId: string): Promise<void> {
  const loaded = await loadSession(sessionId);
  if (!loaded || loaded.row.state !== 'running' || !loaded.row.started_at) return;
  const elapsed = (Date.now() - new Date(loaded.row.started_at).getTime()) / 1000;
  if (elapsed < loaded.row.duration_seconds) return;
  await pool.query(
    `UPDATE sessions SET state = 'ended', ended_at = now(), outcome = 'timed_out' WHERE id = $1`,
    [sessionId]
  );
  await sendDebrief(sessionId);
  const full = await fullSession(sessionId);
  if (full) {
    await publish(sessionChannel(sessionId), JSON.stringify({ event: 'session', data: { session: stripEmails(full.session) } }));
    await publish(roomChannel(full.row.room_id), JSON.stringify({ event: 'session', data: { session: full.session } }));
  }
}

function stripEmails(s: Session): Session {
  return { ...s, testers: s.testers.map((t) => ({ ...t, email: '' })) };
}

/**
 * After any solve (and at session start) every lock/cue whose prerequisites are
 * all solved fires on its own, repeating until none qualify.
 */
export async function fireAutomatic(
  sessionId: string,
  startedAt: Date
): Promise<Array<{ nodeId: string; title: string; elapsedSeconds: number; solvedBy: null }>> {
  const fired: Array<{ nodeId: string; title: string; elapsedSeconds: number; solvedBy: null }> = [];
  const roomIdRow = await pool.query(`SELECT room_id FROM sessions WHERE id = $1`, [sessionId]);
  const roomId = roomIdRow.rows[0].room_id as string;
  for (let pass = 0; pass < 50; pass++) {
    const solvedRows = await pool.query(`SELECT DISTINCT node_id FROM session_solves WHERE session_id = $1`, [sessionId]);
    const solved = new Set(solvedRows.rows.map((r) => r.node_id as string));
    const all = await pool.query(`SELECT * FROM trigger_nodes WHERE room_id = $1`, [roomId]);
    const list = asNodeLike(all.rows);
    const ready = fireable(list, solved);
    if (!ready.length) break;
    const elapsed = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
    for (const n of ready) {
      await pool.query(
        `INSERT INTO session_solves (session_id, node_id, title, elapsed_seconds, solved_by)
         VALUES ($1,$2,$3,$4,NULL)`,
        [sessionId, n.id, n.title, elapsed]
      );
      fired.push({ nodeId: n.id, title: n.title, elapsedSeconds: elapsed, solvedBy: null });
    }
  }
  return fired;
}

export async function broadcastSolves(roomId: string, sessionId: string): Promise<void> {
  const solves = await sessionSolves(sessionId);
  const { roomStats } = await import('./room-service.js');
  const stats = await roomStats(roomId);
  for (const s of solves.slice(-8)) {
    const payload = JSON.stringify({ event: 'solve', data: { sessionId, ...s, stats } });
    await publish(roomChannel(roomId), payload);
    await publish(sessionChannel(sessionId), payload);
  }
}

export { chainOrder };
