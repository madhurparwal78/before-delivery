import { now } from '../clock.js';
import { copy } from '../copy.js';
import { ApiError, invalid } from '../errors.js';
import { readBody } from '../fields.js';
import { isOfficeDate, officeDate } from '../officeTime.js';
import { readBilling } from '../domain/seats.js';
import { emptyCounts, feedState, runBreachCheck, snapshotFor } from '../domain/health.js';
import { credentialJson } from '../domain/credentials.js';
import { loadDrawerContext } from '../views.js';
import type { Route } from '../http.js';

const DESK_STAFF = ['office_manager', 'managing_partner'] as const;

async function reportFor(day: string, at: Date): Promise<Record<string, unknown>> {
  const isToday = day === officeDate(at);
  const snapshot = await snapshotFor(day, isToday);
  const feed = await feedState();
  if (snapshot === null) {
    return {
      office_date: day,
      feed,
      last_good_check_at: null,
      counts: emptyCounts,
      credentials: [],
    };
  }
  const context = await loadDrawerContext(at);
  const credentials = context.credentials
    .filter((credential) => (snapshot.health.get(credential.id)?.health ?? 'sound') !== 'sound')
    .map((credential) => ({
      ...credentialJson(credential, context),
      health: snapshot.health.get(credential.id)?.health,
    }));
  return {
    office_date: day,
    feed,
    last_good_check_at: snapshot.at.toISOString(),
    counts: snapshot.counts,
    credentials,
  };
}

export const reportRoutes: Route[] = [
  {
    method: 'GET',
    path: '/api/billing',
    roles: DESK_STAFF,
    handler: async () => ({ status: 200, body: await readBilling() }),
  },
  {
    method: 'GET',
    path: '/api/health-report',
    roles: DESK_STAFF,
    handler: async (ctx) => {
      const at = now();
      const today = officeDate(at);
      const given = ctx.query.get('day');
      if (given !== null && (!isOfficeDate(given) || given > today)) {
        throw invalid({ day: 'Pick an office day up to today.' });
      }
      return { status: 200, body: await reportFor(given ?? today, at) };
    },
  },
  {
    method: 'POST',
    path: '/api/health-report/checks',
    roles: ['office_manager'],
    handler: async (ctx) => {
      readBody(ctx.body, {});
      const outcome = await runBreachCheck();
      if (!outcome.ok) {
        const snapshot = await snapshotFor(officeDate(outcome.at), true);
        throw new ApiError(503, 'breach_feed_unreachable', copy.breachFeedUnreachable(snapshot?.at ?? null));
      }
      const at = now();
      return { status: 200, body: await reportFor(officeDate(at), at) };
    },
  },
];
