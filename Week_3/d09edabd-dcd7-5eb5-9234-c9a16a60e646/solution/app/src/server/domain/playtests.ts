import { randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { db, type Queryable } from '../db.js';
import { fail, notFound } from '../errors.js';
import { hub, publishPlaytest, roomChannel } from '../events.js';
import { mailer } from '../mail.js';
import type { Debrief, EmailStatus, NodeKind, PlayNode, PlayView, Session, SessionState, SessionTester, TriggerNode } from '../../shared/types.js';
import type { Outcome } from '../../shared/format.js';
import { OCCUPYING, TRANSITIONS, canMove, isRunning, wholeSeconds, type Action } from '../../shared/playtest.js';
import { chainStats } from './chain.js';
import { debriefMessage, inviteMessage } from './messages.js';
import { listNodes, propCount, reloadRoom, roomStats, toPlacement, type PlacementRow, type RoomRow } from './rooms.js';

export interface PlaytestRow {
  id: string;
  room_id: string;
  workspace_id: string;
  kind: 'remote' | 'walk_in';
  state: SessionState;
  host_user_id: string;
  starts_at: Date;
  started_at: Date | null;
  ended_at: Date | null;
  outcome: Outcome | null;
  duration_seconds: number;
  hints_used: number;
  last_hint_at: Date | null;
}

export function assertLegal(row: PlaytestRow, action: Action): void {
  if (!canMove(row.state, action)) throw fail(409, 'invalid_transition', { state: row.state });
}

/** The server's remaining time: the full duration before the start, then frozen at the end. */
function remainingSeconds(row: PlaytestRow, now: Date): number {
  if (!row.started_at) return row.duration_seconds;
  const until = row.ended_at ?? now;
  return Math.max(0, row.duration_seconds - wholeSeconds(row.started_at, until));
}

/** The hint cooldown left: the configured cooldown minus the whole seconds since the last hint. */
export function cooldownSeconds(row: PlaytestRow, now: Date): number {
  return row.last_hint_at ? Math.max(0, config.hintCooldownSeconds - wholeSeconds(row.last_hint_at, now)) : 0;
}

const deadlineOf = (row: PlaytestRow): Date => new Date(row.started_at!.getTime() + row.duration_seconds * 1000);

const elapsedOf = (row: PlaytestRow, now: Date): number => wholeSeconds(row.started_at!, row.ended_at ?? now);

export async function findPlaytest(db: Queryable, workspaceId: string, id: string, lock = false): Promise<PlaytestRow> {
  const found = await db.query<PlaytestRow>(`SELECT * FROM playtests WHERE id = $1 AND workspace_id = $2${lock ? ' FOR UPDATE' : ''}`, [id, workspaceId]);
  const row = found.rows[0];
  if (!row) throw notFound();
  return row;
}

interface SolveRow {
  node_id: string;
  elapsed_seconds: number;
  solved_by: string | null;
}

async function solvesOf(db: Queryable, sessionId: string): Promise<SolveRow[]> {
  return (await db.query<SolveRow>(`SELECT node_id, elapsed_seconds, solved_by FROM solves WHERE playtest_id = $1 ORDER BY id`, [sessionId])).rows;
}

async function emailStatuses(db: Queryable, sessionId: string): Promise<Map<string, EmailStatus>> {
  const found = await db.query<{ invite_id: string; status: EmailStatus }>(
    `SELECT DISTINCT ON (invite_id) invite_id, status FROM outbox WHERE playtest_id = $1 AND kind = 'invite' ORDER BY invite_id, id DESC`,
    [sessionId],
  );
  return new Map(found.rows.map((row) => [row.invite_id, row.status]));
}

export async function sessionView(db: Queryable, row: PlaytestRow, now = new Date()): Promise<Session> {
  const room = (await db.query<{ name: string }>(`SELECT name FROM rooms WHERE id = $1`, [row.room_id])).rows[0]!;
  const nodes = await listNodes(db, row.room_id);
  const solves = await solvesOf(db, row.id);
  const titles = new Map(nodes.map((n) => [n.id, n.title]));
  const solved = new Set(solves.map((s) => s.node_id));
  const statuses = await emailStatuses(db, row.id);
  const invites = await db.query<{ id: string; email: string; display_name: string | null; joined: boolean }>(
    `SELECT id, email, display_name, joined FROM invites WHERE playtest_id = $1 AND revoked_at IS NULL ORDER BY created_at, id`,
    [row.id],
  );
  const testers: SessionTester[] = invites.rows.map((i) => ({ inviteId: i.id, email: i.email, displayName: i.display_name, joined: i.joined, emailStatus: statuses.get(i.id) ?? 'queued' }));
  return {
    id: row.id, roomId: row.room_id, roomName: room.name, kind: row.kind, state: row.state, hostUserId: row.host_user_id,
    startsAt: row.starts_at.toISOString(), startedAt: row.started_at?.toISOString() ?? null, endedAt: row.ended_at?.toISOString() ?? null,
    outcome: row.outcome, durationSeconds: row.duration_seconds, remainingSeconds: remainingSeconds(row, now), hintCooldownSeconds: cooldownSeconds(row, now),
    hintsUsed: row.hints_used, serverTime: now.toISOString(),
    solves: solves.filter((s) => titles.has(s.node_id)).map((s) => ({ nodeId: s.node_id, title: titles.get(s.node_id)!, elapsedSeconds: s.elapsed_seconds, solvedBy: s.solved_by })),
    stats: chainStats(nodes, solved, await propCount(db, row.room_id)), testers,
  };
}

export async function activeSession(db: Queryable, roomId: string, now: Date): Promise<Session | null> {
  const found = await db.query<PlaytestRow>(`SELECT * FROM playtests WHERE room_id = $1 AND state = ANY($2)`, [roomId, OCCUPYING]);
  return found.rows[0] ? sessionView(db, found.rows[0], now) : null;
}

export async function latestRunSessionId(db: Queryable, roomId: string): Promise<string | null> {
  const found = await db.query<{ id: string }>(`SELECT id FROM playtests WHERE room_id = $1 AND started_at IS NOT NULL ORDER BY started_at DESC, created_at DESC LIMIT 1`, [roomId]);
  return found.rows[0]?.id ?? null;
}

/** The solved node ids of a session, and the nodes that fired because of one solve. */
interface SolveOutcome {
  logged: { nodeId: string; title: string; elapsedSeconds: number; solvedBy: string | null }[];
  ended: boolean;
}

/** Locks and cues whose prerequisites are all solved fire on their own, repeatedly, at the same moment. */
async function fireAutomatic(client: Queryable, row: PlaytestRow, nodes: TriggerNode[], solved: Set<string>, elapsed: number): Promise<SolveOutcome['logged']> {
  const logged: SolveOutcome['logged'] = [];
  const onItsOwn = (kind: NodeKind): boolean => kind === 'lock' || kind === 'cue';
  for (;;) {
    const next = nodes.find((n) => onItsOwn(n.kind) && !solved.has(n.id) && n.prerequisites.every((id) => solved.has(id)));
    if (!next) return logged;
    await client.query(`INSERT INTO solves (playtest_id, node_id, elapsed_seconds, solved_by) VALUES ($1,$2,$3,NULL) ON CONFLICT DO NOTHING`, [row.id, next.id, elapsed]);
    solved.add(next.id);
    logged.push({ nodeId: next.id, title: next.title, elapsedSeconds: elapsed, solvedBy: null });
  }
}

/** Logs a player's solve (and everything it sets off); the exit ends the session as escaped. */
export async function logSolve(client: Queryable, row: PlaytestRow, node: TriggerNode, solvedBy: string, now: Date): Promise<{ logged: SolveOutcome['logged']; row: PlaytestRow }> {
  const nodes = await listNodes(client, row.room_id);
  const solved = new Set((await solvesOf(client, row.id)).map((s) => s.node_id));
  const elapsed = elapsedOf(row, now);
  await client.query(`INSERT INTO solves (playtest_id, node_id, elapsed_seconds, solved_by) VALUES ($1,$2,$3,$4)`, [row.id, node.id, elapsed, solvedBy]);
  solved.add(node.id);
  const logged = [{ nodeId: node.id, title: node.title, elapsedSeconds: elapsed, solvedBy }, ...(await fireAutomatic(client, row, nodes, solved, elapsed))];
  const finished = node.kind === 'exit' ? await finishSession(client, row, 'escaped', now) : row;
  return { logged, row: finished };
}

/** Moves a session to running: the clock starts and every lock or cue without prerequisites fires. */
export async function startRunning(client: Queryable, row: PlaytestRow, now: Date): Promise<{ row: PlaytestRow; logged: SolveOutcome['logged'] }> {
  const updated = await client.query<PlaytestRow>(`UPDATE playtests SET state = $3, started_at = $2::timestamptz, starts_at = CASE WHEN kind = 'walk_in' THEN $2::timestamptz ELSE starts_at END WHERE id = $1 RETURNING *`, [row.id, now, TRANSITIONS.start.to]);
  const started = updated.rows[0]!;
  const logged = await fireAutomatic(client, started, await listNodes(client, row.room_id), new Set(), 0);
  return { row: started, logged };
}

/** Ends a running session and queues the debrief email for every recipient. */
export async function finishSession(client: Queryable, row: PlaytestRow, outcome: Outcome, endedAt: Date): Promise<PlaytestRow> {
  const updated = await client.query<PlaytestRow>(`UPDATE playtests SET state = $4, outcome = $2, ended_at = $3 WHERE id = $1 AND state = ANY($5) RETURNING *`, [row.id, outcome, endedAt, TRANSITIONS.end.to, TRANSITIONS.end.from]);
  const ended = updated.rows[0];
  if (!ended) return row;
  const debrief = await buildDebrief(client, ended);
  const room = (await client.query<{ name: string }>(`SELECT name FROM rooms WHERE id = $1`, [ended.room_id])).rows[0]!;
  const message = debriefMessage(room.name, debrief);
  const recipients = await client.query<{ email: string }>(
    `SELECT email FROM invites WHERE playtest_id = $1 AND revoked_at IS NULL
     UNION SELECT email FROM users WHERE id = $2
     UNION SELECT email FROM users WHERE workspace_id = $3 AND role = 'owner'`,
    [ended.id, ended.host_user_id, ended.workspace_id],
  );
  const seen = new Set<string>();
  for (const { email } of recipients.rows) {
    if (seen.has(email.toLowerCase())) continue;
    seen.add(email.toLowerCase());
    await client.query(`INSERT INTO outbox (kind, playtest_id, to_email, subject, body) VALUES ('debrief',$1,$2,$3,$4)`, [ended.id, email, message.subject, message.body]);
  }
  return ended;
}

export async function buildDebrief(client: Queryable, row: PlaytestRow): Promise<Omit<Debrief, 'emailStatus'>> {
  const nodes = await listNodes(client, row.room_id);
  const solves = await solvesOf(client, row.id);
  const at = new Map(solves.map((s) => [s.node_id, s.elapsed_seconds]));
  let chokePoint: Debrief['chokePoint'] = null;
  const puzzles = nodes
    .filter((n) => n.kind === 'puzzle' || n.kind === 'exit')
    .map((n) => {
      const solvedAt = at.get(n.id) ?? null;
      const wait = solvedAt === null ? null : solvedAt - Math.max(0, ...n.prerequisites.map((id) => at.get(id) ?? 0));
      if (wait !== null && (chokePoint === null || wait > chokePoint.waitSeconds)) chokePoint = { title: n.title, waitSeconds: wait };
      return { title: n.title, solvedAtSeconds: solvedAt, waitSeconds: wait };
    });
  return {
    outcome: row.outcome!, elapsedSeconds: elapsedOf(row, new Date()),
    stats: chainStats(nodes, new Set(at.keys()), await propCount(client, row.room_id)), puzzles, hintsUsed: row.hints_used, chokePoint,
  };
}

export async function debriefEmailStatus(client: Queryable, sessionId: string): Promise<EmailStatus> {
  const found = await client.query<{ status: EmailStatus }>(`SELECT DISTINCT status FROM outbox WHERE playtest_id = $1 AND kind = 'debrief'`, [sessionId]);
  const states = new Set(found.rows.map((r) => r.status));
  return states.has('failed') ? 'failed' : states.has('queued') ? 'queued' : 'sent';
}

export async function queueInvite(client: Queryable, row: PlaytestRow, invite: { id: string; email: string; token: string }): Promise<void> {
  const room = (await client.query<{ name: string }>(`SELECT name FROM rooms WHERE id = $1`, [row.room_id])).rows[0]!;
  const message = inviteMessage(room.name, row.starts_at, invite.token);
  await client.query(`INSERT INTO outbox (kind, playtest_id, invite_id, to_email, subject, body) VALUES ('invite',$1,$2,$3,$4,$5)`, [row.id, invite.id, invite.email, message.subject, message.body]);
}

export const newInviteToken = (): string => randomBytes(24).toString('base64url');

/** Tells every editor and tester of a session what it looks like now. */
export async function publishSession(roomId: string, sessionId: string): Promise<void> {
  const row = (await db.query<PlaytestRow>(`SELECT * FROM playtests WHERE id = $1`, [sessionId])).rows[0];
  if (!row) return;
  await publishPlaytest(roomId, sessionId, 'session', { session: await sessionView(db, row) });
  await hub.publish(roomChannel(roomId), 'room', { room: await reloadRoom(db, roomId) });
}

export async function publishSolves(row: PlaytestRow, logged: SolveOutcome['logged']): Promise<void> {
  const stats = await roomStats(db, row.room_id);
  for (const solve of logged) await publishPlaytest(row.room_id, row.id, 'solve', { sessionId: row.id, ...solve, stats });
  await publishSession(row.room_id, row.id);
}

/** Ends every running session past its deadline (outcome timed_out). Safe to call from any instance at any time. */
export async function settleExpired(scope: string | undefined, now: Date): Promise<void> {
  const due = await db.query<{ id: string; room_id: string }>(
    `SELECT id, room_id FROM playtests WHERE state = ANY($3) AND started_at + make_interval(secs => duration_seconds) <= $1 AND ($2::text IS NULL OR id::text = $2 OR room_id::text = $2)`,
    [now, scope ?? null, TRANSITIONS.end.from],
  );
  for (const { id, room_id } of due.rows) {
    const ended = await db.transaction(async (client) => {
      const row = (await client.query<PlaytestRow>(`SELECT * FROM playtests WHERE id = $1 FOR UPDATE`, [id])).rows[0]!;
      if (!isRunning(row.state)) return false;
      return (await finishSession(client, row, 'timed_out', deadlineOf(row))).state === 'ended';
    });
    if (ended) {
      mailer.kick();
      await publishSession(room_id, id);
    }
  }
}

/* ---------- the tester's view ---------- */

export interface InviteContext {
  invite: { id: string; email: string; display_name: string | null; joined: boolean };
  row: PlaytestRow;
  room: RoomRow;
}

export async function playView(client: Queryable, ctx: InviteContext, now = new Date()): Promise<PlayView> {
  const { row, room, invite } = ctx;
  const nodes = await listNodes(client, room.id);
  const solved = new Set((await solvesOf(client, row.id)).map((s) => s.node_id));
  const placements = await client.query<PlacementRow>(`SELECT * FROM placements WHERE room_id = $1 AND deleted_at IS NULL ORDER BY seq`, [room.id]);
  const everyone = await client.query<{ display_name: string | null; joined: boolean }>(
    `SELECT display_name, joined FROM invites WHERE playtest_id = $1 AND revoked_at IS NULL ORDER BY created_at, id`, [row.id],
  );
  const hints = await client.query<{ text: string; sent_at: Date }>(`SELECT text, sent_at FROM hints WHERE playtest_id = $1 ORDER BY id`, [row.id]);
  const playNodes: PlayNode[] = nodes.map((n) => ({
    id: n.id, title: n.title, kind: n.kind, prerequisites: n.prerequisites, placementId: n.placementId, needsAnswer: n.answer !== null,
    solved: solved.has(n.id),
    available: isRunning(row.state) && (n.kind === 'puzzle' || n.kind === 'exit') && !solved.has(n.id) && n.prerequisites.every((id) => solved.has(id)),
  }));
  return {
    session: playSession(row, now),
    room: { name: room.name, widthMm: room.width_mm, depthMm: room.depth_mm, heightMm: room.height_mm, placements: placements.rows.map(toPlacement) },
    nodes: playNodes,
    testers: everyone.rows.map((t) => ({ displayName: t.display_name, joined: t.joined })),
    me: { displayName: invite.display_name, joined: invite.joined },
    hints: hints.rows.map((h) => ({ text: h.text, sentAt: h.sent_at.toISOString() })),
  };
}

/** What a tester may see of a session: the clock figures and the state, nothing else. */
export function playSessionFrom(s: PlayView['session']): PlayView['session'] {
  return {
    state: s.state, startsAt: s.startsAt, remainingSeconds: s.remainingSeconds, hintCooldownSeconds: s.hintCooldownSeconds,
    durationSeconds: s.durationSeconds, serverTime: s.serverTime, outcome: s.outcome,
  };
}

function playSession(row: PlaytestRow, now: Date): PlayView['session'] {
  return playSessionFrom({
    state: row.state, startsAt: row.starts_at.toISOString(), remainingSeconds: remainingSeconds(row, now), hintCooldownSeconds: cooldownSeconds(row, now),
    durationSeconds: row.duration_seconds, serverTime: now.toISOString(), outcome: row.outcome,
  });
}
