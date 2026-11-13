import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { config } from '../config.js';
import { errors } from '../errors.js';
import { chainOrder } from '../../shared/chain.js';
import type {
  Debrief,
  EmailStatus,
  Outcome,
  PlaytestSession,
  RosterEntry,
  SessionKind,
  SessionState,
  SolveEntry,
} from '../../shared/types.js';
import { rowOne, rows } from '../services/db.js';
import { chainFigures, roomNodes, toNode } from '../repo/rooms.js';
import type { NodeRow } from '../repo/rooms.js';

export interface SessionRow {
  id: string;
  room_id: string;
  kind: SessionKind;
  state: SessionState;
  host_user_id: string;
  starts_at: Date;
  started_at: Date | null;
  ended_at: Date | null;
  outcome: Outcome | null;
  duration_seconds: number;
}

export const sessionColumns = `id, room_id, kind, state, host_user_id, starts_at, started_at,
  ended_at, outcome, duration_seconds`;

/** The one table of legal playtest state moves. */
const legalMoves: Record<string, SessionState> = {
  open: 'lobby',
  start: 'running',
  end: 'ended',
  cancel: 'cancelled',
};

const allowedFrom: Record<keyof typeof legalMoves | string, SessionState[]> = {
  open: ['scheduled'],
  start: ['lobby'],
  end: ['running'],
  cancel: ['scheduled', 'lobby'],
};

export type Move = 'open' | 'start' | 'end' | 'cancel';

export function nextState(row: SessionRow, move: Move): SessionState {
  if (!allowedFrom[move].includes(row.state)) throw errors.invalidTransition(row.state);
  return legalMoves[move];
}

/** The one place remaining time is worked out. */
export function remainingSeconds(row: SessionRow, now: number): number {
  if (row.started_at === null) return row.duration_seconds;
  const reference = row.ended_at === null ? now : row.ended_at.getTime();
  const elapsed = Math.floor((reference - row.started_at.getTime()) / 1000);
  return Math.max(0, row.duration_seconds - elapsed);
}

export function elapsedSeconds(row: SessionRow, now: number): number {
  if (row.started_at === null) return 0;
  const reference = row.ended_at === null ? now : row.ended_at.getTime();
  return Math.max(0, Math.floor((reference - row.started_at.getTime()) / 1000));
}

export function cooldownSeconds(lastHintAt: Date | null, now: number): number {
  if (lastHintAt === null) return 0;
  const since = Math.floor((now - lastHintAt.getTime()) / 1000);
  return Math.max(0, config.hintCooldownSeconds - since);
}

export function deadlinePassed(row: SessionRow, now: number): boolean {
  return (
    row.state === 'running' &&
    row.started_at !== null &&
    now >= row.started_at.getTime() + row.duration_seconds * 1000
  );
}

export async function loadSession(client: PoolClient, id: string): Promise<SessionRow | null> {
  return rowOne<SessionRow>(client, `select ${sessionColumns} from playtests where id = $1`, [id]);
}

export async function sessionSolves(client: PoolClient, id: string): Promise<SolveEntry[]> {
  const list = await rows<{
    node_id: string;
    title: string;
    elapsed_seconds: number;
    solved_by: string | null;
  }>(
    client,
    `select node_id, title, elapsed_seconds, solved_by from solves
       where session_id = $1 order by elapsed_seconds, created_seq`,
    [id],
  );
  return list.map((row) => ({
    nodeId: row.node_id,
    title: row.title,
    elapsedSeconds: row.elapsed_seconds,
    solvedBy: row.solved_by,
  }));
}

export async function roster(client: PoolClient, sessionId: string): Promise<RosterEntry[]> {
  const list = await rows<{
    id: string;
    email: string;
    display_name: string | null;
    joined: boolean;
    status: EmailStatus | null;
  }>(
    client,
    `select i.id, i.email, i.display_name, i.joined,
       (select m.status from mail_messages m where m.invite_id = i.id
          order by m.created_at desc limit 1) as status
       from invites i where i.session_id = $1 and i.revoked = false order by i.created_seq`,
    [sessionId],
  );
  return list.map((row) => ({
    inviteId: row.id,
    email: row.email,
    displayName: row.display_name,
    joined: row.joined,
    emailStatus: row.status ?? 'queued',
  }));
}

