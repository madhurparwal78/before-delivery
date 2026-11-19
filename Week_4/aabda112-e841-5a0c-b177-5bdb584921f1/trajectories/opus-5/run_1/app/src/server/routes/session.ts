import { Router } from 'express';
import { browserSettings, TIME_ZONE } from '../config';
import { clinicToday, serverNowIso } from '../clock';
import { one, query } from '../db';
import { AppError } from '../errors';
import { body, ok, route } from '../http';
import {
  createSession,
  currentActor,
  destroySession,
  landingFor,
  requireActor,
  verifyPassword,
  type Role,
} from '../auth';
import { addSubscriber, heartbeat } from '../live';
import { storageReachable } from '../storage';

export const sessionRouter = Router();

sessionRouter.get(
  '/api/health',
  route(async () => {
    try {
      await query('select 1');
    } catch {
      return { status: 503, body: { status: 'down' } };
    }
    const storage = await storageReachable();
    return ok({ status: storage ? 'ok' : 'unavailable' });
  }),
);

sessionRouter.get(
  '/api/time',
  route(async () =>
    ok({ now: serverNowIso(), clinicDate: clinicToday(), timeZone: TIME_ZONE }),
  ),
);

sessionRouter.get(
  '/api/settings',
  route(async () => ok(browserSettings)),
);

sessionRouter.post(
  '/api/session',
  route(async (request, response) => {
    const input = body(request);
    const email = typeof input.email === 'string' ? input.email.trim() : '';
    const password = typeof input.password === 'string' ? input.password : '';
    const user = await one<{ id: string; password_hash: string | null; status: string }>(
      `select id, password_hash, status from users
        where lower(email) = lower($1) order by created_at limit 1`,
      [email],
    );
    if (!user || user.status !== 'Active' || !verifyPassword(password, user.password_hash)) {
      throw new AppError('invalid_credentials');
    }
    await createSession(user.id, response);
    const profile = await loadProfile(user.id);
    return ok({ user: profile, landing: landingFor(input.next) });
  }),
);

sessionRouter.delete(
  '/api/session',
  route(async (request, response) => {
    await destroySession(request, response);
  }),
);

sessionRouter.get(
  '/api/me',
  route(async (request) => {
    const actor = await requireActor(request);
    return ok(await loadProfile(actor.id));
  }),
);

export async function loadProfile(userId: string): Promise<Record<string, unknown>> {
  const row = await one<{
    id: string;
    name: string;
    role: Role;
    clinic_id: string;
    clinic_name: string;
    slug: string;
    email: string;
  }>(
    `select u.id, u.name, u.role, u.email, c.id as clinic_id, c.name as clinic_name, c.slug
       from users u join clinics c on c.id = u.clinic_id where u.id = $1`,
    [userId],
  );
  if (!row) throw new AppError('unauthenticated');
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    email: row.email,
    clinic: { id: row.clinic_id, name: row.clinic_name, slug: row.slug },
  };
}

sessionRouter.get(
  '/api/live',
  route(async (request, response) => {
    const actor = await currentActor(request);
    if (!actor) throw new AppError('unauthenticated');
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    response.write(`data: ${JSON.stringify({ kind: 'hello' })}\n\n`);
    const remove = addSubscriber(actor.clinicId, actor.id, response);
    request.on('close', () => {
      remove();
      response.end();
    });
  }),
);

setInterval(heartbeat, 20_000).unref();
