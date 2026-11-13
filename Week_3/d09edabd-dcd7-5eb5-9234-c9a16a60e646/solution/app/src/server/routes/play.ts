import { fail, notFound } from '../errors.js';
import { hub, playtestChannel, publishPlaytest } from '../events.js';
import { json, route, type Ctx } from '../http.js';
import { mailer } from '../mail.js';
import { logSolve, playSessionFrom, playView, publishSession, publishSolves, settleExpired, type InviteContext, type PlaytestRow } from '../domain/playtests.js';
import type { RoomRow } from '../domain/rooms.js';
import { openEventStream } from '../sse.js';
import { UUID } from '../validate.js';
import { isFinished, isRunning } from '../../shared/playtest.js';
import { valkey } from '../valkey.js';
import { readSolve, solveConflict } from './playtests.js';
import type { Session } from '../../shared/types.js';

/** A capability link: reaches only its own session. Unknown or revoked is 404, a finished session 410. */
async function loadInvite(ctx: Ctx): Promise<InviteContext> {
  const found = await ctx.db.query<InviteContext['invite'] & { playtest_id: string }>(
    `SELECT id, email, display_name, joined, playtest_id FROM invites WHERE token = $1 AND revoked_at IS NULL`, [ctx.params.token],
  );
  const invite = found.rows[0];
  if (!invite) throw notFound();
  await settleExpired(invite.playtest_id, ctx.now);
  const row = (await ctx.db.query<PlaytestRow>(`SELECT * FROM playtests WHERE id = $1`, [invite.playtest_id])).rows[0]!;
  if (isFinished(row.state)) throw fail(410, 'invite_expired');
  const room = (await ctx.db.query<RoomRow>(`SELECT * FROM rooms WHERE id = $1`, [row.room_id])).rows[0]!;
  return { invite, row, room };
}

export function playRoutes(): void {
  route('GET', '/api/play/:token', {
    auth: 'none',
    load: loadInvite,
    run: async (ctx, invite) => json(200, await playView(ctx.db, invite, ctx.now)),
  });

  route('POST', '/api/play/:token/join', {
    auth: 'none',
    transaction: true,
    load: loadInvite,
    validate: (ctx) => {
      const input = ctx.input();
      const name = input.text('displayName', 1, 40, { trim: true });
      input.fields.check();
      return name!;
    },
    run: async (ctx, invite, name) => {
      await ctx.db.query(`UPDATE invites SET display_name = $2, joined = true WHERE id = $1`, [invite.invite.id, name]);
      ctx.after.push(() => publishSession(invite.room.id, invite.row.id));
      return json(200, await playView(ctx.db, { ...invite, invite: { ...invite.invite, display_name: name, joined: true } }));
    },
  });

  route('POST', '/api/play/:token/solves', {
    auth: 'none',
    transaction: true,
    load: async (ctx) => {
      const loaded = await loadInvite(ctx);
      const locked = (await ctx.db.query<PlaytestRow>(`SELECT * FROM playtests WHERE id = $1 FOR UPDATE`, [loaded.row.id])).rows[0]!;
      return { ...loaded, row: locked };
    },
    replay: async (ctx, loaded) => {
      const nodeId = (ctx.body as { nodeId?: unknown } | undefined)?.nodeId;
      if (typeof nodeId !== 'string' || !UUID.test(nodeId)) return undefined;
      const done = await ctx.db.query(`SELECT 1 FROM solves WHERE playtest_id = $1 AND node_id = $2`, [loaded.row.id, nodeId]);
      if (done.rows.length === 0) return undefined;
      const view = await playView(ctx.db, loaded);
      return json(200, { nodes: view.nodes, session: view.session, alreadySolved: true });
    },
    conflict: (ctx, loaded) => solveConflict(ctx, loaded.row, loaded.invite),
    validate: (ctx, loaded) => readSolve(ctx, loaded.row),
    needs: ['valkey'],
    run: async (ctx, loaded, node) => {
      const now = new Date();
      const solved = await logSolve(ctx.db, loaded.row, node, loaded.invite.display_name ?? '', now);
      if (solved.row.state === 'ended') ctx.after.push(() => mailer.kick());
      ctx.after.push(() => publishSolves(solved.row, solved.logged));
      const view = await playView(ctx.db, { ...loaded, row: solved.row }, now);
      return json(200, { nodes: view.nodes, session: view.session, alreadySolved: false });
    },
  });

  route('POST', '/api/play/:token/position', {
    auth: 'none',
    load: loadInvite,
    conflict: async (_ctx, { row, invite }) => {
      if (!isRunning(row.state)) throw fail(409, 'session_not_running');
      if (!invite.joined) throw fail(409, 'not_joined');
    },
    validate: (ctx) => {
      const input = ctx.input();
      const out = { xMm: input.int('xMm', -1_000_000, 1_000_000), zMm: input.int('zMm', -1_000_000, 1_000_000), headingDeg: input.int('headingDeg', 0, 359) };
      input.fields.check();
      return out as { xMm: number; zMm: number; headingDeg: number };
    },
    run: async (ctx, { row, invite }, position) => {
      ctx.after.push(() => publishPlaytest(row.room_id, row.id, 'tester', { sessionId: row.id, displayName: invite.display_name, ...position }));
      return { status: 204 };
    },
  });

  route('GET', '/api/play/:token/events', {
    auth: 'none',
    load: loadInvite,
    run: async (_ctx, { row }) => ({
      stream: (res) => {
        const writer = openEventStream(res);
        writer.onClose(
          hub.subscribe(playtestChannel(row.id), (event, data) => {
            if (event === 'session') writer.send('session', { session: playSessionFrom((data as { session: Session }).session) });
            else writer.send(event, data);
          }),
        );
        writer.send('live', { available: valkey.available });
      },
    }),
  });
}
