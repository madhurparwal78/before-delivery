import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { isUniqueViolation } from '../db.js';
import { fail, notFound, validation } from '../errors.js';
import { publishPlaytest } from '../events.js';
import { empty, json, route, type Actor, type Ctx } from '../http.js';
import { mailer } from '../mail.js';
import { EMAIL, UUID } from '../validate.js';
import { findRoom, listNodes, type RoomRow } from '../domain/rooms.js';
import {
  assertLegal, buildDebrief, cooldownSeconds, debriefEmailStatus, findPlaytest, finishSession, logSolve, newInviteToken, publishSession, publishSolves,
  queueInvite, sessionView, settleExpired, startRunning, type PlaytestRow,
} from '../domain/playtests.js';
import { Input } from '../validate.js';
import { OCCUPYING, TRANSITIONS, isFinished, isRunning, type Action } from '../../shared/playtest.js';

const ROSTER_MAX = 6;
const AHEAD_MS = 30 * 24 * 3600 * 1000;
const PAST_MS = 5 * 60 * 1000;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

const controls = (actor: Actor, row: PlaytestRow): boolean => actor.role === 'owner' || actor.userId === row.host_user_id;

/** Loads a session of the actor's workspace, ending it first when its deadline has passed. */
async function loadSession(ctx: Ctx, lock = false): Promise<PlaytestRow> {
  await settleExpired(ctx.params.playtestId, ctx.now);
  return findPlaytest(ctx.db, ctx.actor.workspaceId, ctx.params.playtestId!, lock);
}

/** Room, then session, both locked: the order every state change takes. */
async function loadForChange(ctx: Ctx): Promise<{ row: PlaytestRow; room: RoomRow }> {
  await settleExpired(ctx.params.playtestId, ctx.now);
  const peek = await findPlaytest(ctx.db, ctx.actor.workspaceId, ctx.params.playtestId!);
  const room = await findRoom(ctx.db, ctx.actor.workspaceId, peek.room_id, true);
  return { row: await findPlaytest(ctx.db, ctx.actor.workspaceId, peek.id, true), room };
}

async function assertRoomFree(ctx: Ctx, roomId: string, exceptId?: string): Promise<void> {
  const busy = await ctx.db.query(`SELECT 1 FROM playtests WHERE room_id = $1 AND state = ANY($3) AND ($2::uuid IS NULL OR id <> $2)`, [roomId, exceptId ?? null, OCCUPYING]);
  if (busy.rows.length > 0) throw fail(409, 'room_busy');
}

const afterChange = (ctx: Ctx, row: PlaytestRow, logged?: Parameters<typeof publishSolves>[1]): void => {
  ctx.after.push(async () => {
    if (logged?.length) await publishSolves(row, logged);
    else await publishSession(row.room_id, row.id);
  });
};

function transitionRoute(action: Action, needsLive: boolean): void {
  route('POST', `/api/playtests/:playtestId/${action}`, {
    auth: 'member',
    transaction: true,
    load: loadForChange,
    role: (ctx, { row }) => controls(ctx.actor, row),
    conflict: async (ctx, { row }) => {
      assertLegal(row, action);
      if (action === 'open') await assertRoomFree(ctx, row.room_id, row.id);
    },
    needs: needsLive ? ['valkey'] : [],
    run: async (ctx, { row }) => {
      const now = new Date();
      if (action === 'start') {
        const started = await startRunning(ctx.db, row, now);
        afterChange(ctx, started.row, started.logged);
        return json(200, { session: await sessionView(ctx.db, started.row, now) });
      }
      let next: PlaytestRow;
      try {
        next =
          action === 'end'
            ? await finishSession(ctx.db, row, 'stopped', now)
            : (await ctx.db.query<PlaytestRow>(`UPDATE playtests SET state = $2 WHERE id = $1 RETURNING *`, [row.id, TRANSITIONS[action].to])).rows[0]!;
      } catch (error) {
        if (isUniqueViolation(error)) throw fail(409, 'room_busy');
        throw error;
      }
      if (action === 'end') ctx.after.push(() => mailer.kick());
      afterChange(ctx, next);
      return json(200, { session: await sessionView(ctx.db, next, now) });
    },
  });
}