export async function lastHintAt(client: PoolClient, sessionId: string): Promise<Date | null> {
  const row = await rowOne<{ sent_at: Date }>(
    client,
    `select sent_at from hints where session_id = $1 order by sent_at desc limit 1`,
    [sessionId],
  );
  return row ? row.sent_at : null;
}

export async function hintsUsed(client: PoolClient, sessionId: string): Promise<number> {
  const row = await rowOne<{ count: string }>(
    client,
    `select count(*)::text as count from hints where session_id = $1`,
    [sessionId],
  );
  return row ? Number(row.count) : 0;
}

export async function serialiseSession(
  client: PoolClient,
  row: SessionRow,
): Promise<PlaytestSession> {
  const now = Date.now();
  const room = await rowOne<{ name: string }>(client, `select name from rooms where id = $1`, [
    row.room_id,
  ]);
  return {
    id: row.id,
    roomId: row.room_id,
    roomName: room ? room.name : '',
    kind: row.kind,
    state: row.state,
    hostUserId: row.host_user_id,
    startsAt: row.starts_at.toISOString(),
    startedAt: row.started_at ? row.started_at.toISOString() : null,
    endedAt: row.ended_at ? row.ended_at.toISOString() : null,
    outcome: row.outcome,
    durationSeconds: row.duration_seconds,
    remainingSeconds: remainingSeconds(row, now),
    hintCooldownSeconds: cooldownSeconds(await lastHintAt(client, row.id), now),
    hintsUsed: await hintsUsed(client, row.id),
    serverTime: new Date(now).toISOString(),
    solves: await sessionSolves(client, row.id),
    stats: await chainFigures(client, row.room_id),
    testers: await roster(client, row.id),
  };
}

export interface LoggedSolve {
  nodeId: string;
  title: string;
  elapsedSeconds: number;
  solvedBy: string | null;
}

async function logSolve(
  client: PoolClient,
  sessionId: string,
  node: NodeRow,
  elapsed: number,
  solvedBy: string | null,
): Promise<boolean> {
  const inserted = await rows<{ id: string }>(
    client,
    `insert into solves (id, session_id, node_id, title, elapsed_seconds, solved_by)
     values ($1,$2,$3,$4,$5,$6) on conflict (session_id, node_id) do nothing returning id`,
    [randomUUID(), sessionId, node.id, node.title, elapsed, solvedBy],
  );
  return inserted.length > 0;
}

async function solvedIds(client: PoolClient, sessionId: string): Promise<Set<string>> {
  const list = await rows<{ node_id: string }>(
    client,
    `select node_id from solves where session_id = $1`,
    [sessionId],
  );
  return new Set(list.map((row) => row.node_id));
}

/** Every lock and cue whose prerequisites are all solved fires on its own. */
export async function fireAutomatics(
  client: PoolClient,
  session: SessionRow,
  elapsed: number,
): Promise<LoggedSolve[]> {
  const nodes = await roomNodes(client, session.room_id);
  const ordered = chainOrder(nodes.map(toNode));
  const solved = await solvedIds(client, session.id);
  const fired: LoggedSolve[] = [];
  let again = true;
  while (again) {
    again = false;
    for (const candidate of ordered) {
      if (candidate.kind !== 'lock' && candidate.kind !== 'cue') continue;
      if (solved.has(candidate.id)) continue;
      if (!candidate.prerequisites.every((id) => solved.has(id))) continue;
      const row = nodes.find((node) => node.id === candidate.id);
      if (!row) continue;
      if (await logSolve(client, session.id, row, elapsed, null)) {
        fired.push({ nodeId: row.id, title: row.title, elapsedSeconds: elapsed, solvedBy: null });
      }
      solved.add(candidate.id);
      again = true;
    }
  }
  return fired;
}

