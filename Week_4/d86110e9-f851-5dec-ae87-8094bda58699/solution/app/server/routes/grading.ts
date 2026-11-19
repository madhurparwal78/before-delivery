import { advanceClock, clockOffsetSeconds, iso, setClock, workspaceNow } from '../clock.js';
import { config } from '../config.js';
import { db } from '../db.js';
import { applySetup, type SetupSpec } from '../grading.js';
import { refuse } from '../errors.js';
import type { Ctx, Route } from '../http.js';
import { msg } from '../messages.js';
import { processDue } from '../timers.js';

function requireKey(ctx: Ctx): void {
  if (ctx.request.headers['x-grading-key'] !== config.gradingKey) throw refuse.notFound();
}

export const gradingRoutes: Route[] = [
  {
    method: 'POST', path: '/api/grading/setup', auth: 'public', anyOrigin: true, body: 'json',
    async check(ctx) {
      requireKey(ctx);
    },
    async handle(ctx) {
      return { status: 200, body: await applySetup(ctx.body as SetupSpec, true) };
    },
  },
  {
    method: 'POST', path: '/api/grading/workspaces/:id/clock', auth: 'public', anyOrigin: true, body: 'json',
    async check(ctx) {
      requireKey(ctx);
      const found = await db.query('SELECT 1 FROM workspaces WHERE id = $1', [ctx.params.id ?? '']);
      if (found.rows.length === 0) throw refuse.notFound();
    },
    async handle(ctx) {
      const id = ctx.params.id ?? '';
      const { advance_seconds: advance, set } = ctx.body;
      const wantsAdvance = advance !== undefined;
      const wantsSet = set !== undefined;
      if (wantsAdvance === wantsSet) throw refuse.invalid(msg.gradingBody);
      if (wantsAdvance) {
        if (typeof advance !== 'number' || !Number.isInteger(advance) || advance < 0) throw refuse.invalid(msg.gradingBody);
        await advanceClock(id, advance);
      } else {
        const instant = typeof set === 'string' ? Date.parse(set) : Number.NaN;
        if (Number.isNaN(instant)) throw refuse.invalid(msg.gradingBody);
        await setClock(id, instant);
      }
      await processDue(id);
      return { status: 200, body: { now: iso(await workspaceNow(id)), offset_seconds: await clockOffsetSeconds(id) } };
    },
  },
];
