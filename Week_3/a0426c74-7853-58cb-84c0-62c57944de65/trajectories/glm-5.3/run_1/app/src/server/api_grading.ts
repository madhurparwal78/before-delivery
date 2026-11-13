import { pool } from './db.js';
import { ApiError, ERROR_TEXT } from '../shared/errors.js';
import { router, config, storage, serverNow, setStorageDown, liveHub, requireUser, drawingRole, applyOperationGroup, randomId, formatUtc, loadDrawing, saveModel } from './api.js';
import { roleForDrawing } from './auth.js';
import { runSeed } from './seed.js';
import { advanceClock, applyDeadlines } from './clock.js';
import type { OpBody } from './api.js';

// ---------------------------------------------------------------------------
// Grading routes. They answer not_found unless PLOT_GRADING is 1.
// ---------------------------------------------------------------------------

function gradingEnabled(): boolean {
  if (!config.grading) throw new ApiError('not_found', 'We couldn\u2019t find that page.');
  return true;
}

router.add('POST', '/api/grading/seed', async (context) => {
  gradingEnabled();
  const outcome = await runSeed((context.body ?? {}) as never, { storage, now: serverNow(), linkTtlMs: config.linkTtlMs, reviewTtlMs: config.reviewTtlMs });
  context.response.writeHead(201, { 'content-type': 'application/json; charset=utf-8' });
  context.response.end(JSON.stringify(outcome));
  return undefined;
});

router.add('POST', '/api/grading/session', async (context) => {
  gradingEnabled();
  const body = (context.body ?? {}) as { username?: unknown };
  const username = String(body.username ?? '');
  const user = await pool.query<{ username: string }>('SELECT username FROM users WHERE username = $1', [username]);
  if (!user.rows[0]) throw new ApiError('not_found', 'We couldn\u2019t find that person.');
  const { createSession } = await import('./auth.js');
  const token = await createSession(username);
  context.response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'set-cookie': `plot_session=${token}; HttpOnly; SameSite=Lax; Path=/` });
  context.response.end(JSON.stringify({ username }));
  return undefined;
});

router.add('POST', '/api/grading/view', async (context) => {
  gradingEnabled();
  await requireUser(context);
  const body = (context.body ?? {}) as { drawing?: unknown; zoom?: unknown; pan_x?: unknown; pan_y?: unknown };
  const drawingId = String(body.drawing ?? '');
  await drawingRole(context, drawingId);
  await pool.query(
    `INSERT INTO drawing_views (drawing_id, username, zoom, pan_x, pan_y) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (drawing_id, username) DO UPDATE SET zoom = $3, pan_x = $4, pan_y = $5`,
    [drawingId, context.username, Number(body.zoom ?? 1), Number(body.pan_x ?? 0), Number(body.pan_y ?? 0)],
  );
  context.response.writeHead(204);
  context.response.end();
  return undefined;
});

router.add('POST', '/api/grading/clock', async (context) => {
  gradingEnabled();
  const body = (context.body ?? {}) as { advance_ms?: unknown };
  const advance = Number(body.advance_ms ?? 0);
  const now = await advanceClock(advance);
  await applyDeadlines(now);
  return { now: formatUtc(now) };
});

router.add('POST', '/api/grading/drawings/:id/ops', async (context) => {
  gradingEnabled();
  const body = (context.body ?? {}) as { as?: unknown } & OpBody;
  const as = String(body.as ?? context.username ?? '');
  const role = await roleForDrawing(context.params.id, as);
  if (!role) throw new ApiError('not_found', 'We couldn\u2019t find that drawing.');
  return applyOperationGroup(
    context.params.id,
    as,
    body,
    { command: String(body.command ?? 'EDIT'), groupId: String(body.group_id ?? randomId('g')) },
  );
});

router.add('POST', '/api/grading/storage', async (context) => {
  gradingEnabled();
  const body = (context.body ?? {}) as { down?: unknown };
  const down = Boolean(body.down);
  setStorageDown(down);
  return { down };
});

export { gradingEnabled };
