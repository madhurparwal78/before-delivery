import { randomBytes, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { config } from '../config.js';
import { utcStamp } from '../../shared/copy.js';
import { errors } from '../errors.js';
import type { Route } from '../http.js';
import { requireMember, requireOwner } from '../domain/session.js';
import type { Member } from '../domain/session.js';
import { FieldCollector, asRecord, email as emailField, text } from '../domain/validate.js';
import {
  broadcastSession,
  broadcastSolves,
  endDueSession,
  endSession,
} from '../domain/endings.js';
import {
  buildDebrief,
  canControl,
  cooldownSeconds,
  fireAutomatics,
  lastHintAt,
  loadSession,
  nextState,
  serialiseSession,
  sessionColumns,
  solve,
} from '../domain/playtest.js';
import type { Move, SessionRow } from '../domain/playtest.js';
import { chainFigures, loadRoom } from '../repo/rooms.js';
import { isUniqueViolation, one, query, rowOne, rows, tx } from '../services/db.js';
import { liveUp, publish, roomChannel, sessionChannel } from '../services/live.js';
import { debriefStatus, resendMail, sendMail } from '../services/mail.js';
import { memberRoom, publishRoom, reply } from './support.js';

async function sessionOf(member: Member, sessionId: string): Promise<SessionRow> {
  const row = await one<SessionRow>(
    `select p.id, p.room_id, p.kind, p.state, p.host_user_id, p.starts_at, p.started_at,
       p.ended_at, p.outcome, p.duration_seconds
       from playtests p join rooms r on r.id = p.room_id
       where p.id = $1 and r.workspace_id = $2`,
    [sessionId, member.workspaceId],
  );
  if (!row) throw errors.notFound();
  return row;
}

function requireControl(session: SessionRow, member: Member): void {
  if (!canControl(session, member)) throw errors.forbidden();
}

function requireLive(): void {
  if (!liveUp()) throw errors.liveUnavailable();
}

async function activeSession(client: PoolClient, roomId: string): Promise<SessionRow | null> {
  return rowOne<SessionRow>(
    client,
    `select ${sessionColumns} from playtests where room_id = $1 and state in ('lobby','running')
       limit 1`,
    [roomId],
  );
}

async function moveSession(session: SessionRow, move: Move): Promise<unknown> {
  const state = nextState(session, move);
  if (move === 'open' || move === 'start') requireLive();
  if (move === 'end') {
    const ended = await endSession(session.id, 'stopped');
    if (!ended) throw errors.invalidTransition(session.state);
    return tx((client) => serialiseSession(client, ended));
  }
  return tx(async (client) => {
    if (move === 'open' || move === 'start') {
      const active = await activeSession(client, session.room_id);
      if (active && active.id !== session.id) throw errors.roomBusy();
    }
    let row: SessionRow | null;
    try {
      row = await rowOne<SessionRow>(
        client,
        `update playtests set state = $2,
           started_at = case when $2 = 'running' then now() else started_at end
         where id = $1 and state = $3 returning ${sessionColumns}`,
        [session.id, state, session.state],
      );
    } catch (error) {
      if (isUniqueViolation(error)) throw errors.roomBusy();
      throw error;
    }
    if (!row) throw errors.invalidTransition(session.state);
    if (state === 'running') {
      const fired = await fireAutomatics(client, row, 0);
      await broadcastSession(client, row);
      broadcastSolves(row, fired, await chainFigures(client, row.room_id));
      publishRoom(row.room_id, 'room', { room: await loadRoom(client, row.room_id) });
    } else {
      await broadcastSession(client, row);
    }
    return serialiseSession(client, row);
  });
}

function inviteJoinUrl(token: string): string {
  return `${config.publicOrigin}/play/${token}`;
}

export const playtestRoutes: Route[] = [
  {
    method: 'POST',
    pattern: '/api/playtests',
    body: 'json',
    async handler(ctx) {
      const member = await requireMember(ctx);
      const body = asRecord(ctx.body);
      const roomId = typeof body.roomId === 'string' ? body.roomId : '';
      const room = await memberRoom(member, roomId);
      requireOwner(member);
      const raw = typeof body.startsAt === 'string' ? body.startsAt : '';
      const when = new Date(raw);
      if (raw === '' || Number.isNaN(when.getTime())) {
        throw errors.field('startsAt', 'not a valid time');
      }
      const now = Date.now();
      if (when.getTime() < now - 5 * 60_000 || when.getTime() > now + 30 * 86_400_000) {
        throw errors.field('startsAt', 'must be between 5 minutes ago and 30 days ahead');
      }
      const id = randomUUID();
      await query(
        `insert into playtests (id, room_id, kind, state, host_user_id, starts_at,
           duration_seconds)
         values ($1,$2,'remote','scheduled',$3,$4,$5)`,
        [id, room.id, member.id, when.toISOString(), config.playtestDurationSeconds],
      );
      const session = await tx(async (client) => {
        const row = await loadSession(client, id);
        if (!row) throw errors.notFound();
        await broadcastSession(client, row);
        return serialiseSession(client, row);
      });
      return reply(201, { session });
    },
  },
  {
    method: 'POST',
    pattern: '/api/rooms/:roomId/walk-in',
    body: 'none',
    async handler(ctx) {
      const member = await requireMember(ctx);
      const room = await memberRoom(member, ctx.params.roomId);
      await endDueSession(room.id);
      requireLive();
      const id = randomUUID();
      const session = await tx(async (client) => {
        const active = await activeSession(client, room.id);
        if (active) throw errors.roomBusy();
        try {
          await client.query(
            `insert into playtests (id, room_id, kind, state, host_user_id, starts_at,
               started_at, duration_seconds)
             values ($1,$2,'walk_in','running',$3,now(),now(),$4)`,
            [id, room.id, member.id, config.playtestDurationSeconds],
          );
        } catch (error) {
          if (isUniqueViolation(error)) throw errors.roomBusy();
          throw error;
        }
        const row = await loadSession(client, id);
        if (!row) throw errors.notFound();
        const fired = await fireAutomatics(client, row, 0);
        await broadcastSession(client, row);
        broadcastSolves(row, fired, await chainFigures(client, row.room_id));
        return serialiseSession(client, row);
      });
      return reply(201, { session });
    },
  },
  {
    method: 'GET',
    pattern: '/api/playtests/:id',
    body: 'none',
    async handler(ctx) {
      const member = await requireMember(ctx);
      const session = await sessionOf(member, ctx.params.id);
      await endDueSession(session.room_id);
      return tx(async (client) => {
        const row = await loadSession(client, session.id);
        if (!row) throw errors.notFound();
        return { session: await serialiseSession(client, row) };
      });
    },
  },
  {
    method: 'GET',
    pattern: '/api/rooms/:roomId/playtests',
    body: 'none',
    async handler(ctx) {
      const member = await requireMember(ctx);
      const room = await memberRoom(member, ctx.params.roomId);
      await endDueSession(room.id);
      return tx(async (client) => {
        const list = await rows<SessionRow>(
          client,
          `select ${sessionColumns} from playtests where room_id = $1 order by created_at desc`,
          [room.id],
        );
        const sessions = [];
        for (const row of list) sessions.push(await serialiseSession(client, row));
        return { sessions };
      });
    },
  },
  {
    method: 'POST',
    pattern: '/api/playtests/:id/open',
    body: 'none',
    async handler(ctx) {
      const member = await requireMember(ctx);
      const session = await sessionOf(member, ctx.params.id);
      requireControl(session, member);
      return { session: await moveSession(session, 'open') };
    },
  },
  {
    method: 'POST',
    pattern: '/api/playtests/:id/start',
    body: 'none',
    async handler(ctx) {
      const member = await requireMember(ctx);
      const session = await sessionOf(member, ctx.params.id);
      requireControl(session, member);
      return { session: await moveSession(session, 'start') };
    },
  },
  {
    method: 'POST',
    pattern: '/api/playtests/:id/end',
    body: 'none',
    async handler(ctx) {
      const member = await requireMember(ctx);
      const session = await sessionOf(member, ctx.params.id);
      requireControl(session, member);
      return { session: await moveSession(session, 'end') };
    },
  },
  {
    method: 'POST',
    pattern: '/api/playtests/:id/cancel',
    body: 'none',
    async handler(ctx) {
      const member = await requireMember(ctx);
      const session = await sessionOf(member, ctx.params.id);
      requireControl(session, member);
      return { session: await moveSession(session, 'cancel') };
    },
  },
  {
    method: 'POST',
    pattern: '/api/playtests/:id/invites',
    body: 'json',
    async handler(ctx) {
      const member = await requireMember(ctx);
      const session = await sessionOf(member, ctx.params.id);
      requireControl(session, member);
      const body = asRecord(ctx.body);
      if (!['scheduled', 'lobby', 'running'].includes(session.state)) {
        throw errors.sessionClosed();
      }
      const existing = await query<{ email: string }>(
        `select email from invites where session_id = $1 and revoked = false`,
        [session.id],
      );
      if (existing.length >= 6) throw errors.rosterFull();
      const collector = new FieldCollector();
      const address = emailField(body, 'email', collector);
      if (
        address !== null &&
        existing.some((row) => row.email.toLowerCase() === address.toLowerCase())
      ) {
        collector.add('email', 'already invited');
      }
      collector.throwIfAny();
      const inviteId = randomUUID();
      const token = randomBytes(24).toString('base64url');
      await query(
        `insert into invites (id, session_id, email, token) values ($1,$2,$3,$4)`,
        [inviteId, session.id, address, token],
      );
      const room = await one<{ name: string }>(`select name from rooms where id = $1`, [
        session.room_id,
      ]);
      const joinUrl = inviteJoinUrl(token);
      const status = await sendMail({
        kind: 'invite',
        recipient: address as string,
        subject: `Playtest invite: ${room ? room.name : ''}`,
        body:
          `Starts ${utcStamp(session.starts_at.toISOString())} UTC\n` +
          `${joinUrl}\n`,
        inviteId,
        sessionId: session.id,
      });
      await tx(async (client) => {
        const row = await loadSession(client, session.id);
        if (row) await broadcastSession(client, row);
      });
      return reply(201, {
        invite: { id: inviteId, email: address, emailStatus: status, joinUrl },
      });
    },
  },
  {
    method: 'DELETE',
    pattern: '/api/playtests/:id/invites/:inviteId',
    body: 'none',
    async handler(ctx) {
      const member = await requireMember(ctx);
      const session = await sessionOf(member, ctx.params.id);
      requireControl(session, member);
      const invite = await one<{ id: string }>(
        `select id from invites where id = $1 and session_id = $2`,
        [ctx.params.inviteId, session.id],
      );
      if (!invite) throw errors.notFound();
      await query(`update invites set revoked = true where id = $1`, [invite.id]);
      await tx(async (client) => {
        const row = await loadSession(client, session.id);
        if (row) await broadcastSession(client, row);
      });
      return undefined;
    },
  },
  {
    method: 'POST',
    pattern: '/api/playtests/:id/invites/:inviteId/resend',
    body: 'none',
    async handler(ctx) {
      const member = await requireMember(ctx);
      const session = await sessionOf(member, ctx.params.id);
      requireControl(session, member);
      const invite = await one<{ id: string; email: string; token: string }>(
        `select id, email, token from invites
           where id = $1 and session_id = $2 and revoked = false`,
        [ctx.params.inviteId, session.id],
      );
      if (!invite) throw errors.notFound();
      const status = await resendMail(invite.id);
      await tx(async (client) => {
        const row = await loadSession(client, session.id);
        if (row) await broadcastSession(client, row);
      });
      return reply(202, {
        invite: {
          id: invite.id,
          email: invite.email,
          emailStatus: status,
          joinUrl: inviteJoinUrl(invite.token),
        },
      });
    },
  },
  {
    method: 'POST',
    pattern: '/api/playtests/:id/hints',
    body: 'json',
    async handler(ctx) {
      const member = await requireMember(ctx);
      const session = await sessionOf(member, ctx.params.id);
      requireControl(session, member);
      await endDueSession(session.room_id);
      const body = asRecord(ctx.body);
      const fresh = await tx((client) => loadSession(client, session.id));
      if (!fresh || fresh.state !== 'running') throw errors.sessionNotRunning();
      requireLive();
      const cooldown = await tx(async (client) =>
        cooldownSeconds(await lastHintAt(client, session.id), Date.now()),
      );
      if (cooldown > 0) throw errors.hintCooldown(cooldown);
      const collector = new FieldCollector();
      const hint = text(body, 'text', 1, 280, collector);
      collector.throwIfAny();
      const sentAt = new Date();
      await query(`insert into hints (id, session_id, text, sent_at) values ($1,$2,$3,$4)`, [
        randomUUID(),
        session.id,
        hint,
        sentAt,
      ]);
      const used = await one<{ count: string }>(
        `select count(*)::text as count from hints where session_id = $1`,
        [session.id],
      );
      const data = {
        sessionId: session.id,
        text: hint,
        sentAt: sentAt.toISOString(),
        hintsUsed: used ? Number(used.count) : 1,
        hintCooldownSeconds: config.hintCooldownSeconds,
      };
      publish(sessionChannel(session.id), { event: 'hint', data });
      publish(roomChannel(session.room_id), { event: 'hint', data });
      await tx(async (client) => {
        const row = await loadSession(client, session.id);
        if (row) await broadcastSession(client, row);
      });
      return reply(201, {
        hint: { text: hint, sentAt: sentAt.toISOString() },
        hintCooldownSeconds: config.hintCooldownSeconds,
      });
    },
  },
  {
    method: 'POST',
    pattern: '/api/playtests/:id/solves',
    body: 'json',
    async handler(ctx) {
      const member = await requireMember(ctx);
      const session = await sessionOf(member, ctx.params.id);
      requireControl(session, member);
      await endDueSession(session.room_id);
      const body = asRecord(ctx.body);
      requireLive();
      const nodeId = typeof body.nodeId === 'string' ? body.nodeId : '';
      const answer = typeof body.answer === 'string' ? body.answer : null;
      const outcome = await tx(async (client) => {
        const row = await loadSession(client, session.id);
        if (!row) throw errors.notFound();
        const result = await solve(client, row, nodeId, answer, member.displayName);
        const stats = await chainFigures(client, row.room_id);
        broadcastSolves(row, result.logged, stats);
        await broadcastSession(client, row);
        return { result, row };
      });
      if (outcome.result.ended) {
        const ended = await endSession(session.id, 'escaped');
        if (ended) {
          return {
            session: await tx((client) => serialiseSession(client, ended)),
            alreadySolved: outcome.result.alreadySolved,
          };
        }
      }
      return tx(async (client) => {
        const row = await loadSession(client, session.id);
        if (!row) throw errors.notFound();
        return {
          session: await serialiseSession(client, row),
          alreadySolved: outcome.result.alreadySolved,
        };
      });
    },
  },
  {
    method: 'GET',
    pattern: '/api/playtests/:id/debrief',
    body: 'none',
    async handler(ctx) {
      const member = await requireMember(ctx);
      const session = await sessionOf(member, ctx.params.id);
      await endDueSession(session.room_id);
      const row = await tx((client) => loadSession(client, session.id));
      if (!row || row.state !== 'ended') throw errors.sessionNotEnded();
      const status = await debriefStatus(row.id);
      return tx((client) => buildDebrief(client, row, status));
    },
  },
];
