import { config } from '../config.js';
import { forbidden, notFound, validation } from '../errors.js';
import { FIELD_COPY } from '../../shared/copy.js';
import { serverNowIso, setGradingClock } from '../clock.js';
import { queryOne } from '../db.js';
import { runSeed } from '../seed.js';
import { createSession } from '../sessions.js';
import { sendJson, setSessionCookie, type RequestContext } from '../http.js';
import { homeRouteFor } from './auth.js';
import { emitAllClassroomStates } from '../stream.js';

const checkToken = (token: string | undefined): void => {
  if (token !== config.gradingToken) throw forbidden();
};

export const gradingSeed = async (ctx: RequestContext): Promise<void> => {
  const header = ctx.req.headers['x-grading-token'];
  checkToken(typeof header === 'string' ? header : undefined);
  const seed = await runSeed();
  await emitAllClassroomStates();
  sendJson(ctx, 200, seed);
};

export const gradingSession = async (ctx: RequestContext): Promise<void> => {
  checkToken(ctx.url.searchParams.get('token') ?? undefined);
  const userId = ctx.url.searchParams.get('user') ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw notFound();
  const account = await queryOne<{ id: string; kind: 'educator' | 'personal' | 'student' }>(
    'select id, kind from accounts where id = $1',
    [userId],
  );
  if (!account) throw notFound();
  setSessionCookie(ctx, await createSession(account.id));
  ctx.res.writeHead(302, { location: homeRouteFor(account.kind), 'cache-control': 'no-store' });
  ctx.res.end();
};

export const gradingClock = async (
  ctx: RequestContext,
  body: Record<string, unknown>,
): Promise<void> => {
  const header = ctx.req.headers['x-grading-token'];
  checkToken(typeof header === 'string' ? header : undefined);
  if (body.now === null) {
    setGradingClock(null);
  } else if (typeof body.now === 'string') {
    const parsed = new Date(body.now);
    if (Number.isNaN(parsed.getTime())) throw validation({ now: FIELD_COPY.localFormat });
    setGradingClock(parsed);
  } else {
    throw validation({ now: FIELD_COPY.localFormat });
  }
  await emitAllClassroomStates();
  sendJson(ctx, 200, { now: serverNowIso() });
};
