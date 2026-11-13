import type { SeedBody, UserBody } from '../../shared/api.js';
import { startSession } from '../auth.js';
import { iso, moveClock, serverNow } from '../clock.js';
import { pool, tx } from '../db.js';
import { runDeadlines } from '../deadlines.js';
import { fail } from '../errors.js';
import { ok, route } from '../http.js';
import { MSG } from '../messages.js';
import { seedWorld } from '../seed.js';

const MAX_ADVANCE_MS = 604800000;

// Mounted only when CUPFOLD_GRADING=1; otherwise these paths are unknown routes and answer 404.
export function registerGrading(): void {
  route('POST', '/api/grading/seed', async (ctx) => {
    const body = ctx.json() as unknown as SeedBody;
    const now = await serverNow();
    return ok(await tx((c) => seedWorld(c, body, now)), 201);
  }, { auth: false });

  route('POST', '/api/grading/session', async (ctx) => {
    const username = String(ctx.json()['username'] ?? '').toLowerCase();
    const { rows } = await pool.query<{ id: string }>('SELECT id FROM users WHERE username = $1', [username]);
    const user = rows[0] ?? fail('not_found', MSG.pageNotFound);
    const reply: UserBody = { user: { username } };
    return ok(reply, 200, { 'Set-Cookie': await startSession(pool, user.id, await serverNow()) });
  }, { auth: false });

  route('POST', '/api/grading/clock', async (ctx) => {
    const advance = ctx.json()['advance_ms'];
    if (typeof advance !== 'number' || !Number.isInteger(advance) || advance < 0 || advance > MAX_ADVANCE_MS) {
      fail('validation', MSG.checkFields, { fields: { advance_ms: `Enter a whole number from 0 to ${MAX_ADVANCE_MS}.` } });
    }
    const now = await moveClock(advance);
    await runDeadlines();
    return ok({ server_time: iso(now) });
  }, { auth: false });
}
