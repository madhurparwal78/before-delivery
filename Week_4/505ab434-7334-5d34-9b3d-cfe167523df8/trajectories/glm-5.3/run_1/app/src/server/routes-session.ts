import type { Ctx, Method } from './http';
import { requireSession } from './http';
import { notFound, forbidden } from './errors';
import { checkCredentials } from './principals';
import { createSession, endSession, cookieHeader, clearCookieHeader } from './sessions';
import { readClock } from './clock';
import type { Config } from './config';
import { calendarDateOf } from './datetime';
import { query } from './db';

export function routeApi(router: { add: (m: Method, p: string, h: (ctx: Ctx) => Promise<unknown>) => void }, cfg: Config): void {
  router.add('GET', '/health', async () => {
    const ok = await storageReachable();
    return { status: ok ? 'ok' : 'unavailable' };
  });

  router.add('POST', '/session', async (ctx) => {
    const body = asRecord(ctx.body.json);
    const principal = await checkCredentials(body.email, body.password);
    const token = await createSession(principal.id);
    ctx.setCookies.push(cookieHeader(cfg.sessionCookieName, token));
    return { principal: principalBody(principal) };
  });

  router.add('DELETE', '/session', async (ctx) => {
    const cookies = ctx.cookies;
    const token = cookies[cfg.sessionCookieName];
    if (token) await endSession(token);
    ctx.setCookies.push(clearCookieHeader(cfg.sessionCookieName));
    return null;
  });

  router.add('GET', '/me', async (ctx) => {
    const principal = requireSession(ctx);
    const now = await readClock(cfg);
    const org = principal.organisationId
      ? await query<{ name: string; territory: string; engagement_starts_on: string | null; engagement_ends_on: string | null; engagement_territories: string[] }>(
          'SELECT name, territory, engagement_starts_on::text, engagement_ends_on::text, engagement_territories FROM organisations WHERE id = $1',
          [principal.organisationId],
        )
      : [];
    return {
      principal: principalBody(principal),
      today: calendarDateOf(now, cfg.appTimeZone),
      now: now.toISOString(),
      timeZone: cfg.appTimeZone,
      weightAnnounceDelayMs: cfg.weightAnnounceDelayMs,
      organisation: org.length > 0
        ? {
            id: principal.organisationId,
            name: org[0].name,
            territory: org[0].territory,
            engagement: {
              startsOn: org[0].engagement_starts_on,
              endsOn: org[0].engagement_ends_on,
              territories: org[0].engagement_territories,
            },
          }
        : null,
    };
  });
}

async function storageReachable(): Promise<boolean> {
  const started = Date.now();
  try {
    const res = await fetch(`${cfgS3Endpoint()}/minio/health/live`, { signal: AbortSignal.timeout(800) });
    void res;
    return res.ok;
  } catch {
    void started;
    return false;
  }
}

function cfgS3Endpoint(): string {
  const ep = process.env.S3_ENDPOINT ?? '';
  return ep.replace(/\/+$/, '');
}

export function principalBody(principal: { id: string; displayName: string; role: string; organisationId: string | null }) {
  return {
    id: principal.id,
    displayName: principal.displayName,
    role: principal.role,
    organisationId: principal.organisationId,
  };
}

export function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export { notFound, forbidden, query };