export interface SolveOutcome {
  alreadySolved: boolean;
  logged: LoggedSolve[];
  ended: boolean;
}

export async function solve(
  client: PoolClient,
  session: SessionRow,
  nodeId: string,
  answer: string | null,
  solvedBy: string | null,
): Promise<SolveOutcome> {
  if (session.state !== 'running') throw errors.sessionNotRunning();
  const node = await rowOne<NodeRow>(
    client,
    `select id, room_id, title, kind, placement_id, answer, prerequisites, version
       from trigger_nodes where id = $1 and room_id = $2`,
    [nodeId, session.room_id],
  );
  if (!node) throw errors.field('nodeId', 'unknown node');
  const solved = await solvedIds(client, session.id);
  if (solved.has(node.id)) return { alreadySolved: true, logged: [], ended: false };
  if (!node.prerequisites.every((id) => solved.has(id))) throw errors.prerequisitesUnsolved();
  if (node.kind === 'lock' || node.kind === 'cue') {
    throw errors.field('nodeId', 'fires on its own');
  }
  if (node.answer !== null) {
    const given = (answer ?? '').trim().toLowerCase();
    if (given !== node.answer.trim().toLowerCase()) throw errors.field('answer', 'incorrect');
  }
  const elapsed = elapsedSeconds(session, Date.now());
  const logged: LoggedSolve[] = [];
  if (await logSolve(client, session.id, node, elapsed, solvedBy)) {
    logged.push({
      nodeId: node.id,
      title: node.title,
      elapsedSeconds: elapsed,
      solvedBy,
    });
  }
  logged.push(...(await fireAutomatics(client, session, elapsed)));
  const ended = node.kind === 'exit';
  return { alreadySolved: false, logged, ended };
}

export async function markEnded(
  client: PoolClient,
  sessionId: string,
  outcome: Outcome,
  endedAt: Date,
): Promise<SessionRow | null> {
  return rowOne<SessionRow>(
    client,
    `update playtests set state = 'ended', outcome = $2, ended_at = $3
       where id = $1 and state = 'running' returning ${sessionColumns}`,
    [sessionId, outcome, endedAt],
  );
}

export async function buildDebrief(
  client: PoolClient,
  session: SessionRow,
  emailStatus: EmailStatus,
): Promise<Debrief> {
  const nodes = chainOrder((await roomNodes(client, session.room_id)).map(toNode));
  const solves = await sessionSolves(client, session.id);
  const solvedAt = new Map(solves.map((entry) => [entry.nodeId, entry.elapsedSeconds]));
  const puzzles = nodes
    .filter((node) => node.kind === 'puzzle' || node.kind === 'exit')
    .map((node) => {
      const at = solvedAt.get(node.id) ?? null;
      const availableAt =
        node.prerequisites.length === 0
          ? 0
          : Math.max(...node.prerequisites.map((id) => solvedAt.get(id) ?? 0));
      return {
        title: node.title,
        solvedAtSeconds: at,
        waitSeconds: at === null ? null : Math.max(0, at - availableAt),
      };
    });
  let chokePoint: { title: string; waitSeconds: number } | null = null;
  for (const puzzle of puzzles) {
    if (puzzle.waitSeconds === null) continue;
    if (chokePoint === null || puzzle.waitSeconds > chokePoint.waitSeconds) {
      chokePoint = { title: puzzle.title, waitSeconds: puzzle.waitSeconds };
    }
  }
  return {
    outcome: session.outcome,
    elapsedSeconds: elapsedSeconds(session, Date.now()),
    stats: await chainFigures(client, session.room_id),
    puzzles,
    hintsUsed: await hintsUsed(client, session.id),
    chokePoint,
    emailStatus,
  };
}

export function canControl(session: SessionRow, member: { id: string; role: string }): boolean {
  return member.role === 'owner' || session.host_user_id === member.id;
}