function readStartsAt(input: Input, now: Date): Date | undefined {
  const raw = input.body.startsAt;
  const moment = typeof raw === 'string' && ISO.test(raw) ? new Date(raw) : null;
  if (!moment || Number.isNaN(moment.getTime())) {
    input.fields.add('startsAt', 'not a valid time');
    return undefined;
  }
  if (moment.getTime() < now.getTime() - PAST_MS || moment.getTime() > now.getTime() + AHEAD_MS) {
    input.fields.add('startsAt', 'must be between 5 minutes ago and 30 days ahead');
    return undefined;
  }
  return moment;
}

export function playtestRoutes(): void {
  route('POST', '/api/playtests', {
    auth: 'member',
    transaction: true,
    load: async (ctx) => {
      const roomId = (ctx.body as { roomId?: unknown } | undefined)?.roomId;
      if (typeof roomId !== 'string' || !UUID.test(roomId)) throw notFound();
      return findRoom(ctx.db, ctx.actor.workspaceId, roomId, true);
    },
    role: (ctx) => ctx.actor.role === 'owner',
    validate: (ctx) => {
      const input = ctx.input();
      const startsAt = readStartsAt(input, new Date());
      input.fields.check();
      return startsAt!;
    },
    run: async (ctx, room, startsAt) => {
      const inserted = await ctx.db.query<PlaytestRow>(
        `INSERT INTO playtests (id, room_id, workspace_id, kind, state, host_user_id, starts_at, duration_seconds)
         VALUES ($1,$2,$3,'remote','scheduled',$4,$5,$6) RETURNING *`,
        [randomUUID(), room.id, ctx.actor.workspaceId, ctx.actor.userId, startsAt, config.playtestDurationSeconds],
      );
      const row = inserted.rows[0]!;
      afterChange(ctx, row);
      return json(201, { session: await sessionView(ctx.db, row) });
    },
  });

  route('POST', '/api/rooms/:roomId/walk-in', {
    auth: 'member',
    transaction: true,
    load: async (ctx) => {
      await settleExpired(ctx.params.roomId, ctx.now);
      return findRoom(ctx.db, ctx.actor.workspaceId, ctx.params.roomId!, true);
    },
    conflict: (ctx, room) => assertRoomFree(ctx, room.id),
    needs: ['valkey'],
    run: async (ctx, room) => {
      const now = new Date();
      let row: PlaytestRow;
      try {
        const inserted = await ctx.db.query<PlaytestRow>(
          `INSERT INTO playtests (id, room_id, workspace_id, kind, state, host_user_id, starts_at, duration_seconds)
           VALUES ($1,$2,$3,'walk_in','lobby',$4,$5,$6) RETURNING *`,
          [randomUUID(), room.id, ctx.actor.workspaceId, ctx.actor.userId, now, config.playtestDurationSeconds],
        );
        row = inserted.rows[0]!;
      } catch (error) {
        if (isUniqueViolation(error)) throw fail(409, 'room_busy');
        throw error;
      }
      const started = await startRunning(ctx.db, row, now);
      afterChange(ctx, started.row, started.logged);
      return json(201, { session: await sessionView(ctx.db, started.row, now) });
    },
  });

  transitionRoute('open', true);
  transitionRoute('start', true);
  transitionRoute('end', false);
  transitionRoute('cancel', false);

  route('GET', '/api/playtests/:playtestId', {
    auth: 'member',
    load: (ctx) => loadSession(ctx),
    run: async (ctx, row) => json(200, { session: await sessionView(ctx.db, row, ctx.now) }),
  });

  route('GET', '/api/rooms/:roomId/playtests', {
    auth: 'member',
    load: async (ctx) => {
      await settleExpired(ctx.params.roomId, ctx.now);
      return findRoom(ctx.db, ctx.actor.workspaceId, ctx.params.roomId!);
    },
    run: async (ctx, room) => {
      const found = await ctx.db.query<PlaytestRow>(`SELECT * FROM playtests WHERE room_id = $1 ORDER BY created_at DESC, id`, [room.id]);
      return json(200, { sessions: await Promise.all(found.rows.map((row) => sessionView(ctx.db, row, ctx.now))) });
    },
  });

  route('POST', '/api/playtests/:playtestId/invites', {
    auth: 'member',
    transaction: true,
    load: (ctx) => loadSession(ctx, true),
    role: (ctx, row) => controls(ctx.actor, row),
    conflict: async (ctx, row) => {
      if (isFinished(row.state)) throw fail(409, 'session_closed');
      const count = await ctx.db.query<{ n: string }>(`SELECT count(*) AS n FROM invites WHERE playtest_id = $1 AND revoked_at IS NULL`, [row.id]);
      if (Number(count.rows[0]!.n) >= ROSTER_MAX) throw fail(409, 'roster_full');
    },
    validate: async (ctx, row) => {
      const input = ctx.input();
      const email = input.text('email', 3, 200, { trim: true });
      if (email !== undefined && !EMAIL.test(email)) input.fields.add('email', 'must be an email address');
      if (email !== undefined) {
        const twin = await ctx.db.query(`SELECT 1 FROM invites WHERE playtest_id = $1 AND lower(email) = lower($2) AND revoked_at IS NULL`, [row.id, email]);
        if (twin.rows.length > 0) input.fields.add('email', 'already invited');
      }
      input.fields.check();
      return email!;
    },
    run: async (ctx, row, email) => {
      const invite = { id: randomUUID(), email, token: newInviteToken() };
      try {
        await ctx.db.query(`INSERT INTO invites (id, playtest_id, email, token) VALUES ($1,$2,$3,$4)`, [invite.id, row.id, invite.email, invite.token]);
      } catch (error) {
        if (isUniqueViolation(error)) throw validation({ email: 'already invited' });
        throw error;
      }
      await queueInvite(ctx.db, row, invite);
      ctx.after.push(() => mailer.kick());
      afterChange(ctx, row);
      return json(201, { invite: { id: invite.id, email, emailStatus: 'queued', joinUrl: `${config.publicOrigin}/play/${invite.token}` } });
    },
  });

  const inviteOf = async (ctx: Ctx, row: PlaytestRow): Promise<{ id: string; email: string; token: string }> => {
    const found = await ctx.db.query<{ id: string; email: string; token: string }>(
      `SELECT id, email, token FROM invites WHERE id = $1 AND playtest_id = $2 AND revoked_at IS NULL`, [ctx.params.inviteId, row.id],
    );
    if (!found.rows[0]) throw notFound();
    return found.rows[0];
  };

  route('DELETE', '/api/playtests/:playtestId/invites/:inviteId', {
    auth: 'member',
    transaction: true,
    load: async (ctx) => {
      const row = await loadSession(ctx, true);
      return { row, invite: await inviteOf(ctx, row) };
    },
    role: (ctx, { row }) => controls(ctx.actor, row),
    run: async (ctx, { row, invite }) => {
      await ctx.db.query(`UPDATE invites SET revoked_at = clock_timestamp() WHERE id = $1`, [invite.id]);
      afterChange(ctx, row);
      return empty(204);
    },
  });

  route('POST', '/api/playtests/:playtestId/invites/:inviteId/resend', {
    auth: 'member',
    transaction: true,
    load: async (ctx) => {
      const row = await loadSession(ctx, true);
      return { row, invite: await inviteOf(ctx, row) };
    },
    role: (ctx, { row }) => controls(ctx.actor, row),
    conflict: async (_ctx, { row }) => {
      if (isFinished(row.state)) throw fail(409, 'session_closed');
    },
    run: async (ctx, { row, invite }) => {
      await queueInvite(ctx.db, row, invite);
      ctx.after.push(() => mailer.kick());
      afterChange(ctx, row);
      return json(202, { invite: { id: invite.id, email: invite.email, emailStatus: 'queued', joinUrl: `${config.publicOrigin}/play/${invite.token}` } });
    },
  });

  route('POST', '/api/playtests/:playtestId/hints', {
    auth: 'member',
    transaction: true,
    load: (ctx) => loadSession(ctx, true),
    role: (ctx, row) => controls(ctx.actor, row),
    conflict: async (_ctx, row) => {
      if (!isRunning(row.state)) throw fail(409, 'session_not_running');
      const left = cooldownSeconds(row, new Date());
      if (left > 0) throw fail(429, 'hint_cooldown', { retryAfterSeconds: left });
    },
    validate: (ctx) => {
      const input = ctx.input();
      const text = input.text('text', 1, 280);
      input.fields.check();
      return text!;
    },
    needs: ['valkey'],
    run: async (ctx, row, text) => {
      const now = new Date();
      const updated = await ctx.db.query<PlaytestRow>(`UPDATE playtests SET hints_used = hints_used + 1, last_hint_at = $2 WHERE id = $1 RETURNING *`, [row.id, now]);
      await ctx.db.query(`INSERT INTO hints (playtest_id, text, sent_at) VALUES ($1,$2,$3)`, [row.id, text, now]);
      const next = updated.rows[0]!;
      ctx.after.push(async () => {
        await publishPlaytest(row.room_id, row.id, 'hint', { sessionId: row.id, text, sentAt: now.toISOString(), hintsUsed: next.hints_used, hintCooldownSeconds: cooldownSeconds(next, now) });
        await publishSession(row.room_id, row.id);
      });
      return json(201, { hint: { text, sentAt: now.toISOString() }, hintCooldownSeconds: cooldownSeconds(next, now) });
    },
  });

  route('POST', '/api/playtests/:playtestId/solves', {
    auth: 'member',
    transaction: true,
    load: (ctx) => loadSession(ctx, true),
    role: (ctx, row) => controls(ctx.actor, row),
    replay: async (ctx, row) => {
      const nodeId = (ctx.body as { nodeId?: unknown } | undefined)?.nodeId;
      if (typeof nodeId !== 'string' || !UUID.test(nodeId)) return undefined;
      const done = await ctx.db.query(`SELECT 1 FROM solves WHERE playtest_id = $1 AND node_id = $2`, [row.id, nodeId]);
      return done.rows.length > 0 ? json(200, { session: await sessionView(ctx.db, row), alreadySolved: true }) : undefined;
    },
    conflict: (ctx, row) => solveConflict(ctx, row),
    validate: (ctx, row) => readSolve(ctx, row),
    needs: ['valkey'],
    run: async (ctx, row, node) => {
      const now = new Date();
      const solved = await logSolve(ctx.db, row, node, ctx.actor.displayName, now);
      if (solved.row.state === 'ended') ctx.after.push(() => mailer.kick());
      ctx.after.push(() => publishSolves(solved.row, solved.logged));
      return json(200, { session: await sessionView(ctx.db, solved.row, now), alreadySolved: false });
    },
  });

  route('GET', '/api/playtests/:playtestId/debrief', {
    auth: 'member',
    load: (ctx) => loadSession(ctx),
    conflict: async (_ctx, row) => {
      if (row.state !== 'ended') throw fail(409, 'session_not_ended');
    },
    run: async (ctx, row) => json(200, { ...(await buildDebrief(ctx.db, row)), emailStatus: await debriefEmailStatus(ctx.db, row.id) }),
  });
}

