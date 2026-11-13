import type { PoolClient } from 'pg';
import { errors } from '../errors.js';
import type { Route } from '../http.js';
import { asRecord } from '../domain/validate.js';
import { broadcastSession, broadcastSolves, endDueSession, endSession, testerSessionView } from '../domain/endings.js';
import { loadSession, sessionColumns, solve } from '../domain/playtest.js';
import type { SessionRow } from '../domain/playtest.js';
import { chainFigures, livePlacements, orderedNodes, toPlacement } from '../repo/rooms.js';
import { one, query, rowOne, rows, tx } from '../services/db.js';
import { liveUp, publish, roomChannel, sessionChannel } from '../services/live.js';
import type { TesterView } from '../../shared/types.js';

export interface InviteRow {
  id: string;
  session_id: string;
  email: string;
  display_name: string | null;
  joined: boolean;
}

export async function inviteByToken(token: string): Promise<InviteRow> {
  const row = await one<InviteRow>(
    `select id, session_id, email, display_name, joined from invites
       where token = $1 and revoked = false`,
    [token],
  );
  if (!row) throw errors.notFound();
  return row;
}

export async function openSessionOfInvite(invite: InviteRow): Promise<SessionRow> {
  const row = await one<SessionRow>(
    `select ${sessionColumns} from playtests where id = $1`,
    [invite.session_id],
  );
  if (!row) throw errors.notFound();
  await endDueSession(row.room_id);
  const fresh = await one<SessionRow>(`select ${sessionColumns} from playtests where id = $1`, [
    invite.session_id,
  ]);
  const current = fresh ?? row;
  if (current.state === 'ended' || current.state === 'cancelled') throw errors.inviteExpired();
  return current;
}

async function testerView(
  client: PoolClient,
  session: SessionRow,
  invite: InviteRow,
): Promise<TesterView> {
  const room = await rowOne<{ name: string; width_mm: number; depth_mm: number; height_mm: number }>(
    client,
    `select name, width_mm, depth_mm, height_mm from rooms where id = $1`,
    [session.room_id],
  );
  const placements = (await livePlacements(client, session.room_id)).map(toPlacement);
  const nodes = await orderedNodes(client, session.room_id);
  const solved = new Set(
    (
      await rows<{ node_id: string }>(
        client,
        `select node_id from solves where session_id = $1`,
        [session.id],
      )
    ).map((row) => row.node_id),
  );
  const testers = await rows<{ display_name: string | null; joined: boolean }>(
    client,
    `select display_name, joined from invites
       where session_id = $1 and revoked = false and joined = true order by created_seq`,
    [session.id],
  );
  const hints = await rows<{ text: string; sent_at: Date }>(
    client,
    `select text, sent_at from hints where session_id = $1 order by sent_at`,
    [session.id],
  );
  return {
    session: await testerSessionView(client, session),
    room: {
      name: room ? room.name : '',
      widthMm: room ? room.width_mm : 0,
      depthMm: room ? room.depth_mm : 0,
      heightMm: room ? room.height_mm : 0,
      placements,
    },
    nodes: nodes.map((node) => ({
      id: node.id,
      title: node.title,
      kind: node.kind,
      prerequisites: node.prerequisites,
      placementId: node.placementId,
      needsAnswer: node.answer !== null,
      solved: solved.has(node.id),
      available: !solved.has(node.id) && node.prerequisites.every((id) => solved.has(id)),
    })),
    testers: testers.map((row) => ({ displayName: row.display_name ?? '', joined: row.joined })),
    me: { displayName: invite.display_name, joined: invite.joined },
    hints: hints.map((row) => ({ text: row.text, sentAt: row.sent_at.toISOString() })),
  };
}

export const playRoutes: Route[] = [
  {
    method: 'GET',
    pattern: '/api/play/:token',
    body: 'none',
    async handler(ctx) {
      const invite = await inviteByToken(ctx.params.token);
      const session = await openSessionOfInvite(invite);
      return tx((client) => testerView(client, session, invite));
    },
  },
  {
    method: 'POST',
    pattern: '/api/play/:token/join',
    body: 'json',
    async handler(ctx) {
      const invite = await inviteByToken(ctx.params.token);
      const session = await openSessionOfInvite(invite);
      const body = asRecord(ctx.body);
      const raw = typeof body.displayName === 'string' ? body.displayName.trim() : '';
      if (raw.length < 1 || raw.length > 40) {
        throw errors.field('displayName', 'must be 1 to 40 characters');
      }
      await query(`update invites set display_name = $2, joined = true where id = $1`, [
        invite.id,
        raw,
      ]);
      const updated = { ...invite, display_name: raw, joined: true };
      return tx(async (client) => {
        await broadcastSession(client, session);
        return testerView(client, session, updated);
      });
    },
  },
  {
    method: 'POST',
    pattern: '/api/play/:token/solves',
    body: 'json',
    async handler(ctx) {
      const invite = await inviteByToken(ctx.params.token);
      const session = await openSessionOfInvite(invite);
      const body = asRecord(ctx.body);
      if (session.state !== 'running') throw errors.sessionNotRunning();
      if (!invite.joined) throw errors.notJoined();
      if (!liveUp()) throw errors.liveUnavailable();
      const nodeId = typeof body.nodeId === 'string' ? body.nodeId : '';
      const answer = typeof body.answer === 'string' ? body.answer : null;
      const result = await tx(async (client) => {
        const row = await loadSession(client, session.id);
        if (!row) throw errors.notFound();
        const outcome = await solve(client, row, nodeId, answer, invite.display_name);
        broadcastSolves(row, outcome.logged, await chainFigures(client, row.room_id));
        await broadcastSession(client, row);
        return outcome;
      });
      if (result.ended) await endSession(session.id, 'escaped');
      return tx(async (client) => {
        const row = await loadSession(client, session.id);
        if (!row) throw errors.notFound();
        const view = await testerView(client, row, invite);
        return {
          nodes: view.nodes,
          session: view.session,
          alreadySolved: result.alreadySolved,
        };
      });
    },
  },
  {
    method: 'POST',
    pattern: '/api/play/:token/position',
    body: 'json',
    async handler(ctx) {
      const invite = await inviteByToken(ctx.params.token);
      const session = await openSessionOfInvite(invite);
      const body = asRecord(ctx.body);
      const xMm = typeof body.xMm === 'number' ? Math.round(body.xMm) : null;
      const zMm = typeof body.zMm === 'number' ? Math.round(body.zMm) : null;
      const headingDeg = typeof body.headingDeg === 'number' ? Math.round(body.headingDeg) : null;
      if (xMm === null || zMm === null || headingDeg === null) {
        throw errors.field('xMm', 'must be a whole number of millimetres');
      }
      await query(`update invites set x_mm = $2, z_mm = $3, heading_deg = $4 where id = $1`, [
        invite.id,
        xMm,
        zMm,
        headingDeg,
      ]);
      const data = {
        sessionId: session.id,
        displayName: invite.display_name ?? '',
        xMm,
        zMm,
        headingDeg,
      };
      publish(sessionChannel(session.id), { event: 'tester', data });
      publish(roomChannel(session.room_id), { event: 'tester', data });
      return undefined;
    },
  },
];
