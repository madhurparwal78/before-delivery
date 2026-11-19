import type { JoinBody } from '../../shared/wire';
import { callerFor, createAuthSession, learnerCanOpen } from '../access';
import { one, pool, run, tx } from '../db';
import { RUNNING_STATES } from '../../shared/states';
import { notFound, Refusal } from '../errors';
import { characters, cookieOf, reply, SESSION_COOKIE, sessionCookie, textOf, type Route } from '../http';
import { newId } from '../ids';

export const joinRoutes: Route[] = [
  {
    method: 'POST',
    path: '/api/join',
    handler: async (ctx) => {
      const body = await ctx.json();
      const code = (textOf(body.code) ?? '').replace(/\s+/g, '').toUpperCase();
      const cls = await one<{ id: string; world_id: string }>(pool, 'SELECT id, world_id FROM classes WHERE code = $1', [code]);
      if (!cls) throw notFound();
      const session = await one<{ id: string; locked: boolean }>(pool, 'SELECT id, locked FROM sessions WHERE class_id = $1 AND state = ANY($2)', [
        cls.id,
        RUNNING_STATES,
      ]);
      if (!session) throw new Refusal(409, "This class isn't open right now.");
      const caller = await callerFor(ctx.req);
      const existing = caller?.kind === 'learner' && caller.worldId === cls.world_id ? caller : null;
      const alreadyIn = existing !== null && (await learnerCanOpen(session.id, existing.id));
      if (session.locked && !alreadyIn) throw new Refusal(409, 'This class is locked. Ask your teacher to let you in.');
      const displayName = textOf(body.displayName)?.trim() ?? '';
      if (!existing && (characters(displayName) < 1 || characters(displayName) > 40)) throw new Refusal(422, 'Enter a name of 1 to 40 characters.');
      const learnerId = existing?.id ?? newId('lrn');
      // Concurrent joins by one learner run one at a time, so exactly one of them is the first join (201).
      const firstJoin = await tx(async (client) => {
        let wasIn = false;
        if (existing) {
          await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`join:${session.id}:${learnerId}`]);
          wasIn = await learnerCanOpen(session.id, learnerId, client);
        }
        if (!existing) await run(client, 'INSERT INTO learners (id, world_id, display_name) VALUES ($1, $2, $3)', [learnerId, cls.world_id, displayName]);
        await run(client, 'INSERT INTO enrolments (class_id, learner_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [cls.id, learnerId]);
        await run(
          client,
          'INSERT INTO session_learners (session_id, learner_id, joined) VALUES ($1, $2, true) ON CONFLICT (session_id, learner_id) DO UPDATE SET joined = true',
          [session.id, learnerId],
        );
        return !wasIn;
      });
      const token = (existing && cookieOf(ctx.req.headers, SESSION_COOKIE)) || (await createAuthSession('learner', learnerId));
      const joined: JoinBody = { sessionId: session.id, learnerId };
      return reply(firstJoin ? 201 : 200, joined, { 'Set-Cookie': sessionCookie(token) });
    },
  },
];