/** The state checks a solve must pass (the session runs, the solver has joined, prerequisites are done). */
export async function solveConflict(ctx: Ctx, row: PlaytestRow, joinedInvite?: { joined: boolean }): Promise<void> {
  if (!isRunning(row.state)) throw fail(409, 'session_not_running');
  if (joinedInvite && !joinedInvite.joined) throw fail(409, 'not_joined');
  const nodeId = (ctx.body as { nodeId?: unknown } | undefined)?.nodeId;
  if (typeof nodeId !== 'string' || !UUID.test(nodeId)) return;
  const nodes = await listNodes(ctx.db, row.room_id);
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return;
  const solved = new Set((await ctx.db.query<{ node_id: string }>(`SELECT node_id FROM solves WHERE playtest_id = $1`, [row.id])).rows.map((r) => r.node_id));
  if (!node.prerequisites.every((id) => solved.has(id))) throw fail(409, 'prerequisites_unsolved');
}

/** Validates a solve request: a known node a player can solve, with the right answer when one is set. */
export async function readSolve(ctx: Ctx, row: PlaytestRow) {
  const input = ctx.input();
  const nodeId = input.text('nodeId', 1, 100);
  input.fields.check();
  const node = (await listNodes(ctx.db, row.room_id)).find((n) => n.id === nodeId);
  if (!node) throw validation({ nodeId: 'unknown node' });
  if (node.kind === 'lock' || node.kind === 'cue') throw validation({ nodeId: 'fires on its own' });
  if (node.answer !== null) {
    const given = typeof input.body.answer === 'string' ? input.body.answer.trim().toLowerCase() : '';
    if (given !== node.answer.trim().toLowerCase()) throw validation({ answer: 'incorrect' });
  }
  return node;
}

